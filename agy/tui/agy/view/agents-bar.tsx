/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { Show, createMemo } from "solid-js"
import type { Store } from "../store"
import { selectHint } from "../keys"
// Línea inferior: solo mientras haya algún agente en marcha en esta sesión. Vacía = no ocupa sitio.
export function AgentsBar(props: { api: TuiPluginApi; store: Store; btwCount?: () => number }) {
  const theme = () => props.api.theme.current
  const running = createMemo(() => props.store.agents().mine.filter((r) => r.status === "running").length)
  return (
    <Show when={running() > 0}>
      <box flexDirection="row" gap={1} paddingLeft={1}>
        <text fg={theme().success}>●</text>
        <text fg={theme().textMuted}>agy: {running()} activo{running() === 1 ? "" : "s"}{props.btwCount && props.btwCount() ? ` · btw ${props.btwCount()}` : ""} · {selectHint(props.api)}</text>
      </box>
    </Show>
  )
}
