/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { For, Show, createMemo } from "solid-js"
import type { Store, AgentRow } from "../store"
import { launchedBy } from "../../../lib/antigravity/tui/registry.mjs"
import { ago } from "./format"

const MAX = 6
// De una ruta, el nombre del fichero; de una orden larga, el principio.
const brief = (arg: string) => {
  const name = /^\/|^\w[\w.-]*\//.test(arg) && !/\s/.test(arg) ? arg.split("/").at(-1) ?? arg : arg
  return name.length > 24 ? `${name.slice(0, 23)}…` : name
}
// Bloque "Agentes" del sidebar: solo si la tarea de ESTA sesión lanzó otros agentes; una línea por agente.
// props.session_id es el sessionID autoritativo que da el propio slot (sidebar_content) — no
// store.sessionID() (que store.agents() usa para separar mine/others), que puede ir un paso por detrás justo
// tras navegar. Por eso se filtra aquí, sobre la unión mine+others que el store ya tiene en memoria, en vez
// de confiar en el "mine" del store (ver rowsForSession en registry.mjs, testado por separado).
export function AgentsSidebar(props: { api: TuiPluginApi; store: Store; session_id: string; onOpen: (row: { cid: string; sub?: unknown }) => void }) {
  const theme = () => props.api.theme.current
  // Solo lo que lanza la tarea del chat (D322): la tarea misma ya se ve en el chat.
  const rows = createMemo(() => launchedBy(props.store.agents(), props.session_id, (id: string) => props.api.state.session.get(id)?.parentID))
  const color = (r: AgentRow) => r.status === "running" ? theme().success : r.status === "failed" ? theme().error : r.status === "question" ? theme().warning : theme().textMuted
  return (
    <Show when={rows().length > 0}>
      <box flexDirection="column">
        <text fg={theme().text}><b>Agentes</b></text>
        <For each={rows().slice(0, MAX)}>{(r) => (
          // Una sola línea que se corta si no cabe (no se parte): el tiempo antes que la última herramienta, que es lo que sobra.
          <box onMouseUp={() => props.onOpen(r)}>
            <text wrapMode="none">
              <span style={{ fg: color(r) }}>{r.icon} </span>
              <span style={{ fg: theme().text }}>{r.layer}</span>
              <span style={{ fg: theme().textMuted }}> · {r.short} · {ago(r.lastAt)}{r.lastTool ? ` · ${r.lastTool.icon} ${brief(r.lastTool.arg || r.lastTool.name)}` : ""}</span>
            </text>
          </box>
        )}</For>
        <Show when={rows().length > MAX}><text fg={theme().textMuted}>… y {rows().length - MAX} más</text></Show>
      </box>
    </Show>
  )
}
