// Herramienta `probar` (P13-c, T3, D281, D283, D289). `{ run }.run` REAL y `node --test` de verdad sobre ficheros
// `*.test.mjs` propios, en directorios temporales: cero cuota, solo `node` local. Las formas del TAP que `parseTap` ya cubre con
// fixtures reales no se repiten aquí; esto prueba lo que `probar` añade: qué ejecuta, cómo lo resume y qué dice cuando no termina.
// Los casos que necesitan una salida que `node` no da a voluntad (sin detalle de fallos, sin salida alguna, 100 líneas) usan un
// puerto `run` que la devuelve: es el puerto, no una pieza interna. Cada test que lanza un proceso declara su propio límite.
import { expect, test } from "bun:test"
import fs from "node:fs"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { run } from "../src/run"
import type { RunResult } from "../src/run"
import { MAX_FAILURES, MAX_MESSAGE_LINE_CHARS, MAX_MESSAGE_LINES, MAX_TEST_FILES, TESTS_TIMEOUT_MS, testsTool, type TestPorts } from "../src/run-tests"
import { MCP_TOOL } from "../src/names"

const RUN_MS = 30_000
const local = { run }
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mcp-tests-")))

function project(files: Readonly<Record<string, string>>): string {
  const dir = tmp()
  Object.entries(files).forEach(([name, content]) => {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
    fs.writeFileSync(path.join(dir, name), content)
  })
  return dir
}

// Los puertos reales, con un registro de cada llamada a `run` y de lo que devolvió.
function spied(root: string, timeoutMs?: number) {
  const calls: { readonly cmd: readonly string[]; readonly cwd: string; readonly timeoutMs: number }[] = []
  const results: RunResult[] = []
  const ports: TestPorts = {
    root,
    realpath: (p) => fsp.realpath(p),
    run: async (cmd, cwd, opts) => {
      calls.push({ cmd, cwd, timeoutMs: opts.timeoutMs })
      const result = await local.run(cmd, cwd, opts)
      results.push(result)
      return result
    },
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  }
  return { ports, calls, results }
}

// Un puerto que devuelve lo que se le diga, sin lanzar nada.
const canned = (root: string, result: RunResult): TestPorts => ({ root, realpath: (p) => fsp.realpath(p), run: async () => result })

const probar = (dir: string, args: unknown = {}, timeoutMs?: number) => {
  const spy = spied(dir, timeoutMs)
  return testsTool(spy.ports)
    .invoke(args, {})
    .then((result) => ({ result, ...spy }))
}

const HEADER = 'import { describe, test } from "node:test"\nimport assert from "node:assert/strict"\n'
const PASSING = `${HEADER}\ntest("suma", () => assert.equal(1 + 2, 3))\ntest("resta", () => assert.equal(3 - 1, 2))\n`
// Un test que pasa, uno que falla y uno anidado que falla; las líneas importan: son las ubicaciones del resultado.
const MIXED = [
  'import { describe, test } from "node:test"',
  'import assert from "node:assert/strict"',
  "",
  'test("bien", () => {})',
  'test("mal", () => {',
  "  assert.equal(1, 2)",
  "})",
  'describe("grupo", () => {',
  '  test("anidado mal", () => {',
  '    throw new Error("rompe")',
  "  })",
  "})",
  "",
].join("\n")
const failing = (n: number) => `${HEADER}\n${Array.from({ length: n }, (_, i) => `test("falla ${i + 1}", () => assert.equal(${i + 1}, 0))`).join("\n")}\n`
const throwing = (message: string) => `${HEADER}\ntest("lanza", () => {\n  throw new Error(${JSON.stringify(message)})\n})\n`
const SLEEPING = `${HEADER}\ntest("espera mucho más que el tope", async () => {\n  await new Promise((resolve) => setTimeout(resolve, 3000))\n})\n`

test("D283: los topes de la herramienta son los del diseño y su nombre MCP es el de schema/mcp.ts", () => {
  expect([TESTS_TIMEOUT_MS, MAX_FAILURES, MAX_MESSAGE_LINES, MAX_TEST_FILES]).toEqual([300_000, 10, 12, 20])
  expect(testsTool(spied(tmp()).ports).name).toBe(MCP_TOOL.tests)
})

test("D289: la descripción de probar cabe en 350 caracteres y dice para qué sirve y qué sustituye", () => {
  const description = testsTool(spied(tmp()).ports).description
  expect(description.length).toBeLessThanOrEqual(350)
  expect(description).toContain("node --test")
  expect(description).toContain("run_command")
})

test("D283: el inputSchema anuncia solo ficheros, opcionales y hasta MAX_TEST_FILES", () => {
  expect(testsTool(spied(tmp()).ports).inputSchema).toEqual({
    type: "object",
    properties: { ficheros: { type: "array", maxItems: MAX_TEST_FILES, items: { type: "string", minLength: 1 } } },
  })
})

test("D283: todo verde dice cuántos tests eran y que todos pasan, y nada más", async () => {
  const dir = project({ "ok.test.mjs": PASSING })
  const { result, calls, results } = await probar(dir)
  expect(result.text).toBe("node --test: 2 tests · todos pasan")
  expect(result.isError).toBeUndefined()
  // El comando es exactamente el de D283, en la raíz y con el tope por defecto.
  expect(calls).toEqual([{ cmd: ["node", "--test", "--test-reporter=tap"], cwd: dir, timeoutMs: TESTS_TIMEOUT_MS }])
  expect(result.stats).toEqual({ tests: 2, pass: 2, fail: 0, caracteres: result.text.length, salida: results[0]?.out.length })
}, RUN_MS)

test("D283: con fallos da el resumen y, de cada uno, su nombre completo, su ubicación desde la raíz y su mensaje sin líneas en blanco", async () => {
  const dir = project({ "sub/mixto.test.mjs": MIXED })
  const { result, results } = await probar(dir)
  expect(result.text).toBe(
    [
      "node --test: 3 tests · 1 pasa · 2 fallan",
      "✗ mal (sub/mixto.test.mjs:5:1)",
      "  Expected values to be strictly equal:",
      "  1 !== 2",
      "✗ grupo > anidado mal (sub/mixto.test.mjs:9:3)",
      "  rompe",
    ].join("\n"),
  )
  // Un test que falla es un resultado, no un error de la herramienta.
  expect(result.isError).toBeUndefined()
  expect(result.stats).toEqual({ tests: 3, pass: 1, fail: 2, caracteres: result.text.length, salida: results[0]?.out.length })
  // Y lo que se devuelve es bastante menos que la salida entera de node.
  expect(result.text.length).toBeLessThan(results[0]?.out.length ?? 0)
}, RUN_MS)

test("D283: con ficheros indicados ejecuta solo esos, por su ruta real, sea cual sea la forma en que se pidieron", async () => {
  const dir = project({ "verde.test.mjs": PASSING, "rojo.test.mjs": MIXED, "sub/otro.test.mjs": PASSING })
  const verde = await probar(dir, { ficheros: ["verde.test.mjs"] })
  expect(verde.result.text).toBe("node --test: 2 tests · todos pasan")
  expect(verde.calls[0]?.cmd).toEqual(["node", "--test", "--test-reporter=tap", path.join(dir, "verde.test.mjs")])
  const rojo = await probar(dir, { ficheros: ["rojo.test.mjs"] })
  expect(rojo.result.text).toStartWith("node --test: 3 tests · 1 pasa · 2 fallan\n✗ mal (rojo.test.mjs:5:1)")
  // Con `./`, absoluta, dentro de un subdirectorio y con `..` por el camino: todas dan la ruta real del fichero.
  const forms = await probar(dir, { ficheros: ["./verde.test.mjs", path.join(dir, "sub", "otro.test.mjs"), "sub/../rojo.test.mjs"] })
  expect(forms.calls[0]?.cmd.slice(3)).toEqual([path.join(dir, "verde.test.mjs"), path.join(dir, "sub", "otro.test.mjs"), path.join(dir, "rojo.test.mjs")])
  expect(forms.result.text).toStartWith("node --test: 7 tests · 5 pasan · 2 fallan\n")
  // Sin ficheros (ausente o vacío) se ejecuta lo que node descubre.
  const todo = await probar(dir, {})
  const vacio = await probar(dir, { ficheros: [] })
  expect([todo.calls[0]?.cmd.length, vacio.calls[0]?.cmd.length]).toEqual([3, 3])
  expect(todo.result.text).toStartWith("node --test: 7 tests · 5 pasan · 2 fallan\n")
  expect(vacio.result.text).toBe(todo.result.text)
}, RUN_MS)

test("D283: un fichero cuyo nombre empieza por - se ejecuta como fichero, no se interpreta como opción de node ni de su runner", async () => {
  const dir = project({ "-raro.test.mjs": PASSING })
  const { result, calls } = await probar(dir, { ficheros: ["-raro.test.mjs"] })
  expect(calls[0]?.cmd.slice(3)).toEqual([path.join(dir, "-raro.test.mjs")])
  expect(result.text).toBe("node --test: 2 tests · todos pasan")
}, RUN_MS)

test("D281: un fichero fuera de la raíz, un symlink que sale o uno que no existe son error y no se ejecuta NADA, ni los válidos del mismo lote", async () => {
  const base = tmp()
  const root = path.join(base, "proyecto")
  fs.mkdirSync(root)
  fs.writeFileSync(path.join(base, "fuera.test.mjs"), PASSING)
  fs.writeFileSync(path.join(root, "dentro.test.mjs"), PASSING)
  fs.symlinkSync(path.join(base, "fuera.test.mjs"), path.join(root, "enlace.test.mjs"))
  const { result, calls } = await probar(root, { ficheros: ["dentro.test.mjs", "../fuera.test.mjs", "enlace.test.mjs", "no-existe.test.mjs"] })
  expect(result).toEqual({ text: "no se ejecutó nada: ../fuera.test.mjs: fuera del proyecto; enlace.test.mjs: fuera del proyecto; no-existe.test.mjs: no existe", isError: true })
  expect(calls).toEqual([])
})

test("D283: con un tope de tiempo que vence, dice que no terminó, cuánto era el tope y qué llegó a salir; no espera al test", async () => {
  const dir = project({ "lento.test.mjs": SLEEPING })
  const started = Date.now()
  const { result, results } = await probar(dir, { ficheros: ["lento.test.mjs"] }, 500)
  // El proceso se cortó al vencer el tope (SIGKILL): la llamada no esperó los 3 s del test.
  expect(Date.now() - started).toBeLessThan(2_500)
  expect(result.isError).toBe(true)
  expect(result.text).toStartWith(`node --test no terminó (código ${results[0]?.exit}): superó el tope de 0.5 s\n`)
  expect(results[0]?.exit).not.toBe(0)
  // De la salida parcial, lo que llegó (node escribe `TAP version 13` al arrancar) o, si no llegó nada, que no hubo salida.
  expect(result.text).toMatch(/\n(Últimas líneas de la salida:\n(.*\n)*TAP version 13|\(sin salida\))/)
  expect(result.stats).toEqual({ caracteres: result.text.length, salida: results[0]?.out.length })
}, RUN_MS)

test("D283: si el runner muere antes del tope (aquí, un test que mata a node) también dice que no terminó, pero sin culpar al tope", async () => {
  const killer = `${HEADER}\ntest("mata al runner", () => {\n  process.kill(process.ppid, "SIGKILL")\n})\n`
  const dir = project({ "mata.test.mjs": killer })
  const { result, results } = await probar(dir, { ficheros: ["mata.test.mjs"] })
  expect(result.isError).toBe(true)
  expect(result.text).toStartWith(`node --test no terminó (código ${results[0]?.exit})\n`)
  expect(result.text).not.toContain("tope")
  expect(results[0]?.exit).not.toBe(0)
}, RUN_MS)

test("D283: sin salida, o con muchas líneas, no terminó da el código y las últimas 40 líneas, no más", async () => {
  const dir = tmp()
  const mute = await testsTool(canned(dir, { exit: 2, out: "" })).invoke({}, {})
  expect(mute).toEqual({ text: "node --test no terminó (código 2)\n(sin salida)", isError: true, stats: { caracteres: mute.text.length, salida: 0 } })
  const noisy = Array.from({ length: 100 }, (_, i) => `linea ${i + 1}`).join("\n")
  const long = await testsTool(canned(dir, { exit: 1, out: `${noisy}\n` })).invoke({}, {})
  const lines = long.text.split("\n")
  expect(lines.slice(0, 2)).toEqual(["node --test no terminó (código 1)", "Últimas líneas de la salida:"])
  expect(lines.slice(2)).toEqual(Array.from({ length: 40 }, (_, i) => `linea ${i + 61}`))
})

test("D283: más de MAX_FAILURES fallos: los 10 primeros y «y K fallos más» (en singular si falta uno)", async () => {
  const dir = project({ "doce.test.mjs": failing(MAX_FAILURES + 2) })
  const twelve = await probar(dir)
  const lines = twelve.result.text.split("\n")
  expect(lines[0]).toBe("node --test: 12 tests · 0 pasan · 12 fallan")
  expect(lines.filter((line) => line.startsWith("✗ ")).map((line) => line.split(" (")[0])).toEqual(Array.from({ length: MAX_FAILURES }, (_, i) => `✗ falla ${i + 1}`))
  expect(lines.at(-1)).toBe("y 2 fallos más")
  const one = project({ "once.test.mjs": failing(MAX_FAILURES + 1) })
  expect((await probar(one)).result.text.split("\n").at(-1)).toBe("y 1 fallo más")
  // Con exactamente MAX_FAILURES no sobra nada que anunciar.
  const exact = project({ "diez.test.mjs": failing(MAX_FAILURES) })
  expect((await probar(exact)).result.text).not.toContain("más")
}, RUN_MS)

test("D283: un mensaje de más de MAX_MESSAGE_LINES líneas se recorta con «… (K líneas más)», y una línea larguísima se corta con aviso", async () => {
  const many = Array.from({ length: 30 }, (_, i) => `linea ${i + 1}`).join("\n")
  const dir = project({ "largo.test.mjs": throwing(many) })
  const lines = (await probar(dir)).result.text.split("\n")
  expect(lines.slice(1, 2)).toEqual(["✗ lanza (largo.test.mjs:4:1)"])
  expect(lines.slice(2)).toEqual([...Array.from({ length: MAX_MESSAGE_LINES }, (_, i) => `  linea ${i + 1}`), "  … (18 líneas más)"])
  const justOver = project({ "once.test.mjs": throwing(Array.from({ length: MAX_MESSAGE_LINES + 1 }, (_, i) => `linea ${i + 1}`).join("\n")) })
  expect((await probar(justOver)).result.text.split("\n").at(-1)).toBe("  … (1 línea más)")
  const wide = project({ "ancho.test.mjs": throwing("y".repeat(MAX_MESSAGE_LINE_CHARS + 1_600)) })
  expect((await probar(wide)).result.text.split("\n").at(-1)).toBe(`  ${"y".repeat(MAX_MESSAGE_LINE_CHARS)}… (+1600 caracteres)`)
}, RUN_MS)

test("D283: un fichero que ni carga se explica con lo que node escribió en stderr, no con «test failed», y se nombra desde la raíz", async () => {
  const dir = project({ "roto.test.mjs": `import { test } from "node:test"\nimport { noExiste } from "./no-existe.mjs"  /*SIN-MAPA*/\ntest("nunca llega", () => noExiste())\n` })
  // Pedido por su ruta, node lo nombra con la ruta absoluta; en el descubrimiento, con la relativa. Las dos salen igual.
  const named = await probar(dir, { ficheros: ["roto.test.mjs"] })
  const found = await probar(dir)
  expect(found.result.text.split("\n").slice(0, 2)).toEqual(named.result.text.split("\n").slice(0, 2))
  const lines = named.result.text.split("\n")
  expect(lines[0]).toBe("node --test: 1 test · 0 pasan · 1 falla")
  expect(lines[1]).toBe("✗ roto.test.mjs (roto.test.mjs:1:1)")
  const result = named.result
  expect(result.text).toContain("Error [ERR_MODULE_NOT_FOUND]: Cannot find module")
  expect(result.text).not.toContain("test failed")
  // Lleva el recorte de siempre: 12 líneas de mensaje a lo sumo.
  expect(lines.filter((line) => line.startsWith("  ")).length).toBeLessThanOrEqual(MAX_MESSAGE_LINES + 1)
}, RUN_MS)

test("D283: los cancelados (un hook que falla y su hijo) se anuncian aparte en el resumen y se listan como fallos", async () => {
  const hook = [
    'import { describe, test, before } from "node:test"',
    "",
    'describe("con hook roto", () => {',
    "  before(() => {",
    '    throw new Error("fallo en el before")',
    "  })",
    '  test("hijo", () => {})',
    "})",
    "",
  ].join("\n")
  const dir = project({ "hook.test.mjs": hook })
  const { result } = await probar(dir)
  expect(result.text).toBe(
    [
      "node --test: 1 test · 0 pasan · 0 fallan · 1 cancelada",
      "✗ con hook roto > hijo (hook.test.mjs:7:3)",
      "  test did not finish before its parent and was cancelled",
      "✗ con hook roto (hook.test.mjs:3:1)",
      "  fallo en el before",
    ].join("\n"),
  )
  expect(result.isError).toBeUndefined()
}, RUN_MS)

test("D283: un directorio sin ningún test no es «todos pasan»: dice que no encontró ninguno", async () => {
  const { result } = await probar(tmp())
  expect(result.text).toBe("node --test: 0 tests · no se encontró ningún test")
  expect(result.isError).toBeUndefined()
}, RUN_MS)

test("D283: si el resumen dice que hay fallos pero no se pudo leer ninguno, devuelve el final de la salida en vez de un recuento mudo", async () => {
  const out = "TAP version 13\n# tests 2\n# pass 1\n# fail 1\n# cancelled 0\n"
  const result = await testsTool(canned(tmp(), { exit: 1, out })).invoke({}, {})
  expect(result.text).toBe("node --test: 2 tests · 1 pasa · 1 falla\nÚltimas líneas de la salida:\nTAP version 13\n# tests 2\n# pass 1\n# fail 1\n# cancelled 0")
  expect(result.isError).toBeUndefined()
})

test("D283: el tope de tiempo que se pasa a run es el de los puertos, y el de D283 si no hay ninguno", async () => {
  const dir = project({ "ok.test.mjs": PASSING })
  expect((await probar(dir, {}, 123_456)).calls[0]?.timeoutMs).toBe(123_456)
  expect((await probar(dir, {})).calls[0]?.timeoutMs).toBe(TESTS_TIMEOUT_MS)
}, RUN_MS)

test("D283: los argumentos que no cumplen el esquema son un error con el motivo y no ejecutan nada", async () => {
  const dir = project({ "ok.test.mjs": PASSING })
  const spy = spied(dir)
  const tool = testsTool(spy.ports)
  const tooMany = Array.from({ length: MAX_TEST_FILES + 1 }, () => "ok.test.mjs")
  const results = await Promise.all([{ ficheros: tooMany }, { ficheros: [1] }, { ficheros: "ok.test.mjs" }, { ficheros: [""] }, undefined].map((args) => tool.invoke(args, {})))
  expect(results.every((r) => r.isError === true && r.text.startsWith("argumentos no válidos"))).toBe(true)
  expect(spy.calls).toEqual([])
  // En el límite de lo admitido sí ejecuta.
  const atLimit = await tool.invoke({ ficheros: Array.from({ length: MAX_TEST_FILES }, () => "ok.test.mjs") }, {})
  expect(atLimit.isError).toBeUndefined()
  expect(spy.calls).toHaveLength(1)
}, RUN_MS)
