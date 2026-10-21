// lib/anti/diagnostico.mjs — el .zip de diagnóstico de anti (D329). Recoge lo indispensable para encontrar y corregir fallos en
// cualquier parte de la app (versiones, ajustes, el registro de anti y qué hizo cada llamada a agy) y NADA de la conversación: ni lo
// que escribe el usuario, ni lo que responde la IA, ni el contenido de sus ficheros. Minimización por diseño (RGPD, art. 5.1.c):
//   · lista blanca: de cada línea del registro solo pasan los campos útiles para depurar; de cada evento de agy, la estructura (capa,
//     modelo, herramienta, estado, tiempos, tokens, errores) y nunca los textos ni los parámetros (solo sus nombres) ni las salidas;
//   · limpieza de lo que pasa: claves y tokens, correos, IPs, la carpeta personal y el nombre de usuario se quitan, y cada ruta se
//     cambia por un marcador estable (<ruta-3>.ts) para poder seguir un mismo fichero sin saber cuál es; los ids, por un código.
// El .zip se crea en el ordenador del usuario y no se envía a ningún sitio: lo comparte él si quiere, y puede abrirlo antes.
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { zipFiles } from "./zip.mjs"

export const LEEME = `Diagnóstico de anti
===================

Este .zip sirve para encontrar y corregir fallos de anti. Lo has creado tú, está en tu ordenador y no se ha enviado a ningún sitio:
tú decides si lo compartes. Puedes abrir sus ficheros y revisarlos antes.

Qué incluye
  - sistema.json: la versión de anti y de agy, tu sistema operativo y tu terminal.
  - ajustes.json: los ajustes de anti (modelos elegidos, opciones). Si el traductor tiene clave solo dice «sí»; la clave no va.
  - anti.log: el registro técnico de anti de los últimos días, solo con los campos que sirven para depurar (nivel, mensaje,
    modelo, errores, tiempos).
  - agy/: por cada tarea de los últimos días, qué hizo el agente paso a paso: qué herramientas usó, cuánto tardó, cuáles
    fallaron, con qué error y cómo terminó.
  - resumen.json: cuántos datos se han quitado o sustituido, para que se vea que la limpieza se ha hecho.

Qué NO incluye
  - Nada de lo que escribes en anti ni de lo que te responde la IA.
  - Nada del contenido de tus ficheros ni de lo que devuelven las órdenes que se ejecutan.
  - Tus claves, contraseñas y tokens, tus correos ni direcciones IP.
  - Tu nombre de usuario ni los nombres de tus carpetas y ficheros: cada ruta se cambia por un marcador como <ruta-3>.ts, que
    solo sirve para saber que dos errores hablan del mismo fichero.

Protección de datos (RGPD)
  Se recoge solo lo indispensable para corregir errores (minimización de datos). Si envías este .zip, quien lo reciba debe usarlo
  únicamente para eso, guardarlo el tiempo necesario y borrarlo cuando lo pidas. Puedes pedir en cualquier momento acceder a lo
  que enviaste o que se borre.
`

// Campos del registro de anti que pasan (lo demás se descarta). Los de `ID_FIELDS` pasan como código; `TEXT_FIELDS`, limpios.
const LOG_FIELDS = new Set(["timestamp", "level", "run", "service", "message", "providerID", "modelID", "llm.runtime", "llm.provider",
  "llm.model", "agent", "mode", "small", "step", "platform", "backend", "count", "version", "status", "code", "duration", "method", "exit",
  "session.id", "messageID", "projectID", "workspaceID", "tool"])
const ID_FIELDS = new Set(["run", "session.id", "messageID", "projectID", "workspaceID"])
const TEXT_FIELDS = new Set(["message"])

const SECRET_PATTERNS = [
  /sk-or-v1-[A-Za-z0-9]{20,}/g, /sk-ant-[A-Za-z0-9_-]{20,}/g, /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g, /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g, /AIza[0-9A-Za-z_-]{30,}/g, /hf_[A-Za-z0-9]{20,}/g, /xox[abprs]-[A-Za-z0-9-]{10,}/g, /AKIA[0-9A-Z]{16}/g,
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, /\b(Bearer|Basic|token|Token)\s+[A-Za-z0-9._~+/=-]{8,}/g,
  /\b((?:api[_-]?key|apikey|password|passwd|secret|token|access[_-]?token)\s*[=:]\s*)["']?[^\s"'&]{4,}/gi,
]

export function createScrubber({ home, user }) {
  const stats = { secrets: 0, emails: 0, ips: 0, paths: 0, droppedFields: 0, droppedText: 0 }
  const paths = new Map()
  const salt = crypto.randomBytes(8).toString("hex")
  const marker = (p) => {
    const ext = /\.[A-Za-z0-9]{1,8}$/.exec(p)?.[0] ?? ""
    const key = p.replace(/[\\/]+$/, "")
    if (!paths.has(key)) paths.set(key, paths.size + 1)
    stats.paths++
    return `<ruta-${paths.get(key)}>${ext}`
  }
  const text = (value) => {
    let s = String(value ?? "")
    for (const re of SECRET_PATTERNS) s = s.replace(re, (m, prefix) => (stats.secrets++, typeof prefix === "string" && /[=:]\s*$/.test(prefix) ? `${prefix}<secreto>` : "<secreto>"))
    s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, () => (stats.emails++, "<correo>"))
    s = s.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, () => (stats.ips++, "<ip>"))
    s = s.replace(/\b(https?:\/\/[^/\s"']+)[^\s"']*/g, (m, origin) => (m.length > origin.length + 1 ? `${origin}/<…>` : m))
    // Rutas absolutas (Unix y Windows), incluida la carpeta personal: un marcador estable con la extensión.
    s = s.replace(/(?:[A-Za-z]:\\|\\\\)[^\s"'<>|:*?]+|(?<![\w.<])\/(?:Users|home|root|tmp|private|var|opt|mnt|Volumes|etc|srv|workspace|usr)\/[^\s"'<>:]*/g, (p) => marker(p))
    if (home) s = s.split(home).join("~")
    if (user && user.length > 2) s = s.replace(new RegExp(`\\b${user.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), "usuario")
    return s
  }
  const id = (value) => `id-${crypto.createHash("sha256").update(salt + String(value)).digest("hex").slice(0, 10)}`
  return { text, id, stats }
}

// Una línea `clave=valor` (logfmt) del registro de anti → solo los campos de la lista blanca, limpios; null si no es una línea así.
export function sanitizeLogLine(line, s) {
  const fields = [...String(line).matchAll(/([A-Za-z_][\w.]*)=("(?:[^"\\]|\\.)*"|\S*)/g)]
  if (!fields.length || !fields.some(([, k]) => k === "timestamp" || k === "level")) return null
  const kept = []
  for (const [, key, raw] of fields) {
    const quoted = raw.startsWith('"')
    const value = quoted ? raw.slice(1, -1) : raw
    if (key.startsWith("error")) kept.push(`${key}="${s.text(value).replace(/"/g, "'").slice(0, 400)}"`)
    else if (!LOG_FIELDS.has(key)) s.stats.droppedFields++
    else if (ID_FIELDS.has(key)) kept.push(`${key}=${s.id(value)}`)
    else if (TEXT_FIELDS.has(key)) kept.push(`${key}=${quoted ? `"${s.text(value)}"` : s.text(value)}`)
    else kept.push(`${key}=${s.text(value)}`)
  }
  return kept.join(" ")
}

const len = (v) => (typeof v === "string" ? v.length : v == null ? 0 : JSON.stringify(v).length)

// Los eventos de una conversación de agy → su estructura, sin textos, parámetros (solo sus nombres) ni salidas.
export function sanitizeEvents(events, s) {
  const out = []
  for (const e of events) {
    const base = { t: e.t, type: e.type, call: e.call }
    if (e.type === "call_start")
      out.push({ ...base, layer: e.layer, model: e.model, level: e.level, pro: e.pro, step: e.step ?? null, session: e.session ? s.id(e.session) : undefined, instruction_chars: len(e.instruction) })
    else if (e.type === "call_end")
      out.push({ ...base, status: e.status, advanced: e.advanced, tokens: e.tokens?.delta ?? e.tokens, seconds: e.seconds?.delta ?? e.seconds, exit: e.exit })
    else if (e.type === "note") out.push({ ...base, text: s.text(e.text) })
    else if (e.type === "denied") out.push({ ...base, type: "denied", kinds: [...new Set((e.actions ?? []).map((a) => a.action ?? "?"))].length ? [...new Set((e.actions ?? []).map((a) => a.action ?? "?"))] : [String(e.rule ?? "?").split("(")[0]], outcome: e.outcome })
    else if (e.type === "question") out.push({ ...base })
    else if (e.type === "diff") {
      const lines = String(e.patch ?? "").split("\n")
      out.push({ ...base, tool: e.tool, add: lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length, del: lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length })
    } else if (e.type === "agy") {
      const ev = e.ev ?? {}
      if (ev.event === "init") out.push({ ...base, type: "init", model: ev.init?.model, tools: ev.init?.tools?.length })
      else if (ev.event === "result") {
        const r = ev.result ?? {}
        out.push({ ...base, type: "result", status: r.status, error: r.error ? s.text(r.error).slice(0, 500) : undefined, turns: r.num_turns, seconds: r.duration_seconds, tokens: r.usage?.total_tokens, response_chars: len(r.response) })
      } else if (ev.event === "step_update") {
        const su = ev.step_update ?? {}
        if (su.step_type === "tool") {
          const info = su.tool_info ?? {}
          out.push({ ...base, type: "tool", step: su.step_index, state: su.state, name: info.name ?? su.tool_name, params: Object.keys(info.parameters ?? {}).filter((k) => k !== "toolAction" && k !== "toolSummary"), ...(info.output != null ? { output_chars: len(info.output) } : {}) })
        } else if (su.step_type === "agent_response") {
          if (su.state === "DONE") out.push({ ...base, type: "turn", step: su.step_index, state: su.state, seconds: su.duration_seconds, thinking_tokens: su.usage?.thinking_tokens })
          else s.stats.droppedText++
        } else out.push({ ...base, type: su.step_type ?? "step", step: su.step_index, state: su.state })
      } else if (ev.event === "error") out.push({ ...base, type: "error", error: s.text(ev.error?.message ?? ev.message ?? "").slice(0, 500) })
    } else if (e.type === "text") s.stats.droppedText++
  }
  return out.map((o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)))
}

function recent(dir, suffix, days) {
  const since = Date.now() - days * 86_400_000
  try {
    return fs.readdirSync(dir).filter((n) => n.endsWith(suffix)).map((n) => path.join(dir, n)).filter((p) => fs.statSync(p).mtimeMs >= since)
      .sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs)
  } catch {
    return []
  }
}
const read = (p) => { try { return fs.readFileSync(p, "utf8").trim() } catch { return "" } }

// Lo que va en el .zip, como {nombre: texto}. `system` lo da quien llama (versiones, sistema); el resto se lee de disco.
export function collect({ home, user, logDir, cacheDir, userDir, days = 7, maxLogLines = 20_000, system = {}, hasKey = false, extraSettings = {} }) {
  const s = createScrubber({ home, user })
  const files = { "LEEME.txt": LEEME }
  files["sistema.json"] = JSON.stringify(Object.fromEntries(Object.entries(system).map(([k, v]) => [k, typeof v === "string" ? s.text(v) : v])), null, 2)
  files["ajustes.json"] = JSON.stringify({
    traductor: read(path.join(userDir, "traductor")) || null,
    agy: read(path.join(userDir, "agy")) ? s.text(read(path.join(userDir, "agy"))) : null,
    asistente_hecho: !!read(path.join(userDir, "onboarding.json")),
    clave_traductor: hasKey ? "sí (no se incluye)" : "no",
    ...Object.fromEntries(Object.entries(extraSettings).map(([k, v]) => [k, typeof v === "string" ? s.text(v) : v])),
  }, null, 2)
  const logLines = recent(logDir, ".log", days).flatMap((f) => read(f).split("\n")).slice(-maxLogLines)
  files["anti.log"] = logLines.map((l) => sanitizeLogLine(l, s)).filter(Boolean).join("\n") + "\n"
  let conversations = 0
  for (const f of recent(cacheDir, ".events.jsonl", days)) {
    const events = read(f).split("\n").flatMap((l) => { try { return [JSON.parse(l)] } catch { return [] } })
    if (!events.length) continue
    files[`agy/${s.id(path.basename(f, ".events.jsonl")).replace(/^id-/, "")}.jsonl`] = sanitizeEvents(events, s).map((e) => JSON.stringify(e)).join("\n") + "\n"
    conversations++
  }
  // Los nombres de las conversaciones salen del código, no del id original; en los tests se piden con su nombre real.
  files["resumen.json"] = JSON.stringify({ creado: new Date().toISOString(), dias: days, conversaciones_de_agy: conversations, lineas_de_registro: logLines.length, quitado: s.stats }, null, 2)
  return files
}

export function writeZip(dest, files) {
  // Solo si falta: en Windows mkdir recursivo sobre una carpeta especial que ya existe (Descargas, a menudo redirigida a OneDrive)
  // falla con EEXIST en bun (visto en GitHub Actions).
  if (!fs.existsSync(path.dirname(dest))) fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, zipFiles(files))
  return dest
}
