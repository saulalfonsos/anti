/** @jsxImportSource @opentui/solid */
// Bloque de plan: pasos con su estado (pending/running/done/waiting/failed), tal como los mantiene el
// reductor (createReducer en render.mjs actualiza vm.plan.steps[].status según call_start/question/call_end).
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { For } from "solid-js"
import type { View } from "../store"

const MARK: Record<string, string> = { done: "✓", running: "▶", pending: "○", waiting: "?", failed: "✗" }

export function PlanBlock(props: { api: TuiPluginApi; plan: NonNullable<View["plan"]> }) {
  const t = () => props.api.theme.current
  const color = (s: string) => s === "done" ? t().success : s === "running" ? t().primary : s === "failed" ? t().error : s === "waiting" ? t().warning : t().textMuted
  return (
    <box flexDirection="column" paddingLeft={1}>
      <text fg={t().text}><b>📋 Plan</b>{props.plan.answer ? <span style={{ fg: t().textMuted }}> — {props.plan.answer.slice(0, 120)}</span> : null}</text>
      <For each={props.plan.steps}>{(s) => <text fg={color(s.status)}>{MARK[s.status] ?? "○"} {s.k}. {s.layer}{s.level === "deep" ? " (deep)" : ""}: {String(s.instruction).replace(/\s+/g, " ").slice(0, 110)}</text>}</For>
    </box>
  )
}
