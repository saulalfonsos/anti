// lib/antigravity/permissions.mjs — de una denegación de agy a una regla `action(target)` y su escritura en
// ~/.gemini/antigravity-cli/settings.json (spec §6.2). Sintaxis verificada en antigravity.google/docs/cli/permissions:
// command(prefijo) · write_file(/ruta) · read_file(/ruta) · read_url(dominio) · execute_url(dominio) · mcp(server/*).
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// Intérpretes de shell y herramientas de wrapper cuya regla se deriva manualmente (nunca automáticamente).
export const SHELL_WRAPPERS = new Set([
  "sh", "bash", "zsh", "fish", "dash", "env", "sudo", "doas", "xargs", "eval", "exec", "nohup", "time", "command", "nice", "timeout",
  "cd", "python", "python3", "node", "npx", "bunx", "deno", "perl", "ruby", "php", "uv", "uvx", "pipx",
])
// python3.12, python3.9... (además del literal "python3" ya cubierto por SHELL_WRAPPERS).
const INTERPRETER_RE = /^python\d*(\.\d+)?$/
// Metacaracteres de shell (encadenado, sustitución, redirección) o salto de línea: una regla
// command(<prefijo>) sobre una línea así autorizaría mucho más que el ejecutable que se ve.
const DANGEROUS_RE = /[;&|$`><]|\n/

export function settingsFile(env = process.env) {
  return env.AGY_SETTINGS_FILE || path.join(os.homedir(), ".gemini", "antigravity-cli", "settings.json")
}

// Primera palabra ejecutable de una línea de comando: sin asignaciones VAR=x previas, sin ruta, sin comillas.
export function commandPrefix(cmdline) {
  const tokens = String(cmdline ?? "").trim().split(/\s+/).filter(Boolean)
  while (tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) tokens.shift()
  if (!tokens.length) return null
  const first = tokens[0].replace(/^["']|["']$/g, "")
  return path.basename(first) || null
}

// Nombre de tool MCP en agy: `mcp_<server>_<tool>` (se confirma en la Tarea 14; ajustar aquí si difiere).
const MCP_TOOL_RE = /^mcp_([^_]+)_/

// cwd resuelve a / o al home del usuario: una regla write_file(cwd)/read_file(cwd) ahí autorizaría
// todo el sistema de ficheros del usuario, no solo el árbol de la tarea.
function unsafeCwd(cwd) {
  let real
  try { real = fs.realpathSync(cwd) } catch { real = path.resolve(String(cwd ?? "")) }
  let home
  try { home = fs.realpathSync(os.homedir()) } catch { home = os.homedir() }
  return real === path.parse(real).root || real === home
}

export function deriveRule({ actions, recentTools = [], cwd }) {
  const a = actions?.[0]
  if (!a) return null
  const last = (pred) => [...recentTools].reverse().find(pred)
  switch (a.action) {
    case "write_file": return unsafeCwd(cwd) ? null : `write_file(${cwd})`
    case "read_file": return unsafeCwd(cwd) ? null : `read_file(${cwd})`
    case "command": {
      const cmd = a.command ?? a.target ?? last((t) => t.name === "run_command")?.parameters?.CommandLine
      if (DANGEROUS_RE.test(String(cmd ?? ""))) return null
      const p = commandPrefix(cmd)
      return p && !SHELL_WRAPPERS.has(p) && !INTERPRETER_RE.test(p) ? `command(${p})` : null
    }
    case "mcp": {
      const m = MCP_TOOL_RE.exec(last((t) => MCP_TOOL_RE.test(t.name ?? ""))?.name ?? "")
      return m ? `mcp(${m[1]}/*)` : null
    }
    case "read_url":
    case "execute_url": {
      const u = last((t) => typeof t.parameters?.Url === "string")?.parameters?.Url
      try { return u ? `${a.action}(${new URL(u).hostname})` : null } catch { return null }
    }
    default: return null
  }
}

export function addAllowRule(file, rule) {
  let text
  try { text = fs.readFileSync(file, "utf8") } catch (e) { return { added: false, reason: `no se puede leer ${file}: ${e.message}` } }
  let json
  try { json = JSON.parse(text) } catch { return { added: false, reason: `${file} no es JSON válido; añade la regla a mano` } }
  if (!json || typeof json !== "object" || Array.isArray(json)) return { added: false, reason: `${file} no contiene un objeto JSON` }
  json.permissions ??= {}
  if (!Array.isArray(json.permissions.allow)) json.permissions.allow = []
  if (json.permissions.allow.includes(rule)) return { added: false, reason: "la regla ya estaba" }
  json.permissions.allow.push(rule)

  // Resuelve el destino real si file es un symlink, para no reemplazarlo con un archivo plano.
  let target = file
  try { target = fs.realpathSync(file) } catch {}

  // Lee el modo del archivo original para preservarlo después de escribir.
  let mode
  try { mode = fs.statSync(target).mode & 0o777 } catch {}

  const tmp = `${target}.tmp-${process.pid}`
  try {
    const data = JSON.stringify(json, null, 2) + "\n"
    fs.writeFileSync(tmp, data, mode ? { mode } : undefined)
    if (mode) fs.chmodSync(tmp, mode)
    fs.renameSync(tmp, target)
    return { added: true }
  } catch (e) {
    try { fs.unlinkSync(tmp) } catch {}
    return { added: false, reason: `no se pudo escribir ${file}: ${e.message}` }
  }
}
