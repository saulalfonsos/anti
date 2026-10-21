// lib/antigravity/prompting.mjs — preámbulos por rol y construcción del prompt que recibe agy.
// Solo lee ficheros de tools/ (escalation.md, about.md). Spec §4.4, §6.1.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const TOOLS_DIR = path.resolve(HERE, "..", "..", "tools")
const ESCALATION = path.join(TOOLS_DIR, "escalation.md")
const ABOUT = path.join(TOOLS_DIR, "about.md")
export const ESCALATION_MISSING_NOTE =
  "escalation.md no se pudo leer: el orquestador corrió SIN las reglas de escalada (G1-G5 no se aplicarán salvo /pro)."
export const ABOUT_MISSING_NOTE =
  "about.md no se pudo leer: el orquestador no conoce este sistema y responderá a preguntas sobre él sin datos."

const COMMON =
  "Reply in Spanish. Be concrete: file paths, what changed, how you checked it. " +
  "If a command is denied by policy, do not work around it: say exactly which command you needed. " +
  "If you need a decision from the user before you can continue, stop and end your reply with exactly one line: " +
  "`PREGUNTA: <the question, in Spanish>`."

export const PREAMBLE = {
  // Modo directo (fase 15, D305): una sola conversación que hace todo el trabajo, como el brazo medido de la fase 14; solo las
  // convenciones comunes (idioma, concreción, denegaciones y la línea PREGUNTA:).
  direct: COMMON,
  orchestrate:
    "You are the ORCHESTRATOR for this workspace. Read whatever you need; do NOT modify files. " +
    "Decide the minimal ordered sequence of steps to satisfy the request. Layers: architect (deep design, read-only), " +
    "research (analysis, read-only), implement (write code), fix (small correction), review (find problems, read-only), " +
    "verify (run tests/build/lint and judge PASS/FAIL). Every step runs later in THIS same conversation but by a different " +
    "model, so each instruction must be self-contained: exact paths, exact change, acceptance criteria. Typical shapes: " +
    "small change → implement, verify; non-trivial change → architect, implement, review, fix, verify. Use as few steps " +
    "as possible. Set `level` for every step following the escalation rules below (default: normal) and a `reason` when " +
    "deep. If the request is a question with no code change (including greetings or questions about this setup), answer " +
    "it fully in `answer` and leave `steps` empty. If something essential is ambiguous, set `needs_user_input` and leave " +
    "`steps` empty. Write `answer` and all instructions in Spanish.",
  architect:
    "You are the ARCHITECT. Do NOT modify files. Produce a concrete design: files to touch, interfaces, data flow, " +
    "trade-offs considered and the decision, risks, and an ordered implementation plan another model can execute. " + COMMON,
  research:
    "You are the RESEARCHER. Do NOT modify files. Investigate the question in this workspace (and the web if allowed) " +
    "and report findings with evidence (paths, line numbers, command output). End with a clear conclusion. " + COMMON,
  implement:
    "You are the IMPLEMENTER. Edit files in this workspace directly to complete the task. Run the relevant tests " +
    "if they exist. End with: files changed, what changed, how you verified it, anything left undone. " + COMMON,
  fix:
    "You are the FIXER. Apply exactly the correction requested with the minimal diff; do not refactor or widen scope. " +
    "Run the relevant tests if they exist. End with: files changed and how you verified it. " + COMMON,
  review:
    "You are the REVIEWER. Do NOT modify files. Review the current changes in this workspace (git diff / recent edits) " +
    "against the request. Report findings ordered by severity, each with path:line, why it is a problem, and the concrete " +
    "fix. End with a verdict line: APPROVE, or NEEDS_FIX followed by the numbered list of fixes. " + COMMON,
  verify:
    "You are the VERIFIER. Run the project's tests, build and linters that are relevant to the change, and check the " +
    "result satisfies the request. Do NOT fix anything. Report PASS or FAIL on its own line, with the evidence " +
    "(commands run and their output). " + COMMON,
}

function include(file, note, notes) {
  try { return "\n\n" + fs.readFileSync(file, "utf8") }
  catch { if (notes && !notes.includes(note)) notes.push(note); return "" }
}

// D327: lo que agy lanza como tarea de fondo (servidores, juegos, apps) muere cuando termina la conversación. Las capas que ejecutan
// órdenes aprenden a abrir eso con `anti-mcp abrir`, que lo deja en su propia ventana de terminal, fuera de agy.
const RUNS = new Set(["direct", "implement", "fix", "verify"])
const quote = (s) => (/^[\w./:\\-]+$/.test(s) ? s : `"${s}"`)
export function openerHint(cfg, platform = process.platform) {
  const entry = cfg?.anti_mcp
  if (!entry) return ""
  const cmd = `${entry.endsWith(".ts") ? `${quote(cfg.anti_bun || "bun")} ${quote(entry)}` : quote(entry)} abrir --`
  return (
    "Anything the user wants to keep running or open after you finish (a dev server, a game, a GUI app, a watcher) dies when this " +
    "conversation ends if you start it yourself, even in the background. Start it with exactly: `" + cmd + " <command>` from the " +
    "project directory: it opens the command in its own terminal window that stays open. Do not start it as a background task, " +
    "do not wait for it and do not stop it at the end; just tell the user it is open." +
    (platform === "win32" ? " If your shell is PowerShell, prefix that line with `& `." : "")
  )
}

export function buildPrompt(layer, instruction, env, notes, opener = "") {
  let pre = PREAMBLE[layer]
  if (opener && RUNS.has(layer)) pre += ` ${opener}`
  if (layer === "orchestrate") {
    pre += include(env?.AGY_ESCALATION_FILE || ESCALATION, ESCALATION_MISSING_NOTE, notes)
    pre += include(env?.AGY_ABOUT_FILE || ABOUT, ABOUT_MISSING_NOTE, notes)
  }
  return `${pre}\n\n--- REQUEST ---\n${instruction}\n`
}
