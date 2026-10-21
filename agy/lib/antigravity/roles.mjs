// Selector de modelos por rol para tools/agy.env. Node ≥18, sin dependencias.
//   agy-roles                 interactivo (↑↓ rol · ←→ modelo · p PRO-auto · r refrescar · Enter guardar · q salir)
//   agy-roles --show | --json | --set rol=modelo | --pro rol=on|off | --refresh
// Solo toca el bloque "# BEGIN agy-roles … # END agy-roles"; lo demás del fichero se conserva.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import readline from "node:readline"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const ROLES = ["orchestrate", "architect", "research", "implement", "fix", "review", "verify"]
export const ESCALABLE = new Set(["orchestrate", "architect", "research", "review", "verify"])
export const EXTRA = ["light", "pro"]
const BEGIN = "# BEGIN agy-roles"
const END = "# END agy-roles"
export const DEFAULTS = Object.freeze({
  models: Object.freeze({ orchestrate: "gemini-3.8-flash-high", architect: "gemini-3.8-flash-high", research: "gemini-3.8-flash-high",
    implement: "gemini-3.8-flash-high", fix: "gemini-3.8-flash-high", review: "gemini-3.8-flash-high", verify: "gemini-3.8-flash-high",
    light: "gemini-3.8-flash-low", pro: "gemini-3.1-pro-high" }),
  proAuto: Object.freeze({ orchestrate: false, architect: false, research: false, review: false, verify: false }),
})

export function envFile() { return process.env.AGY_ENV_FILE || path.resolve(HERE, "..", "..", "tools", "agy.env") }
export function cacheFile() {
  return path.join(process.env.ANTI_AGY_CACHE || path.join(os.homedir(), ".cache", "anti", "agy"), "models.json")
}
const blockRe = () => new RegExp(`${BEGIN}\\n[\\s\\S]*?${END}`)

export function parseBlock(text) {
  const cfg = structuredClone(DEFAULTS)
  const m = text.match(blockRe())
  const body = m ? m[0] : text
  for (const line of body.split("\n")) {
    let r = line.match(/^AGY_MODEL_([A-Z]+)="\$\{AGY_MODEL_[A-Z]+:-([^}]*)\}"\s*$/)
    if (r) { const k = r[1].toLowerCase(); if (k in cfg.models) cfg.models[k] = r[2]; continue }
    r = line.match(/^AGY_PRO_AUTO_([A-Z]+)="\$\{AGY_PRO_AUTO_[A-Z]+:-([01])\}"\s*$/)
    if (r) { const k = r[1].toLowerCase(); if (k in cfg.proAuto) cfg.proAuto[k] = r[2] === "1" }
  }
  return cfg
}

export function renderBlock(cfg) {
  const lines = [BEGIN]
  for (const r of [...ROLES, ...EXTRA]) { const V = `AGY_MODEL_${r.toUpperCase()}`; lines.push(`${V}="\${${V}:-${cfg.models[r]}}"`) }
  for (const r of ROLES) if (ESCALABLE.has(r)) { const V = `AGY_PRO_AUTO_${r.toUpperCase()}`; lines.push(`${V}="\${${V}:-${cfg.proAuto[r] ? 1 : 0}}"`) }
  lines.push(END)
  return lines.join("\n")
}

export function replaceBlock(text, block) {
  if (blockRe().test(text)) return text.replace(blockRe(), () => block)
  return text.replace(/\n*$/, "") + "\n\n" + block + "\n"
}

// `agy models` imprime "slug\tNombre" por línea (y "Fetching…" por stderr). Caché 24 h.
export function loadModels({ force = false, agyBin = "agy", ttlMs = 24 * 3600 * 1000, current = [] } = {}) {
  const p = cacheFile()
  const cached = () => { try { const c = JSON.parse(fs.readFileSync(p, "utf8")); return c } catch { return null } }
  const c = cached()
  if (!force && c?.models?.length && Date.now() - c.fetched_at < ttlMs) return c.models
  try {
    const out = execFileSync(agyBin, ["models"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30000 })
    const models = out.split("\n").filter((l) => l.includes("\t")).map((l) => { const [slug, name] = l.split("\t"); return { slug: slug.trim(), name: (name ?? "").trim() } })
    if (models.length) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify({ fetched_at: Date.now(), models })); return models }
  } catch {}
  if (c?.models?.length) return c.models
  return [...new Set(current)].map((slug) => ({ slug, name: slug }))
}

function interfaceModel() {
  try { return fs.readFileSync(path.resolve(HERE, "..", "..", "opencode.jsonc"), "utf8").match(/"model"\s*:\s*"([^"]+)"/)?.[1] ?? "?" } catch { return "?" }
}

function table(cfg, cursor = -1) {
  const rows = [...ROLES, ...EXTRA]
  const w = 28
  const lines = [`  ${"Rol".padEnd(14)} ${"Modelo base".padEnd(w + 4)} PRO-auto`]
  rows.forEach((r, i) => {
    const mark = i === cursor ? "▸" : " "
    const model = i === cursor ? `‹ ${cfg.models[r].padEnd(w - 4)} ›` : `  ${cfg.models[r].padEnd(w - 4)}  `
    const auto = ESCALABLE.has(r) ? (cfg.proAuto[r] ? "✓" : "✗") : r === "light" || r === "pro" ? "" : "—"
    lines.push(`${mark} ${r.padEnd(14)} ${model} ${auto}`)
  })
  lines.push(`  ${"interfaz".padEnd(14)} ${interfaceModel().padEnd(w + 4)} (solo lectura: opencode.jsonc)`)
  lines.push(`  ${"ejecución".padEnd(14)} ${"Antigravity CLI".padEnd(w + 4)} (solo lectura)`)
  return lines.join("\n")
}

function parseArgs(argv) {
  const o = { show: false, json: false, refresh: false, set: [], pro: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--show") o.show = true
    else if (a === "--json") o.json = true
    else if (a === "--refresh") o.refresh = true
    else if (a === "--set" && argv[i + 1]) o.set.push(argv[++i])
    else if (a === "--pro" && argv[i + 1]) o.pro.push(argv[++i])
    else if (a === "-h" || a === "--help") o.help = true
    else throw new Error(`argumento desconocido: ${a}`)
  }
  return o
}

const HELP = `agy-roles — modelo de Antigravity por rol (edita tools/agy.env)
  agy-roles                    interactivo: ↑↓ rol · ←→ modelo · p PRO-auto · r refrescar modelos · Enter guardar · q salir
  agy-roles --show             tabla actual        --json  JSON actual
  agy-roles --set rol=modelo   fija el modelo base (roles: ${[...ROLES, ...EXTRA].join(", ")})
  agy-roles --pro rol=on|off   PRO-auto (roles: ${[...ESCALABLE].join(", ")})
  agy-roles --refresh          vuelve a pedir la lista a \`agy models\`
`

export async function main(argv, { stdout = process.stdout, stdin = process.stdin, agyBin = process.env.AGY_BIN || "agy" } = {}) {
  let o
  try { o = parseArgs(argv) } catch (e) { stdout.write(`${e.message}\n${HELP}`); return 2 }
  if (o.help) { stdout.write(HELP); return 0 }
  const file = envFile()
  const text = fs.readFileSync(file, "utf8")
  const cfg = parseBlock(text)
  let dirty = false
  for (const s of o.set) {
    const [role, model] = s.split("=")
    if (!(role in cfg.models) || !model) { stdout.write(`--set: rol inválido o modelo vacío: ${s}\n`); return 2 }
    cfg.models[role] = model; dirty = true
  }
  for (const s of o.pro) {
    const [role, v] = s.split("=")
    if (!ESCALABLE.has(role) || !["on", "off"].includes(v)) { stdout.write(`--pro: rol no escalable o valor inválido (on|off): ${s}\n`); return 2 }
    cfg.proAuto[role] = v === "on"; dirty = true
  }
  if (o.refresh) loadModels({ force: true, agyBin })
  const batch = o.show || o.json || o.set.length || o.pro.length || o.refresh
  if (batch) {
    if (dirty) fs.writeFileSync(file, replaceBlock(text, renderBlock(cfg)))
    stdout.write(o.json ? JSON.stringify(cfg, null, 2) + "\n" : table(cfg) + (dirty ? `\nGuardado en ${file}\n` : "\n"))
    return 0
  }
  if (!stdin.isTTY) { stdout.write(table(cfg) + "\n" + HELP); return 0 }
  return interactive({ cfg, file, text, stdout, stdin, agyBin })
}

function interactive({ cfg, file, text, stdout, stdin, agyBin }) {
  const rows = [...ROLES, ...EXTRA]
  const current = rows.map((r) => cfg.models[r])
  let models = loadModels({ agyBin, current })
  let slugs = () => { const s = models.map((m) => m.slug); for (const c of current) if (!s.includes(c)) s.unshift(c); return s }
  let cur = 0, dirty = false, msg = "↑↓ rol · ←→ modelo · p PRO-auto · r refrescar · Enter guardar · q salir"
  const draw = () => {
    const name = models.find((m) => m.slug === cfg.models[rows[cur]])?.name ?? ""
    stdout.write(`\x1b[2J\x1b[H${table(cfg, cur)}\n\n  ${name}\n  ${msg}${dirty ? "  (cambios sin guardar)" : ""}\n`)
  }
  readline.emitKeypressEvents(stdin)
  stdin.setRawMode(true); stdin.resume()
  return new Promise((resolve) => {
    const finish = (code) => { stdin.setRawMode(false); stdin.pause(); stdout.write("\n"); resolve(code) }
    stdin.on("keypress", (str, key = {}) => {
      const role = rows[cur]
      if (key.name === "up") cur = (cur - 1 + rows.length) % rows.length
      else if (key.name === "down") cur = (cur + 1) % rows.length
      else if (key.name === "left" || key.name === "right") {
        const s = slugs(); const i = s.indexOf(cfg.models[role]); const d = key.name === "left" ? -1 : 1
        cfg.models[role] = s[(i + d + s.length) % s.length]; dirty = true
      } else if (str === "p") {
        if (ESCALABLE.has(role)) { cfg.proAuto[role] = !cfg.proAuto[role]; dirty = true; msg = `PRO-auto ${role}: ${cfg.proAuto[role] ? "sí, salta a Pro sin preguntar" : "no, preguntará"}` }
        else msg = `${role} no escala a Pro`
      } else if (str === "r") { models = loadModels({ force: true, agyBin, current }); msg = `${models.length} modelos de agy models` }
      else if (key.name === "return") { fs.writeFileSync(file, replaceBlock(text, renderBlock(cfg))); dirty = false; msg = `Guardado en ${file}` }
      else if (str === "q" || key.name === "escape" || (key.ctrl && key.name === "c")) { stdout.write(dirty ? "\nSalida sin guardar.\n" : "\n"); return finish(0) }
      draw()
    })
    draw()
  })
}
