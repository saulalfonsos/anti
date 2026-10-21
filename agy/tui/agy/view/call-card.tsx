/** @jsxImportSource @opentui/solid */
// Tarjeta de una llamada (call_start..call_end): cabecera con capa/modelo/paso/estado/tokens, instrucción,
// y sus items en orden (tool/text/thinking/diff/plan/question/denied/note — kinds de render.mjs). El plan
// se pinta con el plan del ViewModel (props.plan, con status ya calculado), no con el item "plan" en bruto
// del propio call.items (ese solo trae steps sin status).
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { For, Match, Show, Switch, createMemo } from "solid-js"
import type { View } from "../store"
import { DiffBlock } from "./diff-block"
import { PlanBlock } from "./plan-block"
import { elapsed, k, cap } from "./format"

type Call = View["calls"][number]

export function CallCard(props: { api: TuiPluginApi; call: Call; plan: View["plan"]; showThinking: boolean; openDiffs: boolean }) {
  const t = () => props.api.theme.current
  const status = () => props.call.end === null ? "…" : props.call.denied ? "denegado" : props.call.status
  // Fix round 1, item 10 (spec §5.4 "plegado por defecto"): con el pensamiento oculto, cada tanda seguida
  // de items "thinking" se colapsa en UN único marcador de una línea (no uno por item — el reductor no
  // fusiona deltas de thinking como sí hace con "text", así que una tanda larga podría ser muchos items) y
  // el resto de esa tanda se omite. Con el pensamiento visible los items pasan tal cual (mismo camino que
  // antes de este fix). Recompone solo cuando cambian los items de la llamada o showThinking, no en cada
  // render de la tarjeta.
  const renderItems = createMemo(() => {
    const items = props.call.items as any[]
    if (props.showThinking) return items
    const out: any[] = []
    let inRun = false
    for (const it of items) {
      if (it.kind === "thinking") {
        if (!inRun) { out.push({ kind: "thinking-run" }); inRun = true }
        continue
      }
      inRun = false
      out.push(it)
    }
    return out
  })
  return (
    <box flexDirection="column" paddingTop={1}>
      <box flexDirection="row" gap={1}>
        <text fg={t().primary}><b>{props.call.layer}</b></text>
        <text fg={t().textMuted}>· {props.call.model}{props.call.step ? ` · paso ${props.call.step.k}/${props.call.step.n}` : ""} · {elapsed(props.call.start, props.call.end)}</text>
        <text fg={props.call.end === null ? t().warning : props.call.denied || props.call.status !== "SUCCESS" ? t().error : t().success}>{status()}</text>
        <Show when={props.call.usage}><text fg={t().textMuted}>+{k(props.call.usage!.tokens.delta)} tok</text></Show>
      </box>
      <Show when={props.call.instruction}><text fg={t().textMuted}>  {props.call.instruction.replace(/\s+/g, " ").slice(0, 160)}</text></Show>
      <For each={renderItems()}>{(it: any) => (
        <Switch>
          {/* Fix round 1, item 7: arg de herramienta, pregunta y nota recortados a 300 caracteres con
              elipsis (cap, ./format) — texto libre que puede venir de fuera y no tiene tope propio. Los
              items "denied" no llevan texto libre (solo outcome/rule, ya cortos por construcción, ver
              render.mjs), así que no hay nada que recortar ahí. */}
          <Match when={it.kind === "tool"}><text fg={t().text}>  {it.icon} {it.name} <span style={{ fg: t().textMuted }}>{cap(it.arg, 300)}</span></text></Match>
          <Match when={it.kind === "text"}><text fg={t().text}>  💬 {String(it.text).replace(/\s+/g, " ").slice(0, 400)}</text></Match>
          <Match when={it.kind === "thinking"}><text fg={t().textMuted}>  💭 {String(it.text).replace(/\s+/g, " ").slice(0, 300)}</text></Match>
          <Match when={it.kind === "thinking-run"}><text fg={t().textMuted}>  💭 pensamiento (t para ver)</text></Match>
          <Match when={it.kind === "diff"}><DiffBlock api={props.api} file={it.file} patch={it.patch} untracked={it.untracked} truncated={it.truncated} open={props.openDiffs} /></Match>
          <Match when={it.kind === "plan" && props.plan}><PlanBlock api={props.api} plan={props.plan!} /></Match>
          <Match when={it.kind === "question"}><text fg={t().warning}>  ❓ {cap(it.text, 300)}</text></Match>
          <Match when={it.kind === "denied"}><text fg={t().error}>  ⛔ denegado ({it.outcome}){it.rule ? ` → regla ${it.rule}` : ""}</text></Match>
          <Match when={it.kind === "note"}><text fg={t().textMuted}>  ℹ️ {cap(it.text, 300)}</text></Match>
        </Switch>
      )}</For>
      <Show when={props.call.notes?.length}><text fg={t().textMuted}>  Notas: {props.call.notes.map((n: string) => cap(n, 300)).join(" · ")}</text></Show>
    </box>
  )
}
