// lib/antigravity/direct.test.mjs — el modo directo de la tool (fase 15, D303-D313) de punta a punta con el stub de agy. Sin cuota.
import { test, beforeEach } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { runAntigravity } from "./tool-core.mjs"
import { loadConversation, eventsPath } from "./state.mjs"
import { writeChoice } from "./model-choice.mjs"
import { STUB } from "./fixtures/stub.mjs"

const MODELS = {
  AGY_MODEL_ORCHESTRATE: "gemini-3.8-flash-high", AGY_MODEL_IMPLEMENT: "gemini-3.8-flash-high", AGY_MODEL_REVIEW: "gemini-3.8-flash-high",
  AGY_MODEL_PRO: "gemini-3.1-pro-high", AGY_MODEL_DIRECT: "gemini-3.8-flash-low", AGY_LEER: "0", AGY_ANTI_MCP: "/opt/anti/anti-mcp",
}
let repo, log
beforeEach(() => {
  process.env.ANTI_AGY_CACHE = fs.mkdtempSync(path.join(os.tmpdir(), "agy-direct-cache-"))
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agy-direct-repo-")))
  execFileSync("git", ["init", "-q", repo])
  log = path.join(repo, "stub.log")
  fs.writeFileSync(log, "")
})
const calls = () => fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean)
const events = (cid) => fs.readFileSync(eventsPath(cid), "utf8").trim().split("\n").map((l) => JSON.parse(l))
function ctx(env = {}, sessionID = "sess-d") {
  return {
    directory: repo, sessionID, abort: new AbortController().signal, ask: async () => {}, metadata: () => {},
    env: { AGY_BIN: STUB, AGY_STUB_LOG: log, AGY_SETTINGS_FILE: path.join(repo, "settings.json"), AGY_UI: "0", AGY_STOP_GRACE_MS: "2000", ...MODELS, ...env },
  }
}

test("D305: sin marcas es UNA llamada directa: capa direct, modelo medido, sin plan ni schema, y SIGUIENTE: nada", async () => {
  const r = await runAntigravity({ prompt: "arregla el contador" }, ctx())
  assert.equal(calls().length, 1)
  assert.match(calls()[0], /model=gemini-3\.8-flash-low conv=new schema=no/)
  assert.doesNotMatch(calls()[0], /--mode plan/)
  assert.match(r.output, /STUB OK \(model=gemini-3\.8-flash-low\)/)
  // D323: ni pie técnico ni Registro en lo que lee el traductor; el pie va en los metadatos.
  assert.doesNotMatch(r.output, /\[agy:|Registro/)
  assert.match(r.metadata.trailer, /^\[agy: layer=direct conv=stub/)
  assert.match(r.output, /SIGUIENTE: nada — cuenta el resultado al usuario\.$/)
  assert.equal(loadConversation("stub-conv-001").mode, "directo")
  assert.deepEqual(r.metadata.watch, { disparos: 0, corte: null, llamadas: 1 })
})

test("D304: /orquestar en medio del texto va al orquestador de capas y no llega a agy", async () => {
  const r = await runAntigravity({ prompt: "arregla el contador /orquestar por favor" }, ctx())
  assert.match(calls()[0], /schema=yes/)
  assert.match(calls()[0], /--mode plan/)
  assert.doesNotMatch(calls()[0], /orquestar/)
  assert.match(r.output, /PLAN \(2 pasos\)/)
  assert.equal(loadConversation("stub-conv-001").mode, "orquestador")
})

test("D306: la continuación de una conversación directa sigue directa, en la misma conversación", async () => {
  await runAntigravity({ prompt: "arregla el contador" }, ctx())
  const r = await runAntigravity({ prompt: "ahora añade un test", conversation_id: "stub" }, ctx())
  assert.match(calls()[1], /conv=stub-conv-001 schema=no/)
  assert.equal(r.metadata.layer, "direct")
})

test("D305/D312: el vigilante avisa a la 15.ª lectura, para agy y reanuda la MISMA conversación con el aviso; agy arregla y termina", async () => {
  const r = await runAntigravity({ prompt: "arregla bucle.py" }, ctx({ AGY_STUB_MODE: "loop", AGY_STUB_LOOP_RESUME: "ok" }))
  assert.equal(calls().length, 2)
  assert.match(calls()[1], /conv=stub-conv-001/)
  assert.match(calls()[1], /prompt_head=\[DETECTOR DE BUCLES: has leído 15 veces lo mismo/)
  assert.match(fs.readFileSync(path.join(repo, "bucle.py"), "utf8"), /arreglado/)
  assert.match(r.output, /STUB arreglado tras el aviso/)
  assert.match(r.output, /Detector de bucles: agy se atascó y le avisé una vez; siguió y terminó\./)
  assert.match(r.output, /SIGUIENTE: nada/)
  assert.equal(r.metadata.watch.disparos, 1)
  assert.equal(r.metadata.watch.corte, null)
  const ev = events("stub-conv-001")
  assert.ok(ev.some((e) => e.type === "note" && /^detector de bucles · aviso 1: 15 veces view_file sin editar$/.test(e.text)))
  assert.equal(ev.filter((e) => e.type === "call_start").length, 2)
  assert.equal(ev.filter((e) => e.type === "call_end").length, 2)
})

test("D311: si agy sigue en bucle tras dos avisos, el vigilante corta del todo y Ling no da la tarea por hecha", async () => {
  const r = await runAntigravity({ prompt: "arregla bucle.py" }, ctx({ AGY_STUB_MODE: "loop", AGY_STUB_LOOP_RESUME: "loop" }))
  assert.equal(calls().length, 3)
  assert.match(r.output, /DETECTOR DE BUCLES: agy se quedó repitiendo la misma llamada sin editar nada; le avisé 2 veces y lo he cortado/)
  assert.match(r.output, /NO des la tarea por hecha/)
  assert.match(r.output, /SIGUIENTE: cuéntale al usuario el problema/)
  assert.equal(r.metadata.watch.corte, "bucle")
  assert.equal(r.metadata.watch.disparos, 3)
  assert.ok(events("stub-conv-001").some((e) => e.type === "note" && /^detector de bucles · corte/.test(e.text)))
}, { timeout: 60_000 })

test("D311 con parada en seco (como en Windows): sin el result de agy, el corte igual se cuenta y se informa", async () => {
  const r = await runAntigravity({ prompt: "arregla bucle.py" }, ctx({ AGY_STUB_MODE: "loop", AGY_STUB_LOOP_RESUME: "loop", AGY_STUB_IGNORE_TERM: "1", AGY_STOP_GRACE_MS: "200" }))
  assert.match(r.output, /NO des la tarea por hecha/)
  assert.equal(r.metadata.watch.corte, "bucle")
  assert.equal(r.metadata.watch.disparos, 3)
}, { timeout: 60_000 })

test("D307: /leer on solo no llama a agy y lo deja activado para la sesión; /leer off lo apaga; /leer dice el estado", async () => {
  const on = await runAntigravity({ prompt: "/leer on" }, ctx())
  assert.equal(calls().length, 0)
  assert.match(on.output, /^Lee una vez: ACTIVADO para esta sesión/)
  assert.match(on.output, /SIGUIENTE: nada/)
  assert.match((await runAntigravity({ prompt: "/leer" }, ctx())).output, /ACTIVADO/)
  assert.match((await runAntigravity({ prompt: "/leer off" }, ctx())).output, /desactivado/)
  assert.match((await runAntigravity({ prompt: "/leer" }, ctx({}, "otra-sesion"))).output, /desactivado/)
  assert.match((await runAntigravity({ prompt: "/leer" }, ctx({ AGY_LEER: "1" }, "otra-sesion-2"))).output, /ACTIVADO/)
  assert.equal(calls().length, 0)
})

test("D308: con «lee una vez» se instala el servidor anti en el proyecto y el anuncio va antes del mensaje", async () => {
  const r = await runAntigravity({ prompt: "/leer on arregla el contador" }, ctx())
  const cfg = JSON.parse(fs.readFileSync(path.join(repo, ".agents/plugins/anti/mcp_config.json"), "utf8"))
  assert.deepEqual(cfg.mcpServers.anti, { command: "/opt/anti/anti-mcp", args: ["--raiz", repo] })
  assert.match(fs.readFileSync(path.join(repo, ".git/info/exclude"), "utf8"), /^\.agents\/$/m)
  assert.match(calls()[0], /prompt_head=\[Reply in Spanish/)
  assert.match(r.output, /Notas: .*Lee una vez: activado\./)
  // la sesión lo recuerda: el siguiente mensaje también lo lleva
  await runAntigravity({ prompt: "otra cosa" }, ctx())
  assert.equal(fs.existsSync(path.join(repo, ".agents/plugins/anti/plugin.json")), true)
})

test("D308: sin servidor anti configurado, «lee una vez» se avisa y la llamada sigue sin él", async () => {
  const r = await runAntigravity({ prompt: "/leer on arregla" }, ctx({ AGY_ANTI_MCP: "" }))
  assert.equal(fs.existsSync(path.join(repo, ".agents")), false)
  assert.match(r.output, /no hay servidor anti/)
  assert.equal(calls().length, 1)
})

test("D310: /pro en modo directo usa Pro en esa llamada y cuenta en la sesión", async () => {
  const r = await runAntigravity({ prompt: "[[PRO]]\narregla el contador" }, ctx())
  assert.match(calls()[0], /model=gemini-3\.1-pro-high/)
  assert.match(r.metadata.trailer, /Pro esta sesión: 1\]/)
  assert.equal(r.metadata.pro_calls, 1)
})

test("solo marcas sin petición (/orquestar a secas) es un error claro, sin llamar a agy", async () => {
  const r = await runAntigravity({ prompt: "/orquestar" }, ctx())
  assert.equal(calls().length, 0)
  assert.match(r.output, /Hace falta la petición del usuario/)
})

test("D317: la tool manda al chat el desglose en vivo (ctx.metadata) y en los metadatos finales", async () => {
  const seen = []
  const c = ctx()
  c.metadata = (m) => seen.push(m)
  const r = await runAntigravity({ prompt: "arregla el contador" }, c)
  const live = seen.filter((m) => m.metadata?.agy)
  assert.ok(live.length >= 2)
  assert.equal(live[0].metadata.agy.live, true)
  assert.equal(r.metadata.agy.live, false)
  const items = r.metadata.agy.calls[0].items
  assert.equal(r.metadata.agy.calls[0].layer, "direct")
  assert.ok(items.some((i) => i.kind === "tool" && i.name === "view_file" && i.state === "done"))
  assert.ok(items.some((i) => i.kind === "text"))
})

test("D323: el modelo elegido con /agy se usa en el modo directo; /pro sigue mandando Pro", async () => {
  writeChoice("claude-sonnet-4-6")
  await runAntigravity({ prompt: "arregla el contador" }, ctx())
  assert.match(calls()[0], /model=claude-sonnet-4-6 /)
  await runAntigravity({ prompt: "[[PRO]]\notra cosa" }, ctx({}, "sess-pro"))
  assert.match(calls()[1], /model=gemini-3\.1-pro-high/)
  writeChoice(null)
  await runAntigravity({ prompt: "y otra" }, ctx({}, "sess-otra"))
  assert.match(calls()[2], /model=gemini-3\.8-flash-low/)
})
