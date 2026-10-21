/** @jsxImportSource @opentui/solid */
// Vista de un agente en vivo (ruta "agy"): cabecera + plan + tarjetas de llamada, con teclas propias
// (seguir, pensamiento, diffs, navegador, anterior/siguiente, ayuda, cerrar) y el estado del panel /btw
// (Task 10 pinta el panel de verdad; aquí solo se lleva el signal btwOpen y se deja un hueco btwPanel).
//
// Capa de teclas: en vez de un `enabled` en registerLayer (esa opción no existe en @opentui/keymap 0.4.5 —
// comprobado en el fuente compilado del paquete: ningún layer trae ese campo), se usa el mecanismo que la
// propia doc del host documenta para "full-screen route or modal-like UI"
// (packages/opencode/specs/tui-plugins.md, sección "Mode-aware layers"): `api.mode.push("agy.view")` al
// montar el componente (con onCleanup para hacer pop) y `mode: "agy.view"` en la capa. Así la capa solo
// está activa mientras el modo esté empujado — que coincide exactamente con "mientras se ve este agente",
// porque el propio componente solo existe mientras la ruta "agy" está montada (y, desde el fix round 1,
// item 1, remonta de verdad en cada cid nuevo — ver el <Show keyed> de index.tsx).
import type { TuiPluginApi, TuiRouteCurrent } from "@opencode-ai/plugin/tui"
import { viewerPort } from "../env"
import { For, Show, createMemo, createSignal, onCleanup } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { spawn } from "node:child_process"
import { openUrlCommand } from "../../../lib/anti/platform.mjs"
import type { Store } from "../store"
import { siblings, navigateAgent } from "../store"
import { safe } from "../safe"
import { shortId } from "../../../lib/antigravity/tui/shortid.mjs"
import { Header } from "./header"
import { CallCard } from "./call-card"
import { openHelp } from "./help-dialog"

// Tiempo de espera de la sonda de salud antes de asumir que agy-ui no está en marcha (tecla "o", fix round
// 1 item 8): 300ms es más que de sobra para un servidor local en 127.0.0.1 y lo bastante corto para no
// bloquear la UI de forma perceptible si el puerto está cerrado (AbortController corta la petición ahí).
const HEALTH_TIMEOUT_MS = 300

export function AgentView(props: {
  api: TuiPluginApi
  store: Store
  cid: string
  returnRoute?: TuiRouteCurrent
  btw?: boolean
  btwPanel?: (p: { cid: string; open: boolean }) => any
  btwCount?: (cid: string) => number
}) {
  const api = props.api
  const t = () => api.theme.current
  const unwatch = props.store.watch(props.cid)
  onCleanup(unwatch)
  const view = () => props.store.view(props.cid)
  const [follow, setFollow] = createSignal<boolean>(api.kv.get("agy.follow", true))
  const [thinking, setThinking] = createSignal<boolean>(api.kv.get("agy.thinking", false))
  const [diffs, setDiffs] = createSignal<boolean>(api.kv.get("agy.diffs", true))
  const [btwOpen, setBtwOpen] = createSignal<boolean>(!!props.btw)
  const short = createMemo(() => shortId(props.cid, [...props.store.agents().mine, ...props.store.agents().others].map((r) => r.cid)))
  // Panel btw (Task 10): ≥100 col se aloja a la derecha (fila); por debajo de eso no cabe al lado del
  // scroll principal, así que la fila entera pasa a columna y el panel queda apilado debajo (ruling del
  // controlador — 40% de alto, ver btw-panel.tsx, que decide su propio ancho/alto con la misma medida).
  const dims = useTerminalDimensions()
  const rowDirection = createMemo(() => (btwOpen() && dims().width < 100 ? "column" : "row"))
  let scroll: any

  const back = () => safe(api, "volver", () => {
    const r = props.returnRoute
    api.route.navigate(r?.name ?? "home", r && "params" in r ? (r as any).params : undefined)
  })
  // Fix round 1, item 3 (ruling): ←/→ reutilizan navigateAgent (store.tsx) en vez de api.route.navigate a
  // pelo, para que el returnRoute de la nueva ruta "agy" salga de la MISMA lógica de "no anidar" que ya usa
  // el selector — y no de una copia local que podría desincronizarse. El estado de btw solo se traslada al
  // agente siguiente/anterior si el panel está abierto AHORA MISMO en este agente (no lo que trajera props
  // originalmente, que es solo la semilla inicial: btwOpen() es la fuente de verdad tras el montaje).
  const go = (cid?: string) => { if (cid) navigateAgent(api, cid, btwOpen() ? { btw: true } : undefined) }

  // Fix round 1, item 8 (ruling): antes de intentar abrir el navegador se sondea /api/health del propio
  // agy-ui (no del cid: es un servidor único que sirve todas las conversaciones) con un timeout corto — sin
  // esto, `spawn("open", ...)` "funciona" igualmente (macOS abre una pestaña) aunque no haya nada
  // escuchando en ese puerto, y el usuario se queda mirando un ERR_CONNECTION_REFUSED sin más pista.
  const openBrowser = () => safe(api, "abrir en navegador", async () => {
    const port = viewerPort()
    const url = `http://127.0.0.1:${port}/#${props.cid}`
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS)
    let up = false
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: ctrl.signal })
      up = res.ok
    } catch { /* sin respuesta, puerto cerrado o timeout: se trata igual que "no está en marcha" */ }
    finally { clearTimeout(timer) }
    if (!up) { api.ui.toast({ message: "agy: agy-ui no está en marcha: ejecuta agy-ui --open" }); return }
    try { const [bin, args] = openUrlCommand(url); spawn(bin, args, { detached: true, stdio: "ignore" }).on("error", () => {}).unref() } catch { /* sin navegador (CI): el toast igual da la URL */ }
    api.ui.toast({ message: `agy: abriendo ${url}` })
  })

  // Modo propio de esta vista: mientras esté empujado, la capa de teclas de abajo es la única activa para
  // sus bindings (esc/q, ←/→, f, t, d, o, b, ?) — ver comentario de cabecera. Se saca (pop) en onCleanup,
  // que Solid ejecuta cuando el router desmonta este componente (al volver o al saltar a otro agente).
  const popMode = api.mode.push("agy.view")
  onCleanup(popMode)

  // Fix round 1, item 6 (ruling): salta al fondo del scroll UNA vez, no en cada tick — se usa al reactivar
  // "seguir" con "f" (patrón del host, routes/session/index.tsx: toBottom()): el setTimeout deja que el
  // layout se recalcule con el contenido ya montado antes de pedir scrollHeight.
  const toBottom = () => {
    setTimeout(() => {
      if (!scroll || scroll.isDestroyed) return
      if (typeof scroll.scrollTo === "function") scroll.scrollTo(scroll.scrollHeight)
    }, 50)
  }

  // Fix round 1, item 2 (ruling): cada manejador que toca api.* va envuelto en safe() — un toast en vez de
  // tumbar el runtime de la TUI si algo falla (p.ej. api.kv.set con una clave inválida, un mode ya
  // reventado, etc.). Los toggles puros (follow/thinking/diffs/btw) solo llaman a api.kv.set, pero se
  // envuelven igual por regla general y por si el futuro panel btw (Task 10) añade más lógica ahí.
  const off = api.keymap.registerLayer({
    mode: "agy.view",
    priority: 500,
    commands: [
      { name: "agy.close", title: "Antigravity: volver", run: back },
      { name: "agy.prev", title: "Antigravity: agente anterior", run: () => safe(api, "agente anterior", () => go(siblings(props.store, props.cid).prev)) },
      { name: "agy.next", title: "Antigravity: agente siguiente", run: () => safe(api, "agente siguiente", () => go(siblings(props.store, props.cid).next)) },
      {
        name: "agy.follow", title: "Antigravity: seguir/parar",
        run: () => safe(api, "seguir", () => setFollow((v) => {
          const next = !v
          api.kv.set("agy.follow", next)
          if (next) toBottom()
          return next
        })),
      },
      { name: "agy.thinking", title: "Antigravity: pensamiento", run: () => safe(api, "pensamiento", () => setThinking((v) => { api.kv.set("agy.thinking", !v); return !v })) },
      { name: "agy.diffs", title: "Antigravity: plegar/desplegar diffs", run: () => safe(api, "diffs", () => setDiffs((v) => { api.kv.set("agy.diffs", !v); return !v })) },
      { name: "agy.open", title: "Antigravity: abrir en navegador", run: openBrowser },
      { name: "agy.btw.toggle", title: "Antigravity: panel btw", run: () => safe(api, "panel btw", () => setBtwOpen((v) => !v)) },
      { name: "agy.help", title: "Antigravity: ayuda", run: () => safe(api, "ayuda", () => openHelp(api)) },
    ],
    bindings: [
      { key: "escape,q", cmd: "agy.close", desc: "Volver" },
      { key: "left", cmd: "agy.prev", desc: "Agente anterior" },
      { key: "right", cmd: "agy.next", desc: "Agente siguiente" },
      { key: "f", cmd: "agy.follow", desc: "Seguir" },
      { key: "t", cmd: "agy.thinking", desc: "Pensamiento" },
      { key: "d", cmd: "agy.diffs", desc: "Diffs" },
      // Visor web (agy-ui): solo en desarrollo; anti lo apaga con AGY_UI=0 y la tecla no existe.
      ...(process.env.AGY_UI === "0" ? [] : [{ key: "o", cmd: "agy.open", desc: "Navegador" }]),
      { key: "b", cmd: "agy.btw.toggle", desc: "btw" },
      { key: "?", cmd: "agy.help", desc: "Ayuda" },
    ],
  })
  onCleanup(() => { if (typeof off === "function") off() })

  return (
    <box position="absolute" left={0} top={0} width="100%" height="100%" flexDirection="column" backgroundColor={t().background}>
      <Show when={view()} fallback={<text fg={t().textMuted}>sin eventos todavía en {props.cid} — esperando…</text>}>
        <Header api={api} view={view()!} short={short()} truncated={props.store.truncated(props.cid)} btwCount={props.btwCount?.(props.cid) ?? 0} btwOpen={btwOpen()} />
        <box flexDirection={rowDirection()} flexGrow={1} minHeight={0}>
          {/* Fix round 1, item 6: sin scrollTo por tick — stickyScroll (prop del host) ya seguía el fondo
              por sí solo y el efecto de antes lo forzaba en cada snapshot, pisando un scroll manual del
              usuario aunque "seguir" siguiera nominalmente activo. */}
          <scrollbox ref={(r: any) => (scroll = r)} flexGrow={1} minHeight={0} stickyScroll={follow()} stickyStart="bottom" paddingLeft={1} paddingRight={1}>
            <Show when={view()!.banner}><text fg={view()!.banner!.kind === "question" ? t().warning : t().error}>{bannerText(view()!.banner!)}</text></Show>
            {/* D320: con el aspecto del chat del IDE de Antigravity (el mismo componente que la tool en el chat), si el anfitrión lo
                trae; en un OpenCode sin él, las tarjetas de siempre. */}
            <Show when={api.ui.AgyTool} fallback={<For each={view()!.calls}>{(c) => <CallCard api={api} call={c} plan={view()!.plan} showThinking={thinking()} openDiffs={diffs()} />}</For>}>
              {(AgyTool) => { const Tool = AgyTool(); return <Tool view={view()!} running={view()!.live} collapse={false} /> }}
            </Show>
          </scrollbox>
          <Show when={btwOpen() && props.btwPanel}>{props.btwPanel!({ cid: props.cid, open: btwOpen() })}</Show>
        </box>
      </Show>
    </box>
  )
}

function bannerText(b: any) {
  if (b.kind === "question") return `❓ Antigravity pregunta: ${b.text}`
  if (b.kind === "denied") return `⛔ Acción denegada${b.rule ? ` (regla ${b.rule})` : ""}${b.outcome === "retry-denied" ? " — el reintento volvió a fallar" : ""}`
  if (b.kind === "aborted") return `■ ${b.text}`
  return `✗ ${b.text ?? "error"}`
}
