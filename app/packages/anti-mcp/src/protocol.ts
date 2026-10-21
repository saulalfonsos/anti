// Servidor MCP mínimo, hecho a mano (P13-c, D280): JSON-RPC 2.0 en líneas y los cuatro métodos que `agy` usa
// (`initialize`, `ping`, `tools/list`, `tools/call`). Una herramienta es un VALOR (`McpTool`): el despacho no conoce ninguna,
// así que añadir una no lo toca. Sin `@modelcontextprotocol/sdk` (dependencia nueva que validaría con zod): los argumentos
// se decodifican con Effect Schema y ese mismo esquema, por `toPlainJsonSchema`, es el `inputSchema` que se anuncia, de modo
// que lo que se anuncia y lo que se valida no pueden divergir.
// PURO: ni disco ni procesos. Lo que una herramienta necesita llega por sus puertos y el registro de llamadas, por `onCall`.
import { Option, Result, Schema } from "effect"
import { toPlainJsonSchema } from "./json"
import { CONVERSATION_META } from "./names"

export const PROTOCOL_VERSION = "2025-06-18"

const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602

export type CallMeta = { readonly conversation?: string }
export type ToolResult = { readonly text: string; readonly isError?: boolean; readonly stats?: Readonly<Record<string, number>> }
export type McpTool = {
  readonly name: string
  readonly description: string
  readonly inputSchema: Readonly<Record<string, unknown>>
  readonly invoke: (args: unknown, meta: CallMeta) => Promise<ToolResult>
}
export type CallRecord = { readonly tool: string; readonly args: unknown; readonly meta: CallMeta; readonly result: ToolResult }

// Una herramienta a partir de su esquema de entrada. Si los argumentos no decodifican, la llamada es un error con el motivo
// y `call` no se ejecuta; si `call` lanza, también, con el mensaje: una herramienta nunca tumba el servidor.
export function tool<A>(spec: {
  readonly name: string
  readonly description: string
  readonly input: Schema.Codec<A>
  readonly call: (args: A, meta: CallMeta) => Promise<ToolResult>
}): McpTool {
  const decode = Schema.decodeUnknownResult(spec.input)
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: toPlainJsonSchema(spec.input),
    invoke: async (args, meta) => {
      const decoded = decode(args)
      if (Result.isFailure(decoded)) return { text: `argumentos no válidos: ${decoded.failure.message}`, isError: true }
      // Frontera de la llamada: lo que lance un puerto (disco, proceso) vuelve como el error de ESTA llamada.
      try {
        return await spec.call(decoded.success, meta)
      } catch (error) {
        return { text: `error: ${error instanceof Error ? error.message : String(error)}`, isError: true }
      }
    },
  }
}

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
const decodeMessage = Schema.decodeUnknownOption(
  Schema.Struct({
    jsonrpc: Schema.Literal("2.0"),
    method: Schema.String,
    // MCP no admite `id: null`; sin id es una notificación.
    id: Schema.optionalKey(Schema.Union([Schema.String, Schema.Number])),
    params: Schema.optionalKey(Schema.Unknown),
  }),
)
const decodeInitialize = Schema.decodeUnknownOption(Schema.Struct({ protocolVersion: Schema.String }))
const decodeCall = Schema.decodeUnknownOption(Schema.Struct({ name: Schema.String, arguments: Schema.optionalKey(Schema.Unknown), _meta: Schema.optionalKey(Schema.Unknown) }))
const decodeConversation = Schema.decodeUnknownOption(Schema.Struct({ [CONVERSATION_META]: Schema.String.check(Schema.isMinLength(1)) }))

type Id = string | number | null
type Outcome = { readonly result: unknown } | { readonly code: number; readonly message: string }

// Una línea entra, una línea (sin salto final) o `undefined` sale. El borde las lee y las escribe en orden.
export function handler(spec: {
  readonly name: string
  readonly version: string
  readonly tools: readonly McpTool[]
  readonly onCall?: (record: CallRecord) => void
}): (line: string) => Promise<string | undefined> {
  const byName = new Map(spec.tools.map((candidate) => [candidate.name, candidate] as const))

  return async (line) => {
    const json = decodeJson(line)
    if (Option.isNone(json)) return answer(null, { code: PARSE_ERROR, message: "JSON no válido" })
    const message = decodeMessage(json.value)
    if (Option.isNone(message)) return answer(null, { code: INVALID_REQUEST, message: "no es un mensaje JSON-RPC 2.0" })
    // Sin id es una notificación: nadie espera respuesta, y no hay a quién devolver un resultado.
    if (message.value.id === undefined) return undefined
    return answer(message.value.id, await dispatch(message.value.method, message.value.params))
  }

  async function dispatch(method: string, params: unknown): Promise<Outcome> {
    switch (method) {
      case "initialize":
        return {
          result: {
            protocolVersion: Option.getOrUndefined(decodeInitialize(params))?.protocolVersion ?? PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: spec.name, version: spec.version },
          },
        }
      case "ping":
        return { result: {} }
      case "tools/list":
        return { result: { tools: spec.tools.map((listed) => ({ name: listed.name, description: listed.description, inputSchema: listed.inputSchema })) } }
      case "tools/call":
        return callTool(params)
      default:
        return { code: METHOD_NOT_FOUND, message: `método desconocido: ${method}` }
    }
  }

  async function callTool(params: unknown): Promise<Outcome> {
    const call = decodeCall(params)
    if (Option.isNone(call)) return { code: INVALID_PARAMS, message: "tools/call espera {name, arguments?, _meta?}" }
    const target = byName.get(call.value.name)
    if (!target) return { code: INVALID_PARAMS, message: `herramienta desconocida: ${call.value.name}` }
    const args = call.value.arguments ?? {}
    const meta = metaOf(call.value._meta)
    const result = await target.invoke(args, meta)
    spec.onCall?.({ tool: target.name, args, meta, result })
    return { result: { content: [{ type: "text", text: result.text }], ...(result.isError ? { isError: true } : {}) } }
  }
}

// El id de conversación, si `_meta` lo trae como cadena no vacía; cualquier otra forma de `_meta` no es una conversación.
function metaOf(raw: unknown): CallMeta {
  return Option.match(decodeConversation(raw), { onNone: () => ({}), onSome: (found) => ({ conversation: found[CONVERSATION_META] }) })
}

function answer(id: Id, outcome: Outcome): string {
  if ("result" in outcome) return JSON.stringify({ jsonrpc: "2.0", id, result: outcome.result })
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code: outcome.code, message: outcome.message } })
}
