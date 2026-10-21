// lib/antigravity/stream.mjs — eventos NDJSON de `agy --output-format stream-json` → líneas de progreso
// legibles y datos de tools. Sin I/O. Forma verificada en agy 1.2.2: {event:"init"|"step_update"|"result", …};
// step_update tiene step_type (user_input|agent_response|tool|checkpoint…), state (ACTIVE|DONE|ERROR),
// tool_name, tool_info{name,parameters,output}, text_delta.
import path from "node:path"
import { iconFor, mainArg } from "./tool-icons.mjs"

const MAX_ARG = 80
const MAX_TEXT = 120

export function splitLines(buffer, chunk) {
  const parts = (buffer + chunk).split("\n")
  return { lines: parts.slice(0, -1), rest: parts.at(-1) ?? "" }
}

function clip(text, max) {
  const t = text.replace(/\s+/g, " ").trim()
  return t.length > max ? t.slice(0, max - 1) + "…" : t
}

export function describeTool(info, cwd) {
  const name = info?.name ?? "?"
  const a = mainArg(info?.parameters)
  let arg = a.value
  if (a.kind === "path" && cwd && path.isAbsolute(arg)) arg = path.relative(cwd, arg) || "."
  arg = clip(arg, MAX_ARG)
  return `${iconFor(name)} ${name}${arg ? ": " + arg : ""}`
}

// {line?} progreso legible · {active?} tool que empieza · {done?} tool que acaba (con output) ·
// {result?} envoltorio final · {init?} · {error?}. El result NO produce línea: la escribe tool-core con deltas.
export function parseEvent(raw, cwd) {
  let e
  try { e = JSON.parse(raw) } catch { return { error: "línea no parseable" } }
  if (e.event === "result") return { result: e.result ?? {} }
  if (e.event === "init") return { init: { conversation_id: e.conversation_id ?? null } }
  if (e.event !== "step_update") return {}
  const su = e.step_update ?? {}
  if (su.step_type === "tool") {
    const info = su.tool_info ?? { name: su.tool_name }
    const name = info.name ?? su.tool_name ?? "?"
    const parameters = info.parameters ?? {}
    if (su.state === "ACTIVE") return { line: describeTool(info, cwd), active: { name, parameters } }
    if (su.state === "ERROR") return { line: `⚠️ ${name} ERROR` }
    if (su.state === "DONE") return { done: { name, parameters, output: info.output ?? "" } }
    return {}
  }
  if (su.step_type === "agent_response" && su.state === "DONE" && su.text_delta) {
    return { line: `💬 ${clip(su.text_delta, MAX_TEXT)}` }
  }
  return {}
}
