/** @jsxImportSource @opentui/solid */
// Un subagente de agy (D324) con el aspecto del chat principal: a la izquierda el encargo que le dio Gemini (como un mensaje tuyo) y
// lo que hizo con el mismo componente que la tool en el chat (api.ui.AgyTool); a la derecha, como la barra lateral del chat, qué es y
// quién lo lanzó. Mientras trabaja se relee su base cada segundo. esc vuelve.
import type { TuiPluginApi, TuiRouteCurrent } from "@opencode-ai/plugin/tui"
import { Show, createSignal, onCleanup } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { reduce } from "../../../lib/antigravity/ui/render.mjs"
import { shortId } from "../../../lib/antigravity/tui/shortid.mjs"
import { findSubagent, readSubagent, type SubRef } from "../subagents"
import { safe } from "../safe"

const SIDEBAR = 42

export function SubagentView(props: { api: TuiPluginApi; sub: SubRef; returnRoute?: TuiRouteCurrent }) {
  const api = props.api
  const t = () => api.theme.current
  const dims = useTerminalDimensions()
  const [state, setState] = createSignal<{ file?: string; instruction: string; view?: any; done: boolean; error?: string }>({ instruction: props.sub.prompt, done: false })

  const load = () => {
    try {
      const file = state().file ?? findSubagent(props.sub)
      if (!file) return setState((s) => ({ ...s, error: "todavía no encuentro su conversación en agy" }))
      const read = readSubagent(file, props.sub)
      setState({ file, instruction: read.instruction || props.sub.prompt, view: reduce(read.events), done: read.done })
    } catch (error) {
      setState((s) => ({ ...s, error: error instanceof Error ? error.message : String(error) }))
    }
  }
  load()
  const timer = setInterval(() => { if (!state().done) load() }, 1000)
  onCleanup(() => clearInterval(timer))

  const back = () => safe(api, "volver", () => {
    const r = props.returnRoute
    api.route.navigate(r?.name ?? "home", r && "params" in r ? (r as any).params : undefined)
  })
  const popMode = api.mode.push("agy.sub")
  onCleanup(popMode)
  const off = api.keymap.registerLayer({
    mode: "agy.sub",
    priority: 500,
    commands: [{ name: "agy.sub.close", title: "Antigravity: volver al chat", run: back }],
    bindings: [{ key: "escape,q", cmd: "agy.sub.close", desc: "Volver" }],
  })
  onCleanup(() => { if (typeof off === "function") off() })

  const wide = () => dims().width >= 120
  return (
    <box position="absolute" left={0} top={0} width="100%" height="100%" flexDirection="row" backgroundColor={t().background}>
      <box flexGrow={1} minWidth={0} flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
        <scrollbox flexGrow={1} minHeight={0} stickyScroll={!state().done} stickyStart="bottom">
          <box border={["left"]} borderColor={t().secondary} customBorderChars={{ topLeft: "", bottomLeft: "", vertical: "┃", topRight: "", bottomRight: "", horizontal: " ", bottomT: "", topT: "", cross: "", leftT: "", rightT: "" }} flexShrink={0}>
            <box paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} backgroundColor={t().backgroundPanel} flexShrink={0}>
              <text wrapMode="word" fg={t().text}>{state().instruction}</text>
              <text fg={t().textMuted}>Gemini → subagente {props.sub.type}</text>
            </box>
          </box>
          <Show when={state().view} fallback={<text marginTop={1} paddingLeft={3} fg={t().textMuted}>{state().error ?? "leyendo su conversación…"}</text>}>
            <Show when={api.ui.AgyTool} fallback={<text fg={t().error}>Esta versión de anti no trae el chat de agy.</text>}>
              {(AgyTool) => { const Tool = AgyTool(); return <Tool view={{ ...state().view, live: !state().done }} running={!state().done} /> }}
            </Show>
          </Show>
        </scrollbox>
        <box flexShrink={0} paddingTop={1} flexDirection="row" gap={2}>
          <text fg={t().text}>esc <span style={{ fg: t().textMuted }}>volver al chat</span></text>
        </box>
      </box>
      <Show when={wide()}>
        <box width={SIDEBAR} flexShrink={0} backgroundColor={t().backgroundPanel} paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} flexDirection="column" gap={1}>
          <box flexDirection="column">
            <text fg={t().text}><b>Subagente {props.sub.type}</b></text>
            <text fg={t().textMuted}>{state().file ? shortId(state().file!.split("/").at(-1)!.replace(/\.db$/, ""), []) : "—"}</text>
          </box>
          <box flexDirection="column">
            <text fg={t().text}><b>Estado</b></text>
            <text fg={state().done ? t().success : t().warning}>{state().done ? "✓ terminado" : "● trabajando"}</text>
          </box>
          <box flexDirection="column">
            <text fg={t().text}><b>Lanzado por</b></text>
            <text fg={t().textMuted}>la tarea {shortId(props.sub.parent, [])} de Gemini</text>
          </box>
        </box>
      </Show>
    </box>
  )
}
