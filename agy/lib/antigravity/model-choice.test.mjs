// lib/antigravity/model-choice.test.mjs — el modelo de agy que elige el usuario con /agy (fase 15, D323).
import { test, beforeEach } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { parseModels, readChoice, writeChoice, choicePath, defaultModel } from "./model-choice.mjs"

beforeEach(() => { process.env.ANTI_AGY_CACHE = fs.mkdtempSync(path.join(os.tmpdir(), "agy-modelo-")) })

test("parseModels: lee la salida real de `agy models` (id, tabulador, nombre) e ignora el resto", () => {
  const out = "Fetching available models...\ngemini-3.8-flash-low\tGemini 3.8 Flash (Low)\nclaude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)\n\nbasura sin tabulador\n"
  assert.deepEqual(parseModels(out), [
    { id: "gemini-3.8-flash-low", name: "Gemini 3.8 Flash (Low)" },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Thinking)" },
  ])
  assert.deepEqual(parseModels(""), [])
})

test("readChoice/writeChoice: sin elección no hay nada; se guarda, se lee y null vuelve al de la config", () => {
  assert.equal(readChoice(), null)
  writeChoice("claude-sonnet-4-6")
  assert.equal(readChoice(), "claude-sonnet-4-6")
  writeChoice(null)
  assert.equal(readChoice(), null)
  assert.equal(fs.existsSync(choicePath()), false)
})

test("readChoice: un fichero roto o con algo que no es un id se ignora", () => {
  fs.writeFileSync(choicePath(), "{no es json")
  assert.equal(readChoice(), null)
  fs.writeFileSync(choicePath(), JSON.stringify({ model: "rm -rf /" }))
  assert.equal(readChoice(), null)
})

test("defaultModel: el de tools/agy.env (con o sin ${…:-…}); la variable de entorno manda", () => {
  assert.equal(defaultModel('AGY_X=1\nAGY_MODEL_DIRECT="${AGY_MODEL_DIRECT:-gemini-3.8-flash-low}"\n', {}), "gemini-3.8-flash-low")
  assert.equal(defaultModel('AGY_MODEL_DIRECT="gemini-3.1-pro-low"\n', {}), "gemini-3.1-pro-low")
  assert.equal(defaultModel("", {}), null)
  assert.equal(defaultModel('AGY_MODEL_DIRECT="x"', { AGY_MODEL_DIRECT: "claude-sonnet-4-6" }), "claude-sonnet-4-6")
  // La de verdad
  assert.match(defaultModel(fs.readFileSync(new URL("../../tools/agy.env", import.meta.url), "utf8"), {}), /^gemini-/)
})
