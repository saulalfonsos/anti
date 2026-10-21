// lib/antigravity/ui/render.test.mjs — modelo de vista puro.
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { reduce, createReducer, parseUnifiedDiff, describeTool, findImages } from "./render.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const sample = () => fs.readFileSync(path.join(here, "../fixtures/events-sample.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
const SAMPLE = sample()

test("reduce: llamadas, plan fijo con estados, llamada en curso", () => {
  const vm = reduce(sample())
  assert.equal(vm.cid, "demo-1"); assert.equal(vm.cwd, "/tmp/agy-demo"); assert.equal(vm.live, true); assert.equal(vm.pro, false)
  assert.equal(vm.calls.length, 3)
  assert.deepEqual(vm.plan.steps.map((s) => [s.k, s.layer, s.status]), [[1, "implement", "done"], [2, "verify", "running"]])
  assert.equal(vm.plan.answer, "Añadir decrement() y su test.")
  const c2 = vm.calls[1]
  assert.deepEqual(c2.items.map((i) => i.kind), ["text", "tool", "diff", "tool", "text"])
  assert.equal(c2.items[1].name, "replace_file_content"); assert.equal(c2.items[1].icon, "✏️"); assert.equal(c2.items[1].arg, "counter.py"); assert.equal(c2.items[1].state, "done")
  assert.equal(c2.items[1].parameters.TargetContent, "        self.value = current + 1\n")   // los parámetros del ACTIVE se conservan
  assert.match(c2.items[3].output, /Ran 1 test/); assert.equal(c2.items[3].arg, "python3 -m unittest counter_test.CounterTest.test_decrement")
  assert.deepEqual(c2.usage, { tokens: { delta: 10400, total: 30900 }, seconds: { delta: 6, total: 26 } }); assert.equal(c2.status, "SUCCESS")
  const c3 = vm.calls[2]; assert.equal(c3.end, null); assert.equal(c3.items[0].state, "running"); assert.deepEqual(c3.items[0].images, ["/tmp/agy-demo/shot.png"])
  assert.equal(vm.banner, null); assert.equal(vm.lastUsage.tokens.delta, 10400)
})
test("reduce: pregunta, denegación, reintento, aborto y thinking", () => {
  const base = sample().slice(0, 8)   // hasta el call_start del paso 1
  const t = "2026-09-14T10:01:00.000Z"
  const q = reduce([...base, { t, cid: "demo-1", call: 2, type: "question", text: "¿borro X?", layer: "implement", step: { k: 1, n: 2 } },
    { t, cid: "demo-1", call: 2, type: "call_end", status: "SUCCESS", advanced: false, tokens: { delta: 1, total: 1 }, seconds: { delta: 1, total: 1 }, model: "m", proCount: 0, notes: [], exit: 0 }])
  assert.deepEqual(q.banner, { kind: "question", text: "¿borro X?" }); assert.equal(q.plan.steps[0].status, "waiting"); assert.equal(q.live, false)
  const d = reduce([...base, { t, cid: "demo-1", call: 2, type: "denied", actions: [{ action: "command" }], rule: "command(uname)", outcome: "asked" }])
  assert.equal(d.banner.kind, "denied"); assert.equal(d.banner.rule, "command(uname)")
  const ok = reduce([...base, { t, cid: "demo-1", call: 2, type: "denied", actions: [], rule: "command(uname)", outcome: "asked" }, { t, cid: "demo-1", call: 2, type: "retry", reason: "command(uname)" }])
  assert.equal(ok.banner, null); assert.equal(ok.calls[1].items.at(-1).kind, "note")
  const ab = reduce([...base, { t, cid: "demo-1", call: 2, type: "note", text: "abortada por el usuario" }])
  assert.equal(ab.banner.kind, "aborted")
  const th = reduce([...base, { t, cid: "demo-1", type: "thinking", step_index: 7, thinking: "**Plan**\nPrimero leo." }])
  assert.deepEqual(th.calls[1].items.at(-1), { kind: "thinking", t, step: 7, text: "**Plan**\nPrimero leo." })
  const err = reduce([...base, { t, cid: "demo-1", call: 2, type: "call_end", status: "NO_RESULT", advanced: false, tokens: null, seconds: null, model: "m", proCount: 0, notes: [], exit: 1 }])
  assert.equal(err.banner.kind, "error"); assert.equal(err.plan.steps[0].status, "failed")
})
test("reduce: reintento tras añadir la regla sigue denegado → llamada y paso marcados como fallo, no éxito", () => {
  const base = sample().slice(0, 8)   // hasta el call_start del paso 1
  const t = "2026-09-14T10:01:00.000Z"
  const rd = reduce([...base,
    { t, cid: "demo-1", call: 2, type: "denied", actions: [{ action: "command" }], rule: "command(uname)", outcome: "asked" },
    { t, cid: "demo-1", call: 2, type: "denied", actions: [{ action: "command" }], rule: "command(uname)", outcome: "allowed" },
    { t, cid: "demo-1", call: 2, type: "denied", actions: [{ action: "command" }], rule: "command(uname)", outcome: "retry-denied" },
    { t, cid: "demo-1", call: 2, type: "call_end", status: "SUCCESS", advanced: false, tokens: { delta: 1, total: 1 }, seconds: { delta: 1, total: 1 }, model: "m", proCount: 0, notes: [], exit: 0 }])
  assert.equal(rd.banner.kind, "denied"); assert.equal(rd.banner.outcome, "retry-denied")
  assert.equal(rd.calls[1].status, "SUCCESS"); assert.equal(rd.calls[1].denied, true)   // agy dice SUCCESS pero fue un fallo
  assert.equal(rd.plan.steps[0].status, "failed")
  assert.equal(rd.calls[1].deniedOutcome, undefined)   // campo interno, no se filtra al viewModel
})
test("parseUnifiedDiff: cabecera, hunks y tipos de línea", () => {
  const patch = sample().find((e) => e.type === "diff").patch
  const files = parseUnifiedDiff(patch)
  assert.equal(files.length, 1); assert.match(files[0].header, /^diff --git a\/counter\.py/)
  assert.equal(files[0].hunks.length, 1); assert.equal(files[0].hunks[0].header, "@@ -10,3 +10,8 @@ class Counter:")
  assert.deepEqual(files[0].hunks[0].lines.map((l) => l.type), ["ctx", "ctx", "ctx", "add", "add", "add", "add", "add"])
  assert.equal(files[0].hunks[0].lines[4].text, "    def decrement(self):")
  assert.equal(files[0].hunks[0].oldStart, 10); assert.equal(files[0].hunks[0].newStart, 10)
  assert.equal(files[0].hunks[0].lines[0].oldNo, 10); assert.equal(files[0].hunks[0].lines[0].newNo, 10)
  assert.equal(files[0].hunks[0].lines[3].oldNo, null); assert.equal(files[0].hunks[0].lines[3].newNo, 13)
  assert.deepEqual(parseUnifiedDiff(""), [])
})
test("parseUnifiedDiff: parche con dos ficheros y una línea '\\ No newline at end of file' (meta, sin números de línea)", () => {
  const patch = [
    "diff --git a/foo.py b/foo.py",
    "index 1111111..2222222 100644",
    "--- a/foo.py",
    "+++ b/foo.py",
    "@@ -1,2 +1,2 @@",
    "-old line",
    "+new line",
    " context",
    "\\ No newline at end of file",
    "diff --git a/bar.py b/bar.py",
    "index 3333333..4444444 100644",
    "--- a/bar.py",
    "+++ b/bar.py",
    "@@ -1,1 +1,1 @@",
    "-bar old",
    "+bar new",
  ].join("\n")
  const files = parseUnifiedDiff(patch)
  assert.equal(files.length, 2)
  assert.match(files[0].header, /^diff --git a\/foo\.py/); assert.match(files[1].header, /^diff --git a\/bar\.py/)
  assert.equal(files[0].hunks.length, 1); assert.equal(files[1].hunks.length, 1)
  const lines0 = files[0].hunks[0].lines
  assert.deepEqual(lines0.map((l) => l.type), ["del", "add", "ctx", "meta"])
  const meta = lines0.at(-1)
  assert.equal(meta.text, " No newline at end of file"); assert.equal(meta.oldNo, null); assert.equal(meta.newNo, null)
  const lines1 = files[1].hunks[0].lines
  assert.deepEqual(lines1.map((l) => l.type), ["del", "add"])
  assert.equal(lines1[0].oldNo, 1); assert.equal(lines1[1].newNo, 1)
})
test("describeTool y findImages", () => {
  assert.deepEqual(describeTool({ name: "view_file", parameters: { AbsolutePath: "/w/a/b.py" } }, "/w"), { icon: "👁", name: "view_file", arg: "a/b.py" })
  assert.deepEqual(describeTool({ name: "run_command", parameters: { CommandLine: "ls -la" } }, "/w"), { icon: "🔧", name: "run_command", arg: "ls -la" })
  assert.deepEqual(findImages({ CommandLine: "xcrun simctl io booted screenshot /tmp/s.png" }, "saved /tmp/s.png and /var/x/y.jpeg"), ["/tmp/s.png", "/var/x/y.jpeg"])
  assert.deepEqual(findImages({}, "nada"), [])
})

test("createReducer: push por lotes ≡ reduce(todo) y snapshot no expone el Map interno", () => {
  const r = createReducer()
  r.push(SAMPLE.slice(0, 7)); r.push(SAMPLE.slice(7, 12)); r.push(SAMPLE.slice(12))
  const inc = r.snapshot(), full = reduce(SAMPLE)
  assert.deepEqual(JSON.parse(JSON.stringify(inc)), JSON.parse(JSON.stringify(full)))
  assert.equal(r.count, SAMPLE.length)
  assert.equal(inc.calls[0].tools, undefined)
  // snapshot devuelve una copia: mutarla no afecta a la siguiente
  inc.calls[0].items.length = 0
  assert.ok(r.snapshot().calls[0].items.length > 0)
})
test("createReducer: snapshot intermedio marca live=true mientras la llamada no ha terminado", () => {
  const r = createReducer().push(SAMPLE.slice(0, 3))
  assert.equal(r.snapshot().live, true)
})
test("createReducer: ACTIVE/DONE de run_command partidos entre lotes (idx 12/13) sigue coincidiendo con reduce(todo)", () => {
  // El corte 0-7/7-12/12-fin del primer test de equivalencia no atraviesa ningún par ACTIVE/DONE de tool
  // (view_file: idx 2/3, replace_file_content: idx 9/10, run_command: idx 12/13 — todos caen dentro del
  // mismo lote). Aquí el corte pasa justo entre el ACTIVE (idx 12) y el DONE (idx 13) de run_command, para
  // ejercitar que `applyAgy` encuentra la tool en `call.tools` (viva entre `push`s) en el lote siguiente.
  const r = createReducer()
  r.push(SAMPLE.slice(0, 13))
  assert.equal(r.snapshot().live, true, "call 2 sigue abierta: el ACTIVE de run_command ya llegó pero no su DONE ni el call_end")
  r.push(SAMPLE.slice(13))
  const inc = r.snapshot(), full = reduce(SAMPLE)
  assert.deepEqual(JSON.parse(JSON.stringify(inc)), JSON.parse(JSON.stringify(full)))
  // Nota: este fixture no cierra la última llamada (call 3 queda con un tool ACTIVE sin DONE ni call_end),
  // así que `live` sigue en `true` tras el segundo push — igual que en reduce(SAMPLE) (ver primer test del
  // fichero, que ya afirma vm.live === true para el fixture completo).
  assert.equal(inc.live, true)
  const runCmd = inc.calls[1].items[3]
  assert.equal(runCmd.name, "run_command")
  assert.notEqual(runCmd.state, "running")
  assert.ok(runCmd.output)
})

// Fase 15 (D321): lo que hace Gemini en cada llamada, para marcarlo en el chat: turnos del modelo, segundos de modelo («pensó») y tokens
// de pensamiento, de los `agent_response` DONE con `duration_seconds`; y cuándo empezó y terminó cada herramienta.
test("D321: turnos, segundos de modelo y tokens de pensamiento por llamada; inicio y fin de cada herramienta", () => {
  const su = (o) => ({ type: "agy", t: o.t ?? "2026-10-07T10:00:00.000Z", ev: { event: "step_update", step_update: o } })
  const vm = reduce([
    { type: "call_start", call: 1, t: "2026-10-07T10:00:00.000Z", layer: "direct", model: "gemini-3.8-flash-low" },
    su({ step_index: 1, state: "DONE", step_type: "agent_response", duration_seconds: 2.5, usage: { thinking_tokens: 0 } }),
    su({ t: "2026-10-07T10:00:03.000Z", step_index: 2, state: "ACTIVE", step_type: "tool", tool_info: { name: "run_command", parameters: { CommandLine: "ls" } } }),
    su({ t: "2026-10-07T10:00:05.000Z", step_index: 2, state: "DONE", step_type: "tool", tool_info: { name: "run_command", output: "a" } }),
    su({ step_index: 3, state: "DONE", step_type: "agent_response", duration_seconds: 1.25, usage: { thinking_tokens: 40 } }),
    su({ step_index: 4, state: "ACTIVE", step_type: "agent_response", text_delta: "hola" }),
  ])
  const call = vm.calls[0]
  assert.equal(call.turns, 2)
  assert.equal(call.modelSeconds, 3.75)
  assert.equal(call.thinkingTokens, 40)
  const tool = call.items.find((i) => i.kind === "tool")
  assert.equal(tool.startedAt, "2026-10-07T10:00:03.000Z")
  assert.equal(tool.endedAt, "2026-10-07T10:00:05.000Z")
})

test("D322: invoke_subagent queda terminado con el paso «subagent» DONE (agy no manda el DONE de la tool)", () => {
  const t = "2026-01-01T00:00:00Z"
  const step = (step_type, state, tool_info) => ({ type: "agy", call: 1, t, ev: { event: "step_update", step_update: { step_index: 2, step_type, state, tool_info } } })
  const vm = reduce([
    { type: "call_start", call: 1, cid: "x", layer: "direct", model: "m", level: "normal", pro: false, step: null, session: "s", cwd: "/p", instruction: "i", t },
    step("tool", "ACTIVE", { name: "invoke_subagent", parameters: { Subagents: [{ TypeName: "research", Role: "Codebase Researcher", Prompt: "lista" }] } }),
  ])
  assert.equal(vm.calls[0].items.at(-1).state, "running")
  const done = reduce([
    { type: "call_start", call: 1, cid: "x", layer: "direct", model: "m", level: "normal", pro: false, step: null, session: "s", cwd: "/p", instruction: "i", t },
    step("tool", "ACTIVE", { name: "invoke_subagent", parameters: { Subagents: [{ TypeName: "research", Role: "Codebase Researcher", Prompt: "lista" }] } }),
    step("subagent", "DONE", {}),
  ])
  const item = done.calls[0].items.find((i) => i.kind === "tool")
  assert.equal(item.state, "done")
  assert.equal(item.parameters.Subagents[0].TypeName, "research")
})
