// Nombres del servidor MCP de anti (P13-c, D280-D283). UN solo sitio para el servidor, sus herramientas y la clave de
// conversación, porque los consumen el protocolo y las herramientas (la capa `mcp`), el anuncio (`src/prompts/mcp.ts`), el
// plugin y la comprobación de permisos de la evaluación (`src/eval/*`): nunca literales sueltos. PURO: sin imports.
export const MCP_SERVER = "anti"
export const MCP_TOOL = { read: "leer", tests: "probar" } as const

// Cómo llama `agy` al servidor de un plugin del espacio de trabajo: `<plugin>_<servidor>` (medido en 1.2.14 en la celda de humo del
// piloto: la caché `~/.gemini/antigravity-cli/mcp/anti_anti/`, el `ServerName` de `call_mcp_tool` y el nombre que miran las reglas de
// permisos). Plugin y servidor se llaman los dos `MCP_SERVER` (`eval/plugin.ts`). Es el nombre que ve el modelo y el de las reglas.
export const MCP_AGY_SERVER = `${MCP_SERVER}_${MCP_SERVER}`

// `agy` la pone en el `_meta` de cada `tools/call` (medido en 1.2.14) y es lo único que distingue una conversación de otra.
export const CONVERSATION_META = "antigravity.google/conversation_id"

// Las reglas del `settings.json` de `agy` que autorizan las herramientas del servidor (D286).
export function mcpRules(): readonly string[] {
  return Object.values(MCP_TOOL).map((tool) => `mcp(${MCP_AGY_SERVER}/${tool})`)
}
