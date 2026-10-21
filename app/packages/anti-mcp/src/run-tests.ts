// Herramienta `probar` (P13-c, D281, D283, D289): ejecuta `node --test --test-reporter=tap` (el runner de las tareas propias de
// P13) y devuelve un resumen y SOLO los fallos, con su nombre completo, su ubicación y su mensaje recortado, en vez de la salida
// entera del runner. No detecta el runner del proyecto: hoy no tiene consumidor. Los procesos llegan por el puerto `run`
// (D281): la capa no lanza nada ella misma, y los ficheros que se pidan pasan por la misma regla de raíz que `leer`.
import path from "node:path"
import { Schema } from "effect"
import type { RunResult } from "./run"
import { MCP_TOOL } from "./names"
import { locate } from "./paths"
import { tool, type McpTool, type ToolResult } from "./protocol"
import { parseTap, type TapFailure, type TapSummary } from "./tap"

export const TESTS_TIMEOUT_MS = 300_000
export const MAX_FAILURES = 10
export const MAX_MESSAGE_LINES = 12
export const MAX_TEST_FILES = 20
// Sin resumen (proceso cortado o caído) se devuelven las últimas líneas de la salida, que es lo único que dice qué pasó.
const TAIL_LINES = 40
const TAIL_TITLE = "Últimas líneas de la salida:"
// Una línea de mensaje más larga (un volcado de un objeto, una cadena enorme comparada) se corta con aviso: son N fallos × 12 líneas.
export const MAX_MESSAGE_LINE_CHARS = 400

export type TestPorts = {
  readonly root: string
  readonly realpath: (path: string) => Promise<string>
  // Al vencer `timeoutMs` el proceso se corta con SIGKILL y devuelve lo que llevaba escrito (medido con `LocalHost.fs().run`:
  // código 137 y la salida parcial).
  readonly run: (cmd: readonly string[], cwd: string, opts: { readonly timeoutMs: number }) => Promise<RunResult>
  readonly timeoutMs?: number // por defecto TESTS_TIMEOUT_MS; los tests lo bajan
}

export const TestArgs = Schema.Struct({
  ficheros: Schema.optionalKey(Schema.Array(Schema.String.check(Schema.isMinLength(1))).check(Schema.isMaxLength(MAX_TEST_FILES))),
})

// D289: cada carácter de la descripción se paga en todas las llamadas del modelo (medido: +836 tokens con 1.952 caracteres).
const DESCRIPTION =
  "Ejecuta los tests del proyecto con node --test, todos o solo los ficheros indicados, y devuelve un resumen y solo los fallos, con su nombre, ubicación y error. " +
  "Úsala en lugar de ejecutar node --test con run_command."

export function testsTool(ports: TestPorts): McpTool {
  return tool({ name: MCP_TOOL.tests, description: DESCRIPTION, input: TestArgs, call: (args) => probe(ports, args.ficheros ?? []) })
}

async function probe(ports: TestPorts, requested: readonly string[]): Promise<ToolResult> {
  const located = await Promise.all(requested.map((ruta) => locate(ports, ruta)))
  const invalid = located.flatMap((found, index) => ("error" in found ? [`${requested[index]}: ${found.error}`] : []))
  if (invalid.length > 0) return { text: `no se ejecutó nada: ${invalid.join("; ")}`, isError: true }
  // Rutas absolutas (el realpath): nunca empiezan por `-`, que node tomaría por una opción (y su runner pasa los ficheros a sus
  // procesos hijos tal cual, así que `./-x.test.mjs` tampoco vale), ni dependen del cwd.
  const files = located.flatMap((found) => ("path" in found ? [found.path] : []))
  const timeoutMs = ports.timeoutMs ?? TESTS_TIMEOUT_MS
  const started = performance.now()
  const result = await ports.run(["node", "--test", "--test-reporter=tap", ...files], ports.root, { timeoutMs })
  const waited = performance.now() - started
  const summary = parseTap(result.out)
  if (summary.tests === undefined) {
    const text = unfinished(result, timeoutMs, waited)
    return { text, isError: true, stats: { caracteres: text.length, salida: result.out.length } }
  }
  const text = report(summary, result.out, await ports.realpath(ports.root))
  return { text, stats: { tests: summary.tests, pass: summary.pass ?? 0, fail: summary.fail ?? 0, caracteres: text.length, salida: result.out.length } }
}

// Sin línea de resumen el proceso no terminó. `run` corta por tiempo con SIGKILL, pero también muere un runner por otras causas:
// solo se culpa al tope si la llamada de verdad tardó lo que el tope.
function unfinished(result: RunResult, timeoutMs: number, waited: number): string {
  const cause = waited >= timeoutMs ? `: superó el tope de ${timeoutMs / 1000} s` : ""
  const lines = tail(result.out)
  return [`node --test no terminó (código ${result.exit})${cause}`, ...(lines.length === 0 ? ["(sin salida)"] : [TAIL_TITLE, ...lines])].join("\n")
}

function report(summary: TapSummary, out: string, root: string): string {
  const cancelled = summary.cancelled ?? 0
  const total = `node --test: ${count(summary.tests ?? 0, "test", "tests")}`
  if (summary.failures.length === 0 && (summary.fail ?? 0) === 0 && cancelled === 0) return summary.tests === 0 ? `${total} · no se encontró ningún test` : `${total} · todos pasan`
  const head = [total, count(summary.pass ?? 0, "pasa", "pasan"), count(summary.fail ?? 0, "falla", "fallan"), ...(cancelled > 0 ? [count(cancelled, "cancelada", "canceladas")] : [])].join(" · ")
  const hidden = summary.failures.length - MAX_FAILURES
  // El resumen dice que hay fallos y no se leyó ninguno: es un formato que `parseTap` no conoce, y lo útil es la salida.
  const unread = summary.failures.length === 0 ? [TAIL_TITLE, ...tail(out)] : []
  return [head, ...summary.failures.slice(0, MAX_FAILURES).flatMap((failure) => entry(failure, root)), ...(hidden > 0 ? [`y ${count(hidden, "fallo más", "fallos más")}`] : []), ...unread].join("\n")
}

// «✗ nombre (ubicación)» y su mensaje recortado y sin líneas en blanco, sangrado. El reporter da rutas absolutas (y, para un fichero
// que ni carga y se pidió por su ruta, también como nombre): desde la raíz son más cortas y son las del resto de herramientas.
function entry(failure: TapFailure, root: string): string[] {
  const where = failure.location === undefined ? "" : ` (${within(root, failure.location)})`
  const lines = failure.message.split("\n").filter((line) => line.trim() !== "")
  const hidden = lines.length - MAX_MESSAGE_LINES
  return [`✗ ${within(root, failure.name)}${where}`, ...lines.slice(0, MAX_MESSAGE_LINES).map((line) => `  ${clip(line)}`), ...(hidden > 0 ? [`  … (${count(hidden, "línea más", "líneas más")})`] : [])]
}

const within = (root: string, text: string) => (text.startsWith(`${root}${path.sep}`) ? text.slice(root.length + 1) : text)

const tail = (out: string) => out.split("\n").filter((line, index, all) => index < all.length - 1 || line !== "").slice(-TAIL_LINES).map(clip)

const clip = (line: string) => {
  const text = line.trimEnd()
  return text.length > MAX_MESSAGE_LINE_CHARS ? `${text.slice(0, MAX_MESSAGE_LINE_CHARS)}… (+${text.length - MAX_MESSAGE_LINE_CHARS} caracteres)` : text
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
