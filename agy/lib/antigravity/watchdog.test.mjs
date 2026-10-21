// lib/antigravity/watchdog.test.mjs — el vigilante de la capa actual es una réplica del de packages/task (fase 14, D290, D291, D300):
// los mismos casos y la MISMA conversación real con bucle (986463, 231 llamadas), que tiene que disparar en las mismas llamadas.
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { DEFAULT_WATCH, START, callKey, isRead, nudge, observe, watchConfig } from "./watchdog.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const cmd = (line, extra = {}) => ({ name: "run_command", parameters: { CommandLine: line, ...extra } })
const view = (p) => ({ name: "view_file", parameters: { AbsolutePath: p } })
const edit = { name: "replace_file_content", parameters: { TargetFile: "/p/a.ts" } }
const times = (n, call) => Array.from({ length: n }, () => call)

function run(calls, cfg = DEFAULT_WATCH) {
  let state = START
  const verdicts = []
  for (const call of calls) {
    const r = observe(cfg, state, call)
    state = r.state
    verdicts.push(r.verdict)
  }
  return { verdicts, state }
}
const fired = (verdicts) => verdicts.flatMap((v, i) => (v.kind === "seguir" ? [] : [{ i, kind: v.kind }]))

test("D290: cuatro órdenes iguales siguen; la quinta avisa con la llamada y las veces", () => {
  const { verdicts, state } = run(times(5, cmd("sed -n '1,9p' a.ts")))
  assert.ok(verdicts.slice(0, 4).every((v) => v.kind === "seguir"))
  assert.deepEqual(verdicts[4], { kind: "avisar", fired: 1, call: cmd("sed -n '1,9p' a.ts"), times: 5 })
  assert.equal(state.calls, 5)
  assert.equal(state.fired, 1)
  assert.equal(state.seen.size, 0)
})

test("D290: una edición pone la cuenta a cero; las repeticiones no tienen que ir seguidas", () => {
  assert.deepEqual(fired(run([...times(4, cmd("git grep x")), edit, ...times(4, cmd("git grep x"))]).verdicts), [])
  assert.deepEqual(fired(run([cmd("a"), cmd("b"), cmd("a"), cmd("c"), cmd("a"), cmd("a"), cmd("a")]).verdicts), [{ i: 6, kind: "avisar" }])
})

test("D290: toolAction y toolSummary no cuentan; el orden de las claves tampoco; otra orden es otra llamada", () => {
  const calls = Array.from({ length: 5 }, (_, i) => cmd("git status", { toolAction: `paso ${i}`, toolSummary: `miro ${i}` }))
  assert.deepEqual(fired(run(calls).verdicts), [{ i: 4, kind: "avisar" }])
  const a = { name: "call_mcp_tool", parameters: { ServerName: "anti_anti", Arguments: { ficheros: [{ ruta: "a", desde: 1 }] } } }
  const b = { name: "call_mcp_tool", parameters: { Arguments: { ficheros: [{ desde: 1, ruta: "a" }] }, ServerName: "anti_anti" } }
  assert.equal(callKey(a), callKey(b))
  assert.deepEqual(fired(run(Array.from({ length: 8 }, (_, i) => cmd(i % 2 ? "sed -n '50,80p' a.ts" : "sed -n '1,9p' a.ts"))).verdicts), [])
  assert.equal(callKey({ name: "a", parameters: { x: undefined } }), callKey({ name: "a", parameters: { x: null } }))
})

test("D300: las lecturas cuentan por fichero y avisan a la 15.ª; call_mcp_tool también es lectura", () => {
  assert.deepEqual([view("/p/a.ts"), { name: "call_mcp_tool", parameters: {} }, cmd("cat a"), edit].map(isRead), [true, true, false, false])
  assert.deepEqual(fired(run(times(15, view("/p/a.ts"))).verdicts), [{ i: 14, kind: "avisar" }])
  assert.deepEqual(fired(run([...times(10, view("/p/a.ts")), ...times(10, view("/p/b.ts"))]).verdicts), [])
})

test("D291: avisos en la 5.ª y la 10.ª, corte en la 15.ª; el tope de llamadas corta y le gana al bucle", () => {
  const { verdicts } = run(times(15, cmd("git grep x")))
  assert.deepEqual(fired(verdicts), [{ i: 4, kind: "avisar" }, { i: 9, kind: "avisar" }, { i: 14, kind: "cortar" }])
  assert.deepEqual(verdicts[14], { kind: "cortar", reason: "bucle", call: cmd("git grep x") })
  const cfg = watchConfig({ repeat: 3, readRepeat: 3, nudges: 2, maxCalls: 2 })
  assert.deepEqual(run(times(3, cmd("ls")), cfg).verdicts[2], { kind: "cortar", reason: "llamadas", call: cmd("ls") })
  assert.deepEqual(DEFAULT_WATCH, { repeat: 5, readRepeat: 15, nudges: 2, maxCalls: 120 })
  assert.throws(() => watchConfig({ repeat: 1, readRepeat: 15, nudges: 2, maxCalls: 10 }), /repeat/)
})

test("réplica de packages/task: la conversación real con bucle (986463, 231 llamadas) avisa en 63 y 85 y corta en 105", () => {
  const { llamadas } = JSON.parse(fs.readFileSync(path.join(here, "fixtures/watchdog-bucle-986463.json"), "utf8"))
  assert.equal(llamadas.length, 231)
  assert.deepEqual(fired(run(llamadas).verdicts).slice(0, 3), [{ i: 63, kind: "avisar" }, { i: 85, kind: "avisar" }, { i: 105, kind: "cortar" }])
})

test("D294: el mensaje correctivo dice qué se repitió y cómo seguir", () => {
  const read = nudge({ call: view("/p/a.ts"), times: 15, fired: 1 })
  assert.match(read, /^DETECTOR DE BUCLES: has leído 15 veces lo mismo/)
  assert.match(read, /aviso 1/)
  assert.match(read, /haz el cambio, ejecuta los tests una vez y termina/)
  assert.match(nudge({ call: cmd("x".repeat(400)), times: 5, fired: 2 }), /has hecho 5 veces la misma llamada .*…\)/)
})
