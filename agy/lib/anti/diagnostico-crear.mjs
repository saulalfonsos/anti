// lib/anti/diagnostico-crear.mjs — crea el .zip de diagnóstico con lo de este ordenador (D329): dónde están los registros de anti y de
// agy, las versiones y el sistema, y dónde se guarda. Lo usan igual `/diagnostico` (la TUI), el aviso cuando algo falla y
// `anti diagnostico` (la terminal). La limpieza y lo que entra está en diagnostico.mjs.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { collect, writeZip } from "./diagnostico.mjs"
import { agyBin, hasCredentials, providerOf, readState, readTraductor, userDir } from "./onboarding.mjs"

const home = (env) => env.HOME || env.USERPROFILE || os.homedir()
// Las carpetas de anti (como las calcula xdg-basedir, también en Windows).
export const logDir = (env) => path.join(env.XDG_DATA_HOME || path.join(home(env), ".local", "share"), "anti", "log")
export const agyCacheDir = (env) => env.ANTI_AGY_CACHE || path.join(home(env), ".cache", "anti", "agy")

function version(file) {
  try { return fs.readFileSync(file, "utf8").trim() } catch { return "desarrollo" }
}
function agyVersion(env) {
  try { return execFileSync(agyBin(env), ["--version"], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n")[0] } catch { return "no encontrado" }
}
// Si el traductor tiene con qué hablar con su proveedor (sin incluir la clave).
function hasKey(env) {
  let auth = {}
  try {
    auth = JSON.parse(fs.readFileSync(path.join(env.XDG_DATA_HOME || path.join(home(env), ".local", "share"), "anti", "auth.json"), "utf8"))
  } catch {
    // Sin auth.json todavía.
  }
  return hasCredentials({ provider: providerOf(readTraductor(env)), auth, env, envNames: readState(env)?.envNames ?? [] })
}

// Dónde se guarda: Descargas si existe; si no, la carpeta personal.
export function destination(env, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)
  const downloads = path.join(home(env), "Downloads")
  return path.join(fs.existsSync(downloads) ? downloads : home(env), `anti-diagnostico-${stamp}.zip`)
}

export function crearDiagnostico({ env = process.env, app = "", dest = destination(env), days = 7 } = {}) {
  const files = collect({
    home: home(env),
    user: os.userInfo().username,
    logDir: logDir(env),
    cacheDir: agyCacheDir(env),
    userDir: userDir(env),
    days,
    hasKey: hasKey(env),
    system: {
      anti: env.ANTI_HOME ? version(path.join(env.ANTI_HOME, "VERSION")) : "desarrollo",
      app,
      agy: agyVersion(env),
      sistema: `${os.type()} ${os.release()}`,
      plataforma: `${process.platform}-${process.arch}`,
      terminal: env.TERM_PROGRAM || env.TERM || "desconocida",
      shell: path.basename(env.SHELL || env.ComSpec || ""),
      idioma: env.LANG || Intl.DateTimeFormat().resolvedOptions().locale,
      cpus: os.cpus().length,
      memoria_gb: Math.round(os.totalmem() / 2 ** 30),
    },
  })
  return { dest: writeZip(dest, files), files: Object.keys(files).length }
}
