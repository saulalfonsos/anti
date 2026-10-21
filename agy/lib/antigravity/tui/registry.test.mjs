// lib/antigravity/tui/registry.test.mjs — estado derivado y filas de agentes (spec §5.1).
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { reduce } from "../ui/render.mjs"
import { agentStatus, summarize, listAgents, rowsForSession, launchedBy, STATUS_ICON } from "./registry.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SAMPLE = fs.readFileSync(path.join(HERE, "..", "fixtures", "events-sample.jsonl"), "utf8").trim().split("\n")
const events = (n = SAMPLE.length) => SAMPLE.slice(0, n).map((l) => JSON.parse(l))
// El fixture deja deliberadamente abierta la última llamada (call 3, "verify"): un tool ACTIVE sin DONE ni
// call_end (ver render.test.mjs, que afirma vm.live === true para events(SAMPLE) al completo). Por eso, para
// probar el estado "done" no se puede usar el fichero entero: se usa el prefijo hasta el call_end de la
// llamada 2 (línea 17), la última conversación que realmente termina.
const DONE_AT = 17

test("agentStatus: running mientras la última llamada no cierra; done al final; question/failed/aborted por banner", () => {
  assert.equal(agentStatus(reduce(events(3))), "running")
  assert.equal(agentStatus(reduce(events(DONE_AT))), "done")
  const q = reduce([...events(3), { type: "question", call: 1, text: "¿pytest?", t: "2026-01-01T00:00:00Z" },
    { type: "call_end", call: 1, status: "SUCCESS", advanced: false, t: "2026-01-01T00:00:01Z" }])
  assert.equal(agentStatus(q), "question")
  const f = reduce([...events(3), { type: "call_end", call: 1, status: "ERROR", advanced: false, t: "2026-01-01T00:00:01Z" }])
  assert.equal(agentStatus(f), "failed")
  const a = reduce([...events(3), { type: "note", call: 1, text: "Llamada abortada por el usuario", t: "2026-01-01T00:00:01Z" },
    { type: "call_end", call: 1, status: "ABORTED", advanced: false, t: "2026-01-01T00:00:02Z" }])
  assert.equal(agentStatus(a), "aborted")
})

test("agentStatus: SUCCESS con denied=true → failed (agy dice éxito pero la denegación no se resolvió)", () => {
  const t = "2026-01-01T00:00:00Z"
  const vm = reduce([
    { type: "call_start", call: 1, cid: "x", layer: "implement", model: "m", level: "normal", pro: false, step: null, session: "s", cwd: "/tmp", instruction: "i", t },
    { type: "denied", call: 1, actions: [{ action: "command" }], rule: "command(uname)", outcome: "retry-denied", t },
    { type: "call_end", call: 1, status: "SUCCESS", advanced: false, t },
  ])
  assert.equal(agentStatus(vm), "failed")
})

test("summarize: fila con id corto, capa de la última llamada, última herramienta, paso, totales", () => {
  const row = summarize(reduce(events(DONE_AT)), ["demo-1", "demo-2"])
  // "demo-1"/"demo-2" colisionan en el prefijo de 4 ("demo"): shortId sube a 6, que es el id completo.
  assert.equal(row.short, "demo-1")
  assert.equal(row.cid, "demo-1"); assert.equal(row.icon, STATUS_ICON.done)
  assert.ok(row.lastTool && typeof row.lastTool.name === "string")
  assert.equal(typeof row.tokens, "number"); assert.equal(row.session, "ses_demo")
})

test("listAgents: separa por sesión, ordena por actividad y no lee ficheros enteros (cabeza+cola)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-reg-"))
  fs.writeFileSync(path.join(dir, "demo-1.events.jsonl"), SAMPLE.join("\n") + "\n")
  const other = SAMPLE.map((l) => l.replaceAll("demo-1", "other-1").replaceAll("ses_demo", "ses_other"))
  fs.writeFileSync(path.join(dir, "other-1.events.jsonl"), other.join("\n") + "\n")
  fs.writeFileSync(path.join(dir, "roto.events.jsonl"), "{nope\n")
  const { mine, others } = listAgents(dir, { sessionID: "ses_demo" })
  assert.deepEqual(mine.map((r) => r.cid), ["demo-1"]); assert.deepEqual(others.map((r) => r.cid), ["other-1"])
})

test("listAgents: el fichero cabe entero en la cola (< 64 KB) → cabeza y cola solapan; no se duplica la primera llamada", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-reg-solape-"))
  fs.writeFileSync(path.join(dir, "demo-1.events.jsonl"), SAMPLE.join("\n") + "\n")
  const { mine } = listAgents(dir, { sessionID: "ses_demo" })
  assert.equal(mine.length, 1)
  assert.equal(mine[0].calls, 3)   // sin el duplicado, serían 4 (la call_start de la llamada 1 contada dos veces)
})

test("listAgents: las filas no llevan `mtime` — solo los campos de summarize()", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-reg-campos-"))
  fs.writeFileSync(path.join(dir, "demo-1.events.jsonl"), SAMPLE.join("\n") + "\n")
  const { mine } = listAgents(dir, { sessionID: "ses_demo" })
  const expected = Object.keys(summarize(reduce(events(DONE_AT)), [])).sort()
  assert.deepEqual(Object.keys(mine[0]).sort(), expected)
  assert.equal("mtime" in mine[0], false)
})

test("listAgents: ordena `others` por mtime desc y `limit` trunca", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-reg-orden-"))
  const now = Date.now() / 1000
  const cids = ["o1", "o2", "o3"]
  cids.forEach((cid, i) => {
    const lines = SAMPLE.map((l) => l.replaceAll("demo-1", cid).replaceAll("ses_demo", "ses_other"))
    const file = path.join(dir, `${cid}.events.jsonl`)
    fs.writeFileSync(file, lines.join("\n") + "\n")
    const t = now - (cids.length - i) * 100   // o1 el más antiguo, o3 el más reciente
    fs.utimesSync(file, t, t)
  })
  const { others } = listAgents(dir, { sessionID: "ses_demo" })
  assert.deepEqual(others.map((r) => r.cid), ["o3", "o2", "o1"])
  const limited = listAgents(dir, { sessionID: "ses_demo", limit: 2 }).others
  assert.deepEqual(limited.map((r) => r.cid), ["o3", "o2"])
})

test("rowsForSession: filtra mine+others por el sessionID autoritativo del slot, no por el del store", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-reg-rowsfor-"))
  fs.writeFileSync(path.join(dir, "demo-1.events.jsonl"), SAMPLE.join("\n") + "\n")
  const other = SAMPLE.map((l) => l.replaceAll("demo-1", "other-1").replaceAll("ses_demo", "ses_other"))
  fs.writeFileSync(path.join(dir, "other-1.events.jsonl"), other.join("\n") + "\n")
  // El store llamó a listAgents con SU sessionID ("ses_demo"), así que "other-1" cae en `others`; si el slot
  // pide "ses_other" (su propio sessionID autoritativo), rowsForSession debe encontrarlo ahí, no en `mine`.
  const agents = listAgents(dir, { sessionID: "ses_demo" })
  assert.deepEqual(rowsForSession(agents, "ses_other").map((r) => r.cid), ["other-1"])
  assert.deepEqual(rowsForSession(agents, "ses_demo").map((r) => r.cid), ["demo-1"])
  assert.deepEqual(rowsForSession(agents, "ses_ajena").map((r) => r.cid), [])
})

test("listAgents: el memo por (tamaño, mtime) no sirve datos viejos al crecer el fichero", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-reg-memo-"))
  const file = path.join(dir, "memo-1.events.jsonl")
  const lines = SAMPLE.map((l) => l.replaceAll("demo-1", "memo-1"))
  fs.writeFileSync(file, lines.join("\n") + "\n")
  const first = listAgents(dir, { sessionID: "ses_demo" }).mine[0]
  assert.ok(first, "la fila existe antes de tocar el fichero")
  // Nueva llamada en marcha: el estado de la fila tiene que cambiar aunque el memo ya tenga una entrada.
  const t0 = JSON.parse(lines[0]).t
  fs.appendFileSync(file, JSON.stringify({ t: t0 + 1, type: "call_start", call: 99, layer: "review", model: "m" }) + "\n")
  const second = listAgents(dir, { sessionID: "ses_demo" }).mine[0]
  assert.equal(second.status, "running")
  assert.equal(second.layer, "review")
  // Y sin tocar el fichero, dos llamadas seguidas dan lo mismo (el memo no rompe la idempotencia).
  assert.deepEqual(listAgents(dir, { sessionID: "ses_demo" }).mine[0], second)
})

// Fase 15 (D322): en «Agentes» no sale la tarea que lanza el chat (esa ya se ve en el chat), solo lo que lanza ella: conversaciones de
// sesiones hijas (o nietas) del chat y los subagentes de navegador que abre Gemini dentro de la tarea.
test("launchedBy: oculta la tarea del chat y enseña lo que cuelga de ella (sesiones hijas y subagentes de navegador)", () => {
  const t = (s) => `2026-01-01T00:00:${String(s).padStart(2, "0")}Z`
  const start = (cid, session) => ({ type: "call_start", call: 1, cid, layer: "direct", model: "gemini-3.8-flash-low", level: "normal", pro: false, step: null, session, cwd: "/p", instruction: "i", t: t(0) })
  const sub = (i, state, name) => ({ type: "agy", call: 1, t: t(i), ev: { event: "step_update", step_update: { step_index: i, step_type: "tool", state, tool_info: { name: "browser_subagent", parameters: { TaskName: name, Task: "busca" } } } } })
  const row = (events) => summarize(reduce(events), [])
  const invoke = (i, state) => ({ type: "agy", call: 1, t: t(i), ev: { event: "step_update", step_update: { step_index: i, step_type: "tool", state, tool_info: { name: "invoke_subagent", parameters: { Subagents: [{ TypeName: "research", Role: "Qué versión de node", Prompt: "averigua", Model: "inherit" }] } } } } })
  const main = row([start("main", "ses_chat"), sub(1, "ACTIVE", "Buscar docs"), sub(1, "DONE", "Buscar docs"), sub(2, "ACTIVE", "Probar web"), invoke(3, "ACTIVE"), { type: "agy", call: 1, t: t(4), ev: { event: "step_update", step_update: { step_index: 3, step_type: "subagent", state: "DONE" } } }])
  const child = row([start("hija", "ses_hija"), { type: "call_end", call: 1, status: "SUCCESS", advanced: false, t: t(5) }])
  const grandchild = row([start("nieta", "ses_nieta")])
  const alien = row([start("ajena", "ses_otra")])
  const parents = { ses_hija: "ses_chat", ses_nieta: "ses_hija", ses_otra: undefined }
  const rows = launchedBy({ mine: [main], others: [child, grandchild, alien] }, "ses_chat", (id) => parents[id])
  assert.deepEqual(rows.map((r) => `${r.icon} ${r.layer} · ${r.short}`), ["● navegador · Probar web", "● direct · niet", "✓ research · Qué versión de node", "✓ navegador · Buscar docs", "✓ direct · hija"])
  // Lo que está en marcha va primero; las conversaciones llevan su id corto, los subagentes el nombre de su tarea.
  assert.deepEqual(rows.map((r) => r.status), ["running", "running", "done", "done", "done"])
  // El subagente de navegador abre la tarea que lo lanzó; el de invoke_subagent lleva con qué encontrar su conversación (D324).
  assert.equal(rows[0].cid, "main")
  assert.equal(rows[0].sub, null)
  assert.deepEqual(rows[2].sub, { parent: "main", type: "research", prompt: "averigua", startedAt: t(3), model: "gemini-3.8-flash-low", session: "ses_chat", cwd: "/p" })
  // Sin nada lanzado, «Agentes» se queda vacío.
  assert.deepEqual(launchedBy({ mine: [row([start("sola", "ses_chat")])], others: [] }, "ses_chat", () => undefined), [])
  // Un ciclo en los padres no cuelga la TUI.
  assert.deepEqual(launchedBy({ mine: [], others: [alien] }, "ses_chat", (id) => (id === "ses_otra" ? "ses_x" : "ses_otra")), [])
})
