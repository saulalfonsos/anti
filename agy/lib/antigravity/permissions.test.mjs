import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { settingsFile, commandPrefix, deriveRule, addAllowRule, SHELL_WRAPPERS } from "./permissions.mjs"

test("settingsFile: variable de entorno o ruta por defecto", () => {
  assert.equal(settingsFile({ AGY_SETTINGS_FILE: "/x/s.json" }), "/x/s.json")
  assert.equal(settingsFile({}), path.join(os.homedir(), ".gemini", "antigravity-cli", "settings.json"))
})
test("commandPrefix: primera palabra ejecutable, sin ruta ni asignaciones", () => {
  assert.equal(commandPrefix("uname -a"), "uname")
  assert.equal(commandPrefix("FOO=1 BAR=2 /usr/bin/xcrun simctl list"), "xcrun")
  assert.equal(commandPrefix('"python3" -m unittest'), "python3")
  assert.equal(commandPrefix("   "), null); assert.equal(commandPrefix(undefined), null)
})
test("deriveRule por tipo de acción", () => {
  const cwd = "/w"
  assert.equal(deriveRule({ actions: [{ action: "write_file", display_name: "ReplaceFileContent" }], cwd }), "write_file(/w)")
  assert.equal(deriveRule({ actions: [{ action: "read_file" }], cwd }), "read_file(/w)")
  assert.equal(deriveRule({ actions: [{ action: "command", command: "uname -a" }], cwd }), "command(uname)")
  const tools = [{ name: "view_file", parameters: { AbsolutePath: "/w/a" } }, { name: "run_command", parameters: { CommandLine: "xcrun simctl boot X" } }]
  assert.equal(deriveRule({ actions: [{ action: "command" }], recentTools: tools, cwd }), "command(xcrun)")
  assert.equal(deriveRule({ actions: [{ action: "command" }], recentTools: [], cwd }), null)
  assert.equal(deriveRule({ actions: [{ action: "mcp" }], recentTools: [{ name: "mcp_xcodebuild_screenshot", parameters: {} }], cwd }), "mcp(xcodebuild/*)")
  assert.equal(deriveRule({ actions: [{ action: "mcp" }], recentTools: [], cwd }), null)
  assert.equal(deriveRule({ actions: [{ action: "read_url" }], recentTools: [{ name: "read_url_content", parameters: { Url: "https://docs.python.org/3/x" } }], cwd }), "read_url(docs.python.org)")
  assert.equal(deriveRule({ actions: [{ action: "execute_url" }], recentTools: [{ name: "open_browser_url", parameters: { Url: "no es url" } }], cwd }), null)
  assert.equal(deriveRule({ actions: [{ action: "otra" }], cwd }), null); assert.equal(deriveRule({ actions: [], cwd }), null)
})
test("addAllowRule: añade sin duplicar, escritura atómica, JSON inválido no se toca", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-perm-")); const f = path.join(dir, "settings.json")
  fs.writeFileSync(f, JSON.stringify({ permissions: { allow: ["command(git)"], deny: ["command(sudo)"] }, other: 1 }))
  assert.deepEqual(addAllowRule(f, "command(uname)"), { added: true })
  const j = JSON.parse(fs.readFileSync(f, "utf8"))
  assert.deepEqual(j.permissions.allow, ["command(git)", "command(uname)"]); assert.deepEqual(j.permissions.deny, ["command(sudo)"]); assert.equal(j.other, 1)
  assert.deepEqual(addAllowRule(f, "command(uname)"), { added: false, reason: "la regla ya estaba" })
  assert.equal(fs.readdirSync(dir).length, 1)   // sin temporales
  fs.writeFileSync(f, "{ roto")
  assert.match(addAllowRule(f, "x").reason, /no es JSON válido/); assert.equal(fs.readFileSync(f, "utf8"), "{ roto")
  assert.match(addAllowRule(path.join(dir, "nope.json"), "x").reason, /no se puede leer/)
  const g = path.join(dir, "vacio.json"); fs.writeFileSync(g, "{}")
  assert.deepEqual(addAllowRule(g, "write_file(/w)"), { added: true }); assert.deepEqual(JSON.parse(fs.readFileSync(g, "utf8")), { permissions: { allow: ["write_file(/w)"] } })
})
test("addAllowRule con symlink: preserva el link y escribe en el destino real", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-perm-")); const real = path.join(dir, "real.json")
  fs.writeFileSync(real, JSON.stringify({ permissions: { allow: [] } }))
  const link = path.join(dir, "settings.json")
  fs.symlinkSync(real, link)
  assert.equal(addAllowRule(link, "command(git)").added, true)
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true)   // el link sigue siendo symlink
  const j = JSON.parse(fs.readFileSync(real, "utf8"))
  assert.deepEqual(j.permissions.allow, ["command(git)"])
})
// Windows no tiene los permisos de Unix (chmod solo toca el bit de solo lectura).
const UNIX = process.platform !== "win32"
test("addAllowRule preserva el modo del archivo", { skip: !UNIX && "sin permisos de Unix" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-perm-")); const f = path.join(dir, "settings.json")
  fs.writeFileSync(f, JSON.stringify({ permissions: { allow: [] } }))
  fs.chmodSync(f, 0o600)
  assert.equal(addAllowRule(f, "command(git)").added, true)
  assert.equal(fs.statSync(f).mode & 0o777, 0o600)
})
test("addAllowRule falla con graceful error handling", { skip: !UNIX && "sin permisos de Unix" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-perm-")); const f = path.join(dir, "settings.json")
  fs.writeFileSync(f, JSON.stringify({ permissions: { allow: [] } }))
  fs.chmodSync(dir, 0o555)   // directorio de solo lectura
  try {
    const res = addAllowRule(f, "command(git)")
    assert.equal(res.added, false)
    assert.match(res.reason, /no se pudo escribir/)
    assert.equal(fs.readdirSync(dir).filter(x => x.includes(".tmp-")).length, 0)   // sin temporales
  } finally {
    fs.chmodSync(dir, 0o755)
  }
})
test("deriveRule rechaza intérpretes shell y wrappers", () => {
  const cwd = "/w"
  assert.equal(deriveRule({ actions: [{ action: "command", command: "sh -c 'rm -rf x'" }], cwd }), null)
  assert.equal(deriveRule({ actions: [{ action: "command", command: "env FOO=1 bash" }], cwd }), null)
  assert.equal(deriveRule({ actions: [{ action: "command", command: "sudo ls" }], cwd }), null)
  assert.equal(deriveRule({ actions: [{ action: "command", command: "uname -a" }], cwd }), "command(uname)")
})
test("deriveRule: rechaza comandos con metacaracteres de shell y wrappers ampliados", () => {
  const cwd = "/w"
  assert.equal(deriveRule({ actions: [{ action: "command", command: "cd /tmp && rm -rf x" }], cwd }), null)
  assert.equal(deriveRule({ actions: [{ action: "command", command: "python3 -c x" }], cwd }), null)
  assert.equal(deriveRule({ actions: [{ action: "command", command: "python3.12 -c x" }], cwd }), null)
  assert.equal(deriveRule({ actions: [{ action: "command", command: "npx pkg" }], cwd }), null)
  assert.equal(deriveRule({ actions: [{ action: "command", command: "ls;rm -rf ~" }], cwd }), null)
  assert.equal(deriveRule({ actions: [{ action: "command", command: "git status | sh" }], cwd }), null)
  assert.equal(deriveRule({ actions: [{ action: "command", command: "echo `whoami`" }], cwd }), null)
  assert.equal(deriveRule({ actions: [{ action: "command", command: "echo $HOME" }], cwd }), null)
  assert.equal(deriveRule({ actions: [{ action: "command", command: "echo a > b" }], cwd }), null)
  assert.equal(deriveRule({ actions: [{ action: "command", command: "cat < a" }], cwd }), null)
  assert.equal(deriveRule({ actions: [{ action: "command", command: "echo a\necho b" }], cwd }), null)
  assert.equal(deriveRule({ actions: [{ action: "command", command: "uname -a" }], cwd }), "command(uname)")
})
test("deriveRule: write_file/read_file sin regla si cwd es / o el home del usuario", () => {
  assert.equal(deriveRule({ actions: [{ action: "write_file" }], cwd: "/" }), null)
  assert.equal(deriveRule({ actions: [{ action: "write_file" }], cwd: os.homedir() }), null)
  assert.equal(deriveRule({ actions: [{ action: "read_file" }], cwd: "/" }), null)
  assert.equal(deriveRule({ actions: [{ action: "read_file" }], cwd: os.homedir() }), null)
  assert.equal(deriveRule({ actions: [{ action: "write_file" }], cwd: "/w" }), "write_file(/w)")
})
