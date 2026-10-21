// lib/antigravity/bridge.test.mjs — el puente con agy en JavaScript (D326): sin bash ni jq, para que anti funcione también en
// Linux y Windows. Lee tools/agy.env como lo leía bash y monta la misma orden de agy que agy_bridge.sh.
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseEnvFile, readConfig, agyCommand, stopCommand } from "./bridge.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ENV_FILE = path.join(HERE, "..", "..", "tools", "agy.env")

test("parseEnvFile: ${X:-def}, ${X-def}, $HOME, comillas, comentarios y lo ya definido en el fichero", () => {
  const vars = parseEnvFile([
    "# comentario",
    'A="${A:-uno}"',
    'B="${B-dos}"',
    'C="${C:-tres}"',
    "D=$HOME/x",
    "E='literal $HOME'",
    'F="${A}-f"',
    "  G=sin_comillas   # resto",
    'H="${H-}"',
  ].join("\n"), { HOME: "/home/u", C: "", B: "" })
  assert.deepEqual(vars, { A: "uno", B: "", C: "tres", D: "/home/u/x", E: "literal $HOME", F: "uno-f", G: "sin_comillas", H: "" })
})

// Lo que daba `agy_bridge.sh config` con el agy.env de esta versión (comprobado igual con bash antes de quitarlo, D326).
test("readConfig da la misma configuración que daba agy_bridge.sh", () => {
  const cfg = readConfig({ HOME: "/home/u", AGY_ENV_FILE: ENV_FILE, AGY_MODEL_PRO: "gemini-x", AGY_LEER: "1" })
  assert.deepEqual(cfg, {"model": {"orchestrate": "gemini-3.8-flash-high", "architect": "gemini-3.8-flash-high", "research": "gemini-3.8-flash-high", "implement": "gemini-3.8-flash-high", "fix": "gemini-3.8-flash-high", "review": "gemini-3.8-flash-high", "verify": "gemini-3.8-flash-high", "light": "gemini-3.8-flash-low", "pro": "gemini-x", "direct": "gemini-3.8-flash-low"}, "pro_auto": {"orchestrate": false, "architect": false, "research": false, "review": false, "verify": false}, "timeout": {"orchestrate": "6m", "architect": "12m", "research": "12m", "implement": "15m", "fix": "10m", "review": "10m", "verify": "15m", "direct": "18m"}, "skip_permissions": false, "sandbox": false, "bin": "agy", "ui": {"enabled": false, "port": "7331", "open": true}, "leer": true, "anti_mcp": "", "anti_bun": "bun"})
})

test("agyCommand: la petición va por la entrada estándar (sin límite de longitud de la línea de órdenes, D328) y los argumentos por capa", () => {
  const cfg = readConfig({ HOME: "/home/u", AGY_ENV_FILE: ENV_FILE, AGY_BIN: "/opt/agy", AGY_SKIP_PERMISSIONS: "1" })
  const plan = agyCommand({ cfg, layer: "orchestrate", prompt: "hola\n\"dos\"", cwd: "/p", model: "m" })
  assert.equal(plan.bin, "/opt/agy")
  assert.ok(!plan.args.includes("-p"))
  assert.deepEqual(plan.args.slice(0, 10), ["--input-format", "stream-json", "--output-format", "stream-json", "--add-dir", "/p", "--model", "m", "--print-timeout", cfg.timeout.orchestrate])
  assert.equal(plan.stdin, '{"event":"user","message":{"content":"hola\\n\\"dos\\""}}\n')
  assert.deepEqual(JSON.parse(plan.stdin), { event: "user", message: { content: "hola\n\"dos\"" } })
  assert.ok(plan.args.includes("--mode") && plan.args[plan.args.indexOf("--mode") + 1] === "plan")
  assert.ok(plan.args.includes("--dangerously-skip-permissions"))
  assert.match(plan.args[plan.args.indexOf("--json-schema") + 1], /orchestrate\.schema\.json$/)
  const edit = agyCommand({ cfg, layer: "direct", prompt: "x".repeat(100_000), cwd: "/p", model: "m", conversation: "c1" })
  assert.ok(!edit.args.includes("--mode"))
  assert.deepEqual(edit.args.slice(-3), ["--conversation", "c1", "--dangerously-skip-permissions"])
  assert.ok(edit.args.join(" ").length < 300, "la petición larga no va en los argumentos")
  assert.throws(() => agyCommand({ cfg, layer: "otra", prompt: "x", cwd: "/p", model: "m" }), /capa no válida/)
})

test("stopCommand: en Windows se para el árbol entero de procesos (taskkill /T /F); en macOS y Linux, nada aparte (señal)", () => {
  assert.deepEqual(stopCommand(1234, "win32"), ["taskkill", ["/PID", "1234", "/T", "/F"]])
  assert.equal(stopCommand(1234, "darwin"), null)
  assert.equal(stopCommand(1234, "linux"), null)
})

test("AGY_BIN: el entorno manda; si no, el elegido en el onboarding (~/.config/anti/agy); si no, agy", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-home-"))
  assert.equal(readConfig({ HOME: home, AGY_ENV_FILE: ENV_FILE }).bin, "agy")
  fs.mkdirSync(path.join(home, ".config/anti"), { recursive: true })
  fs.writeFileSync(path.join(home, ".config/anti/agy"), "/elegido/agy\n")
  assert.equal(readConfig({ HOME: home, AGY_ENV_FILE: ENV_FILE }).bin, "/elegido/agy")
  assert.equal(readConfig({ HOME: home, AGY_ENV_FILE: ENV_FILE, AGY_BIN: "/env/agy" }).bin, "/env/agy")
})
