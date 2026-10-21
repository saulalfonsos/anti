import { tool } from "@opencode-ai/plugin"
import { runAntigravity } from "../lib/antigravity/tool-core.mjs"

// El nombre del fichero ES el nombre de la tool: `antigravity`. Toda la lógica está en
// lib/antigravity/tool-core.mjs (testeable con node --test); esto solo adapta el contexto de OpenCode.
// Ling NO elige capa ni modelo: la tool orquesta siempre (spec §4.2).
export default tool({
  description: [
    "Única vía de trabajo: pasa a Antigravity (Gemini) el mensaje del usuario tal cual. Antigravity decide los pasos,",
    "los modelos y edita el código; tú no. Uso: antigravity(prompt=<mensaje del usuario íntegro>) y después obedece la",
    "línea SIGUIENTE: de la respuesta (normalmente antigravity(step=\"next\", conversation_id=…) hasta 'Plan completado').",
    "conversation_id: el último devuelto, si el mensaje continúa una tarea. pro=true si el usuario pidió Pro (/pro, 'usa Pro').",
    "Las marcas /orquestar y /leer on|off van dentro del prompt tal cual: la tool elige el modo con ellas.",
  ].join(" "),
  args: {
    prompt: tool.schema.string().optional().describe("Mensaje del usuario, íntegro y sin resumir. Con step=\"next\" es una nota adicional (p. ej. su respuesta a una pregunta)."),
    conversation_id: tool.schema.string().optional().describe("ID devuelto por la llamada anterior de la misma tarea. Obligatorio con step=\"next\"."),
    step: tool.schema.enum(["next"]).optional().describe("\"next\": ejecuta el siguiente paso del plan guardado. Solo cuando la línea SIGUIENTE: lo indique."),
    pro: tool.schema.boolean().optional().describe("true si el usuario pidió Gemini 3.1 Pro explícitamente (/pro, 'usa Pro')."),
  },
  async execute(args, context) {
    return runAntigravity(args, {
      directory: context.directory,
      sessionID: context.sessionID,
      abort: context.abort,
      ask: (input) => context.ask(input),
      metadata: (input) => context.metadata(input),
    })
  },
})
