// lib/antigravity/modes.mjs — los dos modos de anti (fase 15). Puro.
//   · directo (por defecto, D305): el mensaje es UNA conversación de agy vigilada (tool-core.mjs#runDirect).
//   · orquestador (D304): capas, plan y step="next" (tool-core.mjs#runAntigravity de siempre). Se pide con `/orquestar` en CUALQUIER
//     parte del mensaje; la continuación de una conversación sigue el modo con que empezó (D306).
// `/leer on|off` (D307), también en cualquier parte, cambia «lee una vez» para la sesión; `/leer` solo, el estado. Las marcas se quitan
// del texto antes de mandarlo a agy. Una marca es la palabra entera (precedida de inicio o espacio): `src/orquestar.ts` no cuenta.
const ORQUESTAR = /(^|\s)\/orquestar(?=$|\s|[.,;:!?])/gi
const LEER = /(^|\s)\/leer(?:[ \t]+(on|off))?(?=$|\s|[.,;:!?])/gi

export function parseMarks(prompt) {
  const text = String(prompt ?? "")
  const orquestar = ORQUESTAR.test(text)
  ORQUESTAR.lastIndex = 0
  let leer = null
  for (const match of text.matchAll(LEER)) leer = match[2] ? match[2].toLowerCase() : "estado"
  const cleaned = text.replace(ORQUESTAR, "$1").replace(LEER, "$1")
  // Solo se recompone el espacio donde se quitó una marca: el resto del texto (saltos de línea, sangrías) pasa tal cual.
  const touched = orquestar || leer !== null
  return { orquestar, leer, prompt: touched ? cleaned.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").trim() : text }
}

// state: el de la conversación (state.mjs#loadConversation). Las guardadas antes de esta fase no tienen `mode`: con plan, eran del
// orquestador.
// `layer`: una capa explícita (la pasan los tests y quien llama a la tool a mano; Ling ya no elige capa) es el orquestador.
export function route({ isNext, layer, marks, state }) {
  if (isNext || layer !== undefined || marks.orquestar) return "orquestador"
  if (state.mode === "orquestador" || (state.mode === undefined && state.plan.length > 0)) return "orquestador"
  if (marks.leer !== null && marks.prompt.trim() === "") return "solo-marcas"
  return "directo"
}
