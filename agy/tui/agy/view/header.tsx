/** @jsxImportSource @opentui/solid */
// Cabecera de la vista de un agente: capa/modelo/id/estado de la última llamada, plan (resumen), tokens
// totales y avisos (registro truncado). btwCount/btwOpen son solo estado — el panel en sí es Task 10.
//
// Fix round 1, item 9 (ruling): orden exacto de la spec §5.4 — "layer · model · short · ● elapsed ·
// plan k/n · +tok · Pro sesión: N". Se quita el aviso "(desde <layer>)" de la primera llamada que llevaba
// el Task 9 original (era un parche para que el driver viera "orchestrate" en pantalla pese a que summarize
// muestra la capa de la ÚLTIMA llamada, no la primera; el fix round 1 corrige el propio driver para
// comprobar lo que la cabecera realmente muestra en vez de forzar la cabecera a mostrar algo más).
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { Show } from "solid-js"
import type { View } from "../store"
import { summarize, STATUS_ICON } from "../../../lib/antigravity/tui/registry.mjs"
import { elapsed, k } from "./format"

export function Header(props: { api: TuiPluginApi; view: View; short: string; truncated: boolean; btwCount: number; btwOpen: boolean }) {
  const t = () => props.api.theme.current
  const row = () => summarize(props.view)
  const last = () => props.view.calls.at(-1)
  return (
    <box flexDirection="row" gap={1} paddingLeft={1} paddingRight={1} border={["bottom"]} borderColor={t().border}>
      <text fg={t().text}><b>{row().layer}</b></text>
      <text fg={t().textMuted}>· {row().model}</text>
      <text fg={t().textMuted}>· {props.short}</text>
      <Show when={last()}>
        <text fg={row().status === "running" ? t().success : row().status === "failed" ? t().error : t().textMuted}>
          · {STATUS_ICON[row().status]} {elapsed(last()!.start, last()!.end)}
        </text>
      </Show>
      <Show when={props.view.plan}><text fg={t().textMuted}>· plan {props.view.plan!.steps.filter((s) => s.status === "done").length}/{props.view.plan!.steps.length}</text></Show>
      <text fg={t().textMuted}>· +{k(row().tokens)} tok</text>
      <text fg={t().textMuted}>· Pro sesión: {props.view.proCount}</text>
      <Show when={props.truncated}><text fg={t().warning}>· registro truncado</text></Show>
      <box flexGrow={1} />
      <text fg={props.btwOpen ? t().primary : t().textMuted}>btw {props.btwCount} [b]</text>
      <text fg={t().textMuted}>[?] ayuda · [esc] volver</text>
    </box>
  )
}
