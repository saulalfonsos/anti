// lib/antigravity/watchdog.mjs — vigilante de llamadas repetidas sin edición para el modo directo (fase 15, D305). Es una RÉPLICA del de
// packages/task (`src/algo/watchdog.ts` y `src/prompts/watchdog.ts`, fase 14, D290, D291, D294, D300), el que se midió en 72 celdas: misma
// identidad de llamada, mismos umbrales y mismo mensaje. Réplica y no import porque esta capa se prueba con `node --test` y aquel es
// TypeScript con imports sin extensión; para que no diverjan, watchdog.test.mjs pasa la MISMA conversación real con bucle (986463) y
// exige los mismos disparos (avisos en 63 y 85, corte en 105). PURO: un reductor sobre las tools que empiezan (`{name, parameters}`,
// lo que `stream.mjs#parseEvent` da en `active`); quien lo usa (tool-core.mjs#runDirect) para y reanuda agy.
import { WRITE_TOOLS } from "./tool-icons.mjs"

export function watchConfig(cfg) {
  for (const [key, min] of [["repeat", 2], ["readRepeat", 2], ["nudges", 0], ["maxCalls", 1]]) {
    if (!Number.isInteger(cfg[key]) || cfg[key] < min) throw new Error(`watchConfig: ${key} debe ser un entero >= ${min}, recibido ${cfg[key]}`)
  }
  return cfg
}

// D291 y D300: 5 para órdenes, 15 para lecturas (el stream solo enseña el fichero), corte en el tercer disparo y tope de 120 llamadas.
export const DEFAULT_WATCH = watchConfig({ repeat: 5, readRepeat: 15, nudges: 2, maxCalls: 120 })
export const START = { calls: 0, fired: 0, seen: new Map() }
const CONTINUE = { kind: "seguir" }
const READ_TOOLS = new Set(["view_file", "call_mcp_tool"])
const IGNORED = new Set(["toolAction", "toolSummary"])

export const isRead = (call) => READ_TOOLS.has(call.name)

export function callKey(call) {
  const parameters = Object.fromEntries(Object.entries(call.parameters ?? {}).filter(([key]) => !IGNORED.has(key)))
  return `${call.name} ${canonical(parameters)}`
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1))
    return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${canonical(inner)}`).join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

export function observe(cfg, state, call) {
  const calls = state.calls + 1
  if (calls > cfg.maxCalls) return { state: { ...state, calls }, verdict: { kind: "cortar", reason: "llamadas", call } }
  if (WRITE_TOOLS.has(call.name)) return { state: { ...state, calls, seen: new Map() }, verdict: CONTINUE }
  const key = callKey(call)
  const times = (state.seen.get(key) ?? 0) + 1
  if (times < (isRead(call) ? cfg.readRepeat : cfg.repeat)) return { state: { ...state, calls, seen: new Map(state.seen).set(key, times) }, verdict: CONTINUE }
  const fired = state.fired + 1
  const next = { calls, fired, seen: new Map() }
  if (state.fired >= cfg.nudges) return { state: next, verdict: { kind: "cortar", reason: "bucle", call } }
  return { state: next, verdict: { kind: "avisar", fired, call, times } }
}

const CALL_MAX = 160

export function nudge({ call, times, fired }) {
  const key = callKey(call)
  const shown = key.length > CALL_MAX ? `${key.slice(0, CALL_MAX)}…` : key
  const what = isRead(call) ? `has leído ${times} veces lo mismo (${shown})` : `has hecho ${times} veces la misma llamada (${shown})`
  return [
    `DETECTOR DE BUCLES: ${what} sin editar nada entre medias, y he cortado tu turno (aviso ${fired}).`,
    "No vuelvas a leer lo que ya has leído: con lo que tienes, haz el cambio, ejecuta los tests una vez y termina.",
  ].join("\n")
}
