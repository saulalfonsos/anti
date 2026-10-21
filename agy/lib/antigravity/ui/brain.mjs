// lib/antigravity/ui/brain.mjs — lector best-effort del transcript interno de agy para mostrar el `thinking`
// del modelo. ÚNICA pieza que conoce ese formato (no documentado; agy 1.2.2): líneas JSON con
// {step_index, source, type, status, created_at, content?, thinking?, tool_calls?}. Cualquier error → [].
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export function brainDir() {
  return process.env.AGY_BRAIN_DIR || path.join(os.homedir(), ".gemini", "antigravity-cli", "brain")
}
export function transcriptPath(cid) {
  return path.join(brainDir(), cid, ".system_generated", "logs", "transcript_full.jsonl")
}
export function readThinking(cid, after = -1) {
  // guarda de cid: nunca dejar que un cid con "/", "." o ".." escape de brainDir()
  if (!/^[A-Za-z0-9._-]+$/.test(cid) || cid === "." || cid === "..") return []
  try {
    const out = []
    for (const line of fs.readFileSync(transcriptPath(cid), "utf8").split("\n")) {
      if (!line) continue
      let o; try { o = JSON.parse(line) } catch { continue }
      const idx = Number(o.step_index)
      if (typeof o.thinking === "string" && o.thinking.trim() && idx > after) out.push({ step_index: idx, t: o.created_at ?? null, thinking: o.thinking })
    }
    return out
  } catch { return [] }
}
