// Herramienta `leer` (P13-c, D281, D282, D289): lectura por lotes y por rangos, con memoria de lo ya leído en cada
// conversación. Cambia varias llamadas a `view_file` por una, y volver a leer lo que el modelo ya tiene por «sin cambios desde
// la lectura N». Una «lectura» es una llamada a `leer` dentro de una conversación, numeradas desde 1. Todo el disco llega por
// `ReadPorts` (la raíz, `realpath` y `readFile`), así que la capa no toca el sistema de ficheros.
import { createHash } from "node:crypto"
import { Schema } from "effect"
import { MCP_TOOL } from "./names"
import type { Memo } from "./memo"
import { locate } from "./paths"
import { tool, type CallMeta, type McpTool, type ToolResult } from "./protocol"

export const MAX_FILES = 10
// Tope de las líneas numeradas que devuelve UNA llamada (las cabeceras y los avisos no cuentan: son decenas de caracteres por fichero).
export const MAX_CHARS = 60_000
// Una línea más larga (un bundle minificado, un volcado de datos) se corta con el aviso de cuánto falta. Sin este tope una sola
// línea de más de MAX_CHARS no cabría jamás y el modelo repetiría la misma petición sin poder avanzar; con él caben seis por llamada.
export const MAX_LINE_CHARS = 10_000
const BINARY_SCAN_BYTES = 8_000

export type ReadPorts = {
  readonly root: string
  readonly realpath: (path: string) => Promise<string>
  // Rechaza con el error del sistema: `code: "EISDIR"` distingue un directorio de cualquier otro fallo de lectura.
  readonly readFile: (path: string) => Promise<Uint8Array>
}

const Line = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
export const ReadArgs = Schema.Struct({
  ficheros: Schema.Array(Schema.Struct({ ruta: Schema.String, desde: Schema.optionalKey(Line), hasta: Schema.optionalKey(Line) })).check(Schema.isMinLength(1), Schema.isMaxLength(MAX_FILES)),
})

// D289: cada carácter de la descripción se paga en todas las llamadas del modelo (medido: +836 tokens con 1.952 caracteres).
const DESCRIPTION =
  `Lee de 1 a ${MAX_FILES} ficheros del proyecto en una llamada, enteros o por rango de líneas (desde, hasta), con las líneas numeradas. ` +
  "Lo ya leído en esta conversación y sin cambios no se repite: devuelve «sin cambios desde la lectura N». Úsala en lugar de view_file."

export function readTool(ports: ReadPorts, memo: Memo): McpTool {
  return tool({ name: MCP_TOOL.read, description: DESCRIPTION, input: ReadArgs, call: (args, meta) => read(ports, memo, args, meta) })
}

type Request = (typeof ReadArgs.Type)["ficheros"][number]
type Reading = { readonly conversation: string; readonly read: number }
// Lo que sale de cada fichero: su cabecera y sus líneas numeradas (ninguna si es un error, un aviso o un acierto de memoria).
type Section = { readonly header: string; readonly lines: readonly string[]; readonly failed?: true; readonly avoided?: number }

async function read(ports: ReadPorts, memo: Memo, args: typeof ReadArgs.Type, meta: CallMeta): Promise<ToolResult> {
  // Sin conversación no hay memoria: no se numera ni se recuerda nada.
  const reading = meta.conversation === undefined ? undefined : { conversation: meta.conversation, read: memo.nextRead(meta.conversation) }
  const sections: Section[] = []
  // En orden y de uno en uno: el tope de caracteres es de la llamada y cada fichero gasta lo que dejó el anterior.
  for (const request of args.ficheros) sections.push(await section(ports, memo, reading, request, MAX_CHARS - spent(sections)))
  const text = sections.map((s) => [s.header, ...s.lines].join("\n")).join("\n")
  return {
    text,
    // Solo es un error de la llamada si ningún fichero se pudo leer: con alguno bueno el modelo ya tiene algo que usar.
    ...(sections.every((s) => s.failed) ? { isError: true } : {}),
    stats: {
      ficheros: sections.length,
      memoria: sections.filter((s) => s.avoided !== undefined).length,
      caracteres: text.length,
      evitados: sections.reduce((sum, s) => sum + (s.avoided ?? 0), 0),
    },
  }
}

async function section(ports: ReadPorts, memo: Memo, reading: Reading | undefined, request: Request, room: number): Promise<Section> {
  const file = await load(ports, request.ruta)
  if ("error" in file) return failure(request.ruta, file.error)
  const total = file.lines.length
  if (total === 0) return { header: `== ${request.ruta} · vacío`, lines: [] }
  const from = request.desde ?? 1
  if (request.hasta !== undefined && request.hasta < from) return failure(request.ruta, "rango vacío")
  if (from > total) return failure(request.ruta, `el fichero tiene ${total} ${total === 1 ? "línea" : "líneas"}`)
  const to = Math.min(request.hasta ?? total, total)
  const body = file.lines.slice(from - 1, to).map((text, index) => `${from + index}: ${clip(text)}`)
  const range = (last: number) => `== ${request.ruta} · líneas ${from}-${last} de ${total}`
  const since = reading && memo.covered({ conversation: reading.conversation, file: file.real, hash: file.hash, from, to })
  if (since !== undefined) return { header: `${range(to)} · sin cambios desde la lectura ${since}`, lines: [], avoided: body.join("\n").length }
  const shown = body.slice(0, fitting(body, room))
  if (shown.length === 0) return { header: `== ${request.ruta} · omitido: tope de ${MAX_CHARS} caracteres de esta llamada`, lines: [] }
  const last = from + shown.length - 1
  // Solo cuenta como leído lo que se devolvió de verdad: lo recortado se vuelve a pedir y entonces sí llega.
  if (reading) memo.record({ conversation: reading.conversation, file: file.real, hash: file.hash, from, to: last, read: reading.read })
  const cut = last < to ? ` · recortado por el tope de ${MAX_CHARS} caracteres: sigue desde la línea ${last + 1}` : ""
  return { header: `${range(last)}${cut}`, lines: shown }
}

type Loaded = { readonly real: string; readonly hash: string; readonly lines: readonly string[] } | { readonly error: string }

async function load(ports: ReadPorts, ruta: string): Promise<Loaded> {
  const located = await locate(ports, ruta)
  if ("error" in located) return located
  const result = await ports.readFile(located.path).then(
    (bytes) => ({ bytes }),
    (error: unknown) => ({ error }),
  )
  if ("error" in result) return { error: isDirectory(result.error) ? "es un directorio" : `no se pudo leer: ${result.error instanceof Error ? result.error.message : String(result.error)}` }
  if (result.bytes.subarray(0, BINARY_SCAN_BYTES).includes(0)) return { error: "fichero binario" }
  return { real: located.path, hash: createHash("sha256").update(result.bytes).digest("hex"), lines: linesOf(new TextDecoder().decode(result.bytes)) }
}

const isDirectory = (error: unknown) => error instanceof Error && "code" in error && error.code === "EISDIR"

// Un salto final no abre una línea nueva, y un `\r` antes del salto no es del texto.
function linesOf(text: string): string[] {
  if (text === "") return []
  const lines = text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line))
  return text.endsWith("\n") ? lines.slice(0, -1) : lines
}

const clip = (text: string) => (text.length > MAX_LINE_CHARS ? `${text.slice(0, MAX_LINE_CHARS)}… (+${text.length - MAX_LINE_CHARS} caracteres)` : text)

const failure = (ruta: string, reason: string): Section => ({ header: `== ${ruta} · error: ${reason}`, lines: [], failed: true })

// Cada línea cuesta su texto y el salto que la separa de la siguiente.
const cost = (line: string) => line.length + 1
const spent = (sections: readonly Section[]) => sections.reduce((sum, s) => sum + s.lines.reduce((n, line) => n + cost(line), 0), 0)

// Cuántas de las primeras líneas caben en `room` caracteres.
function fitting(lines: readonly string[], room: number): number {
  let used = 0
  const over = lines.findIndex((line) => (used += cost(line)) > room)
  return over === -1 ? lines.length : over
}
