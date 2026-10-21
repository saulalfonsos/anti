// lib/antigravity/tool-core.test.mjs — integración con el stub de agy y un ctx falso. Sin cuota.
import { test, beforeEach } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { runAntigravity } from "./tool-core.mjs"
import { loadConversation, logPath, eventsPath, convPath } from "./state.mjs"
import { STUB } from "./fixtures/stub.mjs"

const MODELS = {
  AGY_MODEL_ORCHESTRATE: "gemini-3.8-flash-high", AGY_MODEL_ARCHITECT: "gemini-3.8-flash-high",
  AGY_MODEL_RESEARCH: "gemini-3.8-flash-high", AGY_MODEL_IMPLEMENT: "gemini-3.8-flash-high",
  AGY_MODEL_FIX: "gemini-3.8-flash-high", AGY_MODEL_REVIEW: "gemini-3.8-flash-high",
  AGY_MODEL_VERIFY: "gemini-3.8-flash-high", AGY_MODEL_LIGHT: "gemini-3.8-flash-low", AGY_MODEL_PRO: "gemini-3.1-pro-high",
  AGY_PRO_AUTO_ORCHESTRATE: "0", AGY_PRO_AUTO_ARCHITECT: "0", AGY_PRO_AUTO_RESEARCH: "0", AGY_PRO_AUTO_REVIEW: "0", AGY_PRO_AUTO_VERIFY: "0",
}
let repo, log, settings
beforeEach(() => {
  process.env.ANTI_AGY_CACHE = fs.mkdtempSync(path.join(os.tmpdir(), "agy-core-cache-"))
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agy-core-repo-")))
  log = path.join(repo, "stub.log"); fs.writeFileSync(log, "")
  settings = path.join(repo, "settings.json"); fs.writeFileSync(settings, JSON.stringify({ permissions: { allow: ["command(git)"] } }))
})
const calls = () => fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean)
function mk({ ask, env = {} } = {}) {
  const seen = { ask: [], titles: [] }
  const ctx = {
    directory: repo, sessionID: "sess-1", abort: new AbortController().signal,
    ask: async (i) => { seen.ask.push(i); if (ask) return ask(i) },
    metadata: (i) => seen.titles.push(i.title),
    env: { AGY_BIN: STUB, AGY_STUB_LOG: log, AGY_SETTINGS_FILE: settings, AGY_UI: "0", ...MODELS, ...env },
  }
  return { ctx, seen }
}
async function orchestrate(extra = {}, prompt = "Añade decrement() a Counter con su test") {
  const { ctx, seen } = mk(extra)
  const r = await runAntigravity({ layer: "orchestrate", prompt }, ctx)
  return { r, seen, ctx }
}

test("orchestrate: guarda el plan, pide step=next, corre en base con schema y --mode plan", async () => {
  const { r, seen } = await orchestrate()
  assert.match(r.output, /conversation_id: stub-conv-001/)
  assert.match(r.output, /PLAN \(2 pasos\)/)
  assert.match(r.output, /antigravity\(step="next", conversation_id="stub-conv-001"\)/)
  const st = loadConversation("stub-conv-001")
  assert.equal(st.plan.length, 2); assert.equal(st.next, 0); assert.equal(st.plan[1].level, "deep")
  const c = calls(); assert.equal(c.length, 1)
  assert.match(c[0], /model=gemini-3.8-flash-high conv=new schema=yes/); assert.match(c[0], /--mode plan/)
  assert.equal(seen.ask.length, 0)
  assert.ok(seen.titles.some((t) => t.startsWith("antigravity · orchestrate · 3.8-flash-high · paso")))
  assert.match(fs.readFileSync(logPath("stub-conv-001"), "utf8"), /▶ orchestrate · gemini-3.8-flash-high/)
  assert.match(r.output, /Pro esta sesión: 0\]/)
})
test("step=next: paso 1 implement en base sin preguntar; paso 2 review deep pregunta y aprobado → Pro; Plan completado", async () => {
  await orchestrate()
  const { ctx: c1, seen: s1 } = mk()
  const r1 = await runAntigravity({ step: "next", conversation_id: "stub-conv-001" }, c1)
  assert.match(r1.output, /Paso 1\/2 · implement \(normal\) · gemini-3.8-flash-high/)
  assert.match(r1.output, /Quedan 1 pasos/); assert.equal(s1.ask.length, 0)
  assert.match(calls()[1], /model=gemini-3.8-flash-high conv=stub-conv-001 schema=no/); assert.doesNotMatch(calls()[1], /--mode/)
  const { ctx: c2, seen: s2 } = mk()
  const r2 = await runAntigravity({ step: "next", conversation_id: "stub-conv-001" }, c2)
  assert.equal(s2.ask.length, 1)
  assert.equal(s2.ask[0].permission, "antigravity_pro"); assert.deepEqual(s2.ask[0].patterns, ["review"])
  assert.match(s2.ask[0].metadata.reason, /^G4/)
  assert.match(calls()[2], /model=gemini-3.1-pro-high conv=stub-conv-001/); assert.match(calls()[2], /--mode plan/)
  assert.match(r2.output, /Pro autorizado/); assert.match(r2.output, /Plan completado/); assert.match(r2.output, /Pro esta sesión: 1\]/)
  const r3 = await runAntigravity({ step: "next", conversation_id: "stub-conv-001" }, mk().ctx)
  assert.match(r3.output, /No hay pasos pendientes/); assert.equal(calls().length, 3)
})
test("conversation_id corto: prefijo único se resuelve; ambiguo/inexistente → fail con candidatas", async () => {
  await orchestrate()
  const { ctx } = mk()
  const r = await runAntigravity({ step: "next", conversation_id: "stub" }, ctx)
  assert.match(r.output, /conversation_id: stub-conv-001/)
  assert.match(r.output, /conv=stub/)   // pie con id corto
  const miss = await runAntigravity({ step: "next", conversation_id: "zzzz" }, ctx)
  assert.equal(miss.metadata.error, true); assert.match(miss.output, /no existe ninguna conversación/)
})
test("rechazo en el diálogo → corre en base y lo anota", async () => {
  await orchestrate(); await runAntigravity({ step: "next", conversation_id: "stub-conv-001" }, mk().ctx)
  const { ctx } = mk({ ask: async () => { throw new Error("rechazado por el usuario") } })
  const r = await runAntigravity({ step: "next", conversation_id: "stub-conv-001" }, ctx)
  assert.match(r.output, /Pro rechazado .*→ gemini-3.8-flash-high/); assert.match(calls()[2], /model=gemini-3.8-flash-high/)
  assert.match(r.output, /Pro esta sesión: 0\]/)
})
test("PRO-auto en review → Pro sin preguntar", async () => {
  await orchestrate(); await runAntigravity({ step: "next", conversation_id: "stub-conv-001" }, mk().ctx)
  const { ctx, seen } = mk({ env: { AGY_PRO_AUTO_REVIEW: "1" } })
  const r = await runAntigravity({ step: "next", conversation_id: "stub-conv-001" }, ctx)
  assert.equal(seen.ask.length, 0); assert.match(r.output, /Pro automático/); assert.match(calls()[2], /model=gemini-3.1-pro-high/)
})
test("[[PRO]] en el prompt: modo Pro persistente; implement sigue en Flash; review en Pro sin preguntar", async () => {
  const { r, seen } = await orchestrate({}, "[[PRO]]\nAñade decrement() a Counter")
  assert.equal(seen.ask.length, 0); assert.match(calls()[0], /model=gemini-3.1-pro-high/)
  assert.doesNotMatch(fs.readFileSync(logPath("stub-conv-001"), "utf8"), /\[\[PRO\]\]/)
  assert.match(fs.readFileSync(logPath("stub-conv-001"), "utf8"), /▶ orchestrate · gemini-3.1-pro-high · .*Añade decrement/)
  assert.match(r.output, /Modo Pro activado/); assert.equal(loadConversation("stub-conv-001").pro, true)
  await runAntigravity({ step: "next", conversation_id: "stub-conv-001" }, mk().ctx)
  assert.match(calls()[1], /model=gemini-3.8-flash-high/)
  const { ctx, seen: s3 } = mk()
  const r3 = await runAntigravity({ step: "next", conversation_id: "stub-conv-001" }, ctx)
  assert.equal(s3.ask.length, 0); assert.match(calls()[2], /model=gemini-3.1-pro-high/); assert.match(r3.output, /Pro \(\/pro\)/)
})
test("pro=true por argumento equivale a [[PRO]]", async () => {
  const { ctx } = mk()
  await runAntigravity({ layer: "research", prompt: "¿dónde está X?", pro: true }, ctx)
  assert.match(calls()[0], /model=gemini-3.1-pro-high/); assert.equal(loadConversation("stub-conv-001").pro, true)
})
test("G1: dos verify FAIL → el siguiente research pide Pro con trigger G1", async () => {
  const env = { AGY_STUB_MODE: "verify-fail" }
  await runAntigravity({ layer: "verify", prompt: "tests", conversation_id: "conv-g1" }, mk({ env }).ctx)
  await runAntigravity({ layer: "verify", prompt: "tests", conversation_id: "conv-g1" }, mk({ env }).ctx)
  assert.equal(loadConversation("conv-g1").failures.verify, 2)
  const { ctx, seen } = mk()
  await runAntigravity({ layer: "research", prompt: "¿por qué falla?", conversation_id: "conv-g1" }, ctx)
  assert.equal(seen.ask.length, 1); assert.equal(seen.ask[0].metadata.trigger, "G1")
})
test("level=light → modelo light aunque el rol sea elegible", async () => {
  await runAntigravity({ layer: "review", prompt: "renombra x", level: "light" }, mk().ctx)
  assert.match(calls()[0], /model=gemini-3.8-flash-low/)
})
test("acciones denegadas por agy → regla sugerida y NO dar por hecho", async () => {
  const r = await runAntigravity({ layer: "implement", prompt: "edita" },
    mk({ ask: async () => { throw new Error("no") }, env: { AGY_STUB_MODE: "denied" } }).ctx)
  assert.match(r.output, /ACCIONES DENEGADAS POR POLÍTICA/); assert.ok(r.output.includes(`write_file(${repo})`)); assert.match(r.output, /NO hizo el trabajo/)
})
test("permiso denegado (command): diálogo → regla en settings.json → paso repetido y consumido", async () => {
  await orchestrate()
  const seqFile = path.join(repo, "seq"); fs.rmSync(seqFile, { force: true })
  const { ctx, seen } = mk({ env: { AGY_STUB_MODE: "denied-then-ok", AGY_STUB_SEQ_FILE: seqFile } })
  const r = await runAntigravity({ step: "next", conversation_id: "stub-conv-001" }, ctx)
  assert.equal(seen.ask.length, 1)
  assert.equal(seen.ask[0].permission, "antigravity_agy_rule"); assert.deepEqual(seen.ask[0].patterns, ["command(uname)"])
  assert.equal(seen.ask[0].metadata.settings, settings); assert.match(seen.ask[0].metadata.note, /PERMANENTEMENTE/)
  assert.deepEqual(JSON.parse(fs.readFileSync(settings, "utf8")).permissions.allow, ["command(git)", "command(uname)"])
  assert.equal(calls().length, 3)   // orchestrate + paso denegado + paso repetido
  assert.match(r.output, /Notas:.*Regla añadida a settings\.json: command\(uname\); paso repetido/)
  assert.doesNotMatch(r.output, /ACCIONES DENEGADAS/); assert.match(r.output, /Quedan 1 pasos/)
  assert.equal(loadConversation("stub-conv-001").next, 1)
  const ev = events("stub-conv-001").filter((e) => e.call >= 2)
  assert.deepEqual(ev.filter((e) => ["denied", "retry"].includes(e.type)).map((e) => e.type + ":" + (e.outcome ?? e.reason)), ["denied:asked", "denied:allowed", "retry:command(uname)"])
  assert.equal(ev.filter((e) => e.type === "call_start").length, 2); assert.equal(loadConversation("stub-conv-001").calls, 3)
  const ends = ev.filter((e) => e.type === "call_end")
  assert.equal(ends.length, 2); assert.equal(ends[0].advanced, false)
  // La nota de la regla viaja en el call_end de la denegada; el del reintento no la repite (el visor la
  // pintaba dos veces). El informe a Ling sí la conserva (comprobado arriba).
  assert.match(ends[0].notes.join(" "), /Regla añadida/); assert.deepEqual(ends[1].notes, [])
})
test("permiso denegado y rechazado en el diálogo: sin escritura, sin repetición, paso no consumido", async () => {
  await orchestrate()
  const { ctx, seen } = mk({ ask: async () => { throw new Error("rechazado") }, env: { AGY_STUB_MODE: "denied-command" } })
  const r = await runAntigravity({ step: "next", conversation_id: "stub-conv-001" }, ctx)
  assert.equal(seen.ask.length, 1); assert.equal(calls().length, 2)
  assert.deepEqual(JSON.parse(fs.readFileSync(settings, "utf8")).permissions.allow, ["command(git)"])
  assert.match(r.output, /ACCIONES DENEGADAS POR POLÍTICA/); assert.match(r.output, /Permisos: se propuso la regla command\(uname\) \(el usuario rechazó añadirla\)/)
  assert.match(r.output, /El paso 1 NO se ha consumido/); assert.match(r.output, /SIGUIENTE: cuéntale al usuario el problema/)
  assert.equal(loadConversation("stub-conv-001").next, 0)
  assert.equal(events("stub-conv-001").filter((e) => e.type === "denied").at(-1).outcome, "rejected")
})
test("denegación con settings.json roto: se informa y no se repite", async () => {
  fs.writeFileSync(settings, "{ roto")
  const { ctx, seen } = mk({ env: { AGY_STUB_MODE: "denied" } })
  const r = await runAntigravity({ layer: "implement", prompt: "edita" }, ctx)
  assert.equal(seen.ask.length, 1); assert.equal(calls().length, 1)
  assert.match(r.output, /Permisos: se propuso la regla write_file\(.*\) \(no se pudo escribir settings\.json\)/)
  assert.match(r.output, /ACCIONES DENEGADAS/)
})
test("denegación repetida tras añadir la regla: un solo diálogo y un solo reintento", async () => {
  const { ctx, seen } = mk({ env: { AGY_STUB_MODE: "denied-command" } })
  const r = await runAntigravity({ layer: "verify", prompt: "uname", conversation_id: "conv-dd" }, ctx)
  assert.equal(seen.ask.length, 1); assert.equal(calls().length, 2)
  assert.match(r.output, /ACCIONES DENEGADAS/); assert.match(r.output, /Regla añadida a settings\.json: command\(uname\); paso repetido/)
})
test("reintento tras añadir la regla vuelve a salir denegado: evento retry-denied y aviso de que la regla ya estaba", async () => {
  // El stub "denied-command" (sin AGY_STUB_SEQ_FILE) siempre deniega: el reintento vuelve a fallar.
  const { ctx, seen } = mk({ env: { AGY_STUB_MODE: "denied-command" } })
  const r = await runAntigravity({ layer: "verify", prompt: "uname", conversation_id: "conv-dd2" }, ctx)
  assert.equal(seen.ask.length, 1); assert.equal(calls().length, 2)
  const outcomes = events("conv-dd2").filter((e) => e.type === "denied").map((e) => e.outcome)
  assert.deepEqual(outcomes, ["asked", "allowed", "retry-denied"])
  const retryEv = events("conv-dd2").find((e) => e.type === "denied" && e.outcome === "retry-denied")
  assert.equal(retryEv.rule, "command(uname)"); assert.equal(retryEv.call, 2)
  assert.match(r.output, /La regla command\(uname\) ya está en settings\.json y agy sigue denegando: revisa la regla o el comando\./)
  assert.equal(r.metadata.next, "problem")
})
test("step=next con estado corrupto y sin plan: noStepsReport lleva la nota y el pie con Pro esta sesión", async () => {
  fs.writeFileSync(convPath("corrupt-1"), "{ roto")
  const { ctx } = mk()
  const r = await runAntigravity({ step: "next", conversation_id: "corrupt-1" }, ctx)
  assert.equal(r.title, "antigravity · sin pasos")
  assert.match(r.output, /Notas: El estado guardado de esta conversación estaba corrupto y se ha reiniciado\./)
  assert.match(r.output, /\[agy: step=next conv=corr status=NO_STEPS · Pro esta sesión: 0\]\nSIGUIENTE: nada — cuenta el resultado al usuario\.$/)
  assert.equal(calls().length, 0)   // nunca se llegó a invocar a agy
})
test("sin evento result → fallo explícito con el registro", async () => {
  const r = await runAntigravity({ layer: "fix", prompt: "x" }, mk({ env: { AGY_STUB_MODE: "no-result" } }).ctx)
  assert.equal(r.title, "antigravity · fix · sin respuesta"); assert.match(r.output, /NO des la tarea por hecha/); assert.match(r.output, /👁 view_file: counter.py/)
})
test("validación de argumentos sin llamar a agy", async () => {
  const { ctx } = mk()
  assert.match((await runAntigravity({ step: "next" }, ctx)).output, /requiere conversation_id/)
  assert.match((await runAntigravity({ layer: "fix" }, ctx)).output, /Hace falta prompt/)
  assert.match((await runAntigravity({ layer: "turbo", prompt: "x" }, ctx)).output, /layer inválida/)
  assert.equal(calls().length, 0)
})
test("orquestación deep: Flash pide Pro para planificar; aprobado → segunda llamada en Pro con el mismo conversation_id", async () => {
  const { r, seen } = await orchestrate({ env: { AGY_STUB_MODE: "plan-deep-orch" } })
  assert.equal(seen.ask.length, 1); assert.deepEqual(seen.ask[0].patterns, ["orchestrate"]); assert.match(seen.ask[0].metadata.reason, /^G2/)
  const c = calls(); assert.equal(c.length, 2)
  assert.match(c[0], /model=gemini-3.8-flash-high conv=new/); assert.match(c[1], /model=gemini-3.1-pro-high conv=stub-conv-001 schema=yes/)
  assert.match(r.output, /PLAN \(2 pasos\)/); assert.match(r.output, /Pro esta sesión: 1\]/)
})
test("paso denegado por agy no se consume: al reintentar vuelve a correr el mismo paso", async () => {
  await orchestrate()
  const { ctx: cd } = mk({ env: { AGY_STUB_MODE: "denied" } })
  const rd = await runAntigravity({ step: "next", conversation_id: "stub-conv-001" }, cd)
  assert.match(rd.output, /El paso 1 NO se ha consumido: al llamar de nuevo a antigravity\(step="next", conversation_id="stub-conv-001"\) se repetirá\./)
  assert.equal(loadConversation("stub-conv-001").next, 0)
  const { ctx: cn } = mk()
  const rn = await runAntigravity({ step: "next", conversation_id: "stub-conv-001" }, cn)
  assert.match(calls()[2], /model=gemini-3.8-flash-high/)
  assert.match(rn.output, /Paso 1\/2/)
})
test("ctx.metadata que lanza no revienta el host: se reporta como aviso y el resultado igual llega", async () => {
  const ctx = {
    directory: repo, sessionID: "sess-1", abort: new AbortController().signal,
    ask: async () => {},
    metadata: () => { throw new Error("host metadata boom") },
    env: { AGY_BIN: STUB, AGY_STUB_LOG: log, AGY_SETTINGS_FILE: settings, AGY_UI: "0", ...MODELS },
  }
  const r = await runAntigravity({ layer: "implement", prompt: "x" }, ctx)
  assert.equal(r.metadata.status, "SUCCESS")
  assert.match(r.output, /Avisos de agy:\n[\s\S]*callback error/)
})
test("denied_actions vacío no es una denegación: el paso se consume y no aparece ACCIONES DENEGADAS", async () => {
  await orchestrate()
  const r = await runAntigravity({ step: "next", conversation_id: "stub-conv-001" }, mk({ env: { AGY_STUB_MODE: "denied-empty" } }).ctx)
  assert.doesNotMatch(r.output, /ACCIONES DENEGADAS/)
  assert.match(r.output, /Quedan 1 pasos/)
  assert.equal(loadConversation("stub-conv-001").next, 1)
})
test("escalation.md ilegible: se avisa en Notas en vez de aplicar las reglas de escalada en silencio", async () => {
  const { ctx } = mk({ env: { AGY_ESCALATION_FILE: path.join(repo, "no-existe-escalation.md") } })
  const r = await runAntigravity({ layer: "orchestrate", prompt: "tarea" }, ctx)
  assert.match(r.output, /Notas:.*escalation\.md no se pudo leer: el orquestador corrió SIN las reglas de escalada/)
})
test("Pro que falla sin evento result igual cuenta la cuota Pro de la sesión", async () => {
  const r = await runAntigravity({ layer: "research", prompt: "¿dónde está X?", pro: true },
    mk({ env: { AGY_STUB_MODE: "no-result" } }).ctx)
  assert.equal(r.title, "antigravity · research · sin respuesta")
  assert.match(r.output, /Pro esta sesión: 1\]/)
})
test("/orquestar → orchestrate; el prompt del orquestador incluye about.md; el pie trae deltas y SIGUIENTE", async () => {
  const { ctx } = mk()
  const r = await runAntigravity({ prompt: "/orquestar ¿qué modelos puedes lanzar?" }, ctx)
  assert.match(calls()[0], /schema=yes about=yes/); assert.match(calls()[0], /--mode plan/)
  assert.match(r.output, /tokens=\+15 \(conv 15\) t=\+1s \(conv 1s\) · Pro esta sesión: 0\]\nSIGUIENTE: antigravity\(step="next", conversation_id="stub-conv-001"\)$/)
  assert.equal(r.metadata.next, "step")
  const r2 = await runAntigravity({ step: "next", conversation_id: "stub-conv-001" }, mk().ctx)
  assert.match(r2.output, /tokens=\+0 \(conv 15\)/)   // el stub siempre reporta 15 acumulados: delta 0
  assert.match(fs.readFileSync(logPath("stub-conv-001"), "utf8"), /■ SUCCESS · \+15 tokens \(conv 15\) · \+1s\n[\s\S]*■ SUCCESS · \+0 tokens \(conv 15\) · \+1s/)
})
test("about.md ilegible → nota, y el orquestador corre igual", async () => {
  const { ctx } = mk({ env: { AGY_ABOUT_FILE: path.join(repo, "no-about.md") } })
  const r = await runAntigravity({ prompt: "/orquestar tarea" }, ctx)
  assert.match(r.output, /Notas:.*about\.md no se pudo leer/); assert.match(calls()[0], /about=no/)
})
test("PREGUNTA: en un paso → paso no consumido, SIGUIENTE de pregunta; la respuesta viaja como nota adicional", async () => {
  await orchestrate()
  const r = await runAntigravity({ step: "next", conversation_id: "stub-conv-001" }, mk({ env: { AGY_STUB_MODE: "question" } }).ctx)
  assert.match(r.output, /PREGUNTA PARA EL USUARIO \(no hagas nada más hasta que responda\): ¿borro el fichero antiguo\?/)
  assert.match(r.output, /SIGUIENTE: pregunta al usuario: "¿borro el fichero antiguo\?" y, con su respuesta, llama a antigravity\(step="next", conversation_id="stub-conv-001", prompt=<respuesta>\)$/)
  assert.equal(loadConversation("stub-conv-001").next, 0)
  await runAntigravity({ step: "next", conversation_id: "stub-conv-001", prompt: "sí, bórralo" }, mk().ctx)
  assert.equal(loadConversation("stub-conv-001").next, 1)
})
test("/pro ya no aplica a verify: con estado pro, un paso verify corre en Flash", async () => {
  const { ctx } = mk()
  await runAntigravity({ layer: "verify", prompt: "tests", pro: true, conversation_id: "conv-v" }, ctx)
  assert.match(calls()[0], /model=gemini-3.8-flash-high/)
  assert.equal(loadConversation("conv-v").pro, true)
})

const events = (cid) => fs.readFileSync(eventsPath(cid), "utf8").trim().split("\n").map((l) => JSON.parse(l))
function gitInit(dir, files) {
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { stdio: "ignore" })
  git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t")
  for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), c)
  git("add", "."); git("commit", "-qm", "init")
}
test("registro de eventos: call_start/agy/plan/call_end en orchestrate y step {k,n} en el paso", async () => {
  await orchestrate()
  const e1 = events("stub-conv-001")
  assert.deepEqual(e1.map((e) => e.type).filter((t, i, a) => t !== "agy" || a[i - 1] !== "agy"), ["call_start", "agy", "plan", "call_end"])
  assert.equal(e1[0].layer, "orchestrate"); assert.equal(e1[0].call, 1); assert.equal(e1[0].step, null); assert.equal(e1[0].cwd, repo)
  assert.match(e1[0].instruction, /Añade decrement/); assert.equal(e1[0].session, "sess-1")
  assert.equal(e1.find((e) => e.type === "agy").ev.event, "init")
  const plan = e1.find((e) => e.type === "plan"); assert.equal(plan.steps.length, 2); assert.equal(plan.answer, "Añadir decrement() y su test.")
  const end = e1.at(-1); assert.equal(end.status, "SUCCESS"); assert.equal(end.tokens.delta, 15); assert.equal(end.advanced, false); assert.equal(end.proCount, 0)
  await runAntigravity({ step: "next", conversation_id: "stub-conv-001" }, mk().ctx)
  const e2 = events("stub-conv-001").filter((e) => e.call === 2)
  assert.deepEqual(e2[0].step, { k: 1, n: 2 }); assert.equal(e2[0].layer, "implement"); assert.equal(e2.at(-1).advanced, true)
  assert.equal(loadConversation("stub-conv-001").calls, 2)
})
test("diff tras una edición: parche de git en el registro (stub escribe de verdad)", async () => {
  gitInit(repo, { "nuevo.py": "x = 1\n" })
  await runAntigravity({ layer: "implement", prompt: "edita", conversation_id: "conv-w" }, mk({ env: { AGY_STUB_MODE: "write", AGY_STUB_WRITE_FILE: "nuevo.py" } }).ctx)
  const d = events("conv-w").find((e) => e.type === "diff")
  assert.equal(d.tool, "write_to_file"); assert.equal(d.file, "nuevo.py"); assert.equal(d.untracked, false)
  assert.match(d.patch, /\+print\("stub"\)/)
  const types = events("conv-w").map((e) => e.type); assert.ok(types.indexOf("diff") < types.indexOf("call_end"))
})
test("sin git en el cwd: nota única y sin diff", async () => {
  await runAntigravity({ layer: "implement", prompt: "edita", conversation_id: "conv-ng" }, mk({ env: { AGY_STUB_MODE: "write" } }).ctx)
  const ev = events("conv-ng")
  assert.equal(ev.filter((e) => e.type === "diff").length, 0)
  assert.equal(ev.filter((e) => e.type === "note" && /sin git/.test(e.text)).length, 1)
})
test("edición fuera del cwd con git sí presente: sin diff y SIN la nota de 'sin git' (Tarea 8: distingue outside de no-git)", async () => {
  gitInit(repo, { "a.py": "x = 1\n" })
  await runAntigravity({ layer: "implement", prompt: "edita", conversation_id: "conv-outside" },
    mk({ env: { AGY_STUB_MODE: "write", AGY_STUB_WRITE_FILE: "../outside.py" } }).ctx)
  const ev = events("conv-outside")
  assert.equal(ev.filter((e) => e.type === "diff").length, 0)
  assert.equal(ev.filter((e) => e.type === "note" && /sin git/.test(e.text)).length, 0)
})
test("pregunta y sin resultado también quedan registrados", async () => {
  await orchestrate()
  await runAntigravity({ step: "next", conversation_id: "stub-conv-001" }, mk({ env: { AGY_STUB_MODE: "question" } }).ctx)
  const q = events("stub-conv-001").find((e) => e.type === "question"); assert.equal(q.text, "¿borro el fichero antiguo?"); assert.equal(q.layer, "implement")
  await runAntigravity({ layer: "fix", prompt: "x", conversation_id: "conv-nr" }, mk({ env: { AGY_STUB_MODE: "no-result" } }).ctx)
  assert.equal(events("conv-nr").at(-1).status, "NO_RESULT")
})
test("orquestación deep: la primera llamada en Flash también recibe call_end antes de la segunda en Pro", async () => {
  await orchestrate({ env: { AGY_STUB_MODE: "plan-deep-orch" } })
  const ends = events("stub-conv-001").filter((e) => e.type === "call_end")
  assert.equal(ends.length, 2)
  assert.equal(ends[0].call, 1); assert.equal(ends[0].model, "gemini-3.8-flash-high"); assert.equal(ends[0].advanced, false)
  assert.equal(ends[1].call, 2); assert.equal(ends[1].model, "gemini-3.1-pro-high")
})
test("abort a mitad de un paso: nota 'abortada por el usuario', paso no consumido, SIGUIENTE de problema y el stub desaparece", async () => {
  await orchestrate()
  const pidFile = path.join(repo, "stub.pid"); fs.rmSync(pidFile, { force: true })
  const ac = new AbortController()
  const { ctx } = mk({ env: { AGY_STUB_MODE: "sleep", AGY_STUB_PIDFILE: pidFile } })
  ctx.abort = ac.signal
  const runP = runAntigravity({ step: "next", conversation_id: "stub-conv-001" }, ctx)
  // El stub escribe su PID antes de bloquearse en `read`; en vez de un setTimeout fijo (que en una
  // máquina cargada puede dispararse antes de que el stub llegue a arrancar) se sondea el pidfile
  // hasta que exista y tenga contenido, y solo entonces se lee el pid y se aborta.
  let pid = 0
  for (let i = 0; i < 150 && !pid; i++) {
    if (fs.existsSync(pidFile)) {
      const txt = fs.readFileSync(pidFile, "utf8").trim()
      if (txt) pid = Number(txt)
    }
    if (!pid) await new Promise((res) => setTimeout(res, 20))
  }
  assert.ok(pid > 0, "el stub no escribió su pid a tiempo")
  ac.abort()
  const r = await runP
  assert.equal(r.title, "antigravity · implement · sin respuesta")   // abort → sin evento result (noResultReport)
  assert.match(r.output, /SIGUIENTE: cuéntale al usuario el problema tal cual y pregúntale cómo seguir; para repetir llama a antigravity\(step="next", conversation_id="stub-conv-001"\)$/)
  assert.equal(loadConversation("stub-conv-001").next, 0)
  const notes = events("stub-conv-001").filter((e) => e.call === 2 && e.type === "note").map((e) => e.text)
  assert.deepEqual(notes, ["abortada por el usuario"])
  // El proceso del stub (bloqueado en `read`, sin hijos huérfanos) ya debe haber muerto: runAntigravity
  // solo resuelve tras el evento `close`, pero lo confirmamos con el PID que el propio stub escribió.
  assert.throws(() => process.kill(pid, 0), /ESRCH/)
})
// En Windows no hay señales: un proceso termina con un código, nunca «por una señal».
test("agy muere por una señal ajena (ni abort ni timeout): nota distinta a la de tiempo máximo", { skip: process.platform === "win32" && "sin señales en Windows" }, async () => {
  const r = await runAntigravity({ layer: "fix", prompt: "x", conversation_id: "conv-sig" }, mk({ env: { AGY_STUB_MODE: "self-signal" } }).ctx)
  const notes = events("conv-sig").filter((e) => e.type === "note").map((e) => e.text)
  assert.ok(notes.some((t) => /^agy terminó por señal /.test(t)), notes.join(" | "))
  assert.ok(!notes.some((t) => t === "agy detenido por tiempo máximo"))
  assert.equal(r.title, "antigravity · fix · sin respuesta")
})
test("timeout máximo (AGY_HARD_TIMEOUT_MS de test): nota de tiempo máximo, no de señal genérica", async () => {
  const { ctx } = mk({ env: { AGY_STUB_MODE: "sleep", AGY_HARD_TIMEOUT_MS: "300" } })
  const r = await runAntigravity({ layer: "fix", prompt: "x", conversation_id: "conv-to" }, ctx)
  const notes = events("conv-to").filter((e) => e.type === "note").map((e) => e.text)
  assert.deepEqual(notes, ["agy detenido por tiempo máximo"])
  assert.equal(r.title, "antigravity · fix · sin respuesta")
})
test("PREGUNTA: en una respuesta con status != SUCCESS no emite evento question", async () => {
  const r = await runAntigravity({ layer: "fix", prompt: "x", conversation_id: "conv-fq" }, mk({ env: { AGY_STUB_MODE: "fail-question" } }).ctx)
  assert.equal(r.metadata.status, "FAIL")
  assert.equal(events("conv-fq").some((e) => e.type === "question"), false)
})
test("orchestrate SUCCESS sin structured_output no sustituye el plan guardado; kind problem", async () => {
  await orchestrate()
  const before = loadConversation("stub-conv-001")
  const { ctx } = mk({ env: { AGY_STUB_MODE: "orch-no-structured" } })
  const r = await runAntigravity({ prompt: "replantea todo", conversation_id: "stub-conv-001" }, ctx)
  const after = loadConversation("stub-conv-001")
  assert.deepEqual(after.plan, before.plan); assert.equal(after.next, before.next)
  assert.match(r.output, /El orquestador no devolvió salida estructurada/)
  assert.equal(r.metadata.next, "problem")
  const ev = events("stub-conv-001").filter((e) => e.call === 2)
  assert.equal(ev.some((e) => e.type === "plan"), false)   // no se reemite `plan`: no hay uno nuevo
})
test("needs_user_input no vacío ignora los steps que lo acompañan: no crea plan y re-planifica con prompt", async () => {
  const { ctx } = mk({ env: { AGY_STUB_MODE: "orch-question" } })
  const r = await runAntigravity({ layer: "orchestrate", prompt: "tarea nueva" }, ctx)
  assert.match(r.output, /PREGUNTA PARA EL USUARIO \(no hagas nada más hasta que responda\): ¿qué framework de test uso\?/)
  assert.match(r.output, /SIGUIENTE: pregunta al usuario: "¿qué framework de test uso\?" y, con su respuesta, llama a antigravity\(prompt=<respuesta>, conversation_id="stub-conv-001"\)$/)
  assert.equal(loadConversation("stub-conv-001").plan.length, 0)   // los steps del stub se ignoraron
  const plan = events("stub-conv-001").find((e) => e.type === "plan")
  assert.equal(plan, undefined)
})
test("re-plan fallido: el SIGUIENTE de problema repite prompt, no step (mira la llamada real)", async () => {
  await orchestrate()
  await runAntigravity({ step: "next", conversation_id: "stub-conv-001" }, mk().ctx)
  const { ctx } = mk({ env: { AGY_STUB_MODE: "no-result" } })
  const r = await runAntigravity({ prompt: "mejor usa pytest", conversation_id: "stub-conv-001" }, ctx)
  const lastLine = r.output.trim().split("\n").at(-1)
  assert.match(lastLine, /antigravity\(prompt=<la petición de nuevo>, conversation_id="stub-conv-001"\)$/)
  assert.doesNotMatch(lastLine, /step="next"/)
})
test("re-plan a mitad de tarea que pregunta: el SIGUIENTE vuelve al orquestador (prompt), no a un paso del plan viejo", async () => {
  await orchestrate()
  await runAntigravity({ step: "next", conversation_id: "stub-conv-001" }, mk().ctx)
  const before = loadConversation("stub-conv-001")
  const { ctx } = mk({ env: { AGY_STUB_MODE: "orch-question" } })
  const r = await runAntigravity({ prompt: "mejor usa pytest", conversation_id: "stub-conv-001" }, ctx)
  const lastLine = r.output.trim().split("\n").at(-1)
  assert.match(lastLine, /antigravity\(prompt=<respuesta>, conversation_id="stub-conv-001"\)$/)
  assert.doesNotMatch(lastLine, /step="next"/)
  assert.equal(loadConversation("stub-conv-001").plan.length, before.plan.length)
})
