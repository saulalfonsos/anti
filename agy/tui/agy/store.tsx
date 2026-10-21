/** @jsxImportSource @opentui/solid */
// Store reactivo del plugin: un tailer por conversación observada, reducción incremental compartida con el
// visor web (render.mjs) y lista de agentes barata (cabeza+cola). Ninguna vista lee ficheros.
// Extensión .tsx (no .ts) aunque este fichero no tiene JSX: el loader de plugins de la TUI solo intercepta
// "solid-js" (para compartir el runtime reactivo del host) en ficheros .tsx — un .ts que lo importe falla a
// resolver el módulo en silencio (sin registro de ruta/comando y sin traza, ni con --print-logs --log-level
// DEBUG) y el plugin entero queda sin cargar. Confirmado por bisección con ficheros mínimos (Task 6).
import path from "node:path"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createSignal } from "solid-js"
// createStore/reconcile: aliased on import ("Rx") porque este módulo ya exporta su propia función
// createStore(api) (la fábrica del store del plugin, más abajo) — sin alias chocarían los dos nombres.
// Fix round 1, item 5: reducer.snapshot() hace structuredClone y devuelve un árbol de objetos nuevo en
// cada tick; con un createSignal normal eso propaga una referencia distinta de View entera cada vez,
// así que <For each={view().calls}> (agent-view.tsx) ve "todo nuevo" y recrea cada CallCard/DiffBlock aunque
// el contenido no haya cambiado — reparse de diffs incluido. reconcile(..., {key:"n", merge:true}) empareja
// las llamadas por su número de llamada ("n", estable) y fusiona campo a campo; los arrays de items dentro
// de cada llamada no tienen "n" así que reconcile cae automáticamente a comparar por índice ahí (mismo
// efecto que pide la revisión: "calls por key, items por índice").
import { createStore as createRxStore, reconcile } from "solid-js/store"
import { createTailer } from "../../lib/antigravity/tui/tail.mjs"
import { createReducer } from "../../lib/antigravity/ui/render.mjs"
import { listAgents, summarize } from "../../lib/antigravity/tui/registry.mjs"
import { readThinking } from "../../lib/antigravity/ui/brain.mjs"
import { cacheDir } from "./env"
import { safe } from "./safe"

export type View = ReturnType<ReturnType<typeof createReducer>["snapshot"]>
export type AgentRow = ReturnType<typeof summarize>
export type Agents = { mine: AgentRow[]; others: AgentRow[] }

type ViewSlot = { view: View | undefined }
type Watched = {
  tailer: ReturnType<typeof createTailer>
  thinkTimer: ReturnType<typeof setInterval> | null
  reducer: ReturnType<typeof createReducer>
  viewState: ViewSlot
  setViewState: (...args: any[]) => void
  refs: number
  truncated: boolean
}

// Debe coincidir con ROUTE en index.tsx: la ruta propia del plugin también necesita el refresco en vivo
// (§ ensureTimer más abajo). No se importa desde index.tsx para evitar un ciclo index↔store.
const AGY_ROUTE = "agy"

// cid solo se usa para construir una ruta de fichero (watch() más abajo): viene de params de ruta, que un
// tercero podría manipular. Sin esto, un cid como "../../etc/passwd" escaparía de cacheDir().
const CID_RE = /^[A-Za-z0-9._-]+$/

export function createStore(api: TuiPluginApi) {
  const dir = cacheDir()
  const [agents, setAgents] = createSignal<Agents>({ mine: [], others: [] })
  const watched = new Map<string, Watched>()
  let timer: ReturnType<typeof setInterval> | null = null
  let disposed = false

  // La ruta "agy" identifica al agente por cid, no por sessionID (ver params?.cid en index.tsx): la sesión de
  // OpenCode desde la que se navegó viaja en params.returnRoute (que index.tsx debe seguir pasando al navegar
  // aquí). lastKnownSessionID cubre el hueco mientras tanto (p.ej. justo tras cambiar de ruta, antes de que
  // returnRoute esté disponible) — se actualiza cada vez que se ve un sessionID real, nunca se borra.
  let lastKnownSessionID: string | undefined
  const sessionID = () => {
    const cur = api.route.current as { name: string; params?: { sessionID?: string; returnRoute?: { params?: { sessionID?: string } } } }
    const found = cur.params?.sessionID ?? cur.params?.returnRoute?.params?.sessionID
    if (found) lastKnownSessionID = found
    return found ?? lastKnownSessionID
  }
  const refreshAgents = () => { try { setAgents(listAgents(dir, { sessionID: sessionID() })) } catch { /* directorio ausente */ } }
  const ensureTimer = () => {
    if (timer) return
    timer = setInterval(() => {
      // Nadie lee agents() fuera de la vista de sesión (sidebar, Task 7) o de la propia ruta "agy"
      // (selector/vista): sondear el resto del tiempo sería trabajo de disco sin espectador.
      const name = api.route.current.name
      if (name === "session" || name === AGY_ROUTE) refreshAgents()
    }, 1000)
    ;(timer as any).unref?.()
  }

  const watch = (cid: string) => {
    const noop = () => {}
    if (disposed || !CID_RE.test(cid)) return noop
    let w = watched.get(cid)
    if (!w) {
      const [viewState, setViewState] = createRxStore<ViewSlot>({ view: undefined })
      let reducer = createReducer()
      let lastThinking = -1
      const entry: Watched = { reducer, viewState, setViewState, refs: 0, truncated: false, tailer: undefined as any, thinkTimer: null }
      const repaint = () =>
        // reconcile en vez de reemplazar el objeto entero: conserva identidad de las llamadas/items que no
        // cambiaron (ver comentario del import de arriba) — así <For> en agent-view.tsx no las reconstruye.
        entry.setViewState("view", reconcile(entry.reducer.snapshot(), { key: "n", merge: true }))
      entry.tailer = createTailer(path.join(dir, `${cid}.events.jsonl`), (events, meta) => {
        entry.truncated = meta.truncated
        // El fichero se recreó/truncó por fuera (p. ej. limpiar la caché con la TUI abierta): el tailer
        // reenvía desde el byte 0, así que hay que tirar lo reducido o saldría todo duplicado.
        if (meta.reset) { reducer = createReducer(); entry.reducer = reducer; lastThinking = -1 }
        reducer.push(events)
        repaint()
      })
      // El pensamiento del modelo NO está en el fichero de eventos: agy lo escribe en su transcript interno
      // (~/.gemini/antigravity-cli/brain/<cid>/…), y el visor web lo multiplexa en el SSE con readThinking()
      // (ui/server.mjs). Sin esto, la tecla "t", el plegado de call-card y la línea 💭 del contexto de Ling
      // eran código inalcanzable: el reducer nunca recibía un evento {type:"thinking"}. Misma cadencia que
      // el visor (2 s): el transcript se reescribe entero, leerlo más a menudo no aporta nada.
      const pumpThinking = () => {
        try {
          const items = readThinking(cid, lastThinking)
          if (!items.length) return
          for (const th of items) lastThinking = Math.max(lastThinking, Number(th.step_index))
          entry.reducer.push(items.map((th: any) => ({ type: "thinking", ...th })))
          repaint()
        } catch { /* sin transcript (agy antiguo, otra máquina): la vista sigue sin pensamiento */ }
      }
      pumpThinking()
      entry.thinkTimer = setInterval(pumpThinking, 2000)
      ;(entry.thinkTimer as any).unref?.()
      w = entry; watched.set(cid, w)
    }
    w.refs++
    let done = false // unwatch() puede llegar más de una vez (p.ej. cleanup de efecto + onDispose): solo cuenta la primera
    return () => {
      if (done) return
      done = true
      const e = watched.get(cid); if (!e) return; e.refs--; if (e.refs <= 0) { stopWatched(e); watched.delete(cid) }
    }
  }
  const stopWatched = (e: Watched) => { e.tailer.stop(); if (e.thinkTimer) clearInterval(e.thinkTimer); e.thinkTimer = null }
  const view = (cid: string) => watched.get(cid)?.viewState.view
  const truncated = (cid: string) => watched.get(cid)?.truncated ?? false

  ensureTimer(); refreshAgents()
  return {
    dir, agents, refreshAgents, watch, view, truncated, sessionID,
    dispose() { disposed = true; if (timer) clearInterval(timer); timer = null; for (const w of watched.values()) stopWatched(w); watched.clear() },
  }
}
export type Store = ReturnType<typeof createStore>

// Navega a la ruta "agy" para cid, pasando returnRoute (de ahí saca sessionID() la sesión mientras se ve
// esta ruta — ver comentario de watch() más arriba). `extra` permite parámetros adicionales, como
// btw:true. Vivía en index.tsx (Task 9); Fix round 1, item 3: agent-view.tsx la necesita para que ←/→
// reutilicen exactamente esta misma lógica de returnRoute (en vez de llamar a api.route.navigate a pelo),
// así que se mueve aquí — igual que siblings más abajo — para evitar el ciclo index↔view que resultaría de
// importarla desde index.tsx. index.tsx la reexporta para quien la busque por su ruta original.
export function navigateAgent(api: TuiPluginApi, cid: string, extra?: Record<string, unknown>) {
  safe(api, "abrir agente", () => {
    const cur = api.route.current as { name: string; params?: { returnRoute?: unknown } }
    const returnRoute = cur.name === AGY_ROUTE ? (cur.params?.returnRoute ?? cur) : cur
    api.route.navigate(AGY_ROUTE, { cid, returnRoute, ...extra })
  })
}

// Navegación ←/→ entre agentes (vista de Task 9): puro sobre store.agents(), sin efectos secundarios. Vive
// aquí y no en index.tsx (ruling del controlador, Task 8) para evitar un ciclo index↔view — el mismo motivo
// por el que AGY_ROUTE se repite arriba en vez de importarse de index.tsx.
export function siblings(store: Store, cid: string) {
  const a = store.agents()
  const list = (a.mine.some((r) => r.cid === cid) ? a.mine : a.others).map((r) => r.cid)
  const i = list.indexOf(cid)
  return { prev: i > 0 ? list[i - 1] : undefined, next: i >= 0 && i < list.length - 1 ? list[i + 1] : undefined }
}
