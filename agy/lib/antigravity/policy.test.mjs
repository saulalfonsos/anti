// lib/antigravity/policy.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { decide, detectPro, recordOutcome, planFromStructured, emptyState, normalizeLevel, ELIGIBLE, PRO_MODE, usageDelta, detectQuestion } from "./policy.mjs"

const cfg = {
  model: { orchestrate: "flash", architect: "flash", research: "flash", implement: "flash", fix: "flash",
           review: "flash", verify: "flash", light: "flash-low", pro: "pro" },
  pro_auto: { orchestrate: false, architect: false, research: false, review: false, verify: false },
}
const st = (over = {}) => ({ ...emptyState(), ...over, failures: { verify: 0, review: 0, ...(over.failures ?? {}) } })

test("normal → modelo base, sin escalada", () => {
  assert.deepEqual(decide({ layer: "implement", level: "normal", state: st(), cfg }),
    { model: "flash", escalate: "none", trigger: null, level: "normal" })
})
test("light → modelo light en cualquier rol, nunca escala (ni con /pro)", () => {
  assert.equal(decide({ layer: "review", level: "light", state: st({ pro: true }), cfg }).model, "flash-low")
})
test("deep en rol elegible sin PRO-auto → ask", () => {
  const d = decide({ layer: "review", level: "deep", state: st(), cfg })
  assert.equal(d.escalate, "ask"); assert.equal(d.trigger, "deep"); assert.equal(d.model, "flash")
})
test("deep en rol elegible con PRO-auto → auto con modelo pro", () => {
  const c = { ...cfg, pro_auto: { ...cfg.pro_auto, review: true } }
  const d = decide({ layer: "review", level: "deep", state: st(), cfg: c })
  assert.equal(d.escalate, "auto"); assert.equal(d.model, "pro")
})
test("deep en implement/fix → se ignora (nunca escalan)", () => {
  for (const layer of ["implement", "fix"]) {
    const d = decide({ layer, level: "deep", state: st({ pro: true }), cfg })
    assert.equal(d.escalate, "none"); assert.equal(d.model, "flash")
  }
})
test("/pro (state.pro) → pro-mode en elegibles aunque level sea normal", () => {
  const d = decide({ layer: "architect", level: "normal", state: st({ pro: true }), cfg })
  assert.equal(d.escalate, "pro-mode"); assert.equal(d.model, "pro"); assert.equal(d.trigger, null)
})
test("G1: dos FAIL de verify disparan en research/review/verify pero no en architect", () => {
  const s = st({ failures: { verify: 2 } })
  for (const layer of ["research", "review", "verify"]) {
    const d = decide({ layer, level: "normal", state: s, cfg })
    assert.equal(d.escalate, "ask"); assert.equal(d.trigger, "G1")
  }
  assert.equal(decide({ layer: "architect", level: "normal", state: s, cfg }).escalate, "none")
  assert.equal(decide({ layer: "review", level: "normal", state: st({ failures: { verify: 1 } }), cfg }).escalate, "none")
})
test("G3: review con más de 8 ficheros cambiados → ask; 8 o menos → none", () => {
  assert.equal(decide({ layer: "review", level: "normal", state: st(), cfg, changedFiles: 9 }).trigger, "G3")
  assert.equal(decide({ layer: "review", level: "normal", state: st(), cfg, changedFiles: 8 }).escalate, "none")
  assert.equal(decide({ layer: "research", level: "normal", state: st(), cfg, changedFiles: 50 }).escalate, "none")
})
test("level inválido → normal; rol sin modelo → error", () => {
  assert.equal(normalizeLevel("turbo"), "normal")
  assert.throws(() => decide({ layer: "nope", level: "normal", state: st(), cfg }), /sin modelo base/)
})
test("detectPro: detecta y elimina la línea [[PRO]]", () => {
  assert.deepEqual(detectPro("[[PRO]]\nAñade X"), { pro: true, prompt: "Añade X" })
  assert.deepEqual(detectPro("Añade X"), { pro: false, prompt: "Añade X" })
  assert.deepEqual(detectPro(undefined), { pro: false, prompt: "" })
})
test("recordOutcome: cuenta FAIL en verify y NEEDS_FIX en review, ignora el resto", () => {
  const s = st()
  recordOutcome(s, "verify", "Ran 2 tests\nFAIL (failures=1)")
  recordOutcome(s, "verify", "PASS: todo ok")
  recordOutcome(s, "review", "Veredicto:\nNEEDS_FIX\n1. …")
  recordOutcome(s, "implement", "FAIL no cuenta aquí")
  assert.deepEqual(s.failures, { verify: 1, review: 1 })
})
test("planFromStructured: normaliza niveles, degrada deep en implement/fix, descarta pasos inválidos", () => {
  const plan = planFromStructured({ steps: [
    { layer: "implement", level: "deep", reason: "x", instruction: "haz A" },
    { layer: "review", level: "deep", reason: "G4: cripto", instruction: "revisa A" },
    { layer: "verify", level: "banana", instruction: "  tests " },
    { layer: "orchestrate", level: "normal", instruction: "no permitido" },
    { layer: "fix", instruction: "" },
    null,
  ] })
  assert.deepEqual(plan, [
    { layer: "implement", level: "normal", reason: "x", instruction: "haz A" },
    { layer: "review", level: "deep", reason: "G4: cripto", instruction: "revisa A" },
    { layer: "verify", level: "normal", reason: "", instruction: "tests" },
  ])
  assert.deepEqual(planFromStructured(undefined), [])
})
test("ELIGIBLE no incluye implement ni fix", () => {
  assert.equal(ELIGIBLE.has("implement"), false); assert.equal(ELIGIBLE.has("verify"), true)
})
test("/pro: Pro en orchestrate/architect/research/review; verify e implement siguen la política normal", () => {
  assert.deepEqual([...PRO_MODE].sort(), ["architect", "orchestrate", "research", "review"])
  for (const layer of PRO_MODE) assert.equal(decide({ layer, state: st({ pro: true }), cfg }).escalate, "pro-mode", layer)
  assert.deepEqual(decide({ layer: "verify", state: st({ pro: true }), cfg }),
    { model: "flash", escalate: "none", trigger: null, level: "normal" })
  assert.equal(decide({ layer: "verify", level: "deep", state: st({ pro: true }), cfg }).escalate, "ask")
  assert.equal(decide({ layer: "implement", state: st({ pro: true }), cfg }).model, "flash")
})
test("emptyState trae usage y calls a cero", () => {
  assert.deepEqual(emptyState().usage, { tokens: 0, seconds: 0 }); assert.equal(emptyState().calls, 0)
})
test("usageDelta: agy acumula por conversación; devuelve el delta y recuerda el total", () => {
  const s = st()
  assert.deepEqual(usageDelta(s, { usage: { total_tokens: 100 }, duration_seconds: 10 }),
    { tokens: { delta: 100, total: 100 }, seconds: { delta: 10, total: 10 } })
  assert.deepEqual(usageDelta(s, { usage: { total_tokens: 130 }, duration_seconds: 14.6 }).tokens, { delta: 30, total: 130 })
  assert.equal(usageDelta(s, { usage: { total_tokens: 20 }, duration_seconds: 2 }).tokens.delta, 20) // conversación reiniciada
  assert.deepEqual(usageDelta(s, {}), { tokens: { delta: 0, total: 0 }, seconds: { delta: 0, total: 0 } })
  assert.deepEqual(s.usage, { tokens: 0, seconds: 0 })
})
test("detectQuestion: última línea PREGUNTA:, o null", () => {
  assert.equal(detectQuestion("hice X.\nPREGUNTA: ¿borro el fichero viejo?\n"), "¿borro el fichero viejo?")
  assert.equal(detectQuestion("PREGUNTA: a\nmás texto\n  PREGUNTA:   b  "), "b")
  assert.equal(detectQuestion("sin pregunta"), null); assert.equal(detectQuestion(undefined), null)
})
