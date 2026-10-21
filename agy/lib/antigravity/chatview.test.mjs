// lib/antigravity/chatview.test.mjs — el desglose estructurado que la tool manda al chat en sus metadatos (fase 15, D317).
import { test } from "node:test"
import assert from "node:assert/strict"
import { createChatView, CAPS } from "./chatview.mjs"

const t = "2026-10-07T10:00:00.000Z"
const tool = (i, state, name, parameters, output) => ({ type: "agy", call: 1, t, ev: { event: "step_update", step_update: { step_index: i, state, step_type: "tool", tool_info: { name, parameters, ...(output === undefined ? {} : { output }) } } } })

test("D317: el desglose sigue el reductor del visor: llamadas, herramientas, texto y diffs", () => {
  const view = createChatView()
  view.push({ type: "call_start", call: 1, t, layer: "direct", model: "m", cwd: "/p", instruction: "arregla" })
  view.push(tool(3, "ACTIVE", "run_command", { CommandLine: "echo demo" }))
  view.push(tool(3, "DONE", "run_command", { CommandLine: "echo demo" }, "demo\n"))
  view.push({ type: "agy", call: 1, t, ev: { event: "step_update", step_update: { step_index: 4, state: "DONE", step_type: "agent_response", text_delta: "Hecho." } } })
  view.push({ type: "diff", call: 1, t, tool: "replace_file_content", file: "a.txt", patch: "@@ -1 +1 @@\n-a\n+b\n" })
  const s = view.snapshot({ force: true })
  assert.equal(s.version, 1)
  assert.equal(s.cwd, "/p")
  assert.equal(s.live, true)
  assert.equal(s.calls.length, 1)
  const items = s.calls[0].items
  assert.deepEqual(items.map((i) => i.kind), ["tool", "text", "diff"])
  assert.equal(items[0].name, "run_command")
  assert.equal(items[0].state, "done")
  assert.equal(items[0].output, "demo\n")
  view.push({ type: "call_end", call: 1, t, status: "SUCCESS", tokens: { delta: 10, total: 10 }, seconds: { delta: 1, total: 1 } })
  assert.equal(view.snapshot({ force: true }).live, false)
})

test("D317: salidas, parches y textos largos se recortan para no inflar los metadatos de la parte", () => {
  const view = createChatView()
  view.push({ type: "call_start", call: 1, t, layer: "direct", model: "m", cwd: "/p" })
  view.push(tool(3, "DONE", "run_command", { CommandLine: "yes" }, "y\n".repeat(CAPS.output)))
  view.push({ type: "diff", call: 1, t, tool: "write_to_file", file: "a.txt", patch: "+x\n".repeat(CAPS.patch) })
  const [out, diff] = view.snapshot({ force: true }).calls[0].items
  assert.ok(out.output.length <= CAPS.output + 40)
  assert.match(out.output, /… \(\d+ caracteres más\)$/)
  assert.ok(diff.patch.length <= CAPS.patch + 40)
  assert.equal(diff.truncated, true)
})

test("D317: sin force, dos instantáneas seguidas devuelven la misma (se calcula como mucho cada 200 ms)", () => {
  const view = createChatView({ now: () => 1000 })
  view.push({ type: "call_start", call: 1, t, layer: "direct", model: "m", cwd: "/p" })
  const a = view.snapshot()
  view.push(tool(3, "ACTIVE", "view_file", { AbsolutePath: "/p/a" }))
  assert.equal(view.snapshot(), a)
  assert.equal(view.snapshot({ force: true }).calls[0].items.length, 1)
})
