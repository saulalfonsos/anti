// Servidor MCP mínimo (P13-c, T1, D280). El protocolo se prueba sin procesos: entra una línea JSON-RPC y sale una línea (o
// ninguna, si el mensaje es una notificación), con herramientas reales hechas con `tool()`. El borde stdio, que lee y escribe
// líneas de verdad, se prueba aparte (`anti-mcp-script.test.ts`).
import { expect, test } from "bun:test"
import { Schema } from "effect"
import { PROTOCOL_VERSION, handler, tool, type CallRecord } from "../src/protocol"
import { CONVERSATION_META, MCP_AGY_SERVER, MCP_SERVER, MCP_TOOL, mcpRules } from "../src/names"

const decode = Schema.decodeUnknownSync(Schema.UnknownFromJsonString)

const eco = tool({
  name: "eco",
  description: "Repite el texto.",
  input: Schema.Struct({ texto: Schema.String, veces: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))) }),
  call: async (args, meta) => ({ text: `${args.texto.repeat(args.veces ?? 1)}${meta.conversation ? ` [${meta.conversation}]` : ""}`, stats: { llamadas: 1 } }),
})
const rota = tool({
  name: "rota",
  description: "Siempre lanza.",
  input: Schema.Struct({}),
  call: async () => {
    throw new Error("disco lleno")
  },
})
const rotaSinMensaje = tool({
  name: "rota_sin_mensaje",
  description: "Lanza algo que no es un Error.",
  input: Schema.Struct({}),
  call: async () => {
    throw "solo texto"
  },
})
const falla = tool({ name: "falla", description: "Devuelve un error de la herramienta.", input: Schema.Struct({}), call: async () => ({ text: "no pude", isError: true }) })

const records: CallRecord[] = []
const serve = handler({ name: MCP_SERVER, version: "9.9.9", tools: [eco, rota, rotaSinMensaje, falla], onCall: (record) => records.push(record) })
const send = async (message: unknown): Promise<unknown> => {
  const line = await serve(JSON.stringify(message))
  return line === undefined ? undefined : decode(line)
}
const call = (params: unknown) => send({ jsonrpc: "2.0", id: 7, method: "tools/call", params })
const failure = (id: string | number | null, code: number) => expect.objectContaining({ jsonrpc: "2.0", id, error: expect.objectContaining({ code }) })

test("D280: una entrada que no es JSON da -32700 con id null, en una sola línea", async () => {
  const line = await serve("{esto no es json")
  expect(line).not.toContain("\n")
  expect(decode(line ?? "")).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32700, message: expect.stringContaining("JSON") } })
})

test.each([
  ["jsonrpc distinto de 2.0", { jsonrpc: "1.0", id: 1, method: "ping" }],
  ["sin jsonrpc", { id: 1, method: "ping" }],
  ["method que no es cadena", { jsonrpc: "2.0", id: 1, method: 3 }],
  ["sin method (una respuesta del cliente)", { jsonrpc: "2.0", id: 1, result: {} }],
  ["un lote (array)", [{ jsonrpc: "2.0", id: 1, method: "ping" }]],
  ["una cadena", "ping"],
  ["null", null],
  ["id null (MCP no lo admite)", { jsonrpc: "2.0", id: null, method: "ping" }],
  ["id que no es cadena ni número", { jsonrpc: "2.0", id: {}, method: "ping" }],
])("D280: JSON que no es un mensaje JSON-RPC 2.0 (%s) da -32600 con id null", async (_caso, message) => {
  expect(await send(message)).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32600, message: expect.stringContaining("JSON-RPC") } })
})

test("D280: un mensaje sin id es una notificación y no recibe respuesta, ni siquiera si es de un método desconocido o de tools/call", async () => {
  records.length = 0
  expect(await send({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeUndefined()
  expect(await send({ jsonrpc: "2.0", method: "notifications/roots/list_changed", params: { x: 1 } })).toBeUndefined()
  expect(await send({ jsonrpc: "2.0", method: "metodo/inventado" })).toBeUndefined()
  // Sin id no hay a quién devolver el resultado: no se ejecuta nada.
  expect(await send({ jsonrpc: "2.0", method: "tools/call", params: { name: "eco", arguments: { texto: "a" } } })).toBeUndefined()
  expect(records).toEqual([])
})

test("D280: initialize responde con capacidades de herramientas, serverInfo y la versión de protocolo del cliente", async () => {
  expect(await send({ jsonrpc: "2.0", id: "init-1", method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "agy", version: "1.2.14" } } })).toEqual({
    jsonrpc: "2.0",
    id: "init-1",
    result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: MCP_SERVER, version: "9.9.9" } },
  })
})

test.each([
  ["sin params", undefined],
  ["sin protocolVersion", { capabilities: {} }],
  ["protocolVersion que no es cadena", { protocolVersion: 2025 }],
])("D280: initialize %s responde con PROTOCOL_VERSION", async (_caso, params) => {
  expect(await send({ jsonrpc: "2.0", id: 1, method: "initialize", params })).toEqual({
    jsonrpc: "2.0",
    id: 1,
    result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: MCP_SERVER, version: "9.9.9" } },
  })
})

test("D280: ping responde {} y devuelve el id tal cual, sea cadena o número", async () => {
  expect(await send({ jsonrpc: "2.0", id: 3, method: "ping" })).toEqual({ jsonrpc: "2.0", id: 3, result: {} })
  expect(await send({ jsonrpc: "2.0", id: "p-3", method: "ping" })).toEqual({ jsonrpc: "2.0", id: "p-3", result: {} })
})

test("D280: tools/list da nombre, descripción e inputSchema de cada herramienta, en el orden dado", async () => {
  const reply = await send({ jsonrpc: "2.0", id: 2, method: "tools/list" })
  expect(reply).toEqual({
    jsonrpc: "2.0",
    id: 2,
    result: {
      tools: [eco, rota, rotaSinMensaje, falla].map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
    },
  })
  expect(eco.inputSchema).toEqual({
    type: "object",
    properties: { texto: { type: "string" }, veces: { type: "integer", minimum: 1 } },
    required: ["texto"],
  })
})

test("D280: tools/call devuelve el texto como content y solo marca isError cuando la herramienta lo marca", async () => {
  expect(await call({ name: "eco", arguments: { texto: "ab", veces: 2 } })).toEqual({ jsonrpc: "2.0", id: 7, result: { content: [{ type: "text", text: "abab" }] } })
  expect(await call({ name: "falla", arguments: {} })).toEqual({ jsonrpc: "2.0", id: 7, result: { content: [{ type: "text", text: "no pude" }], isError: true } })
})

test("D280: onCall recibe herramienta, argumentos, meta y resultado de cada llamada, después de ejecutarla", async () => {
  records.length = 0
  await call({ name: "eco", arguments: { texto: "a" }, _meta: { [CONVERSATION_META]: "conv-1", otro: 1 } })
  await call({ name: "eco", arguments: { texto: "b" } })
  // Sin `arguments` se pasa {}: la herramienta decide si le basta.
  await call({ name: "falla" })
  expect(records).toEqual([
    { tool: "eco", args: { texto: "a" }, meta: { conversation: "conv-1" }, result: { text: "a [conv-1]", stats: { llamadas: 1 } } },
    { tool: "eco", args: { texto: "b" }, meta: {}, result: { text: "b", stats: { llamadas: 1 } } },
    { tool: "falla", args: {}, meta: {}, result: { text: "no pude", isError: true } },
  ])
})

test("D280: el _meta REAL de agy 1.2.14, con sus tres claves (artifacts_dir, conversation_id y progressToken), no rompe la llamada: se toma la conversación y las demás se ignoran", async () => {
  records.length = 0
  const real = { "antigravity.google/artifacts_dir": "/tmp/agy-artifacts/conv-123", [CONVERSATION_META]: "conv-123", progressToken: 1 }
  expect(await call({ name: "eco", arguments: { texto: "a" }, _meta: real })).toEqual({ jsonrpc: "2.0", id: 7, result: { content: [{ type: "text", text: "a [conv-123]" }] } })
  // El orden de las claves y el tipo del token no importan.
  const reordered = { progressToken: "tok-1", [CONVERSATION_META]: "conv-456", "antigravity.google/artifacts_dir": "/tmp/otro" }
  expect(await call({ name: "eco", arguments: { texto: "b" }, _meta: reordered })).toEqual({ jsonrpc: "2.0", id: 7, result: { content: [{ type: "text", text: "b [conv-456]" }] } })
  expect(records.map((r) => r.meta)).toEqual([{ conversation: "conv-123" }, { conversation: "conv-456" }])
  // Sin la clave de conversación, las otras dos solas no inventan una.
  await call({ name: "eco", arguments: { texto: "c" }, _meta: { "antigravity.google/artifacts_dir": "/tmp/x", progressToken: 2 } })
  expect(records.at(-1)?.meta).toEqual({})
})

test.each([
  ["cadena vacía", ""],
  ["número", 42],
  ["null", null],
])("D280: un _meta[CONVERSATION_META] que es %s no es una conversación", async (_caso, valor) => {
  records.length = 0
  await call({ name: "eco", arguments: { texto: "x" }, _meta: { [CONVERSATION_META]: valor } })
  expect(records.map((r) => r.meta)).toEqual([{}])
})

test("D280: un _meta que no es un objeto no tumba la llamada: simplemente no hay conversación", async () => {
  records.length = 0
  expect(await call({ name: "eco", arguments: { texto: "x" }, _meta: "raro" })).toEqual({ jsonrpc: "2.0", id: 7, result: { content: [{ type: "text", text: "x" }] } })
  expect(records.map((r) => r.meta)).toEqual([{}])
})

test("D280: una herramienta desconocida, o params sin name, dan -32602 y no llaman a onCall", async () => {
  records.length = 0
  expect(await call({ name: "no-existe", arguments: {} })).toEqual(failure(7, -32602))
  expect(await call({ name: "no-existe", arguments: {} })).toEqual(expect.objectContaining({ error: expect.objectContaining({ message: expect.stringContaining("no-existe") }) }))
  expect(await call({ arguments: {} })).toEqual(failure(7, -32602))
  expect(await call(undefined)).toEqual(failure(7, -32602))
  expect(await call("eco")).toEqual(failure(7, -32602))
  expect(records).toEqual([])
})

test("D280: cualquier otro método con id da -32601 y nombra el método", async () => {
  expect(await send({ jsonrpc: "2.0", id: 9, method: "resources/list" })).toEqual({ jsonrpc: "2.0", id: 9, error: { code: -32601, message: expect.stringContaining("resources/list") } })
})

test("tool(): con argumentos que no decodifican no llama a call y dice el motivo", async () => {
  let llamadas = 0
  const contado = tool({ name: "contado", description: "Cuenta.", input: Schema.Struct({ n: Schema.Int }), call: async () => ({ text: String(++llamadas) }) })
  const sinCampo = await contado.invoke({}, {})
  const tipoMalo = await contado.invoke({ n: "tres" }, {})
  const noObjeto = await contado.invoke(undefined, {})
  expect([sinCampo.isError, tipoMalo.isError, noObjeto.isError]).toEqual([true, true, true])
  expect(sinCampo.text).toStartWith("argumentos no válidos")
  expect(sinCampo.text).toContain('"n"')
  expect(llamadas).toBe(0)
  expect(await contado.invoke({ n: 3 }, {})).toEqual({ text: "1" })
})

test("tool(): si call lanza, la llamada devuelve isError con el mensaje y el servidor sigue atendiendo", async () => {
  expect(await rota.invoke({}, {})).toEqual({ text: "error: disco lleno", isError: true })
  expect(await rotaSinMensaje.invoke({}, {})).toEqual({ text: "error: solo texto", isError: true })
  expect(await call({ name: "rota", arguments: {} })).toEqual({ jsonrpc: "2.0", id: 7, result: { content: [{ type: "text", text: "error: disco lleno" }], isError: true } })
  expect(await send({ jsonrpc: "2.0", id: 8, method: "ping" })).toEqual({ jsonrpc: "2.0", id: 8, result: {} })
})

test("D280: el inputSchema sale del mismo esquema que valida y es plano: sin $ref ni additionalProperties", () => {
  const anidado = tool({
    name: "anidado",
    description: "Esquema con estructuras dentro de arrays.",
    input: Schema.Struct({ items: Schema.Array(Schema.Struct({ ruta: Schema.String, desde: Schema.optionalKey(Schema.Int) })).check(Schema.isMinLength(1), Schema.isMaxLength(3)) }),
    call: async () => ({ text: "" }),
  })
  for (const t of [eco, anidado]) {
    const text = JSON.stringify(t.inputSchema)
    expect(text).not.toContain("$ref")
    expect(text).not.toContain("additionalProperties")
    expect(t.inputSchema.type).toBe("object")
  }
  expect(anidado.inputSchema).toEqual({
    type: "object",
    properties: { items: { type: "array", minItems: 1, maxItems: 3, items: { type: "object", properties: { ruta: { type: "string" }, desde: { type: "integer" } }, required: ["ruta"] } } },
    required: ["items"],
  })
})

test("D280/D283: los nombres del servidor, sus herramientas y las reglas de permiso de agy salen de un solo sitio", () => {
  expect(MCP_SERVER).toBe("anti")
  expect(MCP_TOOL).toEqual({ read: "leer", tests: "probar" })
  expect(CONVERSATION_META).toBe("antigravity.google/conversation_id")
  // agy llama `<plugin>_<servidor>` al servidor de un plugin del espacio de trabajo (medido en 1.2.14): es el nombre de las reglas.
  expect(MCP_AGY_SERVER).toBe("anti_anti")
  expect(mcpRules()).toEqual(["mcp(anti_anti/leer)", "mcp(anti_anti/probar)"])
})
