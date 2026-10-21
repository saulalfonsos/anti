// El borde stdio del servidor (P13-c, T4, D280, D281, D288): `src/main.ts` se lanza de verdad con `bun`, con el cwd en un
// proyecto temporal, y se le habla como lo hace agy: una línea JSON-RPC por petición, EN ORDEN, y EOF al final. Cero cuota: ni
// `agy` ni nada de ~/.gemini. El único proceso hijo es el `node --test` de la herramienta `probar`, sobre un test propio.
// Cada `tools/call` lleva el `_meta` REAL de agy 1.2.14, con sus tres claves, no solo la que el servidor lee.
import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Schema } from "effect"
import { CONVERSATION_META, MCP_SERVER, MCP_TOOL } from "../src/names"

const SCRIPT = path.join(import.meta.dir, "..", "src", "main.ts")
// El servidor termina solo al cerrarse stdin: el tope es la red de seguridad de una prueba que se colgara, no un tiempo esperado.
const SPAWN_TIMEOUT_MS = 60_000
const RUN_MS = 90_000
const decode = Schema.decodeUnknownSync(Schema.UnknownFromJsonString)
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "anti-mcp-")))

const A_TS = "export const a = 1\nexport const b = 2\nexport const c = 3\n"
const OK_TEST = 'import { test } from "node:test"\nimport assert from "node:assert/strict"\n\ntest("suma", () => {\n  assert.equal(1 + 2, 3)\n})\n'
const LEER_A = "== a.ts · líneas 1-3 de 3\n1: export const a = 1\n2: export const b = 2\n3: export const c = 3"
const LEER_A_AGAIN = "== a.ts · líneas 1-3 de 3 · sin cambios desde la lectura 1"

// Lo que agy manda en el `_meta` de cada tools/call (medido en 1.2.14): la conversación, el directorio de artefactos y un token de progreso.
const META = { "antigravity.google/artifacts_dir": "/tmp/agy-artifacts", [CONVERSATION_META]: "conv-123", progressToken: 1 }

const lines = (...messages: readonly unknown[]) => `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`
const call = (id: number, name: string, args: unknown, meta?: unknown) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args, ...(meta === undefined ? {} : { _meta: meta }) } })
const reply = (id: number, text: string, isError?: true) => ({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }], ...(isError ? { isError } : {}) } })

function project(): string {
  const dir = tmp()
  fs.writeFileSync(path.join(dir, "a.ts"), A_TS)
  fs.writeFileSync(path.join(dir, "ok.test.mjs"), OK_TEST)
  return dir
}

async function serve(input: { readonly cwd: string; readonly args?: readonly string[]; readonly stdin: string }) {
  const proc = Bun.spawn([process.execPath, SCRIPT, ...(input.args ?? [])], {
    cwd: input.cwd,
    stdin: new Blob([input.stdin]),
    stdout: "pipe",
    stderr: "pipe",
    timeout: SPAWN_TIMEOUT_MS,
    killSignal: "SIGKILL",
  })
  const [stdout, stderr, exit] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { stdout, stderr, exit, replies: stdout.split("\n").filter((line) => line !== "").map((line) => decode(line)) }
}

const readLog = (file: string) => fs.readFileSync(file, "utf8").split("\n").filter((line) => line !== "").map((line) => decode(line))

test("D280/D288: initialize, la notificación, tools/list, leer dos veces y probar, en orden; una línea de arranque y una de registro por tools/call", async () => {
  const dir = project()
  const log = path.join(tmp(), "anti-mcp.jsonl")
  const { replies, stdout, stderr, exit } = await serve({
    cwd: dir,
    args: ["--log", log, "--etiqueta", "celda-1"],
    stdin: lines(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "agy", version: "1.2.14" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      call(3, MCP_TOOL.read, { ficheros: [{ ruta: "a.ts" }] }, META),
      call(4, MCP_TOOL.read, { ficheros: [{ ruta: "a.ts" }] }, META),
      call(5, MCP_TOOL.tests, { ficheros: ["ok.test.mjs"] }, META),
    ),
  })
  // Termina solo al cerrarse stdin, sin escribir nada por stderr, y stdout lleva únicamente respuestas (una por línea).
  expect(exit).toBe(0)
  expect(stderr).toBe("")
  expect(stdout.endsWith("\n")).toBe(true)
  // Cinco respuestas (la notificación no recibe ninguna), en el orden de las peticiones.
  expect(replies).toHaveLength(5)
  expect(replies[0]).toMatchObject({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: MCP_SERVER } } })
  expect(replies[1]).toMatchObject({ id: 2, result: { tools: [{ name: MCP_TOOL.read }, { name: MCP_TOOL.tests }] } })
  expect(replies[2]).toEqual(reply(3, LEER_A))
  // La segunda lectura de la misma conversación sale de la memoria: el `_meta` con tres claves llegó entero y se entendió.
  expect(replies[3]).toEqual(reply(4, LEER_A_AGAIN))
  expect(replies[4]).toEqual(reply(5, "node --test: 1 test · todos pasan"))
  // La línea de arranque (D288), antes de nada, con la etiqueta y el cwd del proceso; y una línea de registro por tools/call, con la etiqueta
  // de la celda, la conversación, los argumentos y las estadísticas.
  const body = LEER_A.split("\n").slice(1).join("\n")
  expect(readLog(log)).toEqual([
    { t: expect.any(String), etiqueta: "celda-1", evento: "arranque", cwd: dir, raiz: dir },
    { t: expect.any(String), etiqueta: "celda-1", conversation: "conv-123", tool: "leer", args: { ficheros: [{ ruta: "a.ts" }] }, isError: false, chars: LEER_A.length, stats: { ficheros: 1, memoria: 0, caracteres: LEER_A.length, evitados: 0 } },
    { t: expect.any(String), etiqueta: "celda-1", conversation: "conv-123", tool: "leer", args: { ficheros: [{ ruta: "a.ts" }] }, isError: false, chars: LEER_A_AGAIN.length, stats: { ficheros: 1, memoria: 1, caracteres: LEER_A_AGAIN.length, evitados: body.length } },
    { t: expect.any(String), etiqueta: "celda-1", conversation: "conv-123", tool: "probar", args: { ficheros: ["ok.test.mjs"] }, isError: false, chars: "node --test: 1 test · todos pasan".length, stats: { tests: 1, pass: 1, fail: 0, caracteres: "node --test: 1 test · todos pasan".length, salida: expect.any(Number) } },
  ])
  // Cada línea del registro empieza por la hora, en ISO: es lo que permite ordenarlas y unirlas con las de otras celdas.
  const raw = fs.readFileSync(log, "utf8").split("\n").filter((line) => line !== "")
  expect(raw.every((line) => /^\{"t":"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z",/.test(line))).toBe(true)
}, RUN_MS)

test("D281: la raíz es el cwd con que se arranca el servidor: lo de dentro se lee y lo de fuera, no, aunque exista", async () => {
  const base = tmp()
  const root = path.join(base, "proyecto")
  fs.mkdirSync(root)
  fs.writeFileSync(path.join(root, "a.ts"), A_TS)
  fs.writeFileSync(path.join(base, "fuera.txt"), "no sales\n")
  const { replies } = await serve({ cwd: root, stdin: lines(call(1, MCP_TOOL.read, { ficheros: [{ ruta: "../fuera.txt" }] }, META), call(2, MCP_TOOL.read, { ficheros: [{ ruta: "../fuera.txt" }, { ruta: "a.ts" }] }, META)) })
  expect(replies[0]).toEqual(reply(1, "== ../fuera.txt · error: fuera del proyecto", true))
  expect(replies[1]).toEqual(reply(2, `== ../fuera.txt · error: fuera del proyecto\n${LEER_A}`))
  expect(JSON.stringify(replies)).not.toContain("no sales")
}, RUN_MS)

test("D288: sin --log no se registra nada; sin id de conversación no hay memoria y el registro no lleva conversation", async () => {
  const dir = project()
  const { replies, exit, stderr } = await serve({ cwd: dir, stdin: lines(call(1, MCP_TOOL.read, { ficheros: [{ ruta: "a.ts" }] }), call(2, MCP_TOOL.read, { ficheros: [{ ruta: "a.ts" }] })) })
  expect([exit, stderr]).toEqual([0, ""])
  expect(replies).toEqual([reply(1, LEER_A), reply(2, LEER_A)])
  // Ni un registro por defecto en el cwd: el proyecto queda como estaba.
  expect(fs.readdirSync(dir).sort()).toEqual(["a.ts", "ok.test.mjs"])
  // Con --log pero sin conversación ni etiqueta, ni la entrada ni la línea de arranque inventan ninguna de las dos.
  const log = path.join(tmp(), "sin-conversacion.jsonl")
  await serve({ cwd: dir, args: ["--log", log], stdin: lines(call(1, MCP_TOOL.read, { ficheros: [{ ruta: "a.ts" }] })) })
  const [start, entry] = readLog(log)
  expect(start).toEqual({ t: expect.any(String), evento: "arranque", cwd: dir, raiz: dir })
  expect(entry).toEqual({ t: expect.any(String), tool: "leer", args: { ficheros: [{ ruta: "a.ts" }] }, isError: false, chars: LEER_A.length, stats: { ficheros: 1, memoria: 0, caracteres: LEER_A.length, evitados: 0 } })
}, RUN_MS)

test("D288: un servidor que arranca y no recibe ninguna llamada deja igualmente su línea de arranque: distingue «arrancó y no se usó» de «no arrancó»", async () => {
  const dir = project()
  const log = path.join(tmp(), "arranque.jsonl")
  // Ni una petición: stdin se cierra al arrancar. El cwd registrado es el del proceso, que es la raíz del servidor (D281).
  const idle = await serve({ cwd: dir, args: ["--log", log, "--etiqueta", "tarea|mcp|0"], stdin: "" })
  expect([idle.exit, idle.stderr, idle.stdout]).toEqual([0, "", ""])
  expect(readLog(log)).toEqual([{ t: expect.any(String), etiqueta: "tarea|mcp|0", evento: "arranque", cwd: dir, raiz: dir }])
  // Cada arranque añade la suya: dos celdas que compartan registro dejan dos líneas, y la hora es la del arranque (ISO).
  await serve({ cwd: dir, args: ["--log", log, "--etiqueta", "tarea|mcp_formato|0"], stdin: lines({ jsonrpc: "2.0", id: 1, method: "ping" }) })
  expect(readLog(log)).toEqual([
    { t: expect.any(String), etiqueta: "tarea|mcp|0", evento: "arranque", cwd: dir, raiz: dir },
    { t: expect.any(String), etiqueta: "tarea|mcp_formato|0", evento: "arranque", cwd: dir, raiz: dir },
  ])
  expect(fs.readFileSync(log, "utf8").split("\n").filter((line) => line !== "").every((line) => /^\{"t":"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z",/.test(line))).toBe(true)
}, RUN_MS)

test("D281: con --raiz, leer resuelve contra ella y probar corre en ella, no en el cwd (agy arranca el plugin en su propia carpeta)", async () => {
  const dir = project()
  const plugin = tmp()
  const log = path.join(tmp(), "raiz.jsonl")
  const { replies, exit } = await serve({ cwd: plugin, args: ["--log", log, "--raiz", dir], stdin: lines(call(1, MCP_TOOL.read, { ficheros: [{ ruta: "a.ts" }] }), call(2, MCP_TOOL.tests, { ficheros: ["ok.test.mjs"] })) })
  expect(exit).toBe(0)
  expect(replies[0]).toEqual(reply(1, LEER_A))
  expect(replies[1]).toEqual(reply(2, "node --test: 1 test · todos pasan"))
  expect(readLog(log)[0]).toEqual({ t: expect.any(String), evento: "arranque", cwd: plugin, raiz: dir })
}, RUN_MS)

test("D280: una línea que no es JSON recibe -32700 y el servidor sigue; las líneas en blanco no reciben nada; la última petición sin salto final también se atiende", async () => {
  const { replies, exit } = await serve({
    cwd: project(),
    stdin: `no es json\n\n   \n${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })}\n${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" })}`,
  })
  expect(exit).toBe(0)
  expect(replies).toEqual([{ jsonrpc: "2.0", id: null, error: { code: -32700, message: expect.any(String) } }, { jsonrpc: "2.0", id: 1, result: {} }, { jsonrpc: "2.0", id: 2, result: {} }])
}, RUN_MS)

test("D280: una petición grande, que llega en varios trozos de stdin, se reensambla y se atiende igual que las pequeñas", async () => {
  // Una línea de 300.000 caracteres: muy por encima del trozo con que se lee stdin, así que el servidor la recibe partida.
  const big = { jsonrpc: "2.0", id: 1, method: "ping", params: { relleno: "x".repeat(300_000) } }
  const { replies, exit } = await serve({ cwd: project(), stdin: lines(big, call(2, MCP_TOOL.read, { ficheros: [{ ruta: "a.ts" }] })) })
  expect(exit).toBe(0)
  expect(replies).toEqual([{ jsonrpc: "2.0", id: 1, result: {} }, reply(2, LEER_A)])
}, RUN_MS)

test("D288: un registro que no se puede escribir no tumba el servidor: se dice por stderr y las respuestas siguen saliendo", async () => {
  const dir = project()
  const log = path.join(tmp(), "no-existe", "anti-mcp.jsonl")
  const { replies, stderr, exit, stdout } = await serve({ cwd: dir, args: ["--log", log], stdin: lines(call(1, MCP_TOOL.read, { ficheros: [{ ruta: "a.ts" }] }, META), call(2, MCP_TOOL.read, { ficheros: [{ ruta: "a.ts" }] }, META)) })
  expect(exit).toBe(0)
  expect(replies).toEqual([reply(1, LEER_A), reply(2, LEER_A_AGAIN)])
  // El arranque y las dos llamadas, tres avisos, y por stderr: stdout es solo del protocolo.
  expect(stderr.split("\n").filter((line) => line.includes("registro"))).toHaveLength(3)
  expect(stderr).toContain(log)
  expect(stdout).not.toContain("registro")
}, RUN_MS)

test("un argumento desconocido o una opción sin valor se rechazan al arrancar, con el motivo por stderr y sin atender nada", async () => {
  const unknown = await serve({ cwd: project(), args: ["--no-existe"], stdin: lines({ jsonrpc: "2.0", id: 1, method: "ping" }) })
  expect(unknown.exit).not.toBe(0)
  expect(unknown.stderr).toContain("no-existe")
  expect(unknown.stdout).toBe("")
  const missing = await serve({ cwd: project(), args: ["--log"], stdin: lines({ jsonrpc: "2.0", id: 1, method: "ping" }) })
  expect(missing.exit).not.toBe(0)
  expect(missing.stdout).toBe("")
}, RUN_MS)
