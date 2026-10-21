// lib/anti/onboarding.test.mjs — el onboarding de anti (fase 15, D325): clave de OpenRouter, modelo traductor gratis, agy y
// su sesión. Sin red ni procesos reales: fetch y la ejecución de órdenes se inyectan.
import { test, beforeEach } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  RECOMMENDED, userDir, readState, writeState, readTraductor, writeTraductor, savedAgy, writeAgy, agyBin,
  checkKey, freeToolModels, testModel, agyCandidates, probeAgy, agySession, pending, providerOf, otherProviders, toolModels, hasCredentials,
} from "./onboarding.mjs"

let home
beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), "anti-onb-")) })
const env = (extra = {}) => ({ HOME: home, PATH: "/usr/bin:/bin", ...extra })
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) })

test("lo que elige el usuario vive en ~/.config/anti (fuera de ~/.anti, que se borra al actualizar)", () => {
  assert.equal(userDir(env()), path.join(home, ".config", "anti"))
  assert.equal(userDir(env({ ANTI_USER_DIR: "/tmp/x" })), "/tmp/x")
  assert.equal(readState(env()), null)
  writeState(env(), { done: true })
  assert.equal(readState(env()).done, true)
  assert.equal(readTraductor(env()), null)
  writeTraductor(env(), "openrouter/nvidia/nemotron-3-super-120b-a12b:free")
  assert.equal(readTraductor(env()), "openrouter/nvidia/nemotron-3-super-120b-a12b:free")
  assert.throws(() => writeTraductor(env(), "rm -rf /"))
  assert.throws(() => writeTraductor(env(), "sin-proveedor"))
  writeTraductor(env(), "opencode/big-pickle")
  assert.equal(readTraductor(env()), "opencode/big-pickle")
  assert.equal(savedAgy(env()), null)
  writeAgy(env(), "/opt/agy/bin/agy")
  assert.equal(savedAgy(env()), "/opt/agy/bin/agy")
  assert.equal(agyBin(env()), "/opt/agy/bin/agy")
  assert.equal(agyBin(env({ AGY_BIN: "/x/agy" })), "/x/agy")
  assert.equal(agyBin({ HOME: fs.mkdtempSync(path.join(os.tmpdir(), "anti-onb-")) }), "agy")
})

test("checkKey: válida (con lo que dice OpenRouter), inválida, vacía, sin red", async () => {
  const ok = await checkKey("sk-or-v1-abc", async (url, init) => {
    assert.equal(url, "https://openrouter.ai/api/v1/key")
    assert.equal(init.headers.Authorization, "Bearer sk-or-v1-abc")
    return res(200, { data: { label: "sk-or-v1-abc...", is_free_tier: true, limit_remaining: null, usage: 0, free_model_daily_requests: { limit: 50, remaining: 42 } } })
  })
  assert.deepEqual(ok, { ok: true, freeTier: true, label: "sk-or-v1-abc...", daily: { limit: 50, remaining: 42 } })
  assert.equal((await checkKey("sk-or-x", async () => res(200, { data: {} }))).daily, undefined)
  assert.match((await checkKey("mala", async () => res(401, { error: { message: "No auth credentials found" } }))).error, /no es válida/)
  assert.match((await checkKey("  ", async () => res(200, {}))).error, /Pega la clave/)
  assert.match((await checkKey("sk-or-x", async () => { throw new Error("ENOTFOUND") })).error, /No pude hablar con OpenRouter/)
})

test("freeToolModels: solo gratis y con herramientas, sin el enrutador aleatorio; el recomendado y el actual primero", () => {
  const m = (id, extra = {}) => ({ id, name: id, description: "d", context_length: 1000, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools"], ...extra })
  const list = freeToolModels({ data: [
    m("a/grande:free", { context_length: 900000 }),
    m("b/pago", { pricing: { prompt: "0.000001", completion: "0" } }),
    m("c/sin-tools:free", { supported_parameters: ["temperature"] }),
    m("openrouter/free"),
    m(RECOMMENDED.replace(/^openrouter\//, "")),
    m("d/actual:free", { expiration_date: "2026-11-01" }),
  ] }, "openrouter/d/actual:free")
  assert.deepEqual(list.map((x) => x.id), ["openrouter/d/actual:free", RECOMMENDED, "openrouter/a/grande:free"])
  assert.equal(list[0].current, true)
  assert.equal(list[1].recommended, true)
  assert.equal(list[0].expires, "2026-11-01")
  assert.deepEqual(freeToolModels({}, null), [])
})

test("testModel: responde, saturado (429), ya no existe (404), sin cuota diaria (402) y sin red", async () => {
  const call = (status, body) => testModel("k", "openrouter/x/y:free", async (url, init) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions")
    assert.equal(JSON.parse(init.body).model, "x/y:free")
    return res(status, body)
  })
  assert.deepEqual(await call(200, { choices: [{ message: { content: "ok" } }] }), { ok: true })
  assert.match((await call(429, {})).error, /saturado/)
  assert.match((await call(404, {})).error, /ya no está/)
  assert.match((await call(402, {})).error, /límite de créditos/)
  assert.match((await testModel("k", "openrouter/x", async () => { throw new Error("x") })).error, /No pude hablar/)
})

test("agyCandidates: lo guardado, AGY_BIN, el PATH y los sitios habituales (el del instalador oficial incluido), sin repetir", () => {
  // Se simula macOS: la carpeta personal es de macOS aunque los tests corran en Windows; lo guardado vive en la carpeta temporal.
  const mac = (extra) => env({ HOME: "/Users/prueba", ANTI_USER_DIR: path.join(home, ".config", "anti"), ...extra })
  writeAgy(mac(), "/guardado/agy")
  const exists = new Set(["/guardado/agy", "/Users/prueba/.local/bin/agy", "/usr/bin/agy", "/opt/homebrew/bin/agy"])
  const list = agyCandidates(mac({ AGY_BIN: "/opt/homebrew/bin/agy", PATH: "/usr/bin:/opt/homebrew/bin" }), (p) => exists.has(p), "darwin")
  assert.deepEqual(list, ["/guardado/agy", "/opt/homebrew/bin/agy", "/usr/bin/agy", "/Users/prueba/.local/bin/agy"])
})

test("agyCandidates en Linux (sin apps de macOS) y en Windows (agy.exe, PATH con «;», %LOCALAPPDATA%\\agy\\bin)", () => {
  assert.deepEqual(agyCandidates({ HOME: "/h", PATH: "/usr/bin" }, (p) => p === "/h/.local/bin/agy", "linux"), ["/h/.local/bin/agy"])
  const win = { USERPROFILE: "C:\\Users\\a", LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local", PATH: "C:\\Windows;C:\\tools", ANTI_USER_DIR: path.join(home, "w") }
  const found = "C:\\Users\\a\\AppData\\Local\\agy\\bin\\agy.exe"
  assert.deepEqual(agyCandidates(win, (p) => p === found || p === "C:\\tools\\agy.exe", "win32"), ["C:\\tools\\agy.exe", found])
})

test("probeAgy: versión de `agy --version`; si no es agy o no arranca, por qué", async () => {
  assert.deepEqual(await probeAgy("/a/agy", async (bin, args) => { assert.deepEqual(args, ["--version"]); return { code: 0, stdout: "1.3.1\n", stderr: "" } }), { ok: true, path: "/a/agy", version: "1.3.1" })
  assert.equal((await probeAgy("/a/otro", async () => ({ code: 0, stdout: "hola", stderr: "" }))).ok, false)
  assert.match((await probeAgy("/a/roto", async () => ({ code: 1, stdout: "", stderr: "permission denied" }))).error, /permission denied/)
})

test("agySession: `agy models` sin gastar cuota; con modelos hay sesión, sin ellos dice qué pasó", async () => {
  const ok = await agySession("/a/agy", async (bin, args) => { assert.deepEqual(args, ["models"]); return { code: 0, stdout: "Fetching...\ngemini-3.8-flash-low\tGemini 3.8 Flash (Low)\n", stderr: "" } })
  assert.deepEqual(ok, { ok: true, models: 1 })
  const no = await agySession("/a/agy", async () => ({ code: 1, stdout: "", stderr: "Error: not signed in\n" }))
  assert.equal(no.ok, false)
  assert.match(no.error, /not signed in/)
})

test("agySession: si agy no responde a tiempo no dice que falte la sesión", async () => {
  const s = await agySession("/a/agy", async () => ({ code: 1, stdout: "", stderr: "Fetching available models...", timedOut: true }))
  assert.equal(s.ok, false)
  assert.equal(s.slow, true)
  assert.match(s.error, /tardó demasiado/)
})

test("pending: qué falta por hacer", () => {
  assert.deepEqual(pending({ state: null, hasKey: false, agy: null }), ["bienvenida", "proveedor", "clave", "modelo", "agy", "sesion"])
  assert.deepEqual(pending({ state: { done: true, version: 1 }, hasKey: true, agy: "/a/agy" }), [])
  // Si después de hacerlo falta la clave o agy, solo se pide eso.
  assert.deepEqual(pending({ state: { done: true, version: 1 }, hasKey: false, agy: "/a/agy" }), ["clave"])
  assert.deepEqual(pending({ state: { done: true, version: 1 }, hasKey: true, agy: null }), ["agy", "sesion"])
})

test("providerOf: el proveedor sale del modelo; sin modelo, OpenRouter", () => {
  assert.equal(providerOf("openrouter/nvidia/x:free"), "openrouter")
  assert.equal(providerOf("anthropic/claude-haiku-4-5"), "anthropic")
  assert.equal(providerOf(null), "openrouter")
})

test("otherProviders: los que se configuran con clave, sin OpenRouter ni Zen, por nombre", () => {
  const all = [
    { id: "openrouter", name: "OpenRouter", env: ["OPENROUTER_API_KEY"] },
    { id: "opencode", name: "OpenCode Zen", env: ["OPENCODE_API_KEY"] },
    { id: "openai", name: "OpenAI", env: ["OPENAI_API_KEY"] },
    { id: "local", name: "Local", env: [] },
    { id: "anthropic", name: "Anthropic", env: ["ANTHROPIC_API_KEY"] },
  ]
  assert.deepEqual(otherProviders(all).map((p) => p.id), ["anthropic", "openai"])
  assert.deepEqual(otherProviders(undefined), [])
})

test("toolModels: con herramientas y sin retirados; el actual y los gratis primero", () => {
  const m = (id, extra = {}) => ({ id, name: id, capabilities: { toolcall: true }, cost: { input: 1, output: 1 }, limit: { context: 1000 }, status: "active", ...extra })
  const provider = { id: "opencode", models: {
    b: m("b"), a: m("a"), gratis: m("gratis", { cost: { input: 0, output: 0 } }),
    viejo: m("viejo", { status: "deprecated" }), mudo: m("mudo", { capabilities: { toolcall: false } }),
  } }
  assert.deepEqual(toolModels(provider, "opencode/b").map((x) => x.id), ["opencode/b", "opencode/gratis", "opencode/a"])
  assert.equal(toolModels(provider, null)[0].free, true)
})

test("hasCredentials: la clave guardada o su variable de entorno, también para Zen", () => {
  assert.equal(hasCredentials({ provider: "opencode", auth: {}, env: {} }), false)
  assert.equal(hasCredentials({ provider: "opencode", auth: {}, env: { OPENCODE_API_KEY: "k" }, envNames: ["OPENCODE_API_KEY"] }), true)
  assert.equal(hasCredentials({ provider: "openrouter", auth: {}, env: {} }), false)
  assert.equal(hasCredentials({ provider: "openrouter", auth: {}, env: { OPENROUTER_API_KEY: "k" } }), true)
  assert.equal(hasCredentials({ provider: "anthropic", auth: { anthropic: { type: "api", key: "k" } }, env: {} }), true)
  assert.equal(hasCredentials({ provider: "anthropic", auth: {}, env: { ANTHROPIC_API_KEY: "k" }, envNames: ["ANTHROPIC_API_KEY"] }), true)
  assert.equal(hasCredentials({ provider: "anthropic", auth: {}, env: { ANTHROPIC_API_KEY: "k" } }), false)
})
