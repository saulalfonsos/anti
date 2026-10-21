#!/usr/bin/env node
// Stub de `agy` para tests: emite stream-json con la forma de agy 1.2.2 y registra cada llamada. En macOS y Linux se lanza tal cual;
// en Windows se compila a agy-stub.exe (bun build --compile), porque allí solo se lanzan ejecutables, como el agy.exe de verdad.
//   AGY_STUB_LOG   fichero de registro (una línea CALL … por invocación)
//   AGY_STUB_IGNORE_TERM=1  en modo loop no atiende SIGTERM (parada en seco)
//   AGY_STUB_MODE  plan2 (defecto) | plan-deep-orch | verify-fail | denied | denied-empty | no-result | question | write | loop
//                  | denied-command | denied-then-ok (usa AGY_STUB_SEQ_FILE) | orch-no-structured | orch-question
//                  | fail-question | sleep (duerme 5s antes del result) | self-signal (se manda SIGTERM a sí mismo)
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const env = process.env
const LOG = env.AGY_STUB_LOG || path.join(os.tmpdir(), "agy_stub.log")
let mode = env.AGY_STUB_MODE || "plan2"
if (mode === "denied-then-ok") {
  const seq = env.AGY_STUB_SEQ_FILE || path.join(os.tmpdir(), "agy_stub_seq")
  if (fs.existsSync(seq)) mode = "plan2"
  else {
    fs.writeFileSync(seq, "")
    mode = "denied-command"
  }
}
const argv = process.argv.slice(2)
if (argv[0] === "models") {
  process.stderr.write("Fetching available models...\n")
  process.stdout.write(
    "gemini-3.8-flash-high\tGemini 3.8 Flash (High)\ngemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)\ngemini-3.8-flash-low\tGemini 3.8 Flash (Low)\ngemini-3.1-pro-high\tGemini 3.1 Pro (High)\nclaude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)\n",
  )
  process.exit(0)
}
let prompt = "", schema = "", conv = "", model = "", informat = ""
const args = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === "-p") prompt = argv[++i] ?? ""
  else if (a === "--input-format") informat = argv[++i] ?? ""
  else if (a === "--json-schema") schema = argv[++i] ?? ""
  else if (a === "--conversation") conv = argv[++i] ?? ""
  else if (a === "--model") model = argv[++i] ?? ""
  else args.push(a)
}
const cid = conv || "stub-conv-001"
// Como agy con --input-format stream-json: la petición llega por la entrada estándar, una línea {"event":"user","message":{"content":…}}.
if (informat === "stream-json") {
  const line = fs.readFileSync(0, "utf8").split("\n")[0]
  try {
    const m = JSON.parse(line)
    prompt = m.event === "user" ? String(m.message.content) : ""
  } catch {
    prompt = ""
  }
}
fs.appendFileSync(
  LOG,
  `CALL model=${model} conv=${conv || "new"} schema=${schema ? "yes" : "no"} about=${prompt.includes("ABOUT THIS SETUP") ? "yes" : "no"} args=[${args.join(" ")}] prompt_head=[${prompt.replace(/\n/g, " ").slice(0, 80)}]\n`,
)

const PWD = process.cwd()
const at = (name) => path.join(PWD, name)
const emit = (event) => process.stdout.write(JSON.stringify(event) + "\n")
const usage = { input_tokens: 10, output_tokens: 5, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 15 }
const step = (step_index, state, step_type, extra = {}) =>
  emit({ event: "step_update", step_update: { conversation_id: cid, step_index, state, step_type, ...extra } })
const toolStep = (step_index, state, name, parameters, output) =>
  step(step_index, state, "tool", { tool_name: name, tool_info: { name, parameters, ...(output !== undefined ? { output } : {}) } })
const result = (fields) =>
  emit({ event: "result", result: { conversation_id: cid, duration_seconds: 0.5, num_turns: 1, ...fields, usage } })

emit({ event: "init", conversation_id: cid, init: { cwd: PWD, tools: ["run_command", "view_file"], permission_mode: "request-review" } })
step(0, "DONE", "user_input")
toolStep(1, "ACTIVE", "view_file", { AbsolutePath: at("counter.py") })
toolStep(1, "DONE", "view_file", { AbsolutePath: at("counter.py") }, "15 lines")
step(2, "DONE", "agent_response", { text_delta: "Stub: he leído el fichero y sigo." })

// bucle (fase 15): relee bucle.py una y otra vez. Con SIGTERM (la parada suave del vigilante) responde como agy: result ERROR
// «interrupted» con el uso de lo hecho. Al reanudar con el aviso del vigilante (prompt «DETECTOR DE BUCLES: …»): AGY_STUB_LOOP_RESUME=ok (defecto)
// edita bucle.py y termina bien; =loop vuelve a hacer bucle.
if (mode === "loop") {
  if (conv && /^DETECTOR DE BUCLES:/m.test(prompt) && (env.AGY_STUB_LOOP_RESUME || "ok") === "ok") {
    fs.appendFileSync(at("bucle.py"), "arreglado\n")
    toolStep(3, "ACTIVE", "replace_file_content", { TargetFile: at("bucle.py") })
    result({ status: "SUCCESS", response: `STUB arreglado tras el aviso (model=${model}).` })
    process.exit(0)
  }
  let term = false
  // AGY_STUB_IGNORE_TERM=1: no atiende la parada suave y hay que pararlo en seco (como en Windows, donde no hay señales).
  process.on("SIGTERM", () => {
    if (env.AGY_STUB_IGNORE_TERM !== "1") term = true
  })
  const max = Number(env.AGY_STUB_LOOP_N || 40)
  for (let n = 0; n < max && !term; n++) {
    toolStep(n + 3, "ACTIVE", "view_file", { AbsolutePath: at("bucle.py") })
    await new Promise((r) => setTimeout(r, 50))
  }
  if (term) result({ status: "ERROR", error: "interrupted", response: "" })
  else result({ status: "SUCCESS", response: "STUB: terminé sin arreglar nada." })
  process.exit(0)
}

// se manda una señal a sí mismo (no es el timeout ni un abort del cliente): Tarea 9.
if (mode === "self-signal") {
  process.kill(process.pid, "SIGTERM")
  await new Promise((r) => setTimeout(r, 1000))
  process.exit(1)
}

// duerme antes de responder: para probar abort (Tarea 15) y el timeout máximo (Tarea 9).
if (mode === "sleep") {
  if (env.AGY_STUB_PIDFILE) fs.writeFileSync(env.AGY_STUB_PIDFILE, `${process.pid}\n`) // para que el test compruebe que muere
  await new Promise((r) => setTimeout(r, 5000))
  result({ status: "SUCCESS", response: `STUB tras dormir (model=${model}).`, duration_seconds: 5.0 })
  process.exit(0)
}

if (mode === "write") {
  const wf = env.AGY_STUB_WRITE_FILE || "nuevo.py"
  fs.appendFileSync(at(wf), 'print("stub")\n')
  toolStep(3, "ACTIVE", "write_to_file", { TargetFile: at(wf), CodeContent: 'print("stub")' })
  toolStep(3, "DONE", "write_to_file", { TargetFile: at(wf) }, `Created file ${wf}`)
}

if (mode === "denied-command") toolStep(3, "ACTIVE", "run_command", { CommandLine: "uname -a", Cwd: PWD })

if (mode === "no-result") process.exit(0)

// orchestrate SUCCESS sin structured_output (agy no respetó el schema pedido).
if (mode === "orch-no-structured") {
  result({ status: "SUCCESS", response: "Sin structured_output (stub)." })
  process.exit(0)
}

// status != SUCCESS con una línea PREGUNTA: en la respuesta (Tarea 10: sin evento `question`).
if (mode === "fail-question") {
  result({ status: "FAIL", response: "algo salió mal.\nPREGUNTA: ¿reintento?" })
  process.exit(0)
}

if (schema) {
  const structured_output =
    mode === "orch-question"
      ? // needs_user_input no vacío CON steps: los steps deben ignorarse (Tarea 13).
        {
          answer: "",
          needs_user_input: "¿qué framework de test uso?",
          deep_orchestration_reason: "",
          steps: [{ layer: "implement", level: "normal", reason: "", instruction: "Esto NO debe convertirse en plan." }],
        }
      : {
          answer: "Añadir decrement() y su test.",
          needs_user_input: "",
          deep_orchestration_reason: mode === "plan-deep-orch" ? "G2: dos esquemas de datos posibles" : "",
          steps: [
            { layer: "implement", level: "normal", reason: "", instruction: "En counter.py añade decrement(); en counter_test.py añade test_decrement." },
            { layer: "review", level: "deep", reason: "G4: concurrencia en Counter", instruction: "Revisa el diff de counter.py y counter_test.py." },
          ],
        }
  result({ status: "SUCCESS", response: "{}", duration_seconds: 1.2, structured_output })
  process.exit(0)
}

let resp = `STUB OK (model=${model}). Ficheros cambiados: ninguno (simulación).`
if (mode === "verify-fail") resp = `FAIL: 1 test falló (stub, model=${model})`
else if (mode === "question") resp = "He mirado counter.py.\nPREGUNTA: ¿borro el fichero antiguo?"
else if (mode === "denied" || mode === "denied-command") {
  const [action, display_name] = mode === "denied" ? ["write_file", "ReplaceFileContent"] : ["command", "RunCommand"]
  result({ status: "SUCCESS", response: "", denied_actions: [{ action, display_name }] })
  process.stderr.write(`jetski: no output produced — a tool required the "${action}" permission\n`)
  process.exit(0)
} else if (mode === "denied-empty") {
  result({ status: "SUCCESS", response: `STUB OK (model=${model}). Sin acciones denegadas.`, denied_actions: [] })
  process.exit(0)
}
result({ status: "SUCCESS", response: resp, duration_seconds: 0.8, num_turns: 2 })
