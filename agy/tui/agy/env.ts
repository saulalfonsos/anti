// Versión de OpenCode contra la que se probó la API de plugins de TUI. Si la instalada es mayor, avisamos una
// vez y seguimos: la API es pública, pero no está versionada por separado.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
export { cacheDir } from "../../lib/antigravity/state.mjs"

// Puerto del visor web. NO basta con process.env: el usuario lo configura en tools/agy.env, que solo lee el
// puente de la tool (lib/antigravity/bridge.mjs), no el proceso de la TUI — así que si lo cambió (p. ej. porque 7331
// estaba ocupado, cosa que el propio ui.mjs le sugiere), la tecla "o" sondearía para siempre el puerto
// equivocado y diría "agy-ui no está en marcha". Lectura perezosa y cacheada: es un fichero de shell, se
// busca solo la asignación de la variable.
let cachedPort: number | null = null
export function viewerPort(): number {
  if (cachedPort !== null) return cachedPort
  const fromEnv = Number(process.env.AGY_UI_PORT)
  if (Number.isFinite(fromEnv) && fromEnv > 0) return (cachedPort = fromEnv)
  cachedPort = 7331
  try {
    const here = path.dirname(fileURLToPath(import.meta.url))   // tui/agy
    const file = path.join(here, "..", "..", "tools", "agy.env")
    const m = /^\s*AGY_UI_PORT=.*?(\d{2,5})/m.exec(fs.readFileSync(file, "utf8"))
    if (m) cachedPort = Number(m[1])
  } catch { /* sin tools/agy.env (instalación parcial): se queda el 7331 por defecto */ }
  return cachedPort
}
