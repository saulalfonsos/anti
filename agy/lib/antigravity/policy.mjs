// Política de enrutado: qué modelo corre una llamada a Antigravity. Sin I/O.
// Spec: docs/superpowers/specs/2026-09-13-antigravity-routing-design.md §4-5.
export const LAYERS = ["orchestrate", "architect", "research", "implement", "fix", "review", "verify"]
export const ELIGIBLE = new Set(["orchestrate", "architect", "research", "review", "verify"])
export const READ_ONLY = new Set(["orchestrate", "architect", "research", "review"])
export const LEVELS = new Set(["light", "normal", "deep"])
export const PRO_MARK = "[[PRO]]"
// Capas en las que /pro fuerza el modelo Pro. verify queda fuera: ejecutar tests no necesita razonamiento
// y Pro es 5-10× más lento por comando (spec §4.5).
export const PRO_MODE = new Set(["orchestrate", "architect", "research", "review"])
const G3_FILES = 8

export function emptyState() {
  return { pro: false, failures: { verify: 0, review: 0 }, plan: [], next: 0, baseline_files: [],
    usage: { tokens: 0, seconds: 0 }, calls: 0 }
}

export function normalizeLevel(level) {
  return LEVELS.has(level) ? level : "normal"
}

// Decisión previa al diálogo. escalate: none | pro-mode | auto | ask. Si "ask", la tool pregunta
// y, según la respuesta, usa cfg.model.pro o deja `model` (el base).
export function decide({ layer, level = "normal", state, cfg, changedFiles = 0 }) {
  level = normalizeLevel(level)
  const base = cfg.model[layer]
  if (!base) throw new Error(`policy: sin modelo base para el rol ${layer}`)
  const out = { model: base, escalate: "none", trigger: null, level }
  if (level === "light") return { ...out, model: cfg.model.light }
  if (!ELIGIBLE.has(layer)) return out
  const g1 = ["research", "review", "verify"].includes(layer) &&
    (state.failures.verify >= 2 || state.failures.review >= 2)
  const g3 = layer === "review" && changedFiles > G3_FILES
  const trigger = level === "deep" ? "deep" : g1 ? "G1" : g3 ? "G3" : null
  if (state.pro && PRO_MODE.has(layer)) return { ...out, model: cfg.model.pro, escalate: "pro-mode", trigger }
  if (!trigger) return out
  if (cfg.pro_auto[layer]) return { ...out, model: cfg.model.pro, escalate: "auto", trigger }
  return { ...out, escalate: "ask", trigger }
}

export function detectPro(prompt) {
  const text = prompt ?? ""
  if (!text.includes(PRO_MARK)) return { pro: false, prompt: text }
  const cleaned = text.split("\n").filter((l) => l.trim() !== PRO_MARK).join("\n").replaceAll(PRO_MARK, "")
  return { pro: true, prompt: cleaned }
}

export function recordOutcome(state, layer, responseText) {
  const t = responseText ?? ""
  if (layer === "verify" && /^\s*FAIL\b/m.test(t)) state.failures.verify++
  if (layer === "review" && /^\s*NEEDS_FIX\b/m.test(t)) state.failures.review++
  return state
}

export function planFromStructured(so) {
  const steps = Array.isArray(so?.steps) ? so.steps : []
  return steps
    .filter((s) => s && LAYERS.includes(s.layer) && s.layer !== "orchestrate" &&
      typeof s.instruction === "string" && s.instruction.trim())
    .map((s) => {
      let level = normalizeLevel(s.level)
      if (!ELIGIBLE.has(s.layer) && level === "deep") level = "normal"
      return { layer: s.layer, level, reason: typeof s.reason === "string" ? s.reason : "", instruction: s.instruction.trim() }
    })
}

// agy reporta usage/duration_seconds ACUMULADOS por conversación (doc headless: "cumulative session").
// Devuelve el delta de esta llamada y recuerda el total; si el total baja (conversación nueva), el delta es el total.
export function usageDelta(state, result) {
  const total = Number(result?.usage?.total_tokens ?? 0)
  const seconds = Number(result?.duration_seconds ?? 0)
  const prev = state.usage ?? { tokens: 0, seconds: 0 }
  const out = {
    tokens: { delta: total >= prev.tokens ? total - prev.tokens : total, total },
    seconds: { delta: seconds >= prev.seconds ? seconds - prev.seconds : seconds, total: seconds },
  }
  state.usage = { tokens: total, seconds }
  return out
}

// Convención de los preámbulos: una capa que necesita al usuario termina con `PREGUNTA: …` (spec §6.1).
export function detectQuestion(text) {
  const lines = String(text ?? "").split("\n")
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^\s*PREGUNTA:\s*(.+?)\s*$/.exec(lines[i])
    if (m) return m[1]
  }
  return null
}
