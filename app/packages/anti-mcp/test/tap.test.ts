// Lector del TAP de `node --test` (P13-c, T3, D283). Las fixtures `test/fixtures/node-tap-*.txt` son salida REAL de
// `node --test --test-reporter=tap` (node v26.8.2), capturada por el mismo `LocalHost.fs().run` que usa `probar`, con una sola
// edición: el directorio temporal sustituido por /work/proj. Cada una sale de un fichero de ejemplo:
//   verde            suma.test.mjs: un test, un describe con dos y un saltado
//   fallos-anidados  calculadora.test.mjs: describe dentro de describe, dos fallos y sus padres `subtestsFailed`
//   mensajes         mensajes.test.mjs: nombre con #, saltado, TODO que falla, diff de deepEqual, comilla simple, error de dos líneas
//   cortada          lento.test.mjs con un tope de 1,5 s: el proceso murió por SIGKILL sin llegar al resumen
//   fichero-roto     roto, sintaxis y bien: dos ficheros que ni cargan (módulo inexistente, error de sintaxis) y uno verde
//   cancelados       un hook que falla, su hijo cancelado y un test que vence su tiempo
//   vacio            un directorio sin ficheros de test
// Los casos de borde que ninguna fixture trae se derivan de ellas o de líneas reales de node, cortando o añadiendo lo mínimo.
import { expect, test } from "bun:test"
import path from "node:path"
import { parseTap } from "../src/tap"

const fixture = (name: string) => Bun.file(path.join(import.meta.dir, "fixtures", `node-tap-${name}.txt`)).text()

test("todo verde: el resumen sale de los # tests, # pass y # fail de nivel 0 y no hay fallos (un saltado no es un fallo)", async () => {
  expect(parseTap(await fixture("verde"))).toEqual({ tests: 4, pass: 3, fail: 0, cancelled: 0, failures: [] })
})

test("un directorio sin tests da un resumen de 0 tests", async () => {
  expect(parseTap(await fixture("vacio"))).toEqual({ tests: 0, pass: 0, fail: 0, cancelled: 0, failures: [] })
})

test("fallos anidados: el nombre es la ruta de # Subtest unida con « > », con ubicación y mensaje, y los padres subtestsFailed no cuentan", async () => {
  const summary = parseTap(await fixture("fallos-anidados"))
  expect(summary.tests).toBe(5)
  expect(summary.pass).toBe(3)
  expect(summary.fail).toBe(2)
  // `suma` y `calculadora` son `not ok` con failureType subtestsFailed: solo cuentan los fallos de verdad, una vez cada uno.
  expect(summary.failures).toEqual([
    { name: "calculadora > suma > suma negativos", location: "/work/proj/calculadora.test.mjs:9:5", message: "Expected values to be strictly equal:\n\n-2 !== -3\n" },
    { name: "calculadora > division por cero", location: "/work/proj/calculadora.test.mjs:18:3", message: "no se puede dividir por cero" },
  ])
})

test("mensajes: error multilínea (|-) con su sangría relativa, entre comillas simples o dobles, nombre con # sin escapar, y TODO y saltado fuera", async () => {
  const summary = parseTap(await fixture("mensajes"))
  expect(summary).toMatchObject({ tests: 7, pass: 1, fail: 4, cancelled: 0 })
  expect(summary.failures.map((f) => f.name)).toEqual(["nombre con # almohadilla y - guion", "objeto distinto", "con comilla simple", "rechazo con dos lineas"])
  expect(summary.failures.map((f) => f.location)).toEqual([
    "/work/proj/mensajes.test.mjs:4:1",
    "/work/proj/mensajes.test.mjs:11:1",
    "/work/proj/mensajes.test.mjs:14:1",
    "/work/proj/mensajes.test.mjs:17:1",
  ])
  expect(summary.failures[0]?.message).toBe("Expected values to be strictly equal:\n\n1 !== 2\n")
  expect(summary.failures[1]?.message).toBe(
    [
      "Expected values to be strictly deep-equal:",
      "+ actual - expected",
      "",
      "  {",
      "    a: 1,",
      "    b: [",
      "      1,",
      "      2,",
      "+     3",
      "-     4",
      "    ],",
      "+   c: 'x'",
      "-   c: 'y'",
      "  }",
      "",
    ].join("\n"),
  )
  // Una línea con comilla simple sale entre comillas dobles (node la imprime con util.inspect).
  expect(summary.failures[2]?.message).toBe("it's broken: ¿qué pasa?")
  expect(summary.failures[3]?.message).toBe("rechazado\ncon dos lineas")
})

test("salida cortada (el proceso murió antes del resumen): sin totales, y lo que sí llegó a salir se lee", async () => {
  const summary = parseTap(await fixture("cortada"))
  expect(summary).toEqual({ tests: undefined, pass: undefined, fail: undefined, cancelled: undefined, failures: [] })
})

test("salida cortada a mitad de un bloque YAML: el fallo se reconoce con lo que llegó, sin lanzar", async () => {
  const lines = (await fixture("fallos-anidados")).split("\n")
  const upTo = (marker: string) => lines.slice(0, lines.findIndex((line) => line.includes(marker)) + 1).join("\n")
  // Antes de `error:`: hay nombre y ubicación, pero ningún mensaje.
  expect(parseTap(upTo("failureType: 'testCodeFailure'")).failures).toEqual([{ name: "calculadora > suma > suma negativos", location: "/work/proj/calculadora.test.mjs:9:5", message: "" }])
  // Dentro del `error: |-`: el mensaje llega hasta donde llegó la salida.
  expect(parseTap(upTo("Expected values to be strictly equal:")).failures).toEqual([
    { name: "calculadora > suma > suma negativos", location: "/work/proj/calculadora.test.mjs:9:5", message: "Expected values to be strictly equal:" },
  ])
  // Justo en la línea `not ok`: sin bloque, solo el nombre.
  expect(parseTap(upTo("not ok 2 - suma negativos")).failures).toEqual([{ name: "calculadora > suma > suma negativos", message: "" }])
})

test("ficheros que ni cargan: el motivo es lo que el proceso escribió en stderr antes de su `not ok`, no el genérico «test failed»", async () => {
  const summary = parseTap(await fixture("fichero-roto"))
  expect(summary).toMatchObject({ tests: 3, pass: 1, fail: 2 })
  expect(summary.failures.map((f) => [f.name, f.location])).toEqual([
    ["roto.test.mjs", "/work/proj/roto.test.mjs:1:1"],
    ["sintaxis.test.mjs", "/work/proj/sintaxis.test.mjs:1:1"],
  ])
  const missing = summary.failures[0]?.message ?? ""
  expect(missing).toStartWith("node:internal/modules/esm/resolve:272\n")
  expect(missing).toContain("Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/work/proj/no-existe.mjs' imported from /work/proj/roto.test.mjs")
  expect(missing).toEndWith("}\nNode.js v26.8.2")
  // Sin el prefijo `# ` del reporter, y sin las líneas del fichero vecino.
  expect(missing.split("\n").some((line) => line.startsWith("# "))).toBe(false)
  expect(missing).not.toContain("SyntaxError")
  const syntax = summary.failures[1]?.message ?? ""
  expect(syntax).toStartWith("file:///work/proj/sintaxis.test.mjs:5\n})\n^\nSyntaxError: Unexpected token '}'\n    at ")
  expect(syntax).toEndWith("\nNode.js v26.8.2")
  expect(syntax).not.toContain("ERR_MODULE_NOT_FOUND")
})

test("cancelados: un hook que falla, su hijo cancelado y un test que vence su tiempo cuentan como fallos, con el # cancelled aparte", async () => {
  const summary = parseTap(await fixture("cancelados"))
  expect(summary).toMatchObject({ tests: 3, pass: 1, fail: 0, cancelled: 2 })
  expect(summary.failures).toEqual([
    { name: "con hook roto > hijo que nunca corre", location: "/work/proj/cancelados.test.mjs:7:3", message: "test did not finish before its parent and was cancelled" },
    { name: "con hook roto", location: "/work/proj/cancelados.test.mjs:3:1", message: "fallo en el before" },
    { name: "timeout propio", location: "/work/proj/cancelados.test.mjs:10:1", message: "test timed out after 50ms" },
  ])
})

test("la salida de los propios tests no engaña: sus líneas llegan con # y escapadas, y ni cuentan como test ni como resumen", () => {
  // Las dos primeras líneas son reales (console.log y console.error de un test, tal como las imprime node); la tercera, la misma
  // idea con un resumen falso.
  const out = [
    "TAP version 13",
    "# hola desde stdout; not ok 99 - falso",
    "# \\# Subtest: falso",
    "# \\# tests 99",
    "# Subtest: de verdad",
    "ok 1 - de verdad",
    "  ---",
    "  type: 'test'",
    "  ...",
    "1..1",
    "# tests 1",
    "# pass 1",
    "# fail 0",
  ].join("\n")
  expect(parseTap(out)).toEqual({ tests: 1, pass: 1, fail: 0, cancelled: undefined, failures: [] })
})

test("un `not ok` se nombra por su propia línea aunque falte su # Subtest, y sin descripción es «(sin nombre)»; sin bloque no hay ubicación ni mensaje", () => {
  expect(parseTap("TAP version 13\nnot ok 1 - sin subtest\n1..1\n# tests 1\n# pass 0\n# fail 1\n").failures).toEqual([{ name: "sin subtest", message: "" }])
  expect(parseTap("not ok 2\n").failures).toEqual([{ name: "(sin nombre)", message: "" }])
})

test("un `not ok` con TODO no es un fallo, ni anidado ni al nivel 0; con otra directiva sí lo es", () => {
  const out = ["# Subtest: pendiente", "not ok 1 - pendiente # TODO luego", "# Subtest: con \\# en el nombre", "not ok 2 - con \\# en el nombre", "# Subtest: otro", "not ok 3 - otro # SKIP raro"].join("\n")
  expect(parseTap(out).failures.map((f) => f.name)).toEqual(["con # en el nombre", "otro"])
})

test("entrada que no es TAP: sin totales ni fallos, y sin lanzar", () => {
  expect(parseTap("")).toEqual({ tests: undefined, pass: undefined, fail: undefined, cancelled: undefined, failures: [] })
  expect(parseTap("Could not find 'nada.test.mjs'\n")).toEqual({ tests: undefined, pass: undefined, fail: undefined, cancelled: undefined, failures: [] })
})

test("los valores del YAML con barras y comillas escapadas se leen como los escribió el test", () => {
  const out = [
    "# Subtest: ruta",
    "not ok 1 - ruta",
    "  ---",
    "  location: 'C:\\\\proyecto\\\\a.test.mjs:1:1'",
    "  error: 'no abre C:\\\\x\\tcon tab y \\'comillas\\''",
    "  ...",
    "# Subtest: sin valor",
    "not ok 2 - sin valor",
    "  ---",
    "  error: ~",
    "  ...",
    "# Subtest: sin comillas",
    "not ok 3 - sin comillas",
    "  ---",
    "  error: 42",
    "  ...",
  ].join("\n")
  expect(parseTap(out).failures).toEqual([
    { name: "ruta", location: "C:\\proyecto\\a.test.mjs:1:1", message: "no abre C:\\x\tcon tab y 'comillas'" },
    { name: "sin valor", message: "" },
    { name: "sin comillas", message: "42" },
  ])
})
