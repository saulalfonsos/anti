import { test, beforeEach } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseBlock, renderBlock, replaceBlock, loadModels, main, DEFAULTS } from "./roles.mjs"
import { readConfig } from "./bridge.mjs"
import { STUB } from "./fixtures/stub.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
let dir, envFile
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-roles-"))
  process.env.ANTI_AGY_CACHE = dir
  envFile = path.join(dir, "agy.env")
  process.env.AGY_ENV_FILE = envFile
  fs.copyFileSync(path.join(here, "..", "..", "tools", "agy.env"), envFile)
})
const out = () => { const buf = []; return { write: (s) => buf.push(s), text: () => buf.join("") } }

test("parseBlock: sin bloque → defaults; con bloque → valores", () => {
  assert.deepEqual(parseBlock("# nada"), DEFAULTS)
  const cfg = parseBlock(fs.readFileSync(envFile, "utf8"))
  assert.equal(cfg.models.orchestrate, "gemini-3.8-flash-high"); assert.equal(cfg.models.pro, "gemini-3.1-pro-high"); assert.equal(cfg.proAuto.review, false)
})
test("renderBlock ↔ parseBlock round-trip", () => {
  const cfg = structuredClone(DEFAULTS); cfg.models.review = "gemini-3.1-pro-high"; cfg.proAuto.verify = true
  assert.deepEqual(parseBlock(renderBlock(cfg)), cfg)
  assert.match(renderBlock(cfg), /^AGY_PRO_AUTO_VERIFY="\$\{AGY_PRO_AUTO_VERIFY:-1\}"$/m)
})
test("replaceBlock: conserva lo de fuera byte a byte; añade el bloque si falta", () => {
  const text = fs.readFileSync(envFile, "utf8")
  const cfg = parseBlock(text); cfg.models.fix = "gemini-3.8-flash-low"
  const next = replaceBlock(text, renderBlock(cfg))
  const strip = (t) => t.replace(/# BEGIN agy-roles[\s\S]*?# END agy-roles/, "")
  assert.equal(strip(next), strip(text)); assert.equal(parseBlock(next).models.fix, "gemini-3.8-flash-low")
  const added = replaceBlock("X=1\n", renderBlock(DEFAULTS))
  assert.ok(added.startsWith("X=1\n")); assert.ok(added.includes("# BEGIN agy-roles")); assert.ok(added.endsWith("# END agy-roles\n"))
})
test("main --set/--pro/--json escribe agy.env y la config del puente lo refleja", async () => {
  const o = out()
  const code = await main(["--set", "review=gemini-3.1-pro-high", "--pro", "verify=on", "--json"], { stdout: o, agyBin: STUB })
  assert.equal(code, 0)
  const j = JSON.parse(o.text()); assert.equal(j.models.review, "gemini-3.1-pro-high"); assert.equal(j.proAuto.verify, true)
  const cfg = readConfig({ ...process.env, AGY_ENV_FILE: envFile })
  assert.equal(cfg.model.review, "gemini-3.1-pro-high"); assert.equal(cfg.pro_auto.verify, true)
  assert.equal(await main(["--set", "turbo=x"], { stdout: out(), agyBin: STUB }), 2)
  assert.equal(await main(["--pro", "implement=on"], { stdout: out(), agyBin: STUB }), 2)
})
test("main --show imprime la tabla con interfaz y ejecución de solo lectura", async () => {
  const o = out(); await main(["--show"], { stdout: o, agyBin: STUB })
  assert.match(o.text(), /orchestrate\s+gemini-3.8-flash-high\s+✗/); assert.match(o.text(), /implement\s+gemini-3.8-flash-high\s+—/)
  assert.match(o.text(), /interfaz .*solo lectura/); assert.match(o.text(), /ejecución\s+Antigravity CLI/)
})
test("loadModels: stub + caché 24h; caché fresca evita agy; sin nada → current", () => {
  const m1 = loadModels({ agyBin: STUB }); assert.equal(m1.length, 5); assert.equal(m1[3].slug, "gemini-3.1-pro-high")
  const m2 = loadModels({ agyBin: "/nonexistent/agy" }); assert.equal(m2.length, 5)
  fs.rmSync(path.join(dir, "models.json"))
  assert.deepEqual(loadModels({ agyBin: "/nonexistent/agy", current: ["a", "a", "b"] }), [{ slug: "a", name: "a" }, { slug: "b", name: "b" }])
})
