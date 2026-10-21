// lib/antigravity/subagent.test.mjs — lo que hizo un subagente de agy, leído de su base (fase 15, D324). El fixture son los pasos reales
// del subagente «research» de la prueba en vivo (fase15-varios), copiados de ~/.gemini/antigravity-cli/conversations (solo lectura).
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { decodeSubagent, matchesParent } from "./subagent.mjs"
import { reduce } from "./ui/render.mjs"

const FIX = JSON.parse(fs.readFileSync(new URL("./fixtures/subagente-5050.json", import.meta.url), "utf8"))
const rows = FIX.rows.map((r) => ({ ...r, payload: Buffer.from(r.payload, "base64") }))

test("D324: decodeSubagent saca de quién es hijo, su encargo, sus herramientas con salida y su respuesta final", () => {
  const s = decodeSubagent(rows, { cid: FIX.cid, layer: "research", model: "gemini-3.8-flash-low", session: "ses_x" })
  assert.equal(s.parent, "6512209c-5098-414e-8520-4d5f34f83a6e")
  assert.match(s.instruction, /^Inspecciona todos los ficheros en el directorio src\//)
  assert.equal(s.done, true)
  const vm = reduce(s.events)
  assert.equal(vm.live, false)
  const call = vm.calls[0]
  assert.equal(call.layer, "research")
  assert.equal(call.status, "SUCCESS")
  assert.equal(call.end, "2026-10-07T18:56:47.000Z")
  const tools = call.items.filter((i) => i.kind === "tool")
  assert.deepEqual(tools.map((t) => t.name), ["run_command", "view_file", "view_file", "view_file", "send_message"])
  assert.equal(tools[0].parameters.CommandLine, "ls -la src/")
  assert.match(tools[0].output, /^total 24\n.*carrito\.mjs/s)
  assert.doesNotMatch(tools[0].output, /The command exited|Output:|\r/)
  assert.match(tools[1].output, /Total Lines: 9/)
  assert.match(tools[4].parameters.Message, /^He inspeccionado todos los ficheros/)
  const texts = call.items.filter((i) => i.kind === "text").map((i) => i.text)
  assert.match(texts.at(-1), /^El informe con el desglose/)
  // Lo que pensó el modelo (20/3) no se enseña como si lo hubiera dicho.
  assert.ok(!texts.some((t) => /^Confirmed no hidden/.test(t)))
})

test("D324: en curso (sin respuesta final todavía) queda en marcha; un comando con código ≠ 0 lo dice", () => {
  const partial = rows.slice(0, 5)
  const s = decodeSubagent(partial, { cid: FIX.cid, layer: "research", model: "m", session: "s" })
  assert.equal(s.done, false)
  assert.equal(reduce(s.events).live, true)
})

test("D324: matchesParent empareja por la conversación que lo lanzó y, si se da, por el encargo", () => {
  const head = rows[0]
  assert.equal(matchesParent(head, "6512209c-5098-414e-8520-4d5f34f83a6e"), true)
  assert.equal(matchesParent(head, "otra"), false)
  assert.equal(matchesParent(head, "6512209c-5098-414e-8520-4d5f34f83a6e", "Inspecciona todos los ficheros en el directorio src/"), true)
  assert.equal(matchesParent(head, "6512209c-5098-414e-8520-4d5f34f83a6e", "otro encargo"), false)
  assert.equal(matchesParent({ step_type: 15, payload: Buffer.alloc(0) }, "x"), false)
})
