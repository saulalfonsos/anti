// lib/anti/diagnostico.test.mjs — el .zip de diagnóstico (D329): lo indispensable para corregir fallos y nada de la conversación ni
// datos personales. Cada test mete datos trampa (claves, rutas con el usuario, correos, lo que pidió el usuario, contenido de
// ficheros) y comprueba que no llegan al .zip.
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { createScrubber, sanitizeLogLine, sanitizeEvents, collect, writeZip, LEEME } from "./diagnostico.mjs"
import { zipFiles } from "./zip.mjs"

const HOME = "/Users/maria"
const scrub = () => createScrubber({ home: HOME, user: "maria" })
const SECRETS = [
  "sk-or-v1-" + "a".repeat(64), "sk-ant-api03-" + "b".repeat(40), "ghp_" + "c".repeat(36), "AIza" + "d".repeat(35),
  "hf_" + "e".repeat(34), "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijklmn", "xoxb-1234567890-abcdefghij",
]

test("scrubber: claves y tokens, correos, IPs, rutas (con marcador estable y extensión), usuario y carpeta personal", () => {
  const s = scrub()
  for (const secret of SECRETS) assert.doesNotMatch(s.text(`fallo con ${secret} al llamar`), new RegExp(secret.slice(0, 12)))
  assert.equal(s.text("escribe a maria.lopez@empresa.es"), "escribe a <correo>")
  assert.equal(s.text("conecta a 192.168.1.20:8080"), "conecta a <ip>:8080")
  const a = s.text("ENOENT /Users/maria/proyectos/secreto/app.ts")
  assert.match(a, /^ENOENT <ruta-\d+>\.ts$/)
  assert.equal(s.text("otra vez /Users/maria/proyectos/secreto/app.ts"), `otra vez ${a.slice(7)}`)
  assert.match(s.text("C:\\Users\\maria\\clientes\\lista.xlsx no existe"), /^<ruta-\d+>\.xlsx no existe$/)
  assert.doesNotMatch(s.text("el usuario maria no puede"), /maria/)
  assert.equal(s.text("https://openrouter.ai/api/v1/key?token=abc#x"), "https://openrouter.ai/<…>")
  assert.ok(s.stats.secrets >= SECRETS.length)
  // Los ids se cambian por un código estable (sirve para unir líneas) que no deja ver el original.
  assert.equal(s.id("ses_abc123"), s.id("ses_abc123"))
  assert.notEqual(s.id("ses_abc123"), "ses_abc123")
})

test("sanitizeLogLine: solo los campos de la lista blanca, limpios; el resto se descarta y se cuenta", () => {
  const s = scrub()
  const line = `timestamp=2026-10-08T10:00:00Z level=ERROR run=ab12 message="stream error" providerID=openrouter modelID=x/y:free session.id=ses_123 path=/Users/maria/p/a.ts directory=/Users/maria/p title="mi factura de Iberdrola" error.error="AI_APICallError: Key sk-or-v1-${"f".repeat(64)} rejected for maria@x.com"`
  const out = sanitizeLogLine(line, s)
  assert.match(out, /^timestamp=2026-10-08T10:00:00Z level=ERROR run=\S+ message="stream error" providerID=openrouter modelID=x\/y:free session\.id=\S+ error\.error="AI_APICallError: Key <secreto> rejected for <correo>"$/)
  assert.doesNotMatch(out, /Iberdrola|maria|path=|directory=|title=|ses_123/)
  assert.equal(s.stats.droppedFields, 3)
  assert.equal(sanitizeLogLine("basura sin formato con maria", s), null)
})

test("sanitizeEvents: de cada llamada a agy, qué hizo y cómo acabó; nada de lo que se pidió, se respondió o se leyó", () => {
  const s = scrub()
  const t = "2026-10-08T10:00:00Z"
  const events = [
    { t, type: "call_start", call: 1, layer: "direct", model: "gemini-3.8-flash-low", level: "normal", pro: false, step: null, session: "ses_9", cwd: "/Users/maria/p", instruction: "arregla la nómina de Juan Pérez, DNI 12345678Z" },
    { t, type: "agy", call: 1, ev: { event: "init", init: { model: "gemini-3.8-flash-low", cwd: "/Users/maria/p", tools: ["a", "b"] } } },
    { t, type: "agy", call: 1, ev: { event: "step_update", step_update: { step_index: 1, step_type: "tool", state: "DONE", tool_info: { name: "view_file", parameters: { AbsolutePath: "/Users/maria/p/nominas.csv" }, output: "Juan Pérez;12345678Z;2100€" } } } },
    { t, type: "agy", call: 1, ev: { event: "step_update", step_update: { step_index: 2, step_type: "agent_response", state: "DONE", text_delta: "La nómina de Juan…", duration_seconds: 3.2, usage: { thinking_tokens: 40 } } } },
    { t, type: "diff", call: 1, file: "nominas.csv", patch: "-Juan\n+Juana\n", tool: "replace_file_content" },
    { t, type: "denied", call: 1, rule: "command(rm -rf /Users/maria/p)", outcome: "rejected", actions: [{ action: "command", command: "rm -rf /Users/maria/p" }] },
    { t, type: "note", call: 1, text: "detector de bucles · aviso 1: 15 veces view_file sin editar" },
    { t, type: "question", call: 1, text: "¿Borro la nómina de Juan?" },
    { t, type: "agy", call: 1, ev: { event: "result", result: { status: "ERROR", error: "open /Users/maria/p/x.ts: permission denied", response: "No pude con la nómina de Juan", num_turns: 3, duration_seconds: 12, usage: { total_tokens: 900 } } } },
    { t, type: "call_end", call: 1, status: "ERROR", advanced: false, tokens: { delta: 900 }, seconds: { delta: 12 }, exit: 1 },
  ]
  const out = sanitizeEvents(events, s)
  const text = JSON.stringify(out)
  for (const leak of ["Juan", "12345678Z", "nómina", "nominas", "maria", "2100", "Borro", "rm -rf"]) assert.ok(!text.includes(leak), `se coló «${leak}»`)
  assert.deepEqual(out[0], { t, type: "call_start", call: 1, layer: "direct", model: "gemini-3.8-flash-low", level: "normal", pro: false, step: null, session: s.id("ses_9"), instruction_chars: 46 })
  assert.deepEqual(out[2], { t, type: "tool", call: 1, step: 1, state: "DONE", name: "view_file", params: ["AbsolutePath"], output_chars: 26 })
  assert.deepEqual(out[3], { t, type: "turn", call: 1, step: 2, state: "DONE", seconds: 3.2, thinking_tokens: 40 })
  assert.deepEqual(out[4], { t, type: "diff", call: 1, tool: "replace_file_content", add: 1, del: 1 })
  assert.deepEqual(out[5], { t, type: "denied", call: 1, kinds: ["command"], outcome: "rejected" })
  assert.deepEqual(out[6], { t, type: "note", call: 1, text: "detector de bucles · aviso 1: 15 veces view_file sin editar" })
  assert.deepEqual(out[7], { t, type: "question", call: 1 })
  assert.match(out[8].error, /^open <ruta-\d+>\.ts: permission denied$/)
  assert.equal(out[8].status, "ERROR")
  assert.equal(out[8].response, undefined)
})

test("collect + writeZip: el .zip lleva LEEME, sistema, ajustes, el registro de anti y las llamadas a agy de los últimos días, sin trampas", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anti-diag-"))
  const logDir = path.join(root, "log"), cacheDir = path.join(root, "cache"), userDir = path.join(root, "config")
  for (const d of [logDir, cacheDir, userDir]) fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(path.join(logDir, "anti.log"), [
    `timestamp=${new Date().toISOString()} level=INFO run=1 message=loading path=/Users/maria/p`,
    `timestamp=${new Date().toISOString()} level=ERROR run=1 message="stream error" error.error="key ${SECRETS[0]}"`,
  ].join("\n"))
  const t = new Date().toISOString()
  fs.writeFileSync(path.join(cacheDir, "c1.events.jsonl"), [
    JSON.stringify({ t, type: "call_start", call: 1, layer: "direct", model: "m", instruction: "secreto: el plan de Juan" }),
    JSON.stringify({ t, type: "call_end", call: 1, status: "SUCCESS" }),
  ].join("\n"))
  const old = path.join(cacheDir, "viejo.events.jsonl")
  fs.writeFileSync(old, JSON.stringify({ t, type: "call_start", call: 1, layer: "direct", model: "m" }))
  fs.utimesSync(old, new Date(Date.now() - 30 * 86400_000), new Date(Date.now() - 30 * 86400_000))
  fs.writeFileSync(path.join(userDir, "traductor"), "openrouter/nvidia/nemotron-3-super-120b-a12b:free\n")
  fs.writeFileSync(path.join(userDir, "agy"), "/Users/maria/.local/bin/agy\n")
  const files = collect({ home: HOME, user: "maria", logDir, cacheDir, userDir, days: 7, system: { anti: "0.1.0", agy: "1.3.1", platform: "darwin" }, hasKey: true })
  const names = Object.keys(files).sort()
  // La conversación de hace 30 días no entra; la reciente va con un código, no con su id.
  assert.equal(names.length, 6)
  assert.deepEqual(names.filter((n) => !n.startsWith("agy/")), ["LEEME.txt", "ajustes.json", "anti.log", "resumen.json", "sistema.json"])
  assert.match(names.find((n) => n.startsWith("agy/")), /^agy\/[0-9a-f]{10}\.jsonl$/)
  const all = Object.values(files).join("\n")
  for (const leak of ["Juan", "secreto:", "el plan", "maria", "sk-or-v1-a", "/Users/"]) assert.ok(!all.includes(leak), `se coló «${leak}»`)
  assert.equal(JSON.parse(files["ajustes.json"]).clave_traductor, "sí (no se incluye)")
  assert.match(files["LEEME.txt"], /RGPD/)
  const dest = path.join(root, "diag.zip")
  writeZip(dest, files)
  // El .zip se abre con las herramientas normales (unzip en macOS y Linux).
  const listing = execFileSync("unzip", ["-l", dest], { encoding: "utf8" })
  for (const n of names) assert.match(listing, new RegExp(n.replace(".", "\\.")))
  assert.equal(execFileSync("unzip", ["-p", dest, "LEEME.txt"], { encoding: "utf8" }), files["LEEME.txt"])
})

test("zipFiles: un .zip válido con varios ficheros, comprimidos, y nombres con carpetas y acentos", () => {
  const dest = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "anti-zip-")), "x.zip")
  fs.writeFileSync(dest, zipFiles({ "a.txt": "hola", "carpeta/año.json": JSON.stringify({ n: "x".repeat(5000) }) }))
  execFileSync("unzip", ["-tq", dest])
  // El unzip de macOS no entiende la marca UTF-8 de los nombres; Python sí (y es lo que hacen los programas de hoy).
  const py = 'import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(len(z.read("carpeta/año.json")), z.testzip())'
  assert.equal(execFileSync("python3", ["-c", py, dest], { encoding: "utf8" }).trim(), "5008 None")
})

test("LEEME: explica en sencillo qué se incluye, qué no y lo del RGPD", () => {
  assert.match(LEEME, /no incluye/i)
  assert.match(LEEME, /lo que escribes/i)
  assert.match(LEEME, /RGPD/)
})
