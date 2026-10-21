// lib/antigravity/chatview.mjs — el desglose de lo que hace agy, para el chat principal (fase 15, D317). La tool lo manda en vivo en
// `ctx.metadata({metadata: {agy}})` y en los metadatos finales; el chat de la TUI (packages/tui, componente de `antigravity`) lo pinta
// con el aspecto del IDE de Antigravity. Es el MISMO modelo que el visor y la vista de agente (ui/render.mjs#createReducer, sobre los
// eventos que ya se escriben en <cid>.events.jsonl), con las salidas largas recortadas: los metadatos viajan en cada actualización de
// la parte y se guardan con la sesión.
import { createReducer } from "./ui/render.mjs"

export const CAPS = { output: 6000, patch: 20000, text: 12000, parameter: 2000 }
const THROTTLE_MS = 200

function cut(s, n) {
  const str = String(s ?? "")
  return str.length > n ? `${str.slice(0, n)}… (${str.length - n} caracteres más)` : str
}

function capParameters(parameters) {
  return Object.fromEntries(Object.entries(parameters ?? {}).map(([k, v]) => [k, typeof v === "string" ? cut(v, CAPS.parameter) : v]))
}

function capItem(item) {
  if (item.kind === "tool") return { ...item, output: cut(item.output, CAPS.output), parameters: capParameters(item.parameters) }
  if (item.kind === "diff") return item.patch?.length > CAPS.patch ? { ...item, patch: item.patch.slice(0, CAPS.patch), truncated: true } : item
  if (item.kind === "text" || item.kind === "thinking") return { ...item, text: cut(item.text, CAPS.text) }
  return item
}

export function compact(vm) {
  return {
    version: 1,
    cwd: vm.cwd,
    live: vm.live,
    pro: vm.pro,
    plan: vm.plan,
    banner: vm.banner,
    calls: vm.calls.map((c) => ({ ...c, items: c.items.map(capItem) })),
  }
}

export function createChatView({ now = () => Date.now() } = {}) {
  const reducer = createReducer()
  let cached = null
  let at = -Infinity
  return {
    push(event) { reducer.push([event]) },
    // Sin `force`, como mucho una instantánea cada THROTTLE_MS: la TUI repinta con cada metadata y agy emite muchas líneas por segundo.
    snapshot({ force = false } = {}) {
      if (!force && cached && now() - at < THROTTLE_MS) return cached
      cached = compact(reducer.snapshot())
      at = now()
      return cached
    },
  }
}
