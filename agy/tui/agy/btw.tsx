/** @jsxImportSource @opentui/solid */
// tui/agy/btw.tsx — Adapter: un hilo /btw por agente = una sesión hija de OpenCode con el agente `btw`. La
// conversación real (padre) no recibe nada. Es el ÚNICO módulo que sabe que "un hilo btw" es una sesión.
// (.tsx y no .ts: cualquier módulo que importe solid-js lleva el pragma @jsxImportSource, aunque como aquí
// no haya JSX — createSignal basta, ver store.tsx.)
//
// Formas del SDK v2 verificadas en ~/src/opencode/packages/sdk/js/src/v2/gen/{types,sdk}.gen.ts — pisan el
// borrador de la tarea, que traía `{path:{id}, body:{...}}` (esa forma es de v1):
//   - client.session.create({ parentID, title }) — parámetros PLANOS (no path/body anidados). Responde
//     { data?: Session, error? } (id en data.id).
//   - client.session.promptAsync({ sessionID, agent, system, parts }) — responde de inmediato (204 sin
//     cuerpo: SessionPromptAsyncResponses = { 204: void }); el texto llega por eventos, no por el valor de
//     retorno.
//   - Ninguna llamada lanza por defecto: error-interceptor.ts sólo envuelve en Error cuando el caller pide
//     `throwOnError: true`, que aquí no se pide — un 4xx/5xx vuelve como `.error` en la respuesta, no como
//     excepción. Por eso cada llamada comprueba `.error` explícitamente además del try/catch.
//   - EventMessagePartUpdated.properties = { sessionID, part, time }; Part NO lleva `role` (eso vive en el
//     Message, no en la Part).
//   - EventMessagePartDelta.properties = { sessionID, messageID, partID, field, delta } — respaldo por si el
//     host de turno sólo entrega deltas y no partes completas.
//   - EventMessageUpdated.properties = { sessionID, info: Message } — info.role/info.time.completed marcan
//     el fin del turno; info.error (mismo union que EventSessionError) lleva el motivo si el turno falló.
//   - api.state.session.messages(sessionID) y api.state.part(messageID) (TuiState, tui.d.ts) son la fuente
//     de verdad síncrona del host: TODO se deriva de ahí — ver rebuildFromState() más abajo.
//
// Fix round 1 (revisión del controlador sobre 6b388ce), I1: la primera versión decidía "la respuesta" con
// una heurística de "último mensaje assistant en la sesión", buscada de forma independiente del turno en
// curso. Con una 2ª/3ª pregunta en el mismo hilo eso reencontraba el assistant de la pregunta ANTERIOR (ya
// completo) antes de que el host hubiera registrado el nuevo mensaje "user", lo marcaba done=true y cortaba
// el sondeo (busy=false) prematuramente — la pregunta siguiente podía entonces pisar una respuesta que
// seguía en curso. rebuildFromState() reconstruye TODO el historial por orden desde
// api.state.session.messages (no busca "el último assistant" suelto) y solo decide "terminado" cuando el
// ÚLTIMO mensaje bruto de la sesión, contado DESDE que arrancó la pregunta actual (baselineCount), es un
// assistant con time.completed — así una lectura tardía del estado nunca puede confundir la respuesta
// anterior con la que se está esperando ahora.
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createSignal, type Accessor } from "solid-js"
import { createStore as createRxStore } from "solid-js/store"
import type { Store } from "./store"
import { buildBtwContext, BTW_SYSTEM_HEADER } from "../../lib/antigravity/tui/btw-context.mjs"
import { summarize } from "../../lib/antigravity/tui/registry.mjs"

export type BtwMessage = { role: "user" | "assistant"; text: string; done: boolean; at: number }

type Thread = {
  sessionID: string | null
  messages: Accessor<BtwMessage[]>
  setMessages: (f: (m: BtwMessage[]) => BtwMessage[]) => void
  busy: Accessor<boolean>
  setBusy: (b: boolean) => void
  error: Accessor<string | null>
  setError: (e: string | null) => void
  poll: ReturnType<typeof setInterval> | null
  pollDeadline: number
  // nº de mensajes (api.state.session.messages) que ya existían en el host cuando arrancó la pregunta EN
  // CURSO: "terminado" solo cuenta si el último mensaje bruto está por ENCIMA de esta marca — sin esto, un
  // sondeo que llega antes de que el host registre el nuevo "user" seguiría viendo el assistant completo de
  // la pregunta anterior como si fuera la respuesta actual (I1).
  baselineCount: number
}

// Sin respuesta del host en 65s DESDE EL ÚLTIMO PROGRESO: se corta el sondeo y se marca error — mejor que
// dejar "busy" para siempre. El plazo se reinicia cada vez que el historial reconstruido cambia de verdad
// (más mensajes, o más texto en el último) para no cortar una respuesta larga que sigue llegando.
const POLL_MS = 400
const POLL_TIMEOUT_MS = 65000

function describeError(err: unknown): string {
  if (!err || typeof err !== "object") return "btw: fallo del modelo"
  const e = err as { data?: { message?: unknown }; message?: unknown; name?: unknown }
  return (
    (typeof e.data?.message === "string" && e.data.message) ||
    (typeof e.message === "string" && e.message) ||
    (typeof e.name === "string" && e.name) ||
    "btw: fallo del modelo"
  )
}

export function createBtw(api: TuiPluginApi, store: Store) {
  // contador de preguntas por cid (reactivo; ver count() más abajo)
  const [counts, setCounts] = createRxStore<Record<string, number>>({})
  const threads = new Map<string, Thread>()
  const bySession = new Map<string, Thread>()
  const hasAgent = () => !!(api.state.config as any)?.agent?.btw

  const thread = (cid: string): Thread => {
    let th = threads.get(cid)
    if (!th) {
      const [messages, setMessagesRaw] = createSignal<BtwMessage[]>([])
      const [busy, setBusy] = createSignal(false)
      const [error, setError] = createSignal<string | null>(null)
      th = {
        sessionID: null,
        messages,
        setMessages: (f) => setMessagesRaw((m) => f(m)),
        busy,
        setBusy,
        error,
        setError,
        poll: null,
        pollDeadline: 0,
        baselineCount: 0,
      }
      threads.set(cid, th)
    }
    return th
  }

  // stopPoll SIEMPRE pisa el error (null incluido): si no, un error de timeout que ya se mostró se queda
  // pegado en pantalla aunque el turno acabe resolviéndose bien más tarde (minor de la revisión: "clear the
  // timeout error when the turn completes").
  function stopPoll(th: Thread, error: string | null = null) {
    if (th.poll) { clearInterval(th.poll); th.poll = null }
    th.setBusy(false)
    th.setError(error)
  }

  function bumpDeadline(th: Thread) {
    if (th.poll) th.pollDeadline = Date.now() + POLL_TIMEOUT_MS
  }

  // Única función que escribe th.messages/th.busy/th.error a partir del estado del host — la llaman tanto
  // los manejadores de evento como el sondeo de respaldo, así que nunca se pisan entre sí de forma
  // inconsistente (siempre parten de la misma lectura de api.state, nunca del `text`/`delta` suelto de un
  // evento concreto).
  function rebuildFromState(th: Thread) {
    if (!th.sessionID) return
    const msgs = (api.state.session.messages(th.sessionID) ?? []) as any[]
    const hostMessages: BtwMessage[] = msgs
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => {
        const parts = (api.state.part(m.id) ?? []) as any[]
        const text = parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("")
        const done = m.role === "user" ? true : !!m.time?.completed
        return { role: m.role as "user" | "assistant", text, done, at: m.time?.created ?? Date.now() }
      })

    const cur = th.messages()
    // Se conserva como "cola pendiente" cualquier burbuja local (la pregunta que acabamos de escribir,
    // todavía no reflejada en api.state) que el host aún no ha confirmado — evita que desaparezca un
    // instante entre el push optimista de ask() y que el servidor registre su propio mensaje "user".
    const merged = hostMessages.length >= cur.length ? hostMessages : [...hostMessages, ...cur.slice(hostMessages.length)]
    const grew =
      merged.length !== cur.length || merged.some((mm, i) => mm.text !== cur[i]?.text || mm.done !== cur[i]?.done)
    if (grew) {
      th.setMessages(() => merged)
      bumpDeadline(th)
    }

    const last = msgs.at(-1)
    const answeredCurrentTurn = msgs.length > th.baselineCount && last && last.role === "assistant" && !!last.time?.completed
    if (answeredCurrentTurn && th.busy()) stopPoll(th, last.error ? describeError(last.error) : null)
  }

  function startPoll(th: Thread) {
    if (th.poll) clearInterval(th.poll)
    th.pollDeadline = Date.now() + POLL_TIMEOUT_MS
    th.poll = setInterval(() => {
      if (Date.now() > th.pollDeadline) { stopPoll(th, "btw: sin respuesta (tiempo agotado)"); return }
      rebuildFromState(th)
    }, POLL_MS)
  }

  // message.part.updated: la parte llega COMPLETA (no por trozos). No se aplica el `text` del evento a
  // pelo: se limita a disparar una resincronización completa desde api.state (rebuildFromState ya filtra
  // por rol y decide "terminado" con la marca baselineCount) — así eventos y sondeo escriben siempre por la
  // misma vía y nunca se pisan entre sí de forma inconsistente.
  const offPart = api.event.on("message.part.updated", (ev: any) => {
    const part = ev.properties?.part
    if (!part || part.type !== "text") return
    const th = bySession.get(part.sessionID)
    if (th) rebuildFromState(th)
  })

  // message.part.delta: respaldo por si el host sólo entrega trozos de texto (no partes completas).
  const offDelta = api.event.on("message.part.delta", (ev: any) => {
    const p = ev.properties
    if (!p || p.field !== "text") return
    const th = bySession.get(p.sessionID)
    if (th) rebuildFromState(th)
  })

  // message.updated: marca de fin de turno — rebuildFromState relee el estado (que ya incluye info.error si
  // el turno falló) y decide "terminado" con la misma lógica que el sondeo, nunca por separado.
  const offUpdated = api.event.on("message.updated", (ev: any) => {
    const info = ev.properties?.info
    if (!info || info.role !== "assistant") return
    const th = bySession.get(info.sessionID)
    if (th) rebuildFromState(th)
  })

  // session.error: algunos fallos (sin red, sin key) llegan por aquí en vez de colgar de un mensaje
  // concreto. Se resincroniza primero (por si hay texto parcial que conservar) y solo se fuerza el corte si
  // rebuildFromState no lo dejó ya resuelto (evita pisar un error más preciso que ya se hubiera mostrado).
  const offSessionError = api.event.on("session.error", (ev: any) => {
    const sessionID = ev.properties?.sessionID
    if (!sessionID) return
    const th = bySession.get(sessionID)
    if (!th) return
    rebuildFromState(th)
    if (th.busy()) stopPoll(th, describeError(ev.properties?.error))
  })

  async function ask(cid: string, parentSessionID: string | undefined, text: string) {
    const th = thread(cid)
    // Estas dos salidas son ANTES de tocar nada: el panel usa el valor de retorno para no borrar lo escrito
    // cuando la pregunta no ha llegado a enviarse (M5).
    if (!hasAgent()) { th.setError("Falta el agente btw en la configuración de anti"); return false }
    const view = store.view(cid)
    if (!view) { th.setError("todavía no hay registro de este agente"); return false }
    th.setError(null)
    th.setBusy(true)
    setCounts(cid, (n: number = 0) => n + 1)
    // Burbuja optimista: se guarda la referencia para poder RETIRARLA si el envío falla. Si se quedara,
    // th.messages() tendría un mensaje que el host nunca confirmará y el merge de rebuildFromState (que
    // asume que el prefijo local coincide con el del host) desalinearía los turnos siguientes (I3).
    const bubble: BtwMessage = { role: "user", text, done: true, at: Date.now() }
    th.setMessages((m) => [...m, bubble])
    try {
      if (!th.sessionID) {
        const row = summarize(view)
        const created = await api.client.session.create({ parentID: parentSessionID, title: `btw · ${row.layer} · ${row.short}` })
        if (created.error) throw new Error(describeError(created.error))
        const id = created.data?.id
        if (!id) throw new Error("btw: no se pudo crear la sesión")
        th.sessionID = id
        bySession.set(id, th)
      }
      // Marca de referencia para "terminado" (ver Thread.baselineCount arriba): cuántos mensajes tenía ya
      // la sesión ANTES de esta pregunta — se toma justo antes de mandar el prompt, con el sessionID ya
      // resuelto (nuevo o existente).
      th.baselineCount = ((api.state.session.messages(th.sessionID) ?? []) as any[]).length
      const system = BTW_SYSTEM_HEADER + "\n\n" + buildBtwContext(view)
      startPoll(th)
      const res = await api.client.session.promptAsync({ sessionID: th.sessionID, agent: "btw", system, parts: [{ type: "text", text }] })
      if (res.error) throw new Error(describeError(res.error))
      return true
    } catch (e) {
      if (th.poll) { clearInterval(th.poll); th.poll = null }
      th.setBusy(false)
      th.setError((e as Error).message)
      th.setMessages((m) => (m.at(-1) === bubble ? m.slice(0, -1) : m))
      return false
    }
  }

  return {
    thread,
    ask,
    // Store (no una señal por hilo): la cabecera lee el contador ANTES de que exista hilo para ese cid, y
    // con `threads.get(cid)?.asked() ?? 0` esa primera lectura no tocaba ninguna señal → el efecto del texto
    // se quedaba sin dependencias y "btw N" no cambiaba nunca. solid-js/store sí registra la lectura de una
    // clave que todavía no existe (M1 de la revisión final).
    count: (cid: string) => counts[cid] ?? 0,
    dispose() {
      if (typeof offPart === "function") offPart()
      if (typeof offDelta === "function") offDelta()
      if (typeof offUpdated === "function") offUpdated()
      if (typeof offSessionError === "function") offSessionError()
      for (const th of threads.values()) if (th.poll) clearInterval(th.poll)
      threads.clear()
      bySession.clear()
    },
  }
}
export type Btw = ReturnType<typeof createBtw>
