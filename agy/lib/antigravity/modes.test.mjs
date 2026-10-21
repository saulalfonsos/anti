// lib/antigravity/modes.test.mjs — marcas del mensaje y enrutado entre el modo directo y el orquestador (fase 15, D303, D304, D306, D307).
import { test } from "node:test"
import assert from "node:assert/strict"
import { parseMarks, route } from "./modes.mjs"
import { emptyState } from "./policy.mjs"

test("D304: /orquestar en cualquier parte del texto se detecta y se quita", () => {
  assert.deepEqual(parseMarks("/orquestar añade un login"), { orquestar: true, leer: null, prompt: "añade un login" })
  assert.deepEqual(parseMarks("añade un login /orquestar por favor"), { orquestar: true, leer: null, prompt: "añade un login por favor" })
  assert.deepEqual(parseMarks("añade un login\n/orquestar"), { orquestar: true, leer: null, prompt: "añade un login" })
  assert.equal(parseMarks("añade un login, /ORQUESTAR.").orquestar, true)
})

test("D304: una palabra que solo contiene la marca no cuenta", () => {
  assert.equal(parseMarks("mira src/orquestar.ts").orquestar, false)
  assert.equal(parseMarks("la ruta a/orquestar/b").orquestar, false)
  assert.equal(parseMarks("lee /leerme.md").leer, null)
})

test("D307: /leer on|off en cualquier parte; gana la última; /leer solo pide el estado", () => {
  assert.deepEqual(parseMarks("/leer on arregla el test"), { orquestar: false, leer: "on", prompt: "arregla el test" })
  assert.deepEqual(parseMarks("arregla el test /leer off"), { orquestar: false, leer: "off", prompt: "arregla el test" })
  assert.equal(parseMarks("/leer on y luego /leer OFF").leer, "off")
  assert.deepEqual(parseMarks("/leer"), { orquestar: false, leer: "estado", prompt: "" })
  assert.deepEqual(parseMarks("/leer off /orquestar haz X"), { orquestar: true, leer: "off", prompt: "haz X" })
})

test("sin marcas el texto pasa tal cual, con sus saltos de línea", () => {
  assert.deepEqual(parseMarks("línea 1\n  línea 2"), { orquestar: false, leer: null, prompt: "línea 1\n  línea 2" })
  assert.deepEqual(parseMarks(undefined), { orquestar: false, leer: null, prompt: "" })
})

test("D303/D304/D306: el enrutado", () => {
  const fresh = emptyState()
  const orq = { ...emptyState(), mode: "orquestador" }
  const legacy = { ...emptyState(), plan: [{ layer: "implement" }] }
  const direct = { ...emptyState(), mode: "directo", plan: [] }
  const m = (prompt) => parseMarks(prompt)
  assert.equal(route({ isNext: false, marks: m("arregla X"), state: fresh }), "directo")
  assert.equal(route({ isNext: false, marks: m("arregla X /orquestar"), state: fresh }), "orquestador")
  assert.equal(route({ isNext: false, layer: "orchestrate", marks: m("arregla X"), state: fresh }), "orquestador")
  assert.equal(route({ isNext: true, marks: m(""), state: orq }), "orquestador")
  // D306: la continuación sigue el modo con el que empezó la conversación
  assert.equal(route({ isNext: false, marks: m("ahora cambia Y"), state: orq }), "orquestador")
  assert.equal(route({ isNext: false, marks: m("ahora cambia Y"), state: direct }), "directo")
  // conversaciones guardadas antes de la fase 15: sin `mode`, con plan → orquestador
  assert.equal(route({ isNext: false, marks: m("sigue"), state: legacy }), "orquestador")
  // D307: un mensaje que solo trae marcas de /leer no llama a agy
  assert.equal(route({ isNext: false, marks: m("/leer off"), state: fresh }), "solo-marcas")
  assert.equal(route({ isNext: false, marks: m("/leer"), state: fresh }), "solo-marcas")
  assert.equal(route({ isNext: false, marks: m("/leer on arregla X"), state: fresh }), "directo")
})
