// lib/antigravity/report.test.mjs — formato puro de la salida para Ling.
import { test } from "node:test"
import assert from "node:assert/strict"
import { nextLine, trailer, report, noResultReport, noStepsReport, fail } from "./report.mjs"

test("nextLine: las cinco formas fijas", () => {
  assert.equal(nextLine({ kind: "step", cid: "c1" }), 'SIGUIENTE: antigravity(step="next", conversation_id="c1")')
  assert.equal(nextLine({ kind: "done", cid: "c1" }), "SIGUIENTE: nada — cuenta el resultado al usuario.")
  assert.equal(nextLine({ kind: "question", cid: "c1", question: "¿A o B?", wasStep: true }),
    'SIGUIENTE: pregunta al usuario: "¿A o B?" y, con su respuesta, llama a antigravity(step="next", conversation_id="c1", prompt=<respuesta>)')
  assert.equal(nextLine({ kind: "question", cid: "c1", question: "¿A o B?", wasStep: false, hasPlan: true }),
    'SIGUIENTE: pregunta al usuario: "¿A o B?" y, con su respuesta, llama a antigravity(prompt=<respuesta>, conversation_id="c1")')
  assert.equal(nextLine({ kind: "problem", cid: "c1", wasStep: true }),
    'SIGUIENTE: cuéntale al usuario el problema tal cual y pregúntale cómo seguir; para repetir llama a antigravity(step="next", conversation_id="c1")')
  assert.equal(nextLine({ kind: "problem", cid: "c1", wasStep: false }),
    'SIGUIENTE: cuéntale al usuario el problema tal cual y pregúntale cómo seguir; para repetir llama a antigravity(prompt=<la petición de nuevo>, conversation_id="c1")')
  assert.equal(nextLine({ kind: "problem", cid: null, wasStep: false }),
    "SIGUIENTE: cuéntale al usuario el problema tal cual y pregúntale cómo seguir; para repetir llama a antigravity(prompt=<la petición de nuevo>)")
})
test("nextLine: problem sigue la llamada real (wasStep), no si hay plan (hasPlan)", () => {
  // Reintento fallido de un re-plan a mitad de tarea: esta llamada fue prompt=…, no step="next",
  // aunque la conversación tenga un plan (hasPlan true) — el SIGUIENTE debe repetir prompt, no step.
  assert.equal(nextLine({ kind: "problem", cid: "c1", hasPlan: true, wasStep: false }),
    'SIGUIENTE: cuéntale al usuario el problema tal cual y pregúntale cómo seguir; para repetir llama a antigravity(prompt=<la petición de nuevo>, conversation_id="c1")')
})
test("trailer: deltas y acumulados; sin usage → exit; sin cid → conv=?", () => {
  const u = { tokens: { delta: 30, total: 130 }, seconds: { delta: 4.6, total: 14.6 } }
  assert.equal(trailer({ layer: "fix", level: "normal", model: "m", status: "SUCCESS", usage: u, proCount: 2, cid: "c1" }),
    "[agy: layer=fix conv=c1 level=normal model=m status=SUCCESS tokens=+30 (conv 130) t=+5s (conv 15s) · Pro esta sesión: 2]")
  assert.equal(trailer({ layer: "fix", level: "normal", model: "m", status: "NO_RESULT", usage: null, proCount: 0, exit: 1, cid: null }),
    "[agy: layer=fix conv=? level=normal model=m status=NO_RESULT exit=1 · Pro esta sesión: 0]")
})
const base = (over = {}) => ({ cid: "c1", layer: "implement", level: "normal", model: "m", stepInfo: { k: 1, n: 2 }, proCount: 0, notes: [],
  progress: ["👁 view_file: a.py"], notices: "", exit: 0, result: { status: "SUCCESS", response: "hecho" }, status: "SUCCESS",
  usage: { tokens: { delta: 1, total: 1 }, seconds: { delta: 1, total: 1 } }, denied: false, question: null, advanced: true,
  plan: [{}, {}], next: 1, cwd: "/w", hasPlan: true, wasStep: true, ...over })
test("report: paso consumido con pasos pendientes → step; último paso → done", () => {
  const r = report(base())
  assert.match(r.output, /^conversation_id: c1\nPaso 1\/2 · implement \(normal\) · m\nhecho\nQuedan 1 pasos/)
  assert.match(r.output, /Registro \(últimos 1 de 1 eventos\):\n👁 view_file: a.py\n\[agy: .*\]\nSIGUIENTE: antigravity\(step="next", conversation_id="c1"\)$/)
  assert.equal(r.metadata.next, "step")
  const d = report(base({ next: 2, stepInfo: { k: 2, n: 2 } }))
  assert.match(d.output, /Plan completado\.\n[\s\S]*SIGUIENTE: nada/); assert.equal(d.metadata.next, "done")
})
test("report: PREGUNTA a mitad de plan → paso no consumido y SIGUIENTE de pregunta", () => {
  const r = report(base({ question: "¿borro X?", advanced: false, next: 0 }))
  assert.match(r.output, /PREGUNTA PARA EL USUARIO \(no hagas nada más hasta que responda\): ¿borro X\?/)
  assert.match(r.output, /El paso 1 NO se ha consumido/)
  assert.match(r.output, /SIGUIENTE: pregunta al usuario: "¿borro X\?" y, con su respuesta, llama a antigravity\(step="next", conversation_id="c1", prompt=<respuesta>\)$/)
})
test("report: estado ≠ SUCCESS o denegación → problem", () => {
  const r = report(base({ status: "WAITING", result: { status: "WAITING", response: "" }, advanced: false, next: 0 }))
  assert.match(r.output, /ESTADO: WAITING\.\n.*headless.*\nNO des la tarea por hecha\./); assert.equal(r.metadata.next, "problem")
  const d = report(base({ denied: true, advanced: false, next: 0, result: { status: "SUCCESS", response: "", denied_actions: [{ action: "write_file" }] } }))
  assert.match(d.output, /ACCIONES DENEGADAS POR POLÍTICA: \[\{"action":"write_file"\}\]\n.*write_file\(\/w\)/); assert.equal(d.metadata.next, "problem")
})
test("report: denegación con regla ya añadida (reintento sigue denegado) no pide añadirla a mano", () => {
  const d = report(base({ denied: true, advanced: false, next: 0, deniedInfo: { rule: "command(uname)", outcome: "allowed" },
    result: { status: "SUCCESS", response: "", denied_actions: [{ action: "command" }] } }))
  assert.match(d.output, /La regla command\(uname\) ya está en settings\.json y agy sigue denegando: revisa la regla o el comando\./)
  assert.doesNotMatch(d.output, /Dile al usuario que añada en ~\/\.gemini/)
  assert.doesNotMatch(d.output, /Permisos: se propuso la regla/)
  assert.equal(d.metadata.next, "problem")
})
test("report: problem con wasStep=false repite prompt aunque haya plan (re-plan fallido)", () => {
  const r = report(base({ status: "WAITING", result: { status: "WAITING", response: "" }, advanced: false, next: 0, stepInfo: null, wasStep: false }))
  assert.match(r.output, /SIGUIENTE: cuéntale al usuario el problema tal cual y pregúntale cómo seguir; para repetir llama a antigravity\(prompt=<la petición de nuevo>, conversation_id="c1"\)$/)
})
test("report: orchestrate con plan → step; con answer sin pasos → done; con needs_user_input → question sin plan", () => {
  const so = { answer: "Resumen.", needs_user_input: "", deep_orchestration_reason: "", steps: [] }
  const plan = [{ layer: "implement", level: "normal", reason: "", instruction: "haz X" }]
  const r = report(base({ layer: "orchestrate", stepInfo: null, result: { status: "SUCCESS", response: "{}", structured_output: so }, plan, next: 0, advanced: false }))
  assert.match(r.output, /PLAN \(1 pasos\) — Resumen\.\n1\. \[implement · normal\] haz X\nEjecuta el paso 1 con: antigravity\(step="next", conversation_id="c1"\)/)
  assert.equal(r.metadata.next, "step")
  const a = report(base({ layer: "orchestrate", stepInfo: null, result: { status: "SUCCESS", response: "{}", structured_output: so }, plan: [], next: 0, advanced: false, hasPlan: false }))
  assert.match(a.output, /RESPUESTA \(no hace falta tocar código\):\nResumen\.[\s\S]*SIGUIENTE: nada/)
  const q = report(base({ layer: "orchestrate", stepInfo: null, wasStep: false, question: "¿qué repo?", result: { status: "SUCCESS", response: "{}", structured_output: { ...so, needs_user_input: "¿qué repo?" } }, plan: [], next: 0, advanced: false, hasPlan: false }))
  assert.match(q.output, /PREGUNTA PARA EL USUARIO.*¿qué repo\?[\s\S]*SIGUIENTE: pregunta al usuario: "¿qué repo\?" y, con su respuesta, llama a antigravity\(prompt=<respuesta>, conversation_id="c1"\)$/)
})
test("report: orchestrate SUCCESS sin structured_output → problem, no done", () => {
  const r = report(base({ layer: "orchestrate", stepInfo: null, wasStep: false, question: null, advanced: false,
    result: { status: "SUCCESS", response: "texto libre" }, plan: [{}, {}], next: 1 }))
  assert.match(r.output, /El orquestador no devolvió salida estructurada\. Respuesta libre:\ntexto libre/)
  assert.equal(r.metadata.next, "problem")
})
test("noResultReport, noStepsReport y fail terminan con SIGUIENTE", () => {
  const n = noResultReport({ cid: "c1", layer: "fix", level: "normal", model: "m", proCount: 1, notices: "boom", progress: ["x"], exit: 1, hasPlan: true })
  assert.match(n.output, /FALLÓ \(exit 1\)[\s\S]*stderr:\nboom[\s\S]*Registro:\nx[\s\S]*NO des la tarea por hecha[\s\S]*status=NO_RESULT exit=1 · Pro esta sesión: 1\]\nSIGUIENTE: cuéntale al usuario el problema/)
  assert.equal(n.title, "antigravity · fix · sin respuesta")
  assert.match(noStepsReport({ cid: "c1", hasPlan: true }).output, /plan completado[\s\S]*SIGUIENTE: nada/)
  assert.match(noStepsReport({ cid: "c1", hasPlan: false }).output, /plan inexistente/)
  assert.match(fail("mal").output, /^mal\nSIGUIENTE: cuéntale al usuario el problema tal cual y pregúntale cómo seguir; para repetir llama a antigravity\(prompt=<la petición de nuevo>\)$/)
})
test("noStepsReport: Notas y pie con Pro esta sesión antes de SIGUIENTE", () => {
  const r = noStepsReport({ cid: "c1", hasPlan: true, notes: ["El estado guardado de esta conversación estaba corrupto y se ha reiniciado."], proCount: 2 })
  assert.match(r.output, /plan completado/)
  assert.match(r.output, /Notas: El estado guardado de esta conversación estaba corrupto y se ha reiniciado\./)
  assert.match(r.output, /\[agy: step=next conv=c1 status=NO_STEPS · Pro esta sesión: 2\]\nSIGUIENTE: nada — cuenta el resultado al usuario\.$/)
  const d = noStepsReport({ cid: "c1", hasPlan: false })
  assert.match(d.output, /plan inexistente/)
  assert.match(d.output, /\[agy: step=next conv=c1 status=NO_STEPS · Pro esta sesión: 0\]/)
  assert.doesNotMatch(d.output, /Notas:/)
})
test("noResultReport: SIGUIENTE sigue wasStep, no hasPlan", () => {
  const stepCall = noResultReport({ cid: "c1", layer: "fix", level: "normal", model: "m", proCount: 0, notices: "", progress: [], exit: 1, hasPlan: true, wasStep: true })
  assert.match(stepCall.output, /SIGUIENTE: cuéntale al usuario el problema tal cual y pregúntale cómo seguir; para repetir llama a antigravity\(step="next", conversation_id="c1"\)$/)
  const promptCall = noResultReport({ cid: "c1", layer: "orchestrate", level: "normal", model: "m", proCount: 0, notices: "", progress: [], exit: 1, hasPlan: true, wasStep: false })
  assert.match(promptCall.output, /SIGUIENTE: cuéntale al usuario el problema tal cual y pregúntale cómo seguir; para repetir llama a antigravity\(prompt=<la petición de nuevo>, conversation_id="c1"\)$/)
})
