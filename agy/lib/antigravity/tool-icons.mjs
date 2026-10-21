// lib/antigravity/tool-icons.mjs — tabla compartida por Node (stream.mjs, tool-core.mjs) y el navegador
// (ui/render.mjs). SIN imports: el servidor la sirve tal cual en /tool-icons.mjs.
export const ICON = {
  run_command: "🔧", send_command_input: "🔧",
  write_to_file: "✏️", replace_file_content: "✏️", multi_replace_file_content: "✏️", sed_file: "✏️", notebook_edit: "✏️",
  view_file: "👁", list_dir: "👁", read_resource: "👁",
  find_by_name: "🔍", grep_search: "🔍",
  read_url_content: "🌐", search_web: "🌐", open_browser_url: "🌐",
}
export const TEXT_KEYS = ["CommandLine", "Command", "Query", "Pattern", "Url", "Instruction"]
export const PATH_KEYS = ["AbsolutePath", "TargetFile", "File", "FilePath", "SearchDirectory", "Path"]
export const WRITE_TOOLS = new Set(["write_to_file", "replace_file_content", "multi_replace_file_content", "sed_file", "notebook_edit"])
export const IMAGE_RE = /\.(png|jpe?g|gif|webp)$/i

// Nombre de las tools MCP en agy: prefijo `mcp_` (se confirma en la Tarea 14; si difiere, se ajusta aquí).
export function iconFor(name) {
  return ICON[name] ?? (String(name).startsWith("mcp_") ? "🧩" : "🔹")
}

export function mainArg(parameters) {
  const p = parameters ?? {}
  for (const k of TEXT_KEYS) if (typeof p[k] === "string" && p[k]) return { kind: "text", value: p[k] }
  for (const k of PATH_KEYS) if (typeof p[k] === "string" && p[k]) return { kind: "path", value: p[k] }
  return { kind: null, value: "" }
}
