// lib/antigravity/tool-icons.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { iconFor, mainArg, WRITE_TOOLS, IMAGE_RE } from "./tool-icons.mjs"

test("iconFor: conocidos, MCP y desconocidos", () => {
  assert.equal(iconFor("run_command"), "🔧"); assert.equal(iconFor("write_to_file"), "✏️")
  assert.equal(iconFor("mcp_xcodebuild_screenshot"), "🧩"); assert.equal(iconFor("wait"), "🔹")
})
test("mainArg: prioridad texto > ruta; vacío si nada", () => {
  assert.deepEqual(mainArg({ CommandLine: "ls", AbsolutePath: "/x" }), { kind: "text", value: "ls" })
  assert.deepEqual(mainArg({ TargetFile: "/a/b.py" }), { kind: "path", value: "/a/b.py" })
  assert.deepEqual(mainArg({}), { kind: null, value: "" }); assert.deepEqual(mainArg(undefined), { kind: null, value: "" })
})
test("WRITE_TOOLS e IMAGE_RE", () => {
  for (const t of ["write_to_file", "replace_file_content", "multi_replace_file_content", "sed_file", "notebook_edit"]) assert.ok(WRITE_TOOLS.has(t), t)
  assert.ok(!WRITE_TOOLS.has("view_file"))
  assert.ok(IMAGE_RE.test("/tmp/shot.PNG")); assert.ok(!IMAGE_RE.test("/tmp/a.py"))
})
