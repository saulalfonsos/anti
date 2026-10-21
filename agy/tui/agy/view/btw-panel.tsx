/** @jsxImportSource @opentui/solid */
// Panel lateral de /btw: historial + input. Estrecho (<100 col) → se apila debajo (lo decide AgentView por
// flexDirection, ver row() ahí); aquí solo se pinta. `esc` devuelve el foco a la vista sin cerrar el panel.
//
// Foco del input y capa de teclas: el borrador de la tarea usaba `enabled: () => !!input?.focused` en el
// registerLayer del panel, pero agent-view.tsx ya deja constancia (comprobado contra el fuente compilado de
// @opentui/keymap 0.4.5) de que esa opción NO existe en `registerLayer` — ningún layer del host la trae. La
// propia regla del controlador para esta tarea ofrece la alternativa: empujar un modo, como ya hace
// AgentView con "agy.view". Aquí se empuja "agy.btw.input" en cuanto el input recibe foco y se saca al
// perder el foco (enter/escape) o al desmontar — mientras ese modo esté arriba de la pila, la propia capa
// de AgentView (mode: "agy.view") queda inactiva (api.mode solo considera "activo" el tope), así que
// ←/→/f/t/d/o/b no se cuelan mientras se escribe.
//
// Fix round 1 (revisión del controlador sobre 6b388ce), I4:
//   (a) `disposed` se marca en onCleanup y se comprueba en focusInput(): el setTimeout(…, 1) que pide el
//       foco al montar podía disparar DESPUÉS de que el panel ya se hubiera desmontado (montaje/desmontaje
//       rápido, p.ej. abrir y cerrar el panel muy seguido) y empujar "agy.btw.input" sin nadie que lo saque
//       — el modo se habría quedado en la cima de la pila para siempre.
//   (b) Se comprobó si el <input> de opentui expone onFocus/onBlur como prop JSX: NO — grep exhaustivo
//       sobre ~/src/opencode/packages/tui/src no encuentra ni un solo uso de onFocus/onBlur en ningún
//       <input> del propio host; lo único parecido es `renderer.on("focus"/"blur", …)` (attention.ts), que
//       es el foco de la VENTANA del terminal entera (cuando el propio proceso pierde el foco del SO), no
//       el foco de un elemento — no sirve para esto. El propio host, cuando quiere reaccionar a que el
//       ratón mueva el foco a un input, lo hace con `onMouseDown={(r) => r.target?.focus()}`
//       (component/prompt/index.tsx:1438): aquí se sigue el mismo patrón — onMouseDown en el <input> llama
//       a focusInput() (idempotente) además del setTimeout inicial, así un clic de ratón también empuja el
//       modo, no solo el foco automático al abrir el panel.
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { For, Show, createSignal, onCleanup } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import type { Btw } from "../btw"

const BUSY_HINT_MS = 1500

export function BtwPanel(props: { api: TuiPluginApi; btw: Btw; cid: string; parentSessionID?: string; onBlur: () => void }) {
  const t = () => props.api.theme.current
  const th = props.btw.thread(props.cid)
  const dims = useTerminalDimensions()
  const [draft, setDraft] = createSignal("")
  const [hint, setHint] = createSignal<string | null>(null)
  let input: any
  let popInputMode: (() => void) | null = null
  let hintTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  const focusInput = () => {
    if (disposed) return
    if (!input || input.isDestroyed) return
    input.focus()
    if (!popInputMode) popInputMode = props.api.mode.push("agy.btw.input")
  }
  const blurToView = () => {
    if (input && !input.isDestroyed) input.blur()
    if (popInputMode) { popInputMode(); popInputMode = null }
    props.onBlur()
  }
  // InputRenderable de @opentui/core 0.4.5 NO tiene clear(); lo que sí expone es el setter `value`. Se
  // intentan los dos (otras versiones sí traen clear) y se ignora cualquier fallo: no vaciar el input es
  // molesto, pero romper el manejador de enter lo es mucho más.
  const setInputText = (v: string) => {
    try {
      if (!input) return
      if (v === "" && typeof input.clear === "function") input.clear()
      else input.value = v
    } catch { /* versión del renderable sin API de escritura */ }
  }
  const send = () => {
    const text = draft().trim()
    if (!text) return
    if (th.busy()) {
      // Minor de la revisión: no perder lo escrito ni fallar en silencio — un aviso breve, y el borrador se
      // queda tal cual para reintentar cuando Ling termine.
      setHint("espera a que Ling termine…")
      if (hintTimer) clearTimeout(hintTimer)
      hintTimer = setTimeout(() => setHint(null), BUSY_HINT_MS)
      return
    }
    setDraft("")
    setInputText("")
    // ask() devuelve false cuando ni siquiera intentó enviar (falta el agente btw, o todavía no hay registro
    // del agente): en ese caso se devuelve lo escrito al input en vez de tirarlo (M5 de la revisión final).
    void props.btw.ask(props.cid, props.parentSessionID, text).then((sent) => {
      if (sent || disposed) return
      setDraft(text)
      setInputText(text)
    }, () => { /* ask() ya avisa por th.error(); aquí solo se evita el rechazo sin manejador */ })
  }

  const off = props.api.keymap.registerLayer({
    mode: "agy.btw.input",
    priority: 600,
    commands: [
      { name: "agy.btw.send", title: "btw: enviar", run: send },
      { name: "agy.btw.blur", title: "btw: soltar foco", run: blurToView },
    ],
    bindings: [
      { key: "enter", cmd: "agy.btw.send", desc: "Enviar" },
      { key: "escape", cmd: "agy.btw.blur", desc: "Volver a la vista" },
    ],
  })
  onCleanup(() => {
    disposed = true
    if (hintTimer) { clearTimeout(hintTimer); hintTimer = null }
    if (typeof off === "function") off()
    if (popInputMode) { popInputMode(); popInputMode = null }
  })

  const width = () => Math.max(40, Math.floor(dims().width * 0.38))
  const narrow = () => dims().width < 100

  return (
    <box
      flexDirection="column"
      width={narrow() ? "100%" : width()}
      height={narrow() ? "40%" : "100%"}
      border={narrow() ? ["top"] : ["left"]}
      borderColor={t().border}
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={t().primary}>
        <b>btw</b> <span style={{ fg: t().textMuted }}>· Ling sobre este agente · esc: volver</span>
      </text>
      <scrollbox flexGrow={1} minHeight={0} stickyScroll={true} stickyStart="bottom">
        <For each={th.messages()}>
          {(m) => (
            <text fg={m.role === "user" ? t().text : t().textMuted}>
              {m.role === "user" ? "tú: " : "ling: "}
              {m.text}
              {m.role === "assistant" && !m.done ? " ▍" : ""}
            </text>
          )}
        </For>
        <Show when={th.busy() && th.messages().at(-1)?.role === "user"}>
          <text fg={t().textMuted}>ling: …</text>
        </Show>
        <Show when={th.error()}>
          <text fg={t().error}>{th.error()}</text>
        </Show>
      </scrollbox>
      <Show when={hint()}>
        <text fg={t().warning}>{hint()}</text>
      </Show>
      <input
        ref={(r: any) => {
          input = r
          // Igual que dialog-select.tsx:572-596 (host): el setTimeout deja que el input termine de
          // montarse antes de pedirle el foco.
          setTimeout(() => { if (!disposed && r && !r.isDestroyed) focusInput() }, 1)
        }}
        onInput={(v: string) => setDraft(v)}
        onMouseDown={() => focusInput()}
        placeholder="pregunta sobre este agente…"
        placeholderColor={t().textMuted}
        focusedBackgroundColor={t().backgroundPanel}
        cursorColor={t().primary}
      />
    </box>
  )
}
