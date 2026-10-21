/** @jsxImportSource @opentui/solid */
// La tool `antigravity` en el chat principal y en la vista de agente (fase 15, D318, D320, D321), con el aspecto del chat del IDE de
// Antigravity y cada cosa distinta que hace el agente separada por una línea:
//   · «◆ Gemini 3.8 Flash Low · pensó 9.4s · 4 turnos · 52s · +79k tok ✓» marca lo que hace Gemini (lo que no lleva esta cabecera es
//     del traductor);
//   · cada herramienta es una fila «verbo en gris · objeto · +a −b · detalle · ›» que se despliega con un clic; las exploraciones seguidas
//     se agrupan («Explored 2 files, 1 search ›»); la terminal y los diffs van abiertos; lo que está en curso, desplegado y con el
//     indicador de trabajo;
//   · los cuerpos (terminal, diff, salida, respuesta web) van en una ventana con borde y scroll propio;
//   · avisos, preguntas, permisos y errores con su color.
// En el chat, al terminar, se pliega en «Worked for 52s ›» con los avisos, el último mensaje de agy y la tarjeta de ficheros cambiados
// (con su diff); en la vista de agente (`collapse={false}`) se ve todo. Las filas salen de `steps.ts#present`.
import { For, Match, Show, Switch, createMemo, createSignal, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { TextAttributes, type RGBA } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { useTheme } from "../../../context/theme"
import { Rings } from "../../../component/brand/marks"
import { filesChanged, present, thought, workedFor, type AgyView, type Body, type CallRow, type Row, type StepRow, type Tone } from "./steps"

const WINDOW_LINES = 12
// Una tarjeta de ficheros con menos líneas de diff que esto los enseña abiertos; con más, plegados (un clic los abre).
const OPEN_DIFF_LINES = 40
const ICONS: Record<NonNullable<StepRow["icon"]>, string> = { file: "▤", page: "≡", folder: "▣", image: "◩" }

export function isAgyView(value: unknown): value is AgyView {
  return !!value && typeof value === "object" && Array.isArray((value as { calls?: unknown }).calls)
}

// «View Page»: la página que leyó agy, en el navegador del sistema.
function openUrl(url: string) {
  try {
    const cmd = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd.exe", "/c", "start", "", url] : ["xdg-open", url]
    Bun.spawn(cmd, { stdio: ["ignore", "ignore", "ignore"] })
  } catch {
    // Sin «open», «xdg-open» ni «start» no hay nada que abrir.
  }
}

function useTone() {
  const { theme } = useTheme()
  return (tone: Tone | undefined, fallback: RGBA): RGBA =>
    tone === "ok" ? theme.success : tone === "error" ? theme.error : tone === "warning" ? theme.warning : tone === "muted" ? theme.textMuted : fallback
}

function Clickable(props: { onClick?: () => void; children: JSX.Element }) {
  const renderer = useRenderer()
  return (
    <box
      flexDirection="row"
      flexShrink={0}
      onMouseUp={() => {
        if (renderer.getSelection()?.getSelectedText()) return
        props.onClick?.()
      }}
    >
      {props.children}
    </box>
  )
}

// La línea que separa cada cosa distinta del agente.
function Separator() {
  const { theme } = useTheme()
  return <box border={["top"]} borderStyle="single" borderColor={theme.borderSubtle} height={1} flexShrink={0} />
}

// Markdown ligero de las respuestas web y de los mensajes de agy: **negrita** (que puede llevar dentro código o un enlace, como
// «**[`src/a.mjs`](file:///…)**»), `código`, [enlaces](url), listas con viñeta o número, títulos, separadores y bloques ```.
function Inline(props: { text: string; bold?: boolean }) {
  const { theme } = useTheme()
  const parts = createMemo(() => props.text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g).filter((part) => part !== ""))
  const attributes = (extra = 0) => (props.bold ? TextAttributes.BOLD : 0) | extra
  return (
    <For each={parts()}>
      {(part) => (
        <Switch fallback={<span style={{ fg: theme.text, attributes: attributes() }}>{part}</span>}>
          <Match when={part.startsWith("**")}>
            <Inline text={part.slice(2, -2)} bold />
          </Match>
          <Match when={part.startsWith("`")}>
            <span style={{ fg: theme.markdownCode, attributes: attributes() }}>{part.slice(1, -1)}</span>
          </Match>
          <Match when={part.startsWith("[") && /^\[([^\]]+)\]\(/.exec(part)}>
            {(link) => <span style={{ fg: theme.markdownLink, attributes: attributes(TextAttributes.UNDERLINE) }}>{link()[1]!.replace(/`|\*\*/g, "")}</span>}
          </Match>
        </Switch>
      )}
    </For>
  )
}

function blocks(text: string): { code: boolean; line: string }[] {
  let code = false
  return text.replace(/\r/g, "").split("\n").flatMap((line) => {
    if (/^\s*```/.test(line)) {
      code = !code
      return []
    }
    return [{ code, line }]
  })
}

function Markdown(props: { text: string }) {
  const { theme } = useTheme()
  const lines = createMemo(() => blocks(props.text.trim()))
  return (
    <box flexDirection="column" flexShrink={0}>
      <For each={lines()}>
        {(item) => {
          if (item.code) return <text fg={theme.markdownCode}>{"  "}{item.line}</text>
          if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(item.line)) return <Separator />
          const bullet = /^(\s*)([-*]|\d+\.) (.*)$/.exec(item.line)
          const heading = /^#{1,6} (.*)$/.exec(item.line)
          if (bullet)
            return (
              <text wrapMode="word">
                {"  ".repeat(Math.ceil(bullet[1]!.length / 3))}
                <span style={{ fg: theme.textMuted }}>{/\d/.test(bullet[2]!) ? bullet[2] : "•"} </span>
                <Inline text={bullet[3]!} />
              </text>
            )
          if (heading) return <text wrapMode="word" fg={theme.text} attributes={TextAttributes.BOLD}>{heading[1]}</text>
          return <text wrapMode="word"><Inline text={item.line} /></text>
        }}
      </For>
    </box>
  )
}

function Window(props: { body: Body }) {
  const { theme } = useTheme()
  const text = createMemo(() => {
    const body = props.body
    if (body.kind === "image") return body.paths.join("\n")
    if (body.kind === "diff") return body.patch
    if (body.kind === "terminal") return body.output
    return body.text
  })
  const lines = createMemo(() => text().replace(/\n+$/, "").split("\n"))
  // La terminal lleva además su línea «$ orden».
  const extra = () => (props.body.kind === "terminal" ? 1 : 0)
  const height = createMemo(() => Math.min((text().trim() ? lines().length : 0) + extra(), WINDOW_LINES) + 2)
  const diffColor = (line: string) =>
    line.startsWith("+") && !line.startsWith("+++") ? theme.diffAdded : line.startsWith("-") && !line.startsWith("---") ? theme.diffRemoved : line.startsWith("@@") ? theme.info : theme.textMuted
  return (
    <box border borderStyle="rounded" borderColor={theme.border} marginLeft={2} height={height()} flexShrink={0}>
      <scrollbox flexGrow={1} minHeight={0} paddingLeft={1} paddingRight={1}>
        <Switch fallback={<text fg={theme.text}>{lines().join("\n")}</text>}>
          <Match when={props.body.kind === "terminal" && props.body}>
            {(body) => (
              <>
                <text fg={theme.textMuted}>$ <span style={{ fg: theme.text }}>{body().command}</span></text>
                <Show when={body().output.trim()}>
                  <text fg={theme.text}>{lines().join("\n")}</text>
                </Show>
              </>
            )}
          </Match>
          <Match when={props.body.kind === "diff"}>
            <For each={lines()}>{(line) => <text fg={diffColor(line)}>{line}</text>}</For>
          </Match>
          <Match when={props.body.kind === "markdown"}>
            <Markdown text={text()} />
          </Match>
          <Match when={props.body.kind === "image"}>
            <text fg={theme.textMuted}>{lines().join("\n")}</text>
          </Match>
        </Switch>
      </scrollbox>
    </box>
  )
}

function Step(props: { row: StepRow; open: boolean; onToggle: () => void }) {
  const { theme } = useTheme()
  const tone = useTone()
  return (
    <box flexDirection="column" flexShrink={0} gap={props.row.body && props.open ? 1 : 0}>
      <Clickable onClick={props.row.body ? props.onToggle : undefined}>
        <text wrapMode="word" flexShrink={1}>
          <span style={{ fg: props.row.failed ? theme.error : theme.textMuted }}>{props.row.verb} </span>
          <Show when={props.row.icon}>{(icon) => <span style={{ fg: theme.textMuted }}>{ICONS[icon()]} </span>}</Show>
          <span style={{ fg: props.row.failed ? theme.error : theme.text }}>{props.row.object}</span>
          <Show when={props.row.add !== undefined && (props.row.add > 0 || (props.row.del ?? 0) > 0)}>
            <span style={{ fg: theme.diffAdded }}> +{props.row.add}</span>
            <span style={{ fg: theme.diffRemoved }}> -{props.row.del}</span>
          </Show>
          <Show when={props.row.detail}>
            {(detail) => <span style={{ fg: tone(props.row.failed ? undefined : props.row.tone, theme.textMuted) }}> · {detail()}</span>}
          </Show>
          <Show when={props.row.body}><span style={{ fg: theme.textMuted }}> {props.open ? "⌄" : "›"}</span></Show>
        </text>
        <Show when={props.row.running}><box marginLeft={1}><Rings /></box></Show>
        <Show when={props.row.href}>
          {(href) => (
            <>
              <box flexGrow={1} />
              <Clickable onClick={() => openUrl(href())}>
                <text fg={theme.textMuted}>View Page</text>
              </Clickable>
            </>
          )}
        </Show>
      </Clickable>
      <Show when={props.open && props.row.body}>{(body) => <Window body={body()} />}</Show>
    </box>
  )
}

const STATE: Record<CallRow["state"], [string, Tone]> = {
  running: ["", "muted"],
  ok: ["✓", "ok"],
  error: ["✗ error", "error"],
  question: ["? pregunta", "warning"],
  denied: ["⛔ denegada", "error"],
  cut: ["⏹ cortada por el detector de bucles", "error"],
  nudged: ["⏸ pausada para avisarle; sigue abajo", "warning"],
}

const kTokens = (tokens: number) => (tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens))

// Lo que hace Gemini: modelo, rol, lo que pensó, turnos, duración, tokens y estado.
function CallHead(props: { row: CallRow; worked?: { duration: string; open: boolean; onToggle: () => void } }) {
  const { theme } = useTheme()
  const tone = useTone()
  const detail = () =>
    [
      props.row.role,
      props.row.turns
        ? `pensó ${thought(props.row.modelSeconds)}${props.row.thinkingTokens ? ` (${kTokens(props.row.thinkingTokens)} tok de pensamiento)` : ""} en ${props.row.turns} ${props.row.turns === 1 ? "turno" : "turnos"}`
        : "",
      props.worked || props.row.seconds === undefined ? "" : `${props.row.seconds}s`,
      props.row.tokens ? `+${kTokens(props.row.tokens)} tok` : "",
    ].filter(Boolean)
  return (
    <box flexDirection="column" flexShrink={0}>
      <Clickable onClick={props.worked?.onToggle}>
        <text wrapMode="word" flexShrink={1}>
          <span style={{ fg: props.row.pro ? theme.primary : theme.secondary }}>◆ </span>
          <span style={{ fg: theme.text, attributes: TextAttributes.BOLD }}>{props.row.model}</span>
          <Show when={props.worked}>
            {(worked) => (
              <>
                <span style={{ fg: theme.textMuted }}> · Worked for </span>
                <span style={{ fg: theme.text }}>{worked().duration}</span>
              </>
            )}
          </Show>
          <Show when={detail().length}><span style={{ fg: theme.textMuted }}> · {detail().join(" · ")}</span></Show>
          <Show when={STATE[props.row.state][0]}><span style={{ fg: tone(STATE[props.row.state][1], theme.textMuted) }}> {STATE[props.row.state][0]}</span></Show>
          <Show when={props.worked}>{(worked) => <span style={{ fg: theme.textMuted }}> {worked().open ? "⌄" : "›"}</span>}</Show>
        </text>
        <Show when={props.row.state === "running"}><box marginLeft={1}><Rings /></box></Show>
      </Clickable>
      <Show when={props.row.notes.length}>
        <text wrapMode="word" fg={theme.textMuted}>  {props.row.notes.join(" · ")}</text>
      </Show>
    </box>
  )
}

const PLAN_MARK: Record<string, string> = { done: "✓", running: "◐", failed: "✗", waiting: "?", pending: "○" }

// `full`: la vista de agente, donde también los grupos de exploración se ven abiertos.
function RowView(props: { row: Row; id: string; full?: boolean; isOpen: (key: string, initial: boolean) => boolean; toggle: (key: string, initial: boolean) => void }) {
  const { theme } = useTheme()
  const tone = useTone()
  return (
    <Switch>
      <Match when={props.row.kind === "call" && props.row}>{(row) => <CallHead row={row()} />}</Match>
      <Match when={props.row.kind === "step" && props.row}>
        {(step) => <Step row={step()} open={props.isOpen(props.id, step().open)} onToggle={() => props.toggle(props.id, step().open)} />}
      </Match>
      <Match when={props.row.kind === "group" && props.row}>
        {(group) => (
          <box flexDirection="column" flexShrink={0}>
            <Clickable onClick={() => props.toggle(props.id, group().open || !!props.full)}>
              <text fg={theme.textMuted}>{group().verb} </text>
              <text fg={theme.text}>{group().summary}</text>
              <Show when={group().running}><box marginLeft={1}><Rings /></box></Show>
              <text fg={theme.textMuted}> {props.isOpen(props.id, group().open || !!props.full) ? "⌄" : "›"}</text>
            </Clickable>
            <Show when={props.isOpen(props.id, group().open || !!props.full)}>
              <box flexDirection="column" paddingLeft={2} paddingTop={1} gap={1}>
                <For each={group().children}>
                  {(child, i) => <Step row={child} open={props.isOpen(`${props.id}.${i()}`, child.open)} onToggle={() => props.toggle(`${props.id}.${i()}`, child.open)} />}
                </For>
              </box>
            </Show>
          </box>
        )}
      </Match>
      <Match when={props.row.kind === "text" && props.row}>{(text) => <Markdown text={text().text} />}</Match>
      <Match when={props.row.kind === "question" && props.row}>
        {(question) => (
          <box border borderStyle="rounded" borderColor={theme.warning} paddingLeft={1} paddingRight={1} flexShrink={0}>
            <text wrapMode="word"><span style={{ fg: theme.warning }}>? Antigravity pregunta: </span><span style={{ fg: theme.text }}>{question().text}</span></text>
          </box>
        )}
      </Match>
      <Match when={props.row.kind === "denied" && props.row}>
        {(denied) => <text wrapMode="word" fg={tone(denied().tone, theme.error)}>{denied().tone === "ok" ? "🔓 " : "🔒 "}{denied().text}</text>}
      </Match>
      <Match when={props.row.kind === "note" && props.row}>
        {(note) => <text wrapMode="word" fg={tone(note().tone, theme.textMuted)}>{note().tone === "warning" ? "⚠ " : note().tone === "error" ? "■ " : "· "}{note().text}</text>}
      </Match>
      <Match when={props.row.kind === "error" && props.row}>
        {(error) => (
          <box flexDirection="column" flexShrink={0}>
            <text wrapMode="word" fg={theme.error}>✗ {error().text}. La tarea no está hecha.</text>
          </box>
        )}
      </Match>
      <Match when={props.row.kind === "plan" && props.row}>
        {(plan) => (
          <box border borderStyle="rounded" borderColor={theme.border} paddingLeft={1} paddingRight={1} flexDirection="column" flexShrink={0}>
            <text fg={theme.text} attributes={TextAttributes.BOLD}>Plan{plan().answer ? ` · ${plan().answer}` : ""}</text>
            <For each={plan().steps}>
              {(s, i) => (
                <text wrapMode="word">
                  <span style={{ fg: s.status === "done" ? theme.success : s.status === "failed" ? theme.error : s.status === "running" ? theme.warning : theme.textMuted }}>{PLAN_MARK[s.status ?? "pending"] ?? "○"} </span>
                  <span style={{ fg: theme.textMuted }}>{`${i() + 1}. ${s.layer ?? ""} · `}</span>
                  <span style={{ fg: theme.text }}>{s.instruction ?? ""}</span>
                </text>
              )}
            </For>
          </box>
        )}
      </Match>
    </Switch>
  )
}

// Las filas, cada cosa distinta separada por una línea.
function Rows(props: { rows: readonly Row[]; prefix: string; full?: boolean; isOpen: (key: string, initial: boolean) => boolean; toggle: (key: string, initial: boolean) => void }) {
  return (
    <box flexDirection="column" flexShrink={0}>
      <For each={props.rows}>
        {(row, index) => (
          <box flexDirection="column" flexShrink={0}>
            <Show when={index() > 0}><Separator /></Show>
            <box paddingTop={index() > 0 ? 1 : 0} paddingBottom={1} flexShrink={0}>
              <RowView row={row} id={`${props.prefix}${index()}`} full={props.full} isOpen={props.isOpen} toggle={props.toggle} />
            </box>
          </box>
        )}
      </For>
    </box>
  )
}

// Los ficheros que cambió agy, cada uno con su +/− y su diff (abierto si caben, si no un clic).
function FilesCard(props: { view: AgyView; isOpen: (key: string, initial: boolean) => boolean; toggle: (key: string, initial: boolean) => void }) {
  const { theme } = useTheme()
  const files = createMemo(() => filesChanged(props.view))
  const total = createMemo(() =>
    files().reduce((sum, f) => ({ add: sum.add + f.add, del: sum.del + f.del, lines: sum.lines + f.patches.join("\n").split("\n").length }), { add: 0, del: 0, lines: 0 }),
  )
  const initial = () => total().lines <= OPEN_DIFF_LINES
  return (
    <Show when={files().length}>
      <box border borderStyle="rounded" borderColor={theme.border} paddingLeft={1} paddingRight={1} flexDirection="column" flexShrink={0} gap={1}>
        <text>
          <span style={{ fg: theme.text }}>{files().length} {files().length === 1 ? "file" : "files"} changed</span>
          <span style={{ fg: theme.diffAdded }}> +{total().add}</span>
          <span style={{ fg: theme.diffRemoved }}> -{total().del}</span>
        </text>
        <For each={files()}>
          {(file) => (
            <box flexDirection="column" flexShrink={0}>
              <Clickable onClick={() => props.toggle(`f:${file.path}`, initial())}>
                <text wrapMode="word" flexShrink={1}>
                  <span style={{ fg: theme.textMuted }}>{ICONS.file} </span>
                  <span style={{ fg: theme.text }}>{file.path}</span>
                  <Show when={file.created}><span style={{ fg: theme.success }}> (nuevo)</span></Show>
                  <span style={{ fg: theme.diffAdded }}> +{file.add}</span>
                  <span style={{ fg: theme.diffRemoved }}> -{file.del}</span>
                  <span style={{ fg: theme.textMuted }}> {props.isOpen(`f:${file.path}`, initial()) ? "⌄" : "›"}</span>
                </text>
              </Clickable>
              <Show when={props.isOpen(`f:${file.path}`, initial())}>
                <Window body={{ kind: "diff", patch: file.patches.join("\n") }} />
              </Show>
            </box>
          )}
        </For>
      </box>
    </Show>
  )
}

export function AgyTool(props: { view: AgyView; running: boolean; collapse?: boolean }) {
  const rows = createMemo(() => present(props.view))
  const done = createMemo(() => (props.running ? undefined : workedFor(props.view)))
  // Lo que el usuario despliega o pliega a mano; sin entrada, cada fila sigue su valor por defecto.
  const [overrides, setOverrides] = createStore<Record<string, boolean>>({})
  const isOpen = (key: string, initial: boolean) => overrides[key] ?? initial
  const toggle = (key: string, initial: boolean) => setOverrides(key, !isOpen(key, initial))
  const [expanded, setExpanded] = createSignal(false)
  const first = createMemo(() => rows().find((row): row is CallRow => row.kind === "call"))
  const last = createMemo(() => [...rows()].reverse().find((row): row is Extract<Row, { kind: "text" }> => row.kind === "text"))
  // Las órdenes y los tests que ejecutó (con su resultado) siguen a la vista al plegar, una línea cada una: son la prueba de lo que hizo.
  const commands = createMemo(() =>
    rows().filter((row): row is StepRow => row.kind === "step" && (row.body?.kind === "terminal" || row.verb === "Failed to run" || row.verb === "Ran tests with anti" || row.verb.startsWith("Opened in its own terminal"))),
  )
  // Errores, avisos, preguntas y permisos denegados no se esconden al plegar: son lo que el usuario tiene que ver.
  const alerts = createMemo(() =>
    rows().filter((row) => row.kind === "error" || row.kind === "question" || (row.kind === "note" && row.tone !== "muted") || (row.kind === "denied" && row.tone !== "ok")),
  )
  return (
    <box flexDirection="column" marginTop={1} paddingLeft={3} flexShrink={0}>
      <Show
        when={props.collapse !== false && done() && first()}
        fallback={
          <box flexDirection="column" flexShrink={0} gap={1}>
            <Rows rows={rows()} prefix="r" full={props.collapse === false} isOpen={isOpen} toggle={toggle} />
            <Show when={done()}><FilesCard view={props.view} isOpen={isOpen} toggle={toggle} /></Show>
          </box>
        }
      >
        {(head) => (
          <box flexDirection="column" gap={1} flexShrink={0}>
            <CallHead row={head()} worked={{ duration: done()!.duration, open: expanded(), onToggle: () => setExpanded((v) => !v) }} />
            <Show when={expanded()}>
              <Rows rows={rows().slice(1)} prefix="r" isOpen={isOpen} toggle={toggle} />
            </Show>
            <Show when={!expanded()}>
              <For each={alerts()}>{(row, i) => <RowView row={row} id={`a${i()}`} isOpen={isOpen} toggle={toggle} />}</For>
              <Show when={commands().length}>
                <box flexDirection="column" flexShrink={0}>
                  <For each={commands()}>{(row, i) => <Step row={row} open={isOpen(`c${i()}`, false)} onToggle={() => toggle(`c${i()}`, false)} />}</For>
                </box>
              </Show>
              <Show when={last()}>{(text) => <Markdown text={text().text} />}</Show>
            </Show>
            <FilesCard view={props.view} isOpen={isOpen} toggle={toggle} />
          </box>
        )}
      </Show>
    </box>
  )
}
