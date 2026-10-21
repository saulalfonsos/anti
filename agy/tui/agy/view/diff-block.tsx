/** @jsxImportSource @opentui/solid */
// Bloque de diff plegable dentro de una llamada. parseUnifiedDiff (lib/antigravity/ui/render.mjs, PURO,
// compartido con el visor web) da hunks con líneas {type: add|del|ctx|meta, text, oldNo, newNo} — el campo
// de texto es "text" (comprobado en el fuente, no "raw"). Cap de 400 líneas por diff (spec de la tarea):
// evita que un patch enorme cuelgue el renderer de la TUI. Fix round 1, item 7: además cada línea se recorta
// a 400 caracteres (una sola línea minificada larguísima no debe desbordar el ancho de la tarjeta).
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { parseUnifiedDiff } from "../../../lib/antigravity/ui/render.mjs"
import { cap } from "./format"

const MAX_LINES = 400
const MAX_LINE_CHARS = 400

export function DiffBlock(props: { api: TuiPluginApi; file: string; patch: string; untracked: boolean; truncated: boolean; open: boolean }) {
  const t = () => props.api.theme.current
  const [open, setOpen] = createSignal(props.open)
  // Fix round 1, item 4 (spec §5.4): "d" (el toggle global, props.open) manda — cada vez que cambia
  // resincroniza este bloque, incluso si ya estaba en pantalla. Un click local en el propio bloque solo lo
  // altera hasta el PRÓXIMO toggle global (el signal local vive entre medias sin que nada lo pise).
  createEffect(() => setOpen(props.open))
  // Fix round 1, item 5: parseUnifiedDiff (y el aplanado a líneas) memoizados por el string del patch — sin
  // esto se reparsea el patch entero cada vez que Solid reevalúa este componente (p.ej. al cambiar
  // showThinking en la tarjeta hermana), aunque el patch en sí no haya cambiado.
  const files = createMemo(() => parseUnifiedDiff(props.patch))
  const lines = createMemo(() => files().flatMap((f) => f.hunks.flatMap((h) => [{ type: "hunk", text: h.header, oldNo: null as number | null, newNo: null as number | null }, ...h.lines])))
  const color = (ty: string) => ty === "add" ? t().diffAdded : ty === "del" ? t().diffRemoved : ty === "hunk" ? t().info : ty === "meta" ? t().textMuted : t().text
  const stats = () => { let a = 0, d = 0; for (const l of lines()) { if (l.type === "add") a++; else if (l.type === "del") d++ } return `+${a} −${d}` }
  return (
    <box flexDirection="column" paddingLeft={2}>
      <box flexDirection="row" gap={1} onMouseUp={() => setOpen((v) => !v)}>
        <text fg={t().textMuted}>{open() ? "▼" : "▶"}</text>
        <text fg={t().text}>✏️ {props.file}</text>
        <text fg={t().textMuted}>{stats()}{props.untracked ? " · nuevo" : ""}{props.truncated ? " · truncado" : ""}</text>
      </box>
      <Show when={open()}>
        <For each={lines().slice(0, MAX_LINES)}>{(l: any) => (
          <text fg={color(l.type)}>{l.type === "hunk" ? cap(l.text, MAX_LINE_CHARS) : `${String(l.oldNo ?? "").padStart(4)} ${String(l.newNo ?? "").padStart(4)} ${l.type === "add" ? "+" : l.type === "del" ? "-" : " "}${cap(l.text, MAX_LINE_CHARS)}`}</text>
        )}</For>
        <Show when={lines().length > MAX_LINES}><text fg={t().textMuted}>… {lines().length - MAX_LINES} líneas más (o: abrir en el navegador)</text></Show>
      </Show>
    </box>
  )
}
