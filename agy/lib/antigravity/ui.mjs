// lib/antigravity/ui.mjs — arranca o reutiliza el visor agy-ui desde la tool, sin bloquear ni hacer fallar la
// llamada (spec §5.3). Variables: AGY_UI=0 desactiva; AGY_UI_PORT (7331); AGY_UI_OPEN=1 abre el navegador
// una vez por sesión de OpenCode.
import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"
import { openUrlCommand } from "../anti/platform.mjs"
import { fileURLToPath } from "node:url"
import { sessionFlag } from "./state.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BIN = path.resolve(HERE, "..", "..", "bin", "agy-ui")
const SERVER = path.join(HERE, "ui", "server.mjs")
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Dentro de OpenCode `process.execPath` es el binario de OpenCode (bun compilado), no node: lanzarlo con
// bin/agy-ui como argumento no arranca el visor (visto en la verificación real del 2026-09-15). Si el
// ejecutable actual no es node, se usa el `node` del PATH.
export function nodeBinary(execPath = process.execPath) {
  return /^node(\.exe)?$/i.test(path.basename(execPath)) ? execPath : "node"
}

export function viewerUrl(env) { return `http://127.0.0.1:${Number(env.AGY_UI_PORT || 7331)}` }
export function diskVersion() { try { return String(Math.floor(fs.statSync(SERVER).mtimeMs)) } catch { return "" } }

async function health(url, ms = 300) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms)
  try {
    const r = await fetch(`${url}/api/health`, { signal: c.signal })
    return r.ok ? await r.json() : null
  } catch { return null }
  finally { clearTimeout(t) }
}
function openBrowser(u) {
  try { const [bin, args] = openUrlCommand(u); spawn(bin, args, { detached: true, stdio: "ignore" }).on("error", () => {}).unref() } catch {}
}

// Abre el navegador como mucho una vez por sesión de OpenCode (marca sessionFlag). No-op sin url, con
// AGY_UI_OPEN=0, sin sessionID, o si ya se abrió antes en esta sesión.
export function openViewerOnce({ env, sessionID, url, opener = openBrowser }) {
  if (!url || env.AGY_UI_OPEN === "0" || !sessionID || sessionFlag(sessionID, "ui_opened")) return
  sessionFlag(sessionID, "ui_opened", true)
  opener(url)
}

export async function ensureViewer({ env, cid = null, expectVersion = diskVersion() }) {
  if (env.AGY_UI === "0") return null
  const url = viewerUrl(env)
  const port = new URL(url).port
  let h = await health(url)
  if (h && h.agy_ui !== true) return { url: null, note: `puerto ${port} ocupado por otro programa; pon AGY_UI_PORT=<otro> en tools/agy.env` }
  if (h && h.version !== expectVersion) {
    try { await fetch(`${url}/api/quit`, { method: "POST" }) } catch {}
    for (let i = 0; i < 10 && (await health(url)); i++) await sleep(100)
    h = null
  }
  if (!h) {
    try { spawn(nodeBinary(), [BIN], { detached: true, stdio: "ignore", env: { ...env, AGY_UI_PORT: port } }).unref() }
    catch (e) { return { url: null, note: `no se pudo lanzar agy-ui: ${e.message}` } }
    for (let i = 0; i < 20 && !h; i++) { await sleep(100); h = await health(url) }
    if (!h) return { url: null, note: "agy-ui no arrancó en 2 s (¿`node` en el PATH? ejecuta `node bin/agy-ui` para ver el error)" }
  }
  // El navegador NO se abre aquí: quien llama (tool-core) ya conoce el cid definitivo y decide cuándo
  // abrir con openViewerOnce (una sola vez por sesión de OpenCode). Abrirlo desde ensureViewer duplicaba
  // esa decisión y, peor, podía hacerlo con un cid todavía provisional.
  const full = cid ? `${url}/#${cid}` : url
  return { url: full, note: null }
}
