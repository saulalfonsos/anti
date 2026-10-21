// lib/antigravity/leer.test.mjs — «lee una vez» (fase 15, D308): el anuncio y el plugin MCP de anti en el proyecto.
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { announce, installPlugin, serverFor, nodeTests, leerDefault } from "./leer.mjs"

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agy-leer-")))

test("D308: el anuncio es el de mcp_formato_vigilado (turnos), con probar solo si hay tests de node", () => {
  const withTests = announce({ tests: true })
  assert.match(withTests, /servidor MCP «anti_anti» con dos herramientas/)
  assert.ok(withTests.includes(JSON.stringify({ ServerName: "anti_anti", ToolName: "leer", Arguments: { ficheros: [{ ruta: "src/a.ts", desde: 1, hasta: 80 }] } })))
  assert.ok(withTests.includes(JSON.stringify({ ServerName: "anti_anti", ToolName: "probar", Arguments: { ficheros: ["test/a.test.mjs"] } })))
  assert.match(withTests, /lee de una vez, con leer, todo lo que vayas a necesitar/)
  assert.match(withTests, /Ejecuta los tests con probar una vez/)
  const noTests = announce({ tests: false })
  assert.match(noTests, /servidor MCP «anti_anti» con una herramienta/)
  assert.doesNotMatch(noTests, /probar/)
  assert.match(noTests, /lee de una vez, con leer/)
})

test("D308: el plugin queda en .agents/plugins/anti y .agents/ en el exclude de git, una sola vez", () => {
  const dir = tmp()
  execFileSync("git", ["init", "-q", dir])
  installPlugin(dir, { command: "/opt/anti-mcp", args: ["--raiz", dir] })
  installPlugin(dir, { command: "/opt/anti-mcp", args: ["--raiz", dir] })
  const base = path.join(dir, ".agents/plugins/anti")
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(base, "plugin.json"), "utf8")), { name: "anti" })
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(base, "mcp_config.json"), "utf8")), { mcpServers: { anti: { command: "/opt/anti-mcp", args: ["--raiz", dir] } } })
  const exclude = fs.readFileSync(path.join(dir, ".git/info/exclude"), "utf8")
  assert.equal(exclude.split("\n").filter((l) => l.trim() === ".agents/").length, 1)
  assert.equal(execFileSync("git", ["-C", dir, "status", "--porcelain"], { encoding: "utf8" }), "")
})

test("D308: sin repo de git el plugin se instala igual y no se crea .git", () => {
  const dir = tmp()
  installPlugin(dir, { command: "x", args: [] })
  assert.ok(fs.existsSync(path.join(dir, ".agents/plugins/anti/mcp_config.json")))
  assert.ok(!fs.existsSync(path.join(dir, ".git")))
})

test("serverFor: un .ts se lanza con bun; un binario, directo; sin AGY_ANTI_MCP no hay servidor", () => {
  assert.deepEqual(serverFor({ AGY_ANTI_MCP: "/x/anti-mcp.ts" }, "/p"), { command: "bun", args: ["/x/anti-mcp.ts", "--raiz", "/p"] })
  assert.deepEqual(serverFor({ AGY_ANTI_MCP: "/x/anti-mcp.ts", AGY_ANTI_BUN: "/b/bun" }, "/p"), { command: "/b/bun", args: ["/x/anti-mcp.ts", "--raiz", "/p"] })
  assert.deepEqual(serverFor({ AGY_ANTI_MCP: "/x/anti-mcp" }, "/p"), { command: "/x/anti-mcp", args: ["--raiz", "/p"] })
  assert.equal(serverFor({}, "/p"), null)
})

test("nodeTests y leerDefault", () => {
  const dir = tmp()
  assert.equal(nodeTests(dir), false)
  fs.writeFileSync(path.join(dir, "package.json"), "{}")
  assert.equal(nodeTests(dir), true)
  assert.equal(leerDefault({ AGY_LEER: "1" }), true)
  assert.equal(leerDefault({ AGY_LEER: "0" }), false)
  assert.equal(leerDefault({}), false)
})
