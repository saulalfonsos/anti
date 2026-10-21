// lib/antigravity/tui/btw-context.mjs — lo que Ling recibe como sistema en cada pregunta /btw (spec §5.5).
// Siempre se regenera del ViewModel actual: el contexto es "en vivo" por construcción. Acotado para un
// modelo gratuito: estado primero (lo que más importa), luego plan, últimos N eventos, diffs recortados.
import { agentStatus } from "./registry.mjs"

export const BTW_SYSTEM_HEADER = [
  "Eres el acompañante de un agente Antigravity (Gemini) que está trabajando en el código del usuario.",
  "Explicas en español, en pocas frases, qué está haciendo, por qué y qué acaba de pasar, SOLO a partir del",
  "registro que sigue. No ejecutas nada, no editas nada y no inventas: si algo no está en el registro, dilo.",
].join(" ")

const STATUS_ES = { running: "en marcha", done: "hecho", failed: "fallo", question: "pregunta", aborted: "abortado" }
const MARK = { done: "✓", running: "▶", pending: "○", waiting: "?", failed: "✗" }
const hhmmss = (t) => { try { return new Date(t).toISOString().slice(11, 19) } catch { return "??:??:??" } }

function eventLine(it) {
  switch (it.kind) {
    case "tool": return `${it.icon ?? "🔧"} ${it.name}${it.arg ? " " + it.arg : ""}${it.output ? " → " + String(it.output).replace(/\s+/g, " ").slice(0, 120) : ""}`
    case "text": return `💬 ${String(it.text).replace(/\s+/g, " ").slice(0, 200)}`
    case "thinking": return `💭 ${String(it.text).replace(/\s+/g, " ").slice(0, 160)}`
    case "diff": return `✏️ diff ${it.file}`
    case "plan": return `📋 plan de ${it.steps.length} pasos`
    case "question": return `❓ ${it.text}`
    case "denied": return `⛔ denegado (${it.outcome}) regla ${it.rule ?? "-"}`
    case "note": return `ℹ️ ${it.text}`
    default: return String(it.kind)
  }
}

export function buildBtwContext(vm, { maxEvents = 40, maxDiffLines = 200, now = new Date() } = {}) {
  void now   // reservado para futuras marcas relativas ("hace 3 s"); no se usa todavía
  const last = vm.calls.at(-1)
  const out = []
  out.push("## ESTADO AHORA")
  out.push(`estado: ${STATUS_ES[agentStatus(vm)]}; llamada ${vm.calls.length}${last ? ` · capa ${last.layer} · modelo ${last.model}${last.step ? ` · paso ${last.step.k}/${last.step.n}` : ""}` : ""}`)
  if (vm.banner) out.push(`aviso: ${vm.banner.kind}${vm.banner.text ? ": " + vm.banner.text : ""}${vm.banner.rule ? " regla " + vm.banner.rule : ""}`)
  if (vm.calls[0]?.instruction) out.push(`petición inicial: ${vm.calls[0].instruction.replace(/\s+/g, " ").slice(0, 300)}`)
  out.push("", "## PLAN")
  if (!vm.plan) out.push("(sin plan todavía)")
  else { if (vm.plan.answer) out.push(vm.plan.answer.slice(0, 300)); vm.plan.steps.forEach((s) => out.push(`[${MARK[s.status] ?? "○"}] ${s.k}. ${s.layer}: ${String(s.instruction).replace(/\s+/g, " ").slice(0, 160)}`)) }
  out.push("", "## ÚLTIMOS EVENTOS")
  const items = vm.calls.flatMap((c) => c.items.map((it) => ({ ...it, call: c.n }))).slice(-maxEvents)
  if (!items.length) out.push("(ninguno)")
  for (const it of items) out.push(`- ${hhmmss(it.t)} [${it.call}] ${eventLine(it)}`)
  out.push("", "## DIFFS")
  const diffs = vm.calls.flatMap((c) => c.items.filter((it) => it.kind === "diff"))
  if (!diffs.length) out.push("(ninguno)")
  let budget = maxDiffLines
  for (const d of diffs) {
    const lines = String(d.patch ?? "").split("\n")
    out.push(`### ${d.file}`)
    const take = lines.slice(0, Math.max(0, budget)); out.push(...take); budget -= take.length
    if (lines.length > take.length) out.push(`… (${lines.length - take.length} líneas más)`)
    if (budget <= 0) break
  }
  out.push("", "## NOTAS")
  const notes = vm.calls.flatMap((c) => c.notes ?? [])
  out.push(notes.length ? notes.map((n) => `- ${n}`).join("\n") : "(ninguna)")
  return out.join("\n")
}
