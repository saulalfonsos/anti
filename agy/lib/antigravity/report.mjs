// lib/antigravity/report.mjs — formatea la salida de la tool para Ling. Puro (sin I/O).
// Toda salida acaba en dos líneas fijas: el pie `[agy: …]` y `SIGUIENTE: …` (spec §4.2). Ling copia SIGUIENTE.
import { shortId } from "./tui/shortid.mjs"
export const REGISTRO = 30

export function fail(msg) {
  return { title: "antigravity · error", output: `${msg}\n${nextLine({ kind: "problem", cid: null })}`, metadata: { error: true, next: "problem" } }
}

export function trailer({ layer, level, model, status, usage, proCount, exit, cid }) {
  const cost = usage
    ? `tokens=+${usage.tokens.delta} (conv ${usage.tokens.total}) t=+${Math.round(usage.seconds.delta)}s (conv ${Math.round(usage.seconds.total)}s)`
    : `exit=${exit}`
  return `[agy: layer=${layer} conv=${cid ? shortId(cid) : "?"} level=${level} model=${model} status=${status} ${cost} · Pro esta sesión: ${proCount}]`
}

export function nextLine({ kind, cid, question, wasStep }) {
  const step = `antigravity(step="next", conversation_id="${cid}")`
  const again = cid ? `antigravity(prompt=<la petición de nuevo>, conversation_id="${cid}")` : "antigravity(prompt=<la petición de nuevo>)"
  const answer = cid ? `antigravity(prompt=<respuesta>, conversation_id="${cid}")` : "antigravity(prompt=<respuesta>)"
  // Tanto aquí como en "problem" (default) la decisión mira la llamada QUE SE HIZO (wasStep =
  // step="next"), no si hay un plan guardado: un re-plan a mitad de tarea (prompt=… sobre una
  // conversación con plan) que pregunta o falla repite con prompt, no con el step del plan viejo.
  switch (kind) {
    case "step": return `SIGUIENTE: ${step}`
    case "done": return "SIGUIENTE: nada — cuenta el resultado al usuario."
    case "question": return `SIGUIENTE: pregunta al usuario: "${question}" y, con su respuesta, llama a ` +
      (wasStep && cid ? `antigravity(step="next", conversation_id="${cid}", prompt=<respuesta>)` : answer)
    default: return `SIGUIENTE: cuéntale al usuario el problema tal cual y pregúntale cómo seguir; para repetir llama a ${wasStep && cid ? step : again}`
  }
}

// r: {cid, layer, level, model, stepInfo, proCount, notes, progress, notices, exit, result, status, usage,
//     denied, deniedInfo?, question, advanced, plan, next, cwd, wasStep, viewer?}
export function report(r) {
  const { cid, layer, level, model, stepInfo, proCount, notes, progress, notices, exit, result, status, usage,
    denied, deniedInfo, question, advanced, plan, next, cwd, viewer, wasStep, watch } = r
  const lines = [`conversation_id: ${cid}`]
  if (viewer) lines.push(`Visor: ${viewer}`)
  if (stepInfo) lines.push(`Paso ${stepInfo.k}/${stepInfo.n} · ${layer} (${level}) · ${model}`)
  let kind = "done"
  if (status !== "SUCCESS" && !watch?.corte) {
    lines.push(`ESTADO: ${status}. ${result.error ?? ""}`.trim())
    if (status === "WAITING") lines.push("Antigravity se quedó esperando una respuesta que en modo headless nadie puede dar: pregunta al usuario y reintenta con el mismo conversation_id.")
    lines.push("NO des la tarea por hecha.")
    kind = "problem"
  }
  if (layer === "orchestrate" && status === "SUCCESS") {
    const s = result.structured_output
    if (!s) { lines.push("El orquestador no devolvió salida estructurada. Respuesta libre:", result.response ?? ""); kind = "problem" }
    else if (question) { lines.push(`PREGUNTA PARA EL USUARIO (no hagas nada más hasta que responda): ${question}`); kind = "question" }
    else if (!plan.length) lines.push(`RESPUESTA (no hace falta tocar código):\n${s.answer ?? ""}`)
    else {
      lines.push(`PLAN (${plan.length} pasos) — ${s.answer ?? ""}`)
      plan.forEach((p, i) => lines.push(`${i + 1}. [${p.layer} · ${p.level}${p.reason ? " · " + p.reason : ""}] ${p.instruction}`))
      lines.push(`Ejecuta el paso 1 con: antigravity(step="next", conversation_id="${cid}") y repite la misma llamada hasta que diga "Plan completado". Cuenta al usuario el resultado de cada paso.`)
      kind = "step"
    }
  } else {
    if (result.response?.trim()) lines.push(result.response.trim())
    if (question && status === "SUCCESS") { lines.push(`PREGUNTA PARA EL USUARIO (no hagas nada más hasta que responda): ${question}`); kind = "question" }
  }
  if (stepInfo) {
    if (!advanced) {
      lines.push(`El paso ${stepInfo.k} NO se ha consumido: al llamar de nuevo a antigravity(step="next", conversation_id="${cid}") se repetirá.`)
      if (kind !== "question") kind = "problem"
    } else {
      const left = plan.length - next
      lines.push(left > 0 ? `Quedan ${left} pasos: llama a antigravity(step="next", conversation_id="${cid}").` : "Plan completado.")
      kind = left > 0 ? "step" : "done"
    }
  }
  // Modo directo (fase 15, D311): el vigilante cortó un bucle; Ling no reintenta por su cuenta.
  if (watch?.corte) {
    lines.push(watch.corte === "llamadas"
      ? `DETECTOR DE BUCLES: agy pasó de ${watch.llamadas - 1} llamadas a herramientas sin terminar y lo he cortado. NO des la tarea por hecha.`
      : `DETECTOR DE BUCLES: agy se quedó repitiendo la misma llamada sin editar nada; le avisé ${watch.disparos - 1} veces y lo he cortado tras ${watch.llamadas} llamadas. NO des la tarea por hecha.`)
    kind = "problem"
  } else if (watch?.disparos) {
    lines.push(`Detector de bucles: agy se atascó y le avisé ${watch.disparos === 1 ? "una vez" : `${watch.disparos} veces`}; siguió y terminó.`)
  }
  if (denied) {
    // En headless una denegación termina el turno sin respuesta (verificado agy 1.2.2): hay que dar la regla exacta.
    const acts = JSON.stringify(result.denied_actions)
    lines.push(`ACCIONES DENEGADAS POR POLÍTICA: ${acts}`)
    if (deniedInfo?.outcome === "allowed") {
      // La regla ya se añadió a settings.json y el reintento (§6.2) volvió a salir denegado: decirle al
      // usuario que la añada a mano sería falso y confuso — ya está ahí, el problema es otro.
      lines.push(`La regla ${deniedInfo.rule} ya está en settings.json y agy sigue denegando: revisa la regla o el comando.`)
    } else {
      if (deniedInfo?.rule) {
        const how = { rejected: "el usuario rechazó añadirla", "write-failed": "no se pudo escribir settings.json", "no-rule": "sin regla derivable", "no-dialog": "sin diálogo disponible para confirmarla" }[deniedInfo.outcome] ?? deniedInfo.outcome
        lines.push(`Permisos: se propuso la regla ${deniedInfo.rule} (${how}).`)
      }
      const rules = []
      if (/write_file|read_file/.test(acts)) rules.push(`write_file(${cwd})`)
      if (/"command"/.test(acts)) rules.push("command(<prefijo del comando>) (o command(*) si aceptas cualquier comando)")
      lines.push(`Antigravity paró aquí y NO hizo el trabajo. Dile al usuario que añada en ~/.gemini/antigravity-cli/settings.json → permissions.allow: ${rules.join(" · ") || "la regla que indique el aviso"} y que repita la petición.`)
    }
    kind = "problem"
  }
  if (notices) lines.push(`Avisos de agy:\n${notices}`)
  // Modo directo (D323): el Registro y el pie técnico no llegan al traductor, que los copiaba al usuario; el chat ya enseña todo lo
  // que hizo agy, y el pie queda en los metadatos.
  const direct = layer === "direct"
  if (progress.length && !direct) lines.push(`Registro (últimos ${Math.min(progress.length, REGISTRO)} de ${progress.length} eventos):\n${progress.slice(-REGISTRO).join("\n")}`)
  if (notes.length) lines.push(`Notas: ${notes.join(" · ")}`)
  const foot = trailer({ layer, level, model, status, usage, proCount, exit, cid })
  if (!direct) lines.push(foot)
  lines.push(nextLine({ kind, cid, question, wasStep }))
  return { title: `antigravity · ${layer} · ${status}`, output: lines.join("\n"),
    metadata: { layer, level, model, conversation_id: cid, status, exit, pro_calls: proCount, next: kind, viewer: viewer ?? null, trailer: foot } }
}

export function noResultReport(b) {
  const { cid, layer, level, model, proCount, notices, progress, exit, wasStep, viewer } = b
  const out = [`conversation_id: ${cid ?? "(desconocido)"}`]
  if (viewer) out.push(`Visor: ${viewer}`)
  out.push(`antigravity(${layer}) FALLÓ (exit ${exit}): agy no devolvió el evento result (timeout, abort o agy no autenticado).`)
  if (notices) out.push(`stderr:\n${notices}`)
  if (progress.length && layer !== "direct") out.push(`Registro:\n${progress.slice(-REGISTRO).join("\n")}`)
  out.push("Revisa que `agy` esté autenticado (ejecuta `agy` interactivo una vez). NO des la tarea por hecha.")
  if (layer !== "direct") out.push(trailer({ layer, level, model, status: "NO_RESULT", usage: null, proCount, exit, cid }))
  out.push(nextLine({ kind: "problem", cid, wasStep }))
  return { title: `antigravity · ${layer} · sin respuesta`, output: out.join("\n"),
    metadata: { layer, level, model, conversation_id: cid, exit, pro_calls: proCount, next: "problem", viewer: viewer ?? null } }
}

export function noStepsReport({ cid, hasPlan, notes = [], proCount = 0 }) {
  const lines = [
    `conversation_id: ${cid}`,
    `No hay pasos pendientes en esta conversación (plan ${hasPlan ? "completado" : "inexistente"}). Para una tarea nueva llama a antigravity(prompt=…, conversation_id="${cid}").`,
  ]
  if (notes.length) lines.push(`Notas: ${notes.join(" · ")}`)
  lines.push(`[agy: step=next conv=${cid ? shortId(cid) : "?"} status=NO_STEPS · Pro esta sesión: ${proCount}]`)
  lines.push("SIGUIENTE: nada — cuenta el resultado al usuario.")
  return { title: "antigravity · sin pasos", output: lines.join("\n"), metadata: { conversation_id: cid, next: "done" } }
}
