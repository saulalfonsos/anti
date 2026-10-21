// lib/antigravity/tui/registry.mjs — qué agentes (conversaciones agy) hay y en qué estado (spec §5.1).
// Estado derivado del ViewModel de render.mjs: una sola definición de "qué significa cada evento".
import fs from "node:fs"
import path from "node:path"
import { headEvent, tailEvents } from "../events-file.mjs"
import { reduce } from "../ui/render.mjs"
import { shortId } from "./shortid.mjs"

export const STATUS_ICON = { running: "●", done: "✓", failed: "✗", question: "?", aborted: "■" }

export function agentStatus(vm) {
  if (vm.live) return "running"
  if (vm.banner?.kind === "aborted") return "aborted"
  if (vm.banner?.kind === "question") return "question"
  const last = vm.calls.at(-1)
  if (!last) return "running"
  if (vm.banner?.kind === "denied" || vm.banner?.kind === "error" || last.denied || (last.status && last.status !== "SUCCESS")) return "failed"
  return "done"
}

function lastToolOf(vm) {
  for (let i = vm.calls.length - 1; i >= 0; i--) {
    const it = [...vm.calls[i].items].reverse().find((x) => x.kind === "tool")
    if (it) return { icon: it.icon, name: it.name, arg: it.arg }
  }
  return null
}

const SUBAGENT_TOOLS = new Set(["invoke_subagent", "browser_subagent"])
const clip = (text) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 60)
const firstOf = (params, keys) => keys.map((k) => params?.[k]).find((v) => typeof v === "string" && v.trim() !== "")

export function summarize(vm, all = []) {
  const last = vm.calls.at(-1) ?? null, first = vm.calls[0] ?? null
  const status = agentStatus(vm)
  let tokens = 0, seconds = 0
  for (const c of vm.calls) { tokens += c.usage?.tokens?.delta ?? 0; seconds += c.usage?.seconds?.delta ?? 0 }
  return {
    cid: vm.cid, short: shortId(vm.cid ?? "", all), layer: last?.layer ?? "?", model: last?.model ?? "", status, icon: STATUS_ICON[status],
    lastTool: lastToolOf(vm), step: last?.step ?? null, calls: vm.calls.length, tokens, seconds,
    startedAt: first?.start ?? null, lastAt: last?.end ?? last?.start ?? null, session: vm.session, cwd: vm.cwd,
    first: String(first?.instruction ?? "").replace(/\s+/g, " ").slice(0, 120),
    plan: vm.plan ? { n: vm.plan.steps.length, done: vm.plan.steps.filter((s) => s.status === "done").length } : null,
    // Los subagentes que lanzó Gemini dentro de esta conversación (D322): `invoke_subagent` (self, research, image-generator o uno
    // definido con define_subagent) y `browser_subagent`.
    // Un `invoke_subagent` puede lanzar varios a la vez: `Subagents: [{TypeName, Role, Prompt}]`, uno por fila.
    subagents: vm.calls.flatMap((c) => c.items.filter((it) => it.kind === "tool" && SUBAGENT_TOOLS.has(it.name))).flatMap((it) => {
      const status = it.state === "running" ? "running" : it.state === "error" ? "failed" : "done"
      const when = { status, startedAt: it.startedAt ?? null, endedAt: it.endedAt ?? null }
      if (it.name === "browser_subagent") return [{ kind: "navegador", name: clip(firstOf(it.parameters, ["TaskName", "Task"]) || it.arg), ...when }]
      const list = Array.isArray(it.parameters?.Subagents) && it.parameters.Subagents.length ? it.parameters.Subagents : [it.parameters ?? {}]
      return list.map((a) => ({ kind: String(firstOf(a, ["TypeName", "SubagentName", "Name"]) || "subagente"), name: clip(firstOf(a, ["Role", "Prompt", "Task"])), prompt: String(firstOf(a, ["Prompt", "Task"]) ?? ""), ...when }))
    }),
  }
}

// Dos eventos son "el mismo" si coinciden en marca de tiempo, tipo y llamada: basta para no confundir un
// evento de cabeza reaparecido en la cola (fichero pequeño: la cola de 64 KB cabe el fichero entero desde el
// byte 0) con un evento legítimamente repetido (p. ej. dos "note" en la misma llamada). La igualdad no puede
// ser por referencia: headEvent y tailEvents parsean el fichero por separado y nunca comparten objeto.
function sameEvent(a, b) { return !!a && !!b && a.t === b.t && a.type === b.type && a.call === b.call }

// Lista barata: cabeza + cola de cada fichero (como listConversations del visor web) — nunca el fichero
// entero, solo los lectores de events-file.mjs. La cola basta para el estado y la última herramienta; el
// plan completo solo se conoce al abrir la vista (tail completo).
// Memo por fichero: (tamaño, mtime) → modelo reducido. listAgents se llama una vez por segundo mientras
// hay una sesión abierta y el directorio de caché no se limpia nunca, así que sin esto el coste crece con
// TODAS las conversaciones que el usuario haya tenido en su vida (medido: ~2 ms por llamada con 11
// ficheros, ~90 ms/s con 500) y encima en el hilo de render de la TUI. Un fichero de eventos solo crece por
// el final: si tamaño y mtime no han cambiado, su modelo tampoco. Se guarda el vm, no la fila, porque
// summarize() depende del conjunto de ids presentes (ids cortos) y ese sí cambia al aparecer otro fichero.
const vmCache = new Map()

export function listAgents(dir, { sessionID = null, limit = 20 } = {}) {
  let names = []
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith(".events.jsonl")) } catch { return { mine: [], others: [] } }
  const all = names.map((n) => n.slice(0, -".events.jsonl".length))
  // Emparejamiento temporal fila+mtime solo para ordenar: `mtime` no es un campo de AgentRow y no debe
  // filtrarse a las filas devueltas (summarize() ya define el conjunto de campos exacto).
  const pairs = []
  const seen = new Set()
  for (const n of names) {
    const file = path.join(dir, n)
    try {
      const st = fs.statSync(file)
      seen.add(file)
      let hit = vmCache.get(file)
      if (!hit || hit.size !== st.size || hit.mtimeMs !== st.mtimeMs) {
        const head = headEvent(file)
        if (!head) continue
        const tail = tailEvents(file)
        const rest = sameEvent(head, tail[0]) ? tail.slice(1) : tail
        const vm = reduce([head, ...rest])
        if (!vm.cid) vm.cid = n.slice(0, -".events.jsonl".length)
        hit = { size: st.size, mtimeMs: st.mtimeMs, vm }
        vmCache.set(file, hit)
      }
      pairs.push({ row: summarize(hit.vm, all), mtime: st.mtimeMs })
    } catch { /* fichero roto o a medio escribir: se omite */ }
  }
  for (const key of vmCache.keys()) if (!seen.has(key)) vmCache.delete(key)
  pairs.sort((a, b) => b.mtime - a.mtime)
  const rows = pairs.map((p) => p.row)
  const mine = rows.filter((r) => sessionID && r.session === sessionID).slice(0, limit)
  const others = rows.filter((r) => !(sessionID && r.session === sessionID)).slice(0, limit)
  return { mine, others }
}

// El sidebar recibe su propio sessionID por el slot (props.session_id, autoritativo) que puede no coincidir
// con el sessionID con el que el store ya llamó a listAgents (store.sessionID() puede ir un paso por detrás
// justo tras navegar). En vez de volver a leer disco, se filtra la unión de lo que el store ya tiene: cada
// una de `mine`/`others` ya viene ordenada por actividad (ver listAgents), así que basta concatenar y filtrar.
export function rowsForSession(agents, sessionID) {
  return [...agents.mine, ...agents.others].filter((r) => r.session === sessionID)
}

// «Agentes» del sidebar (D322): lo que LANZA la tarea del chat, no la tarea misma (esa ya se ve en el chat). Son las conversaciones de
// sesiones que descienden de la del chat (hijas, nietas…; `parentOf` da el padre de una sesión) y los subagentes que lanzó
// Gemini dentro de las conversaciones del chat, que al pulsarlos abren la conversación que los lanzó. Lo que está en marcha, primero.
export function launchedBy(agents, sessionID, parentOf) {
  const all = [...agents.mine, ...agents.others]
  const descends = (session) => {
    const seen = new Set()
    for (let s = parentOf(session); s && !seen.has(s); s = parentOf(s)) {
      if (s === sessionID) return true
      seen.add(s)
    }
    return false
  }
  const subs = all.filter((r) => r.session === sessionID).flatMap((r) => (r.subagents ?? []).map((a) => ({
    cid: r.cid, short: a.name || r.short, layer: a.kind, status: a.status, icon: STATUS_ICON[a.status], lastTool: null, lastAt: a.endedAt ?? a.startedAt,
    // D324: con esto la TUI encuentra su conversación y la enseña como el chat (los de navegador no tienen una propia).
    sub: a.kind === "navegador" ? null : { parent: r.cid, type: a.kind, prompt: a.prompt ?? "", startedAt: a.startedAt, model: r.model, session: r.session, cwd: r.cwd },
  })))
  const children = all.filter((r) => r.session && r.session !== sessionID && descends(r.session))
  const rows = [...subs.reverse(), ...children]
  return [...rows.filter((r) => r.status === "running"), ...rows.filter((r) => r.status !== "running")]
}
