// lib/antigravity/ui/render.mjs — modelo de vista del visor agy-ui. PURO: sin imports de Node; lo cargan
// el navegador (módulo ES servido en /render.mjs) y los tests. Entrada: eventos de <cid>.events.jsonl
// ya parseados, más eventos {type:"thinking"} que el servidor multiplexa en el SSE (spec §5.2, §5.4).
import { iconFor, mainArg } from "../tool-icons.mjs"

const IMAGE_PATH_RE = /(\/[^\s"'`<>]+?\.(?:png|jpe?g|gif|webp))\b/gi

export function describeTool(info, cwd) {
  const a = mainArg(info?.parameters)
  let arg = a.value
  if (a.kind === "path" && cwd && arg.startsWith(cwd + "/")) arg = arg.slice(cwd.length + 1)
  return { icon: iconFor(info?.name), name: info?.name ?? "?", arg }
}

export function findImages(parameters, output) {
  const found = new Set()
  const scan = (s) => { for (const m of String(s ?? "").matchAll(IMAGE_PATH_RE)) found.add(m[1]) }
  for (const v of Object.values(parameters ?? {})) if (typeof v === "string") scan(v)
  scan(output)
  return [...found]
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)/

export function parseUnifiedDiff(patch) {
  const files = []
  let file = null, hunk = null, a = 0, b = 0
  for (const raw of String(patch ?? "").split("\n")) {
    if (raw.startsWith("diff --git ")) { file = { header: raw, hunks: [] }; files.push(file); hunk = null; continue }
    if (!raw && !file) continue
    if (!file) { file = { header: "", hunks: [] }; files.push(file) }
    if (raw.startsWith("@@")) {
      const m = HUNK_HEADER_RE.exec(raw)
      a = m ? Number(m[1]) : 0; b = m ? Number(m[2]) : 0
      hunk = { header: raw, oldStart: a, newStart: b, lines: [] }; file.hunks.push(hunk); continue
    }
    if (!hunk) continue   // index / --- / +++ y similares
    if (raw === "" ) continue   // línea vacía final del parche
    const type = raw.startsWith("+") ? "add" : raw.startsWith("-") ? "del" : raw.startsWith("\\") ? "meta" : "ctx"
    let oldNo = null, newNo = null
    if (type === "ctx") { oldNo = a++; newNo = b++ }
    else if (type === "add") { newNo = b++ }
    else if (type === "del") { oldNo = a++ }
    hunk.lines.push({ type, text: raw.slice(1), oldNo, newNo })
  }
  return files
}

function setStep(plan, k, status) { const s = plan?.steps[k - 1]; if (s) s.status = status }

function applyAgy(call, ev, t, cwd) {
  if (!ev || ev.event !== "step_update") return
  const su = ev.step_update ?? {}
  if (su.step_type === "tool") {
    const info = su.tool_info ?? { name: su.tool_name }
    let item = call.tools.get(su.step_index)
    if (!item) {
      const d = describeTool(info, cwd)
      item = { kind: "tool", t, name: d.name, icon: d.icon, arg: d.arg, parameters: info.parameters ?? {}, output: "", state: "running",
        images: findImages(info.parameters ?? {}, ""), startedAt: t, endedAt: null }   // ya en ACTIVE: una captura en curso se muestra en cuanto acabe
      call.tools.set(su.step_index, item); call.items.push(item)
    }
    if (su.state === "DONE") {
      item.state = "done"; item.output = info.output ?? ""; item.endedAt = t
      item.parameters = { ...item.parameters, ...(info.parameters ?? {}) }   // el DONE suele traer menos parámetros: se conservan los del ACTIVE
      item.images = findImages(item.parameters, item.output)
    }
    if (su.state === "ERROR") { item.state = "error"; item.endedAt = t }
    return
  }
  // D322: `invoke_subagent` no se cierra con su DONE de tool, sino con un paso `subagent` del mismo step_index cuando el subagente acaba.
  if (su.step_type === "subagent" && (su.state === "DONE" || su.state === "ERROR")) {
    const item = call.tools.get(su.step_index)
    if (item) { item.state = su.state === "DONE" ? "done" : "error"; item.endedAt = t }
    return
  }
  // Fase 15 (D321): cada turno del modelo cerrado trae su duración y su uso; el chat marca lo que hizo Gemini y cuánto pensó.
  if (su.step_type === "agent_response" && su.state === "DONE" && typeof su.duration_seconds === "number") {
    call.turns += 1
    call.modelSeconds = Math.round((call.modelSeconds + su.duration_seconds) * 1000) / 1000
    call.thinkingTokens += Number(su.usage?.thinking_tokens ?? 0)
  }
  if (su.step_type === "agent_response" && su.text_delta) {
    const last = call.items.at(-1)
    if (last?.kind === "text" && last.step === su.step_index) last.text += su.text_delta
    else call.items.push({ kind: "text", t, step: su.step_index, text: su.text_delta })
  }
}

// Reductor incremental: la TUI recibe el registro por lotes (tail) y no puede re-parsear el fichero entero
// en cada línea nueva. `push` aplica eventos sobre el estado; `snapshot` devuelve una copia serializable sin
// los Map internos. reduce(events) === createReducer().push(events).snapshot() (test de equivalencia).
export function createReducer() {
  const vm = { cid: null, cwd: "", session: null, pro: false, plan: null, calls: [], banner: null, live: false, lastUsage: null, proCount: 0 }
  const byCall = new Map()
  let cur = null
  const r = {
    count: 0,
    push(events) {
      for (const e of events) {
        r.count++
        if (!vm.cid && e.cid) vm.cid = e.cid
        switch (e.type) {
          case "call_start":
            cur = { n: e.call, layer: e.layer, model: e.model, level: e.level, pro: !!e.pro, step: e.step ?? null, start: e.t, end: null,
              status: null, usage: null, instruction: e.instruction ?? "", items: [], notes: [], tools: new Map(), turns: 0, modelSeconds: 0, thinkingTokens: 0 }
            vm.calls.push(cur); byCall.set(e.call, cur)
            if (e.cwd) vm.cwd = e.cwd
            if (e.session) vm.session = e.session
            if (e.pro) vm.pro = true
            if (e.step) setStep(vm.plan, e.step.k, "running")
            vm.banner = null
            break
          case "agy": if (cur) applyAgy(cur, e.ev, e.t, vm.cwd); break
          case "thinking": cur?.items.push({ kind: "thinking", t: e.t, step: e.step_index, text: e.thinking }); break
          case "diff": cur?.items.push({ kind: "diff", t: e.t, tool: e.tool, file: e.file, patch: e.patch, untracked: !!e.untracked, truncated: !!e.truncated }); break
          case "plan":
            vm.plan = { answer: e.answer ?? "", steps: (e.steps ?? []).map((s, i) => ({ k: i + 1, ...s, status: "pending" })) }
            cur?.items.push({ kind: "plan", t: e.t, answer: e.answer ?? "", steps: e.steps ?? [] })
            break
          case "question":
            cur?.items.push({ kind: "question", t: e.t, text: e.text })
            vm.banner = { kind: "question", text: e.text }
            if (e.step) setStep(vm.plan, e.step.k, "waiting")
            break
          case "denied":
            cur?.items.push({ kind: "denied", t: e.t, actions: e.actions ?? [], rule: e.rule ?? null, outcome: e.outcome })
            // Último outcome de denegación visto en esta llamada: si al cerrarla (`call_end`) sigue sin ser
            // "allowed" (p. ej. `retry-denied`: la regla se añadió y el reintento SIGUIÓ denegado), la
            // llamada es un fallo aunque agy reporte status SUCCESS (spec §6.2, quirk headless).
            if (cur) cur.deniedOutcome = e.outcome
            vm.banner = e.outcome === "allowed" ? null : { kind: "denied", rule: e.rule ?? null, outcome: e.outcome, actions: e.actions ?? [] }
            break
          case "retry": cur?.items.push({ kind: "note", t: e.t, text: `regla añadida (${e.reason}); paso repetido` }); vm.banner = null; break
          case "note":
            cur?.items.push({ kind: "note", t: e.t, text: e.text })
            if (/abortada/.test(e.text ?? "")) vm.banner = { kind: "aborted", text: e.text }
            break
          case "call_end": {
            const c = byCall.get(e.call) ?? cur
            if (!c) break
            c.end = e.t; c.status = e.status; c.notes = e.notes ?? []; if (e.model) c.model = e.model
            c.usage = e.tokens ? { tokens: e.tokens, seconds: e.seconds } : null
            if (typeof e.proCount === "number") vm.proCount = e.proCount
            if (c.usage) vm.lastUsage = c.usage
            c.denied = !!c.deniedOutcome && c.deniedOutcome !== "allowed"
            if (c.step) setStep(vm.plan, c.step.k, e.advanced ? "done" : vm.banner?.kind === "question" ? "waiting" : "failed")
            if (e.status !== "SUCCESS" && !vm.banner) vm.banner = { kind: "error", text: `La llamada terminó con estado ${e.status}` }
            break
          }
        }
      }
      vm.live = !!cur && cur.end === null
      return r
    },
    snapshot() {
      const copy = structuredClone({ ...vm, calls: vm.calls.map((c) => { const { tools, deniedOutcome, ...rest } = c; return rest }) })
      return copy
    },
  }
  return r
}

export function reduce(events) { return createReducer().push(events).snapshot() }
