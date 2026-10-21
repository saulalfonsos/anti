// lib/antigravity/bridge.mjs — el puente con agy (D326). Antes era tools/agy_bridge.sh (bash + jq); ahora es JavaScript para que
// anti funcione igual en macOS, Linux y Windows. Lee tools/agy.env con la misma sintaxis que bash (KEY="${KEY:-defecto}") y monta
// la orden de agy de cada capa. El fichero agy.env sigue siendo la única fuente de modelos, timeouts y opciones.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const TOOLS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "tools")

// Lo que entiende de la sintaxis de bash: KEY=valor, "…" (con expansión), '…' (literal), ${X:-def}, ${X-def}, ${X} y $X. Cada línea
// ve las anteriores. Las líneas que no son asignaciones (if, export a secas, comentarios) se ignoran.
export function parseEnvFile(text, env = process.env) {
  const vars = {}
  const lookup = (name) => (name in vars ? vars[name] : env[name])
  const expand = (s) =>
    s.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?-)([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, name, op, def, bare) => {
      if (bare) return lookup(bare) ?? ""
      const v = lookup(name)
      if (op === ":-") return v ? v : expand(def)
      if (op === "-") return v !== undefined ? v : expand(def)
      return v ?? ""
    })
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(raw)
    if (!m) continue
    const rest = m[2].trim()
    let value
    if (rest.startsWith('"')) value = expand(rest.slice(1, rest.indexOf('"', 1) === -1 ? undefined : rest.lastIndexOf('"')))
    else if (rest.startsWith("'")) value = rest.slice(1, rest.lastIndexOf("'") > 0 ? rest.lastIndexOf("'") : undefined)
    else value = expand(rest.replace(/\s+#.*$/, "").trim())
    vars[m[1]] = value
  }
  return vars
}

const on = (v) => v === "1"

// La configuración resuelta, con la misma forma que daba `agy_bridge.sh config`.
export function readConfig(env = process.env) {
  const file = env.AGY_ENV_FILE || path.join(TOOLS_DIR, "agy.env")
  const v = parseEnvFile(fs.readFileSync(file, "utf8"), env)
  const home = env.HOME || env.USERPROFILE || os.homedir()
  let chosen = ""
  try {
    chosen = fs.readFileSync(path.join(home, ".config", "anti", "agy"), "utf8").trim()
  } catch {
    // Sin onboarding hecho: el agy del PATH.
  }
  return {
    model: { orchestrate: v.AGY_MODEL_ORCHESTRATE, architect: v.AGY_MODEL_ARCHITECT, research: v.AGY_MODEL_RESEARCH, implement: v.AGY_MODEL_IMPLEMENT,
      fix: v.AGY_MODEL_FIX, review: v.AGY_MODEL_REVIEW, verify: v.AGY_MODEL_VERIFY, light: v.AGY_MODEL_LIGHT, pro: v.AGY_MODEL_PRO,
      direct: v.AGY_MODEL_DIRECT || "gemini-3.8-flash-low" },
    pro_auto: { orchestrate: on(v.AGY_PRO_AUTO_ORCHESTRATE), architect: on(v.AGY_PRO_AUTO_ARCHITECT), research: on(v.AGY_PRO_AUTO_RESEARCH),
      review: on(v.AGY_PRO_AUTO_REVIEW), verify: on(v.AGY_PRO_AUTO_VERIFY) },
    timeout: { orchestrate: v.AGY_TIMEOUT_ORCHESTRATE, architect: v.AGY_TIMEOUT_ARCHITECT, research: v.AGY_TIMEOUT_RESEARCH,
      implement: v.AGY_TIMEOUT_IMPLEMENT, fix: v.AGY_TIMEOUT_FIX, review: v.AGY_TIMEOUT_REVIEW, verify: v.AGY_TIMEOUT_VERIFY,
      direct: v.AGY_TIMEOUT_DIRECT || "18m" },
    skip_permissions: on(v.AGY_SKIP_PERMISSIONS), sandbox: on(v.AGY_SANDBOX),
    bin: env.AGY_BIN || chosen || v.AGY_BIN || "agy",
    ui: { enabled: on(v.AGY_UI), port: v.AGY_UI_PORT, open: on(v.AGY_UI_OPEN) },
    leer: on(v.AGY_LEER || "0"), anti_mcp: v.AGY_ANTI_MCP ?? "", anti_bun: v.AGY_ANTI_BUN || "bun",
  }
}

// Las capas de solo lectura van en --mode plan (no editan); las demás editan y ejecutan.
const PLAN = new Set(["orchestrate", "architect", "research", "review"])
const LAYERS = new Set([...PLAN, "implement", "fix", "verify", "direct"])

// D328: la petición va por la entrada estándar como una línea `{"event":"user","message":{"content":…}}` (--input-format stream-json,
// antigravity.google/docs/cli/headless) y no como argumento: en Windows la línea de órdenes no pasa de 32.767 caracteres y una petición
// con un texto pegado largo no llegaba a arrancar agy. Al cerrar la entrada, agy termina ese turno y sale.
export function agyCommand({ cfg, layer, prompt, cwd, model, conversation }) {
  if (!LAYERS.has(layer)) throw new Error(`capa no válida: ${layer}`)
  const args = ["--input-format", "stream-json", "--output-format", "stream-json", "--add-dir", cwd, "--model", model, "--print-timeout", cfg.timeout[layer]]
  if (PLAN.has(layer)) args.push("--mode", "plan")
  if (conversation) args.push("--conversation", conversation)
  if (cfg.skip_permissions) args.push("--dangerously-skip-permissions")
  if (cfg.sandbox) args.push("--sandbox")
  if (layer === "orchestrate") args.push("--json-schema", path.join(TOOLS_DIR, "orchestrate.schema.json"))
  return { bin: cfg.bin, args, stdin: `${JSON.stringify({ event: "user", message: { content: prompt } })}\n` }
}

// D328: en Windows no hay señales: matar a agy deja vivos a sus hijos (las órdenes que lanzó, sus subagentes). Para pararlo se cierra
// el árbol entero. En macOS y Linux basta la señal (SIGTERM es la parada suave: agy aún emite su resultado).
export function stopCommand(pid, platform = process.platform) {
  return platform === "win32" ? ["taskkill", ["/PID", String(pid), "/T", "/F"]] : null
}
