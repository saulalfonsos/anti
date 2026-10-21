// Persistencia mínima en ~/.cache/anti/agy/: estado por conversación de agy,
// contador de llamadas Pro por sesión de OpenCode, log en vivo, y ficheros cambiados en git.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { emptyState } from "./policy.mjs"

export function cacheDir() {
  return process.env.ANTI_AGY_CACHE || path.join(os.homedir(), ".cache", "anti", "agy")
}
function ensure() { fs.mkdirSync(cacheDir(), { recursive: true }) }
const safe = (id) => String(id).replace(/[^A-Za-z0-9._-]/g, "_")

export function convPath(id) { return path.join(cacheDir(), `${safe(id)}.json`) }
export function logPath(id) { return path.join(cacheDir(), `${safe(id)}.log`) }

export function eventsPath(id) { return path.join(cacheDir(), `${safe(id)}.events.jsonl`) }

// Forma mínima que el resto del código asume (tool-core.mjs indexa plan[], recorre
// baseline_files, etc.): si no se cumple, el fichero se trata como corrupto igual que un JSON.parse roto.
function hasExpectedShape(s) {
  return Array.isArray(s.plan) && Array.isArray(s.baseline_files) &&
    !!s.failures && typeof s.failures === "object" && !Array.isArray(s.failures) &&
    typeof s.failures.verify === "number" && typeof s.failures.review === "number" &&
    typeof s.next === "number" && typeof s.pro === "boolean"
}

export function loadConversation(id) {
  ensure()
  const p = convPath(id)
  try {
    const s = JSON.parse(fs.readFileSync(p, "utf8"))
    const base = emptyState()
    const merged = { ...base, ...s, failures: { ...base.failures, ...(s.failures ?? {}) }, corrupt: false }
    if (!hasExpectedShape(merged)) return { ...emptyState(), corrupt: true }
    return merged
  } catch {
    return { ...emptyState(), corrupt: fs.existsSync(p) }
  }
}

export function saveConversation(id, state) {
  ensure()
  const { corrupt, ...rest } = state
  fs.writeFileSync(convPath(id), JSON.stringify(rest, null, 2))
}

// Registro de eventos por conversación (spec §5.1): una línea JSON por evento, con marca de tiempo y cid.
export function appendEvent(id, ev) {
  ensure()
  fs.appendFileSync(eventsPath(id), JSON.stringify({ t: new Date().toISOString(), cid: id, ...ev }) + "\n")
}

function sessionPath(sessionID) { return path.join(cacheDir(), `session-${safe(sessionID)}.json`) }
function readSession(sessionID) { try { return JSON.parse(fs.readFileSync(sessionPath(sessionID), "utf8")) } catch { return {} } }

export function bumpSessionPro(sessionID, inc) {
  ensure()
  const s = readSession(sessionID)
  s.pro_calls = (s.pro_calls ?? 0) + inc
  fs.writeFileSync(sessionPath(sessionID), JSON.stringify(s))
  return s.pro_calls
}

// Marca por sesión de OpenCode (p. ej. ui_opened). Sin `value` solo lee. Devuelve el valor previo.
export function sessionFlag(sessionID, key, value) {
  ensure()
  const s = readSession(sessionID)
  const prev = s[key]
  if (value !== undefined) { s[key] = value; fs.writeFileSync(sessionPath(sessionID), JSON.stringify(s)) }
  return prev
}

export function appendLog(id, line) {
  ensure()
  fs.appendFileSync(logPath(id), `${new Date().toISOString().slice(11, 19)} ${line}\n`)
}

// Rutas con cambios (modificados/añadidos/sin seguimiento) según git; [] si no hay git o repo.
export function gitChangedFiles(cwd) {
  try {
    const out = execFileSync("git", ["-C", cwd, "status", "--porcelain"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    return out.split("\n").filter(Boolean).map((l) => l.slice(3).trim())
  } catch {
    return []
  }
}
