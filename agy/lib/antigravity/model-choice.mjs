// lib/antigravity/model-choice.mjs — el modelo de agy que elige el usuario con /agy o /antigravity (fase 15, D323). Lo usa el modo directo en cada
// tarea nueva en vez de AGY_MODEL_DIRECT (/pro sigue mandando: usa Pro en esa llamada). Se guarda en un fichero de la caché porque la
// TUI (que lo elige) y la tool (que lo usa) no comparten memoria. Sin elección, manda la config.
import fs from "node:fs"
import path from "node:path"
import { cacheDir } from "./state.mjs"

// Un id de modelo de agy: letras, números, puntos y guiones. Lo que no lo sea no llega nunca a la línea de órdenes.
const ID = /^[a-z0-9][a-z0-9.-]{1,80}$/

export const choicePath = () => path.join(cacheDir(), "modelo.json")

// `agy models` imprime «id\tNombre» por línea (más una línea «Fetching…»).
export function parseModels(out) {
  return String(out).split("\n").map((line) => line.split("\t")).filter(([id, name]) => ID.test(id ?? "") && name?.trim()).map(([id, name]) => ({ id, name: name.trim() }))
}

export function readChoice() {
  try {
    const model = JSON.parse(fs.readFileSync(choicePath(), "utf8")).model
    return typeof model === "string" && ID.test(model) ? model : null
  } catch {
    return null
  }
}

export function writeChoice(model) {
  if (model === null) return fs.rmSync(choicePath(), { force: true })
  if (!ID.test(model)) throw new Error(`modelo no válido: ${model}`)
  fs.mkdirSync(cacheDir(), { recursive: true })
  fs.writeFileSync(choicePath(), JSON.stringify({ model }) + "\n")
}

// El modelo del modo directo que trae la config (tools/agy.env: AGY_MODEL_DIRECT="${AGY_MODEL_DIRECT:-gemini-3.8-flash-low}").
export function defaultModel(envText, env = process.env) {
  if (env.AGY_MODEL_DIRECT && ID.test(env.AGY_MODEL_DIRECT)) return env.AGY_MODEL_DIRECT
  const line = /^AGY_MODEL_DIRECT="\$\{AGY_MODEL_DIRECT:-([^}]+)\}"/m.exec(envText) ?? /^AGY_MODEL_DIRECT="?([^"\s]+)"?/m.exec(envText)
  return line && ID.test(line[1]) ? line[1] : null
}
