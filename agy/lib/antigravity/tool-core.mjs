// lib/antigravity/tool-core.mjs — núcleo de la tool `antigravity`: una llamada = una ejecución de agy con el
// modelo que dicta la política (policy.mjs), progreso en vivo (stream.mjs) y estado por conversación
// (state.mjs). No depende de OpenCode: recibe ctx {directory, sessionID, abort?, ask, metadata, env?} y
// devuelve {title, output, metadata}. Lo envuelve tools/antigravity.ts.
// Spec: docs/superpowers/specs/2026-09-14-antigravity-live-relay-design.md §4, §6.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { readChoice } from "./model-choice.mjs"
import { spawn } from "node:child_process"
import { readConfig, agyCommand, stopCommand } from "./bridge.mjs"
import { LAYERS, decide, detectPro, detectQuestion, recordOutcome, planFromStructured, emptyState, normalizeLevel, usageDelta } from "./policy.mjs"
import { splitLines, parseEvent } from "./stream.mjs"
import { loadConversation, saveConversation, bumpSessionPro, appendLog, appendEvent, gitChangedFiles, eventsPath, cacheDir, sessionFlag } from "./state.mjs"
import { parseMarks, route } from "./modes.mjs"
import { DEFAULT_WATCH, START, observe, nudge } from "./watchdog.mjs"
import { announce, installPlugin, serverFor, nodeTests } from "./leer.mjs"
import { createChatView } from "./chatview.mjs"
import { buildPrompt, openerHint, TOOLS_DIR } from "./prompting.mjs"
import { report, noResultReport, noStepsReport, fail } from "./report.mjs"
import { gitDiffFile } from "./diffs.mjs"
import { WRITE_TOOLS, mainArg } from "./tool-icons.mjs"
import { ensureViewer, openViewerOnce } from "./ui.mjs"
import { deriveRule, addAllowRule, settingsFile } from "./permissions.mjs"
import { resolveConversation, shortId } from "./tui/shortid.mjs"

export { TOOLS_DIR }
const PERMISSION = "antigravity_pro"
const RULE_PERMISSION = "antigravity_agy_rule"
const HARD_TIMEOUT_MS = 20 * 60 * 1000 // por encima del --print-timeout más largo de agy.env
const RECENT = 8
// Parada suave del vigilante (fase 14, D292): SIGTERM, y agy aún emite su `result` con el uso de lo hecho; si a los 10 s sigue vivo, SIGKILL.
const STOP_GRACE_MS = 10_000

async function bridgeConfig(env) {
  try {
    return readConfig(env)
  } catch (e) {
    throw new Error(`no puedo leer tools/agy.env: ${e.message}`)
  }
}

// Lanza agy (D326: directamente, sin bash; antes, tools/agy_bridge.sh) y entrega cada evento del stream a onEvent (con `raw` = JSON
// parseado). Resuelve siempre. `stop` (fase 15): la parada suave del vigilante, que le llega a agy directamente.
function bridgeRun({ layer, promptFile, cwd, model, conversationId, env, abort, stop, onEvent }) {
  return new Promise((resolve) => {
    const cmd = agyCommand({ cfg: readConfig(env), layer, prompt: fs.readFileSync(promptFile, "utf8"), cwd, model, conversation: conversationId })
    // El instalador oficial deja agy en ~/.local/bin (en Windows, %LOCALAPPDATA%\agy\bin), que no siempre está en el PATH.
    const extra = process.platform === "win32" ? path.join(env.LOCALAPPDATA || "", "agy", "bin") : path.join(env.HOME || os.homedir(), ".local", "bin")
    const p = spawn(cmd.bin, cmd.args, { cwd, env: { ...env, PATH: `${extra}${path.delimiter}${env.PATH ?? ""}` } })
    // D328: la petición por la entrada estándar; al cerrarla, agy termina el turno y sale.
    p.stdin?.on("error", () => {})
    p.stdin?.end(cmd.stdin)
    // D328: en Windows, parar a agy es parar su árbol entero (si no, sus órdenes y subagentes siguen vivos).
    const kill = (signal) => {
      const tree = stopCommand(p.pid, process.platform)
      if (tree && p.pid) {
        try { spawn(tree[0], tree[1], { stdio: "ignore" }).on("error", () => p.kill()) } catch { p.kill() }
        return
      }
      p.kill(signal)
    }
    let rest = "", stderr = "", result = null, init = null, timedOut = false, stopped = false, grace = null
    // Override solo para tests (agy_stub.sh modo `sleep`): el timeout real de producción es HARD_TIMEOUT_MS.
    const timeoutMs = Number(env?.AGY_HARD_TIMEOUT_MS) || HARD_TIMEOUT_MS
    const timer = setTimeout(() => { timedOut = true; kill() }, timeoutMs)
    const onAbort = () => kill()
    abort?.addEventListener("abort", onAbort)
    const onStop = () => {
      stopped = true
      kill("SIGTERM")
      grace = setTimeout(() => kill("SIGKILL"), Number(env?.AGY_STOP_GRACE_MS) || STOP_GRACE_MS)
    }
    stop?.addEventListener("abort", onStop)
    const handle = (line) => {
      if (!line.trim()) return
      try {
        const ev = parseEvent(line, cwd)
        if (!ev.error) ev.raw = JSON.parse(line)
        if (ev.init) init = ev.init
        if (ev.result) result = ev.result
        onEvent(ev)
      } catch (e) {
        stderr += `\ncallback error: ${e?.message ?? e}`
      }
    }
    p.stdout.on("data", (d) => { const s = splitLines(rest, d.toString()); rest = s.rest; s.lines.forEach(handle) })
    p.stderr.on("data", (d) => (stderr += d))
    p.on("error", (e) => (stderr += `\n${e.message}`))
    p.on("close", (code, signal) => {
      if (rest.trim()) handle(rest)
      clearTimeout(timer)
      clearTimeout(grace)
      abort?.removeEventListener("abort", onAbort)
      stop?.removeEventListener("abort", onStop)
      resolve({ result, init, stderr, code, signal, timedOut, stopped })
    })
  })
}

// Aplica la política y, si toca, el diálogo de permisos de OpenCode. Devuelve el modelo final.
async function resolveModel({ layer, level, reason, state, cfg, changed, ctx }) {
  const d = decide({ layer, level, state, cfg, changedFiles: changed })
  const why = reason || d.trigger || ""
  if (d.escalate === "pro-mode") return { model: d.model, note: "Pro (/pro)" }
  if (d.escalate === "auto") return { model: d.model, note: `Pro automático (${why})` }
  if (d.escalate !== "ask") return { model: d.model, note: "" }
  try {
    await ctx.ask({ permission: PERMISSION, patterns: [layer], always: [layer],
      metadata: { layer, reason: why, model: cfg.model.pro, trigger: d.trigger } })
    return { model: cfg.model.pro, note: `Pro autorizado (${why})` }
  } catch (e) {
    return { model: d.model, note: `Pro rechazado (${why}) → ${d.model}${e?.message ? " — " + e.message : ""}` }
  }
}

// Una ejecución de agy con progreso: título de la tool en la TUI, log en vivo, lista `progress` y registro
// de eventos (spec §5.1). Los eventos anteriores a conocer el cid se guardan y se vuelcan al llegar `init`.
// Fase 15: `raw` manda `instruction` tal cual, sin preámbulo (el aviso del vigilante al reanudar); `stop` es la parada suave y
// `onActive` recibe cada tool que empieza (lo que lee el vigilante).
async function execute({ layer, instruction, cwd, model, cid, env, ctx, progress, notes, level, pro, stepInfo, call, raw, stop, onActive, view }) {
  const promptFile = path.join(os.tmpdir(), `anti-agy-${process.pid}-${Date.now()}.txt`)
  fs.writeFileSync(promptFile, raw ? instruction : buildPrompt(layer, instruction, env, notes, openerHint(readConfig(env))))
  const short = model.replace(/^gemini-/, "")
  const paintErrors = []
  // ctx.metadata es del host (OpenCode): si lanza, no debe reventar la ejecución de agy.
  // D317: además del título y las últimas líneas, el desglose estructurado (chatview.mjs) para el chat principal.
  const paint = (s, force = false) => {
    try { ctx.metadata?.({ title: `antigravity · ${layer} · ${short} · ${s}`, metadata: { recent: progress.slice(-RECENT), ...(view ? { agy: view.snapshot({ force }) } : {}) } }) }
    catch (e) { paintErrors.push(`callback error: ${e?.message ?? e}`) }
  }
  const header = `▶ ${layer} · ${model} · ${instruction.slice(0, 200).replace(/\s+/g, " ")}`
  let logId = cid
  const pending = []
  const emit = (ev) => {
    view?.push({ t: new Date().toISOString(), call, ...ev })
    if (logId) appendEvent(logId, { call, ...ev }); else pending.push(ev)
  }
  const flush = () => { for (const ev of pending.splice(0)) appendEvent(logId, { call, ...ev }) }
  if (logId) appendLog(logId, header)
  emit({ type: "call_start", layer, model, level, pro: !!pro, step: stepInfo, session: ctx.sessionID ?? "default", cwd, instruction })
  paint("iniciando")
  let n = 0
  const tools = []   // {name, parameters} de cada tool iniciada (para derivar reglas de permisos)
  const diffs = []   // promesas de git diff en curso
  let noGit = false
  const r = await bridgeRun({ layer, promptFile, cwd, model, conversationId: cid, env, abort: ctx.abort, stop, onEvent: (ev) => {
    if (ev.init?.conversation_id && !logId) { logId = ev.init.conversation_id; appendLog(logId, header); flush() }
    if (ev.raw) emit({ type: "agy", ev: ev.raw })
    if (ev.error && logId) appendLog(logId, "(línea de agy no parseable)")
    if (ev.active) { tools.push(ev.active); onActive?.(ev.active) }
    if (ev.done && WRITE_TOOLS.has(ev.done.name)) {
      const target = mainArg(ev.done.parameters)
      if (target.kind === "path") diffs.push(gitDiffFile(cwd, target.value).then((d) => {
        if (!d.skip) emit({ type: "diff", tool: ev.done.name, ...d })
        // Solo "no hay repo" merece la nota: un fichero fuera del cwd, o un fallo del propio `git diff`,
        // no significa que falte git (spec §5.1: la nota es "sin git en <cwd>", una sola vez por llamada).
        else if (d.skip === "no-git" && !noGit) { noGit = true; emit({ type: "note", text: `sin git en ${cwd}: no hay diffs` }) }
      }).catch((e) => { try { appendLog(logId, `(diff no registrado: ${e?.message ?? e})`) } catch {} }))
    }
    if (!ev.line) return
    n++
    progress.push(ev.line)
    if (logId) appendLog(logId, ev.line)
    paint(`paso ${n} · ${ev.line}`)
  } })
  await Promise.all(diffs)
  try { fs.unlinkSync(promptFile) } catch {}
  if (ctx.abort?.aborted) emit({ type: "note", text: "abortada por el usuario" })
  else if (r.stopped) { /* parada del vigilante: la nota la pone runDirect, que sabe por qué */ }
  else if (r.timedOut) emit({ type: "note", text: "agy detenido por tiempo máximo" })
  else if (r.signal) emit({ type: "note", text: `agy terminó por señal ${r.signal}` })
  paint(r.result ? r.result.status : "sin resultado", true)
  if (paintErrors.length) r.stderr = (r.stderr ? r.stderr + "\n" : "") + paintErrors.join("\n")
  return { ...r, tools, logId, emit }
}

function notices(stderr) {
  return (stderr ?? "").split("\n").filter((l) => l.trim() && !l.startsWith("agy_bridge:")).join("\n").slice(-1500)
}

const isDenied = (result) => Array.isArray(result?.denied_actions) && result.denied_actions.length > 0

// Denegación de agy → diálogo nativo de OpenCode → regla permanente en settings.json → repetir la misma
// ejecución UNA vez (spec §6.2). Devuelve {run, deniedInfo, call, proCount}.
async function handleDenied({ run, cwd, env, ctx, state, notes, exec, call, model, proCount, cfg, sess }) {
  const actions = run.result.denied_actions
  const rule = deriveRule({ actions, recentTools: run.tools, cwd })
  const deniedInfo = { rule, outcome: "no-rule" }
  if (!rule) { run.emit({ type: "denied", actions, rule, outcome: "no-rule" }); return { run, deniedInfo, call, proCount } }
  if (typeof ctx.ask !== "function") {
    deniedInfo.outcome = "no-dialog"; run.emit({ type: "denied", actions, rule, outcome: "no-dialog" }); return { run, deniedInfo, call, proCount }
  }
  const file = settingsFile(env)
  run.emit({ type: "denied", actions, rule, outcome: "asked" })
  try {
    await ctx.ask({ permission: RULE_PERMISSION, patterns: [rule], always: [rule],
      metadata: { rule, actions, cwd, settings: file,
        note: "Se añade PERMANENTEMENTE a permissions.allow de settings.json (agy no tiene permisos por ejecución) y se repite el paso. 'Una vez' y 'siempre' hacen lo mismo." } })
  } catch {
    deniedInfo.outcome = "rejected"; notes.push(`Regla ${rule} rechazada por el usuario`)
    run.emit({ type: "denied", actions, rule, outcome: "rejected" }); return { run, deniedInfo, call, proCount }
  }
  const w = addAllowRule(file, rule)
  if (!w.added && w.reason !== "la regla ya estaba") {
    deniedInfo.outcome = "write-failed"; notes.push(`No se pudo añadir ${rule}: ${w.reason}`)
    run.emit({ type: "denied", actions, rule, outcome: "write-failed" }); return { run, deniedInfo, call, proCount }
  }
  deniedInfo.outcome = "allowed"; notes.push(`Regla añadida a settings.json: ${rule}; paso repetido`)
  run.emit({ type: "denied", actions, rule, outcome: "allowed" })
  // La ejecución denegada también fue una llamada real a agy: cierra su call_end (spec §5.1) antes de
  // repetir, con el mismo criterio que cualquier otra llamada que no avanza el paso.
  const u = usageDelta(state, run.result)
  run.emit({ type: "call_end", status: run.result.status, advanced: false, tokens: u.tokens, seconds: u.seconds, model, proCount, notes: [...notes], exit: run.code })
  run.emit({ type: "retry", reason: rule })
  if (model === cfg.model.pro) proCount = bumpSessionPro(sess, 1)   // el reintento en Pro también consume cuota
  call = ++state.calls
  const again = await exec(call)
  return { run: again, deniedInfo, call, proCount }
}

// «Lee una vez» de la sesión (D307): lo que dijo el último `/leer on|off`; sin él, el defecto de agy.env (AGY_LEER).
function currentLeer(sess, cfg) {
  const flag = sessionFlag(sess, "leer")
  return flag === undefined ? !!cfg.leer : flag
}

function leerReport(on) {
  const lines = [
    `Lee una vez: ${on ? "ACTIVADO" : "desactivado"} para esta sesión.` +
      (on ? " agy leerá y probará de una vez con el servidor anti." : " agy usará sus herramientas de siempre."),
    "SIGUIENTE: nada — cuenta el resultado al usuario.",
  ]
  return { title: `antigravity · lee una vez ${on ? "on" : "off"}`, output: lines.join("\n"), metadata: { next: "done", leer: on } }
}

// Modo directo (fase 15, D305): UNA conversación de agy con el vigilante (watchdog.mjs, réplica del medido en la fase 14). Al avisar,
// para agy con la parada suave y reanuda la MISMA conversación con el mensaje correctivo; al cortar (tercer disparo o más de
// DEFAULT_WATCH.maxCalls llamadas) termina y lo dice. Cada tramo es una llamada de la TUI (call_start/call_end), y los disparos son notas.
// Con «lee una vez» (D308), el servidor anti se instala como plugin del proyecto y el anuncio va antes del mensaje.
async function runDirect({ ctx, cfg, env, cwd, cid, state, notes, prompt, sess }) {
  state.mode = "directo"
  const view = createChatView()
  // D323: el modelo elegido con /agy manda sobre el de la config; /pro, sobre los dos.
  const model = state.pro ? cfg.model.pro : readChoice() ?? cfg.model.direct
  if (state.pro) notes.push("Pro (/pro)")
  let proCount = bumpSessionPro(sess, model === cfg.model.pro ? 1 : 0)
  let instruction = prompt
  if (currentLeer(sess, cfg)) {
    const server = serverFor({ AGY_ANTI_MCP: cfg.anti_mcp, AGY_ANTI_BUN: cfg.anti_bun }, cwd)
    if (!server) notes.push("Lee una vez está activado pero no hay servidor anti (AGY_ANTI_MCP): sigue sin él.")
    else {
      try {
        installPlugin(cwd, server)
        instruction = `${announce({ tests: nodeTests(cwd) })}\n\n${prompt}`
        notes.push("Lee una vez: activado.")
      } catch (e) {
        notes.push(`No se pudo instalar el servidor anti en ${cwd}: ${e?.message ?? e}. Sigue sin «lee una vez».`)
      }
    }
  }

  const uiEnv = { ...env, AGY_UI: env.AGY_UI ?? (cfg.ui.enabled ? "1" : "0"),
    AGY_UI_PORT: env.AGY_UI_PORT ?? cfg.ui.port, AGY_UI_OPEN: env.AGY_UI_OPEN ?? (cfg.ui.open ? "1" : "0") }
  const firstCall = !cid || !fs.existsSync(eventsPath(cid))
  const viewer = await ensureViewer({ env: uiEnv, cid })
  if (viewer?.note) notes.push(viewer.note)

  const progress = []
  let watch = START, cut = null, text = instruction, raw = false
  let call = ++state.calls
  let run
  while (true) {
    const stop = new AbortController()
    let verdict = null
    run = await execute({ view, layer: "direct", instruction: text, raw, cwd, model, cid, env, ctx, progress, notes, level: "normal", pro: state.pro, stepInfo: null, call,
      stop: stop.signal,
      onActive: (tool) => {
        if (verdict) return
        const r = observe(DEFAULT_WATCH, watch, tool)
        watch = r.state
        if (r.verdict.kind !== "seguir") { verdict = r.verdict; stop.abort() }
      } })
    cid = run.result?.conversation_id || run.init?.conversation_id || cid
    if (!verdict) break
    const what = verdict.kind === "avisar"
      ? `aviso ${verdict.fired}: ${verdict.times} veces ${verdict.call.name} sin editar`
      : verdict.reason === "llamadas" ? `corte: más de ${DEFAULT_WATCH.maxCalls} llamadas` : `corte: ${verdict.call.name} en bucle tras ${DEFAULT_WATCH.nudges} avisos`
    run.emit({ type: "note", text: `detector de bucles · ${what}` })
    progress.push(`🛑 detector de bucles · ${what}`)
    if (verdict.kind === "cortar" || ctx.abort?.aborted || !cid) { cut = verdict; break }
    // Terminó antes de que la parada llegara: se acepta tal cual.
    if (run.result?.status === "SUCCESS") break
    const u = usageDelta(state, run.result)
    run.emit({ type: "call_end", status: run.result?.status ?? "STOPPED", advanced: false, tokens: u.tokens, seconds: u.seconds, model, proCount, notes: [...notes], exit: run.code })
    if (model === cfg.model.pro) proCount = bumpSessionPro(sess, 1)
    call = ++state.calls
    text = nudge(verdict)
    raw = true
  }

  let deniedInfo = null
  let eventNotesFrom = 0
  if (run.result && isDenied(run.result)) {
    const exec = (c) => execute({ view, layer: "direct", instruction: text, raw, cwd, model, cid, env, ctx, progress, notes, level: "normal", pro: state.pro, stepInfo: null, call: c })
    const callBefore = call
    const h = await handleDenied({ run, cwd, env, ctx, state, notes, exec, call, model, proCount, cfg, sess })
    run = h.run; deniedInfo = h.deniedInfo; call = h.call; proCount = h.proCount
    if (h.call !== callBefore) eventNotesFrom = notes.length
    cid = run.result?.conversation_id || cid
    if (deniedInfo.outcome === "allowed" && isDenied(run.result)) {
      run.emit({ type: "denied", actions: run.result.denied_actions, rule: deniedInfo.rule, outcome: "retry-denied" })
    }
  }

  const base = { cid, layer: "direct", level: "normal", model, stepInfo: null, proCount, notes, progress, notices: notices(run.stderr), exit: run.code,
    hasPlan: false, wasStep: false, cwd, viewerUrl: viewer?.url ?? null }
  const viewerFor = (id) => (viewer?.url && id) ? `${viewer.url.replace(/\/#.*$/, "")}/#${id}` : null
  const watchInfo = { disparos: watch.fired, corte: cut ? cut.reason : null, llamadas: watch.calls }
  if (!run.result) {
    run.emit({ type: "call_end", status: "NO_RESULT", advanced: false, tokens: null, seconds: null, model, proCount, notes, exit: run.code })
    if (cid) saveConversation(cid, state)
    openViewerOnce({ env: uiEnv, sessionID: ctx.sessionID, url: viewerFor(cid), opener: ctx.openBrowser })
    const out = cut ? report({ ...base, result: { status: "STOPPED" }, status: "STOPPED", usage: null, denied: false, deniedInfo: null, question: null, advanced: false,
      plan: [], next: 0, viewer: firstCall ? viewerFor(cid) : null, watch: watchInfo }) : noResultReport({ ...base, viewer: firstCall ? viewerFor(cid) : null })
    out.metadata.viewer = viewerFor(cid)
    // También aquí: en Windows el corte del vigilante es una parada en seco (taskkill) y agy no llega a emitir su `result`.
    out.metadata.watch = watchInfo
    out.metadata.agy = view.snapshot({ force: true })
    return out
  }
  const result = run.result
  const usage = usageDelta(state, result)
  const status = result.status ?? "UNKNOWN"
  const summary = `■ ${status} · +${usage.tokens.delta} tokens (conv ${usage.tokens.total}) · +${Math.round(usage.seconds.delta)}s`
  progress.push(summary); if (cid) appendLog(cid, summary)
  const denied = isDenied(result)
  const question = detectQuestion(result.response)
  run.emit({ type: "call_end", status, advanced: false, tokens: usage.tokens, seconds: usage.seconds, model, proCount, notes: notes.slice(eventNotesFrom), exit: run.code })
  if (cid) saveConversation(cid, state)
  openViewerOnce({ env: uiEnv, sessionID: ctx.sessionID, url: viewerFor(cid), opener: ctx.openBrowser })
  const out = report({ ...base, result, status, usage, denied, deniedInfo, question, advanced: false, plan: [], next: 0,
    viewer: firstCall ? viewerFor(cid) : null, watch: watchInfo })
  out.metadata.viewer = viewerFor(cid)
  out.metadata.watch = watchInfo
  out.metadata.agy = view.snapshot({ force: true })
  return out
}

export async function runAntigravity(args, ctx) {
  const cwd = ctx.directory
  const env = { ...process.env, ...(ctx.env ?? {}) }
  const isNext = args.step === "next"
  const layerArg = args.layer ?? "orchestrate"   // Ling ya no elige capa (spec §4.2)
  if (isNext && !args.conversation_id) return fail('step="next" requiere conversation_id (el que devolvió la llamada anterior).')
  if (!isNext && !args.prompt) return fail('Hace falta prompt (la petición del usuario íntegra), o bien step="next" con conversation_id.')
  if (!isNext && !LAYERS.includes(layerArg)) return fail(`layer inválida: ${layerArg}. Válidas: ${LAYERS.join(", ")}.`)

  let cfg
  try { cfg = await bridgeConfig(env) } catch (e) { return fail(e.message) }

  const notes = []
  let cid = args.conversation_id || null
  if (cid) {
    const r = resolveConversation(cid, cacheDir())
    if (r.ambiguous) return fail(`conversation_id "${cid}" es ambiguo: ${r.ambiguous.map((c) => `${c} (${shortId(c, r.ambiguous)})`).join(", ")}. Usa más caracteres.`)
    if (r.missing && isNext) return fail(`no existe ninguna conversación que empiece por "${cid}".`)
    // Sin `next`, un conversation_id que todavía no existe es legítimo: así se ARRANCA una conversación con
    // un id elegido por quien llama (es lo que hacen los tests y lo que permite reanudar por id tras limpiar
    // la caché). Revisión final M4 proponía tratarlo como error; no se aplica: rompería ese camino. El riesgo
    // que señala (un prefijo corto mal escrito crea un "agente fantasma" en la caché) exige que el id haya
    // dejado de existir entre dos llamadas —limpiar la caché con una conversación viva en el contexto de
    // Ling, que sigue copiando el `SIGUIENTE:` del informe anterior—. Que ese fantasma no secuestre además
    // a la conversación real lo evita resolveConversation (shortid.mjs, M4′).
    if (r.cid) cid = r.cid
  }
  const state = cid ? loadConversation(cid) : { ...emptyState(), corrupt: false }
  if (state.corrupt) notes.push("El estado guardado de esta conversación estaba corrupto y se ha reiniciado.")
  // Fase 15: las marcas `/orquestar` y `/leer on|off` (en cualquier parte del texto) eligen el modo y se quitan antes de seguir.
  const marks = parseMarks(args.prompt)
  const sess = ctx.sessionID ?? "default"
  if (marks.leer === "on" || marks.leer === "off") sessionFlag(sess, "leer", marks.leer === "on")
  const mode = route({ isNext, layer: args.layer, marks, state })
  if (mode === "solo-marcas") return leerReport(currentLeer(sess, cfg))
  const det = detectPro(marks.prompt)
  if (!isNext && !det.prompt.trim()) return fail("Hace falta la petición del usuario además de las marcas (/orquestar, /leer, /pro).")
  if ((args.pro || det.pro) && !state.pro) { state.pro = true; notes.push("Modo Pro activado para esta tarea (/pro).") }
  if (mode === "directo") return runDirect({ ctx, cfg, env, cwd, cid, state, notes, prompt: det.prompt, sess })
  state.mode = "orquestador"

  let layer, level, reason, instruction, stepInfo = null
  if (isNext) {
    const step = state.plan[state.next]
    if (!step) return noStepsReport({ cid, hasPlan: state.plan.length > 0, notes, proCount: bumpSessionPro(ctx.sessionID ?? "default", 0) })
    layer = step.layer; level = step.level; reason = step.reason
    instruction = step.instruction + (det.prompt.trim() ? `\n\nNota adicional del usuario: ${det.prompt.trim()}` : "")
    stepInfo = { k: state.next + 1, n: state.plan.length }
  } else {
    layer = layerArg; level = normalizeLevel(args.level); reason = args.reason ?? ""; instruction = det.prompt
  }

  const changed = layer === "review" ? gitChangedFiles(cwd).filter((f) => !state.baseline_files.includes(f)).length : 0
  let { model, note } = await resolveModel({ layer, level, reason, state, cfg, changed, ctx })
  if (note) notes.push(note)
  // Se cuenta el gasto de Pro en cuanto se decide usarlo, no solo si la llamada acaba en éxito:
  // un intento en Pro que falla (timeout, sin result) igual consumió cuota real.
  let proCount = bumpSessionPro(sess, model === cfg.model.pro ? 1 : 0)

  // Visor en vivo (agy-ui): agy.env pone los defectos; el entorno del proceso gana (tests, override manual).
  const uiEnv = { ...env, AGY_UI: env.AGY_UI ?? (cfg.ui.enabled ? "1" : "0"),
    AGY_UI_PORT: env.AGY_UI_PORT ?? cfg.ui.port, AGY_UI_OPEN: env.AGY_UI_OPEN ?? (cfg.ui.open ? "1" : "0") }
  const firstCall = !cid || !fs.existsSync(eventsPath(cid))
  // ensureViewer solo arranca/reutiliza el servidor y calcula la URL; el navegador se abre explícitamente
  // más abajo con openViewerOnce, una vez que el cid es definitivo (spec §5.3).
  const viewer = await ensureViewer({ env: uiEnv, cid })
  if (viewer?.note) notes.push(viewer.note)

  const progress = []
  const view = createChatView()
  let call = ++state.calls
  let run = await execute({ view, layer, instruction, cwd, model, cid, env, ctx, progress, notes, level, pro: state.pro, stepInfo, call })
  cid = run.result?.conversation_id || run.init?.conversation_id || cid

  // La orquestación en Flash pide Pro para planificar (deep_orchestration_reason): política + repetición.
  const so = run.result?.structured_output
  if (layer === "orchestrate" && run.result?.status === "SUCCESS" && so?.deep_orchestration_reason && model !== cfg.model.pro) {
    const r2 = await resolveModel({ layer, level: "deep", reason: so.deep_orchestration_reason, state, cfg, changed: 0, ctx })
    notes.push(`Orquestación: ${r2.note}`)
    if (r2.model === cfg.model.pro) {
      const u = usageDelta(state, run.result)   // la planificación en Flash también cuenta en el acumulado
      run.emit({ type: "call_end", status: run.result.status, advanced: false, tokens: u.tokens, seconds: u.seconds, model, proCount, notes: [...notes], exit: run.code })
      model = r2.model
      proCount = bumpSessionPro(sess, 1)
      call = ++state.calls
      run = await execute({ view, layer, instruction, cwd, model, cid, env, ctx, progress, notes, level, pro: state.pro, stepInfo, call })
      cid = run.result?.conversation_id || cid
    } else notes.push("Se usa el plan de Flash.")
  }

  let deniedInfo = null
  let eventNotesFrom = 0   // el call_end del reintento no repite las notas ya emitidas en el call_end de la denegada
  if (run.result && isDenied(run.result)) {
    const exec = (c) => execute({ view, layer, instruction, cwd, model, cid, env, ctx, progress, notes, level, pro: state.pro, stepInfo, call: c })
    const callBefore = call
    const h = await handleDenied({ run, cwd, env, ctx, state, notes, exec, call, model, proCount, cfg, sess })
    run = h.run; deniedInfo = h.deniedInfo; call = h.call; proCount = h.proCount
    if (h.call !== callBefore) eventNotesFrom = notes.length
    cid = run.result?.conversation_id || cid
    // La regla se añadió y se repitió el paso (spec §6.2), pero agy volvió a denegar: sin este evento el
    // visor solo ve el `denied:allowed` (banner limpio) seguido de un call_end con status SUCCESS y lo
    // pinta como éxito. El paso NO se ha hecho: hay que decirlo explícitamente.
    if (deniedInfo.outcome === "allowed" && isDenied(run.result)) {
      run.emit({ type: "denied", actions: run.result.denied_actions, rule: deniedInfo.rule, outcome: "retry-denied" })
    }
  }

  const base = { cid, layer, level, model, stepInfo, proCount, notes, progress, notices: notices(run.stderr), exit: run.code,
    hasPlan: state.plan.length > 0, wasStep: isNext, cwd, viewerUrl: viewer?.url ?? null }
  // Sin id no hay conversación que enseñar: null (nunca la url a secas, que aterrizaría en la última
  // conversación del visor — p. ej. si agy no llegó ni a arrancar y nunca hubo conversation_id).
  const viewerFor = (id) => (viewer?.url && id) ? `${viewer.url.replace(/\/#.*$/, "")}/#${id}` : null
  if (!run.result) {
    run.emit({ type: "call_end", status: "NO_RESULT", advanced: false, tokens: null, seconds: null, model, proCount, notes, exit: run.code })
    if (cid) saveConversation(cid, state)
    openViewerOnce({ env: uiEnv, sessionID: ctx.sessionID, url: viewerFor(cid), opener: ctx.openBrowser })
    const out = noResultReport({ ...base, viewer: firstCall ? viewerFor(cid) : null })
    out.metadata.viewer = viewerFor(cid)
    out.metadata.agy = view.snapshot({ force: true })
    return out
  }

  const result = run.result
  const usage = usageDelta(state, result)
  const status = result.status ?? "UNKNOWN"
  const summary = `■ ${status} · +${usage.tokens.delta} tokens (conv ${usage.tokens.total}) · +${Math.round(usage.seconds.delta)}s`
  progress.push(summary); if (cid) appendLog(cid, summary)
  const denied = isDenied(result)
  const question = layer === "orchestrate"
    ? (result.structured_output?.needs_user_input?.trim() || null)
    : detectQuestion(result.response)
  recordOutcome(state, layer, result.response)
  // Solo se sustituye el plan guardado cuando de verdad hay uno nuevo que poner en su lugar: sin
  // structured_output (agy no respetó el schema) o con needs_user_input (el orquestador todavía está
  // preguntando, los `steps` que venga acompañando no son un plan aceptado) se conserva el anterior.
  const replacesPlan = layer === "orchestrate" && status === "SUCCESS" && !!result.structured_output && !question
  if (replacesPlan) {
    state.plan = planFromStructured(result.structured_output)
    state.next = 0
    state.failures = { verify: 0, review: 0 }
    state.baseline_files = gitChangedFiles(cwd)
  }
  const advanced = isNext && status === "SUCCESS" && !denied && !question
  if (advanced) state.next++
  if (replacesPlan) run.emit({ type: "plan", steps: state.plan, answer: result.structured_output?.answer ?? "" })
  if (question && status === "SUCCESS") run.emit({ type: "question", text: question, layer, step: stepInfo })
  run.emit({ type: "call_end", status, advanced, tokens: usage.tokens, seconds: usage.seconds, model, proCount, notes: notes.slice(eventNotesFrom), exit: run.code })
  if (cid) saveConversation(cid, state)

  openViewerOnce({ env: uiEnv, sessionID: ctx.sessionID, url: viewerFor(cid), opener: ctx.openBrowser })
  const out = report({ ...base, cid, hasPlan: state.plan.length > 0, result, status, usage, denied, deniedInfo, question, advanced,
    plan: state.plan, next: state.next, viewer: firstCall ? viewerFor(cid) : null })
  out.metadata.viewer = viewerFor(cid)
  out.metadata.agy = view.snapshot({ force: true })
  return out
}
