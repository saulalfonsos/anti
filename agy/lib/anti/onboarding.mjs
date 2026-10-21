// lib/anti/onboarding.mjs — lo que necesita anti la primera vez (fase 15, D325), sin interfaz: el proveedor del traductor
// (OpenRouter, OpenCode Zen u otro de los que soporta OpenCode) y su clave, el modelo traductor, dónde está agy y si tiene la sesión
// iniciada. La red y las órdenes se inyectan (`fetch`,
// `run(bin, args)`) para probarlo sin nada real. Las elecciones viven en ~/.config/anti porque el instalador borra ~/.anti al
// actualizar; la clave la guarda OpenCode (auth.set), como cualquier otra. Nunca se leen las credenciales de agy: su sesión se comprueba
// con `agy models`, que no gasta cuota.
import fs from "node:fs"
import path from "node:path"
import { parseModels } from "../antigravity/model-choice.mjs"
import { agyDirs, agyExe, agyInstall } from "./platform.mjs"

export const VERSION = 1
// Probado de punta a punta como traductor (fase 15, D316).
export const RECOMMENDED = "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free"
export const KEYS_URL = "https://openrouter.ai/settings/keys"
export { agyInstall }
export const ZEN = "opencode"
export const ZEN_URL = "https://opencode.ai/zen"
const API = "https://openrouter.ai/api/v1"
// proveedor/modelo, como los escribe OpenCode (el modelo puede llevar más barras: openrouter/nvidia/…).
const MODEL_ID = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:\/-]*$/i
export const providerOf = (model) => String(model ?? "").split("/")[0] || "openrouter"

// ANTI_USER_DIR permite probarlo desde cero sin tocar la configuración real.
export const userDir = (env) => env.ANTI_USER_DIR || path.join(env.HOME || env.USERPROFILE, ".config", "anti")
const file = (env, name) => path.join(userDir(env), name)

function read(env, name) {
  try {
    return fs.readFileSync(file(env, name), "utf8").trim() || null
  } catch {
    return null
  }
}
function write(env, name, text) {
  fs.mkdirSync(userDir(env), { recursive: true })
  fs.writeFileSync(file(env, name), `${text}\n`)
}

export function readState(env) {
  try {
    return JSON.parse(read(env, "onboarding.json") ?? "null")
  } catch {
    return null
  }
}
export const writeState = (env, state) => write(env, "onboarding.json", JSON.stringify({ version: VERSION, ...state }))

// El modelo traductor: agy/opencode.jsonc lo lee con {file:~/.config/anti/traductor}.
export const readTraductor = (env) => read(env, "traductor")
export function writeTraductor(env, model) {
  if (!MODEL_ID.test(model)) throw new Error(`modelo no válido: ${model}`)
  write(env, "traductor", model)
}

export const savedAgy = (env) => read(env, "agy")
export function writeAgy(env, bin) {
  if (!path.isAbsolute(bin) && !path.win32.isAbsolute(bin)) throw new Error(`ruta no absoluta: ${bin}`)
  write(env, "agy", bin)
}
// El agy que se usa: AGY_BIN si lo ponen, el elegido en el onboarding, o el del PATH.
export const agyBin = (env) => env.AGY_BIN || savedAgy(env) || "agy"

// GET /key de OpenRouter: si la clave vale, si es de la capa gratuita y cuántas peticiones a modelos gratis quedan hoy (el tope depende
// de los créditos comprados alguna vez; OpenRouter lo da en `free_model_daily_requests`, así que no se escribe aquí ninguna cifra).
export async function checkKey(key, fetch) {
  const k = String(key ?? "").trim()
  if (!k) return { ok: false, error: "Pega la clave (empieza por sk-or-)." }
  let r
  try {
    r = await fetch(`${API}/key`, { headers: { Authorization: `Bearer ${k}` } })
  } catch (error) {
    return { ok: false, error: `No pude hablar con OpenRouter (${error.message}). ¿Hay conexión?` }
  }
  if (r.status === 401 || r.status === 403) return { ok: false, error: "OpenRouter dice que esa clave no es válida. Cópiala otra vez desde la página de claves." }
  if (!r.ok) return { ok: false, error: `OpenRouter respondió ${r.status}. Prueba otra vez en un momento.` }
  const data = (await r.json())?.data ?? {}
  const daily = data.free_model_daily_requests
  return {
    ok: true,
    freeTier: data.is_free_tier === true,
    label: String(data.label ?? ""),
    ...(daily && Number.isFinite(Number(daily.limit)) ? { daily: { limit: Number(daily.limit), remaining: Number(daily.remaining ?? daily.limit) } } : {}),
  }
}

// Los modelos gratis que saben usar herramientas (el traductor tiene que llamar a la tool `antigravity`). Sin `openrouter/free`, que
// elige uno al azar en cada petición. Primero el actual, luego el recomendado, luego por contexto.
export function freeToolModels(json, current) {
  const free = (json?.data ?? []).filter((m) =>
    Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0 && (m.supported_parameters ?? []).includes("tools") && m.id !== "openrouter/free")
  const rank = (m) => (m.id === current ? 0 : m.id === RECOMMENDED ? 1 : 2)
  return free
    .map((m) => ({
      id: `openrouter/${m.id}`,
      name: String(m.name ?? m.id).replace(/\s*\(free\)\s*$/i, ""),
      description: String(m.description ?? "").replace(/\s+/g, " ").trim(),
      context: Number(m.context_length ?? 0),
      expires: m.expiration_date ?? null,
    }))
    .map((m) => ({ ...m, current: m.id === current, recommended: m.id === RECOMMENDED }))
    .sort((a, b) => rank(a) - rank(b) || b.context - a.context)
}

// Una petición mínima de verdad: confirma que la clave y el modelo funcionan ahora mismo.
export async function testModel(key, model, fetch) {
  let r
  try {
    r = await fetch(`${API}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "anti" },
      body: JSON.stringify({ model: model.replace(/^openrouter\//, ""), messages: [{ role: "user", content: "Responde solo: ok" }], max_tokens: 16 }),
    })
  } catch (error) {
    return { ok: false, error: `No pude hablar con OpenRouter (${error.message}).` }
  }
  if (r.ok) return { ok: true }
  if (r.status === 429) return { ok: false, error: "Ese modelo está saturado ahora mismo o has gastado las peticiones gratis de hoy. Elige otro o prueba más tarde." }
  if (r.status === 404) return { ok: false, error: "Ese modelo ya no está en OpenRouter. Elige otro." }
  if (r.status === 402) return { ok: false, error: "OpenRouter no deja usar ese modelo con esta cuenta ahora (límite de créditos). Elige otro o revisa tu cuenta en openrouter.ai." }
  if (r.status === 401) return { ok: false, error: "OpenRouter no acepta la clave. Vuelve al paso de la clave." }
  return { ok: false, error: `OpenRouter respondió ${r.status}. Prueba otra vez o elige otro modelo.` }
}

// Dónde puede estar agy: lo elegido antes, AGY_BIN, cada carpeta del PATH y los sitios habituales de cada sistema (platform.mjs; el
// instalador oficial lo deja en ~/.local/bin o %LOCALAPPDATA%\agy\bin) y, en macOS, dentro de las apps de Antigravity.
export function agyCandidates(env, exists, platform = process.platform) {
  const p = platform === "win32" ? path.win32 : path.posix
  const home = env.HOME || env.USERPROFILE
  const dirs = [...String(env.PATH ?? "").split(platform === "win32" ? ";" : ":").filter(Boolean), ...agyDirs(env, platform)]
  const apps = platform !== "darwin" ? [] : ["/Applications/Antigravity.app", "/Applications/Antigravity IDE.app", p.join(home, "Applications/Antigravity.app")]
    .flatMap((app) => ["Contents/Resources/app/bin/agy", "Contents/Resources/bin/agy", "Contents/MacOS/agy"].map((x) => p.join(app, x)))
  const all = [savedAgy(env), env.AGY_BIN, ...dirs.map((d) => p.join(d, agyExe(platform))), ...apps].filter((x) => x && p.isAbsolute(x))
  return [...new Set(all)].filter((x) => exists(x))
}

export async function probeAgy(bin, run) {
  const r = await run(bin, ["--version"]).catch((error) => ({ code: 1, stdout: "", stderr: error.message }))
  const version = /^\s*v?(\d+\.\d+\.\d+)/.exec(r.stdout ?? "")?.[1]
  if (r.code === 0 && version) return { ok: true, path: bin, version }
  return { ok: false, path: bin, error: (r.stderr || r.stdout || "no responde como agy").trim().split("\n")[0] }
}

export async function agySession(bin, run) {
  const r = await run(bin, ["models"]).catch((error) => ({ code: 1, stdout: "", stderr: error.message }))
  const models = parseModels(r.stdout ?? "").length
  if (r.code === 0 && models > 0) return { ok: true, models }
  if (r.timedOut) return { ok: false, slow: true, error: "agy tardó demasiado en responder; suele ser cosa de un momento" }
  return { ok: false, error: (r.stderr || r.stdout || "agy no devolvió modelos").trim().split("\n").filter(Boolean).at(-1) }
}

// Los proveedores que se configuran con una clave de API (los que traen variables de entorno en models.dev), sin OpenRouter ni Zen,
// que tienen su propia entrada. `all` es la lista de OpenCode (client.provider.list).
export function otherProviders(all) {
  return (all ?? [])
    .filter((p) => p.env?.length && p.id !== "openrouter" && p.id !== ZEN)
    .map((p) => ({ id: p.id, name: p.name, env: p.env }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// Los modelos de un proveedor que saben usar herramientas (el traductor tiene que llamar a la tool `antigravity`), sin los retirados.
// Primero el actual, luego los gratis, luego por nombre.
export function toolModels(provider, current) {
  const free = (m) => Number(m.cost?.input) === 0 && Number(m.cost?.output) === 0
  return Object.values(provider?.models ?? {})
    .filter((m) => m.capabilities?.toolcall && m.status !== "deprecated")
    .map((m) => ({ id: `${provider.id}/${m.id}`, name: m.name ?? m.id, free: free(m), context: Number(m.limit?.context ?? 0) }))
    .map((m) => ({ ...m, current: m.id === current }))
    .sort((a, b) => Number(b.current) - Number(a.current) || Number(b.free) - Number(a.free) || a.name.localeCompare(b.name))
}

// ¿Tiene el traductor con qué hablar con su proveedor? La clave guardada en OpenCode (auth.json) o una de sus variables de entorno
// (`envNames`, las que dio OpenCode al elegirlo). También Zen: su capa gratuita solo funciona desde OpenCode.
export function hasCredentials({ provider, auth, env, envNames = [] }) {
  if (auth?.[provider]) return true
  const names = provider === "openrouter" ? ["OPENROUTER_API_KEY", ...envNames] : envNames
  return names.some((n) => env?.[n])
}

// Qué pasos tocan. La primera vez, todos; después, solo lo que se haya perdido (otra clave, agy desinstalado).
export function pending({ state, hasKey, agy }) {
  if (!state?.done || state.version !== VERSION) return ["bienvenida", "proveedor", "clave", "modelo", "agy", "sesion"]
  return [...(hasKey ? [] : ["clave"]), ...(agy ? [] : ["agy", "sesion"])]
}
