// lib/antigravity/stream.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { splitLines, describeTool, parseEvent } from "./stream.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const CWD = "/home/u/tmp/frontier-smoke"
const fixture = fs.readFileSync(path.join(here, "fixtures/agy-stream.ndjson"), "utf8")

test("splitLines: devuelve líneas completas y conserva el resto", () => {
  assert.deepEqual(splitLines("", 'a\nb\nc'), { lines: ["a", "b"], rest: "c" })
  assert.deepEqual(splitLines("c", "d\n"), { lines: ["cd"], rest: "" })
})
test("describeTool: comando, ruta relativa al cwd, truncado a 80", () => {
  assert.equal(describeTool({ name: "run_command", parameters: { CommandLine: "python3 -m unittest -v" } }, CWD), "🔧 run_command: python3 -m unittest -v")
  assert.equal(describeTool({ name: "view_file", parameters: { AbsolutePath: `${CWD}/counter.py` } }, CWD), "👁 view_file: counter.py")
  assert.equal(describeTool({ name: "replace_file_content", parameters: { TargetFile: `${CWD}/a/b.py` } }, CWD), `✏️ replace_file_content: ${path.join("a", "b.py")}`)
  const long = describeTool({ name: "run_command", parameters: { CommandLine: "x".repeat(200) } }, CWD)
  assert.equal(long.length, "🔧 run_command: ".length + 80); assert.ok(long.endsWith("…"))
  assert.equal(describeTool({ name: "wait" }, CWD), "🔹 wait")
})
test("parseEvent sobre el fixture: líneas esperadas, ERROR, línea inválida y result", () => {
  const out = fixture.split("\n").filter(Boolean).map((l) => parseEvent(l, CWD))
  const lines = out.map((o) => o.line).filter(Boolean)
  assert.deepEqual(lines, [
    "🔍 find_by_name: *",
    "👁 view_file: counter.py",
    "💬 Voy a ejecutar los tests para ver el estado actual.",
    "🔧 run_command: python3 -m unittest -v counter_test.py",
    '🔧 run_command: python3 -c " import threading, time print(1) "',
    "⚠️ run_command ERROR",
  ])
  assert.equal(out.filter((o) => o.error).length, 1)
  const result = out.find((o) => o.result)?.result
  assert.equal(result.status, "SUCCESS"); assert.equal(result.denied_actions[0].action, "command")
  const done = out.filter((o) => o.done)
  assert.equal(done.length, 3)
  assert.equal(done.find((o) => o.done.name === "run_command").done.output, "test_concurrent_increments ... FAIL")
  assert.deepEqual(out.find((o) => o.active?.name === "view_file").active.parameters, { AbsolutePath: `${CWD}/counter.py` })
  assert.equal(out.find((o) => o.result).line, undefined)
})
test("parseEvent: agent_response largo se trunca a 120 y los DONE de tool no producen línea", () => {
  const r = parseEvent(JSON.stringify({ event: "step_update", step_update: { step_type: "agent_response", state: "DONE", text_delta: "y".repeat(300) } }), CWD)
  assert.equal(r.line.length, "💬 ".length + 120)
  assert.deepEqual(parseEvent(JSON.stringify({ event: "step_update", step_update: { step_type: "tool", state: "DONE", tool_name: "x" } }), CWD),
    { done: { name: "x", parameters: {}, output: "" } })
  assert.deepEqual(parseEvent(JSON.stringify({ event: "init", conversation_id: "c" }), CWD), { init: { conversation_id: "c" } })
})
