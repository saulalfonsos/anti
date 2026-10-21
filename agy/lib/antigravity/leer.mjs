// lib/antigravity/leer.mjs — «lee una vez» en el modo directo (fase 15, D308): lo que se midió como `mcp_formato_vigilado` en la fase 14.
// El servidor MCP de anti (`leer` y, en proyectos de node, `probar`) se instala como plugin del espacio de trabajo del PROYECTO
// (`.agents/plugins/anti/`, que agy activa solo en ese directorio) y el anuncio `turnos` se antepone al mensaje. Nada en ~/.gemini:
// las reglas de permiso `mcp(anti_anti/…)` las pide el flujo de denegaciones de siempre (tool-core.mjs#handleDenied) la primera vez.
// Réplica del texto de packages/task (`src/prompts/mcp.ts#announce("turnos")` y `src/eval/plugin.ts`); leer.test.mjs fija los ejemplos
// carácter por carácter.
import fs from "node:fs"
import path from "node:path"

const SERVER = "anti"
const AGY_SERVER = `${SERVER}_${SERVER}`   // agy nombra `<plugin>_<servidor>` al servidor de un plugin del espacio de trabajo
const PLUGIN_DIR = ".agents/plugins"
const IGNORED = ".agents/"
const READ_EXAMPLE = { ServerName: AGY_SERVER, ToolName: "leer", Arguments: { ficheros: [{ ruta: "src/a.ts", desde: 1, hasta: 80 }] } }
const TESTS_EXAMPLE = { ServerName: AGY_SERVER, ToolName: "probar", Arguments: { ficheros: ["test/a.test.mjs"] } }

// `probar` ejecuta `node --test`: en un proyecto sin package.json no se anuncia, para no mandar al modelo a una herramienta inútil.
export function announce({ tests }) {
  const read = "- leer: lee uno o varios ficheros por llamada, enteros o por rangos de líneas, sin repetir lo que ya leíste en esta conversación."
  if (!tests) {
    return [
      `Tienes un servidor MCP «${AGY_SERVER}» con una herramienta. Úsala EN LUGAR DE view_file:`,
      read,
      "Se llama con call_mcp_tool, así (desde y hasta son opcionales):",
      JSON.stringify(READ_EXAMPLE),
      "Para gastar menos turnos: localiza con una sola búsqueda (varios patrones a la vez) y lee de una vez, con leer, todo lo que vayas a necesitar.",
    ].join("\n")
  }
  return [
    `Tienes un servidor MCP «${AGY_SERVER}» con dos herramientas. Úsalas EN LUGAR DE view_file y de ejecutar los tests con run_command:`,
    read,
    "- probar: ejecuta node --test y devuelve solo los fallos.",
    "Se llaman con call_mcp_tool, así (desde y hasta son opcionales; sin ficheros, probar ejecuta todos los tests):",
    JSON.stringify(READ_EXAMPLE),
    JSON.stringify(TESTS_EXAMPLE),
    "Para gastar menos turnos: localiza con una sola búsqueda (varios patrones a la vez) y lee de una vez, con leer, todo lo que vayas a necesitar.",
    "Ejecuta los tests con probar una vez, cuando hayas terminado de editar.",
  ].join("\n")
}

export const nodeTests = (dir) => fs.existsSync(path.join(dir, "package.json"))
export const leerDefault = (env) => env.AGY_LEER === "1"

// AGY_ANTI_MCP: el servidor. Un `.ts` (desarrollo: packages/task/scripts/anti-mcp.ts) se lanza con bun; otra cosa es un binario
// compilado (la distribución). Sin él no hay «lee una vez» y el modo directo sigue sin el servidor.
export function serverFor(env, dir) {
  const entry = env.AGY_ANTI_MCP
  if (!entry) return null
  if (entry.endsWith(".ts")) return { command: env.AGY_ANTI_BUN || "bun", args: [entry, "--raiz", dir] }
  return { command: entry, args: ["--raiz", dir] }
}

export function installPlugin(dir, server) {
  const plugin = path.join(dir, PLUGIN_DIR, SERVER)
  fs.mkdirSync(plugin, { recursive: true })
  fs.writeFileSync(path.join(plugin, "plugin.json"), `${JSON.stringify({ name: SERVER }, null, 2)}\n`)
  fs.writeFileSync(path.join(plugin, "mcp_config.json"), `${JSON.stringify({ mcpServers: { [SERVER]: { command: server.command, args: server.args } } }, null, 2)}\n`)
  ignore(dir)
}

// Solo en un repo de git normal (`.git` directorio): sin eso, `git status` del usuario vería `.agents/` como suyo. Idempotente.
function ignore(dir) {
  const git = path.join(dir, ".git")
  if (!fs.existsSync(git) || !fs.statSync(git).isDirectory()) return
  const file = path.join(git, "info", "exclude")
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
  if (current.split("\n").some((line) => line.trim() === IGNORED)) return
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, `${current === "" || current.endsWith("\n") ? "" : "\n"}${IGNORED}\n`)
}
