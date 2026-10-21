// Presentador de la tool `antigravity` en el chat (fase 15, D318, D321). La config de anti manda en los metadatos de la parte (`agy`) el
// desglose de lo que hace agy (el modelo del reductor de eventos: llamadas con sus items). Aquí se convierte en filas con el vocabulario
// y la jerarquía del chat del IDE de Antigravity, una fila por cosa distinta que hace el agente:
//   · una cabecera por llamada de Gemini: modelo, rol (orquestador, paso k/n), lo que pensó, turnos, duración, tokens y estado;
//   · las exploraciones seguidas (leer, listar, buscar, web, recursos, `leer` de anti) se agrupan en «Explored 2 files, 1 search», con
//     una fila hija por herramienta y lo que trae su salida (líneas del fichero, entradas, resultados, ficheros que no existen);
//   · las órdenes son «Ran orden» con su terminal abierta, su directorio si no es el del proyecto, si van en segundo plano y el resumen
//     de los tests que haya en la salida (node --test, pytest, jest);
//   · las ediciones son «Created/Edited ruta +a −b» con su diff abierto;
//   · avisos (detector de bucles, aborto, tiempo máximo), preguntas, permisos y errores tienen su propia fila y su tono.
// Los formatos de las salidas son los REALES del stream de agy: `view_file` solo trae «N lines, M bytes», `list_dir` una entrada por
// línea, `run_command` la salida sin código de salida (ERROR = denegada o no arrancó), `call_mcp_tool` los Arguments como texto.
// Un texto del agente corta el grupo, como en el IDE. Puro: sin TUI.
export type AgyItem = { readonly kind: string; readonly [key: string]: unknown }
export type AgyCall = {
  readonly n: number
  readonly layer: string
  readonly model: string
  readonly start: string
  readonly end: string | null
  readonly status: string | null
  readonly items: readonly AgyItem[]
  readonly step?: { readonly k: number; readonly n: number } | null
  readonly denied?: boolean
  readonly notes?: readonly string[]
  readonly usage?: { readonly tokens?: { readonly delta?: number } } | null
  readonly turns?: number
  readonly modelSeconds?: number
  readonly thinkingTokens?: number
}
export type AgyPlanStep = { readonly k: number; readonly layer?: string; readonly instruction?: string; readonly status?: string }
export type AgyView = {
  readonly version: number
  readonly cwd: string
  readonly live: boolean
  readonly calls: readonly AgyCall[]
  readonly plan?: { readonly answer?: string; readonly steps: readonly AgyPlanStep[] } | null
}

export type Tone = "ok" | "error" | "warning" | "muted"
export type Body =
  | { readonly kind: "output"; readonly text: string }
  | { readonly kind: "markdown"; readonly text: string }
  | { readonly kind: "diff"; readonly patch: string }
  | { readonly kind: "image"; readonly paths: readonly string[] }
  | { readonly kind: "terminal"; readonly command: string; readonly output: string }

export type StepRow = {
  readonly kind: "step"
  readonly verb: string
  readonly object: string
  readonly icon?: "file" | "page" | "folder" | "image"
  // Lo que se sabe además (líneas, resultados, cwd, «background», resumen de tests…), en gris tras el objeto.
  detail?: string
  readonly tone?: Tone
  // Enlace que abre «View Page» (lecturas de páginas web).
  readonly href?: string
  add?: number
  del?: number
  readonly running: boolean
  readonly failed: boolean
  readonly open: boolean
  body?: Body
  readonly file?: string
}
export type GroupRow = {
  readonly kind: "group"
  readonly verb: "Explored" | "Exploring"
  readonly summary: string
  readonly running: boolean
  readonly open: boolean
  readonly children: readonly StepRow[]
}
export type CallRow = {
  readonly kind: "call"
  readonly model: string
  readonly pro: boolean
  readonly role: string
  readonly state: "running" | "ok" | "error" | "question" | "denied" | "cut" | "nudged"
  readonly modelSeconds: number
  readonly turns: number
  readonly thinkingTokens: number
  readonly seconds?: number
  readonly tokens?: number
  readonly notes: readonly string[]
}
export type Row =
  | StepRow
  | GroupRow
  | CallRow
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "question"; readonly text: string }
  | { readonly kind: "denied"; readonly tone: Tone; readonly text: string }
  | { readonly kind: "note"; readonly tone: Tone; readonly text: string }
  | { readonly kind: "error"; readonly text: string; readonly notes: readonly string[] }
  | { readonly kind: "plan"; readonly answer: string; readonly steps: readonly AgyPlanStep[] }

const str = (value: unknown): string => (typeof value === "string" ? value : value === undefined || value === null ? "" : String(value))
const pick = (parameters: Record<string, unknown>, ...keys: string[]) => str(keys.map((key) => parameters[key]).find((value) => value !== undefined && value !== ""))
const lines = (text: string) => text.split("\n").filter((line) => line.trim() !== "")
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const cap = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text)

function relative(cwd: string, file: string): string {
  if (!file) return ""
  if (file === cwd) return cwd.split("/").filter(Boolean).at(-1) ?? file
  return cwd && file.startsWith(`${cwd}/`) ? file.slice(cwd.length + 1) : file
}
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

// «gemini-3.8-flash-low» → «Gemini 3.8 Flash Low», como lo nombra el IDE. Otros modelos, tal cual.
export function modelName(id: string): string {
  const match = /^gemini-(\d+(?:\.\d+)?)-(.+)$/.exec(id)
  if (!match) return id
  return `Gemini ${match[1]} ${match[2]!.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")}`
}

// Resumen de tests en la salida de una orden, si lo hay: node --test (ℹ/# pass|fail), pytest («3 failed, 5 passed») y jest («Tests: …»).
function testSummary(output: string): { pass: number; fail: number } | undefined {
  const node = { pass: /^(?:ℹ|#) pass (\d+)/m.exec(output), fail: /^(?:ℹ|#) fail (\d+)/m.exec(output) }
  if (node.pass || node.fail) return { pass: Number(node.pass?.[1] ?? 0), fail: Number(node.fail?.[1] ?? 0) }
  const jest = /Tests:\s+(?:(\d+) failed, )?(?:\d+ skipped, )?(\d+) passed/.exec(output)
  if (jest) return { pass: Number(jest[2]), fail: Number(jest[1] ?? 0) }
  const pyFail = /(\d+) failed/.exec(output)
  const pyPass = /(\d+) passed/.exec(output)
  if (pyFail || pyPass) return { pass: Number(pyPass?.[1] ?? 0), fail: Number(pyFail?.[1] ?? 0) }
  return undefined
}

// Las herramientas de exploración, en qué cuenta del grupo caen y cuántas unidades suma cada una.
type Kind = readonly [string, string]
const FILE: Kind = ["file", "files"]
const EXPLORE: Record<string, Kind> = {
  view_file: FILE,
  view_file_outline: FILE,
  view_code_item: FILE,
  list_dir: ["folder", "folders"],
  grep_search: ["search", "searches"],
  find_by_name: ["search", "searches"],
  codebase_search: ["search", "searches"],
  search_web: ["page", "pages"],
  read_url_content: ["page", "pages"],
  read_browser_page: ["page", "pages"],
  list_resources: ["resource", "resources"],
  read_resource: ["resource", "resources"],
}
const EDIT = new Set(["write_to_file", "replace_file_content", "multi_replace_file_content", "sed_file", "notebook_edit"])
const HIDDEN = new Set(["finish", "task_boundary"])
const ANTI = new Set(["anti", "anti_anti"])

const isAnti = (item: AgyItem, tool: string) => {
  const p = (item.parameters ?? {}) as Record<string, unknown>
  return str(item.name) === "call_mcp_tool" && ANTI.has(pick(p, "ServerName")) && pick(p, "ToolName") === tool
}
// Los Arguments de `call_mcp_tool` llegan como texto (a veces con comillas simples): se sacan las rutas sin parsear JSON.
const routes = (args: string) => [...args.matchAll(/['"]ruta['"]\s*:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!)
const testFiles = (args: string) => {
  const list = /['"]ficheros['"]\s*:\s*\[([^\]]*)\]/.exec(args)?.[1] ?? ""
  return [...list.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]!)
}

function explores(item: AgyItem): { kind: Kind; units: number } | undefined {
  if (item.kind !== "tool") return undefined
  const kind = EXPLORE[str(item.name)]
  if (kind) return { kind, units: 1 }
  if (isAnti(item, "leer")) return { kind: FILE, units: Math.max(1, routes(str(((item.parameters ?? {}) as Record<string, unknown>).Arguments)).length) }
  return undefined
}

function step(input: Omit<StepRow, "kind" | "open"> & { readonly open?: boolean }): StepRow {
  return { kind: "step", open: input.open ?? input.running, ...input }
}
const verb = (done: string, doing: string, running: boolean) => (running ? doing : done)
const join = (...parts: (string | undefined | false)[]) => parts.filter(Boolean).join(" · ") || undefined

function presentTool(item: AgyItem, cwd: string): StepRow | undefined {
  const name = str(item.name)
  if (HIDDEN.has(name)) return undefined
  const p = (item.parameters ?? {}) as Record<string, unknown>
  const running = item.state === "running"
  const failed = item.state === "error"
  const output = str(item.output)
  const has = output.trim() !== ""
  const out: Body | undefined = has ? { kind: "output", text: output } : undefined
  const md: Body | undefined = has ? { kind: "markdown", text: output } : undefined
  const common = { running, failed, ...(failed ? { tone: "error" as const } : {}) }
  const count = (one: string, many: string) => (running ? undefined : lines(output).length ? plural(lines(output).length, one, many) : `no ${many}`)
  const where = (dir: string) => (dir && dir !== cwd ? ` in ${relative(cwd, dir)}` : "")

  if (isAnti(item, "leer")) {
    const files = routes(pick(p, "Arguments"))
    const missing = (output.match(/· error:/g) ?? []).length
    return step({ ...common, verb: verb("Read with anti", "Reading with anti", running), object: files.join(", ") || "files", icon: "file", detail: missing ? `${missing} missing` : undefined, body: out })
  }
  if (isAnti(item, "probar")) {
    const files = testFiles(pick(p, "Arguments"))
    const first = lines(output)[0] ?? ""
    const bad = /falla|fail(?:ed|s)?\b(?![: ]*0\b)|✖|not ok/i.test(output) && !/todos pasan/i.test(first)
    const tone: Tone | undefined = failed || bad ? "error" : /todos pasan|\b0 fail|all pass/i.test(output) ? "ok" : undefined
    return step({ ...common, verb: verb("Ran tests with anti", "Running tests with anti", running), object: files.join(", ") || "all tests", detail: first || undefined, ...(tone ? { tone } : {}), open: running || tone === "error", body: out })
  }

  switch (name) {
    case "view_file": {
      const file = relative(cwd, pick(p, "AbsolutePath", "File"))
      const start = Number(p.StartLine)
      const end = Number(p.EndLine)
      const range = start > 0 && end > 0 ? `:${start}-${end}` : ""
      const summary = /^(\d+) lines?/.exec(output.trim())
      // El stream solo trae «N lines, M bytes»; un subagente (D324) guarda el contenido con «Total Lines: N», y va en su ventana.
      const total = /^Total Lines: (\d+)/m.exec(output)
      const n = summary?.[1] ?? total?.[1]
      return step({ ...common, verb: verb("Viewed", "Viewing", running), object: `${file}${range}`, icon: "file", detail: n ? plural(Number(n), "line", "lines") : undefined, body: summary ? undefined : out })
    }
    case "view_file_outline":
    case "view_code_item":
      return step({ ...common, verb: verb("Analyzed", "Analyzing", running), object: relative(cwd, pick(p, "AbsolutePath", "File")), icon: "file", body: out })
    case "list_dir":
      return step({ ...common, verb: verb("Listed directory", "Listing directory", running), object: relative(cwd, pick(p, "DirectoryPath", "Path")), icon: "folder", detail: count("entry", "entries"), body: out })
    case "grep_search":
      return step({ ...common, verb: verb("Searched for", "Searching for", running), object: `"${pick(p, "Query", "Pattern")}"${where(pick(p, "SearchPath"))}`, detail: count("result", "results"), body: out })
    case "find_by_name":
      return step({ ...common, verb: verb("Searched for files:", "Searching for files:", running), object: `${pick(p, "Pattern", "Query")}${where(pick(p, "SearchDirectory"))}`, detail: count("result", "results"), body: out })
    case "codebase_search":
      return step({ ...common, verb: verb("Searched codebase for", "Searching codebase for", running), object: `"${pick(p, "Query")}"`, detail: count("result", "results"), body: out })
    case "search_web":
      return step({ ...common, verb: verb("Searched web for", "Searching web for", running), object: `"${pick(p, "query", "Query")}"`, body: md })
    case "read_url_content":
    case "read_browser_page": {
      const url = pick(p, "Url", "URL", "url")
      return step({ ...common, verb: failed ? "Failed to read page" : verb("Read page", "Reading page", running), object: host(url), icon: "page", href: url || undefined, body: md })
    }
    case "list_resources":
      return step({ ...common, verb: "List resources:", object: pick(p, "ServerName", "Server"), detail: count("result", "results"), body: out })
    case "read_resource":
      return step({ ...common, verb: verb("Read resource:", "Reading resource:", running), object: pick(p, "Uri", "URI", "uri"), body: out })
    case "run_command": {
      const raw = pick(p, "CommandLine", "Command")
      // D327: lo que agy abre con `anti-mcp abrir -- <orden>` queda en su propia ventana de terminal, fuera de agy.
      const opened = /anti-mcp(?:\.ts|\.exe)?["']?\s+abrir\s+--\s+(.+)$/s.exec(raw)
      if (opened)
        return step({ ...common, verb: verb("Opened in its own terminal", "Opening in its own terminal", running), object: opened[1]!.trim(), detail: has ? lines(output)[0] : undefined, tone: failed ? "error" : "ok", open: false })
      // El `cd <proyecto> &&` con que agy encabeza muchas órdenes no aporta: el proyecto ya se sabe.
      const command = raw.replace(new RegExp(`^cd\\s+${cwd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*&&\\s*`), "")
      const tests = testSummary(output)
      // WaitMsBeforeAsync lo pone agy casi siempre (espera N ms antes de soltarla): solo es «background» si lo dice agy.
      const background = p.RunPersistent === true || /running in (?:the )?background|background command id/i.test(output)
      const dir = pick(p, "Cwd")
      const detail = join(dir && dir !== cwd ? `in ${relative(cwd, dir)}` : undefined, background && "background", tests && `${tests.pass} pass · ${tests.fail} fail`, !running && !failed && !has && "no output", failed && !has && "denied or did not start")
      return step({
        ...common,
        verb: failed ? "Failed to run" : verb("Ran", "Running", running),
        object: command,
        detail,
        ...(tests && !failed ? { tone: tests.fail > 0 ? ("error" as const) : ("ok" as const) } : {}),
        open: running || has,
        body: running || has ? { kind: "terminal", command, output } : undefined,
      })
    }
    case "command_status":
    case "read_terminal":
      return step({ ...common, verb: verb("Checked command", "Checking command", running), object: pick(p, "CommandId", "Name", "TerminalId"), open: has, body: has ? { kind: "terminal", command: pick(p, "CommandId", "Name"), output } : undefined })
    case "send_command_input":
      return step({ ...common, verb: verb("Sent input to command", "Sending input to command", running), object: pick(p, "CommandId", "Name"), open: has, body: has ? { kind: "terminal", command: pick(p, "CommandId", "Name"), output } : undefined })
    case "generate_image": {
      const images = Array.isArray(item.images) ? (item.images as unknown[]).map(str).filter(Boolean) : []
      const object = images[0] ? relative(cwd, images[0]) : `${pick(p, "ImageName", "Name")}.png`
      return step({ ...common, verb: verb("Generated image", "Generating image", running), object, icon: "image", body: images.length ? { kind: "image", paths: images } : undefined })
    }
    case "schedule":
      return step({ ...common, verb: verb("Timed", "Timing", running), object: `${pick(p, "DurationSeconds", "Seconds")} seconds`, detail: pick(p, "Prompt") ? cap(pick(p, "Prompt"), 60) : undefined, body: out })
    case "manage_task": {
      const action = pick(p, "Action")
      const task = pick(p, "TaskId").split("/").at(-1) ?? ""
      if (action === "list") return step({ ...common, verb: verb("Listed", "Listing", running), object: "tasks", body: out })
      if (action === "kill") return step({ ...common, verb: verb("Cancelled task", "Cancelling task", running), object: task, body: out })
      if (action === "status") return step({ ...common, verb: verb("Checked task", "Checking task", running), object: task, body: out })
      return step({ ...common, verb: verb("Managed task", "Managing task", running), object: task, body: out })
    }
    case "call_mcp_tool":
      return step({ ...common, verb: "MCP Tool", object: `${pick(p, "ServerName")} / ${pick(p, "ToolName")}`, body: out })
    case "browser_subagent": {
      const goal = pick(p, "Task", "Goal")
      const text = [goal ? `**Goal**\n${goal}` : "", output].filter(Boolean).join("\n\n")
      return step({ ...common, verb: verb("Browsed", "Browsing", running), object: pick(p, "TaskName", "Task"), body: text ? { kind: "markdown", text } : undefined })
    }
    case "invoke_subagent": {
      // agy lanza uno o varios a la vez: `Subagents: [{TypeName, Role, Prompt}]` (D322).
      const list = (Array.isArray(p.Subagents) ? p.Subagents : [p]) as Record<string, unknown>[]
      const names = list.map((a) => pick(a, "TypeName", "SubagentName", "Name") || "subagent")
      const roles = list.map((a) => pick(a, "Role")).filter(Boolean)
      const prompts = list.map((a, i) => (list.length > 1 ? `**${names[i]}**\n${pick(a, "Prompt", "Task")}` : pick(a, "Prompt", "Task"))).filter(Boolean)
      return step({ ...common, verb: verb("Launched subagent", "Running subagent", running), object: names.join(", "), detail: roles.join(", ") || undefined, body: prompts.length ? { kind: "markdown", text: prompts.join("\n\n") } : undefined })
    }
    case "send_message":
      // Un subagente devuelve su informe a la tarea que lo lanzó (D324).
      return step({ ...common, verb: verb("Sent report", "Sending report", running), object: "to main agent", body: pick(p, "Message") ? { kind: "markdown", text: pick(p, "Message") } : undefined })
    case "ask_question":
      return step({ ...common, verb: verb("Asked", "Asking", running), object: "1 question" })
  }
  if (EDIT.has(name)) {
    const target = pick(p, "TargetFile", "File")
    return step({ ...common, verb: name === "write_to_file" ? verb("Created", "Creating", running) : verb("Edited", "Editing", running), object: relative(cwd, target), icon: "file", add: 0, del: 0, file: relative(cwd, target), open: true })
  }
  const arg = Object.entries(p).find(([key, value]) => typeof value === "string" && value !== "" && key !== "toolAction" && key !== "toolSummary")
  return step({ ...common, verb: verb("Used", "Using", running), object: name, detail: arg ? cap(str(arg[1]), 80) : undefined, body: out })
}

// Las cabeceras de git (diff --git, index, modos, ---/+++) no dicen nada que no diga ya la fila: se dejan solo los trozos «@@». Lo
// que va antes del primer «@@» de cada fichero es cabecera; un diff sin trozos (binario) se deja como venía.
export function hunks(patch: string): string {
  const lines = patch.split("\n")
  if (!lines.some((line) => line.startsWith("@@"))) return patch
  let header = true
  return lines
    .filter((line) => {
      if (line.startsWith("diff --git ")) header = true
      else if (line.startsWith("@@")) header = false
      return !header
    })
    .join("\n")
}

// Dentro de los trozos, «+»/«-» son líneas añadidas/borradas aunque el texto empiece por «++» o «--».
export function diffStats(patch: string): { add: number; del: number } {
  const lines = hunks(patch).split("\n").filter((line) => !line.startsWith("@@"))
  return { add: lines.filter((line) => line.startsWith("+")).length, del: lines.filter((line) => line.startsWith("-")).length }
}

const NOTE_ERROR = /abortada|tiempo máximo|terminó por señal/i
// Las notas del detector de bucles; las conversaciones anteriores a su nombre actual lo llaman «vigilante».
const DETECTOR = /^(?:detector de bucles|vigilante) · /
const detectorNote = (text: string, kind: "aviso" | "corte") => DETECTOR.test(text) && text.replace(DETECTOR, "").startsWith(kind)
function note(text: string): Row {
  if (detectorNote(text, "aviso")) return { kind: "note", tone: "warning", text: text.replace(DETECTOR, "Detector de bucles: ") }
  if (detectorNote(text, "corte")) return { kind: "note", tone: "error", text: text.replace(DETECTOR, "Detector de bucles: ") }
  if (/^abortada/i.test(text)) return { kind: "note", tone: "error", text: "Abortada por el usuario" }
  return { kind: "note", tone: NOTE_ERROR.test(text) ? "error" : "muted", text }
}

const DENIED: Record<string, (rule: string) => [Tone, string] | undefined> = {
  allowed: (rule) => ["ok", `Permiso concedido: ${rule}`],
  rejected: (rule) => ["error", `Acción denegada: ${rule} (rechazaste añadir la regla)`],
  "no-rule": () => ["error", "Acción denegada (sin regla que proponer)"],
  "no-dialog": (rule) => ["error", `Acción denegada: ${rule} (sin diálogo para confirmarla)`],
  "write-failed": (rule) => ["error", `Acción denegada: ${rule} (no se pudo escribir settings.json)`],
  "retry-denied": (rule) => ["error", `Acción denegada otra vez: ${rule} (la regla ya estaba)`],
  // «asked» es el paso intermedio (se está preguntando): lo que cuenta es el resultado que lo sigue.
  asked: () => undefined,
}

function head(call: AgyCall): CallRow {
  const items = call.items
  const running = call.end === null
  const cut = items.some((i) => i.kind === "note" && detectorNote(str(i.text), "corte"))
  // Parada para avisar: el detector la para y la reanuda en la misma conversación con el aviso, en la llamada siguiente. No es un error.
  const nudged = items.some((i) => i.kind === "note" && detectorNote(str(i.text), "aviso"))
  const question = items.some((i) => i.kind === "question")
  const state: CallRow["state"] = running ? "running" : call.denied ? "denied" : cut ? "cut"
    : call.status === "SUCCESS" ? (question ? "question" : "ok") : nudged ? "nudged" : "error"
  const role = call.layer === "direct" ? "" : call.layer === "orchestrate" ? "orquestador" : call.step ? `paso ${call.step.k}/${call.step.n} · ${call.layer}` : call.layer
  const seconds = running ? undefined : Math.round((Date.parse(call.end!) - Date.parse(call.start)) / 1000)
  return {
    kind: "call",
    model: modelName(call.model),
    pro: /-pro-/.test(call.model),
    role,
    state,
    modelSeconds: call.modelSeconds ?? 0,
    turns: call.turns ?? 0,
    thinkingTokens: call.thinkingTokens ?? 0,
    ...(seconds === undefined || Number.isNaN(seconds) ? {} : { seconds }),
    ...(call.usage?.tokens?.delta === undefined ? {} : { tokens: call.usage.tokens.delta }),
    notes: call.notes ?? [],
  }
}

export function present(view: AgyView): Row[] {
  const rows: Row[] = []
  let planShown = false
  // Por el nombre de la cuenta («search»), no por la tupla: grep y find suman en la misma.
  let group: { units: Map<string, { kind: Kind; n: number }>; children: StepRow[] } | undefined
  const close = () => {
    if (!group) return
    const running = group.children.some((c) => c.running)
    const summary = [...group.units.values()].map(({ kind: [one, many], n }) => plural(n, one, many)).join(", ")
    rows.push({ kind: "group", verb: running ? "Exploring" : "Explored", summary, running, open: running, children: group.children })
    group = undefined
  }
  for (const call of view.calls) {
    rows.push(head(call))
    if (view.plan && !planShown) {
      rows.push({ kind: "plan", answer: str(view.plan.answer), steps: view.plan.steps })
      planShown = true
    }
    for (const item of call.items) {
      const explore = explores(item)
      if (explore) {
        group ??= { units: new Map(), children: [] }
        const unit = group.units.get(explore.kind[0]) ?? { kind: explore.kind, n: 0 }
        unit.n += explore.units
        group.units.set(explore.kind[0], unit)
        group.children.push(presentTool(item, view.cwd)!)
        continue
      }
      if (item.kind === "diff") {
        // El diff que sigue a una edición le pone el +/− y la ventana: la última edición de ese fichero sin diff todavía.
        const file = str(item.file)
        const target = [...rows].reverse().find((r): r is StepRow => r.kind === "step" && r.file === file && r.body === undefined)
        if (target) {
          const stats = diffStats(str(item.patch))
          target.add = stats.add
          target.del = stats.del
          target.body = { kind: "diff", patch: hunks(str(item.patch)) }
          if (item.truncated) target.detail = join(target.detail, "diff truncated")
        }
        continue
      }
      close()
      if (item.kind === "tool") {
        const row = presentTool(item, view.cwd)
        if (row) rows.push(row)
      } else if (item.kind === "text" && str(item.text).trim()) rows.push({ kind: "text", text: str(item.text) })
      else if (item.kind === "question") rows.push({ kind: "question", text: str(item.text) })
      else if (item.kind === "denied") {
        const shown = (DENIED[str(item.outcome)] ?? ((rule: string) => ["error", `Acción denegada: ${rule}`] as [Tone, string]))(str(item.rule))
        if (shown) rows.push({ kind: "denied", tone: shown[0], text: shown[1] })
      } else if (item.kind === "note" && /^sin git/.test(str(item.text))) {
        // Sin repo no hay diff: lo dicen las ediciones que se quedaron sin él, no una nota suelta.
        const edits = rows.filter((r): r is StepRow => r.kind === "step" && r.file !== undefined && r.body === undefined)
        for (const r of edits) r.detail = join(r.detail, "no diff: not a git repo")
        if (!edits.length) rows.push(note(str(item.text)))
      } else if (item.kind === "note") rows.push(note(str(item.text)))
      else if (item.kind === "plan" && !view.plan && !planShown) {
        rows.push({ kind: "plan", answer: str(item.answer), steps: (item.steps ?? []) as AgyPlanStep[] })
        planShown = true
      }
    }
    close()
    const h = head(call)
    if (h.state === "error") rows.push({ kind: "error", text: `agy terminó con estado ${call.status ?? "desconocido"}`, notes: call.notes ?? [] })
  }
  return rows
}

// Los ficheros que cambió agy, cada uno una vez, en el orden en que aparecen, con sus +/− sumados y si es nuevo.
export function filesChanged(view: AgyView): { path: string; add: number; del: number; created: boolean; patches: string[] }[] {
  const files = new Map<string, { path: string; add: number; del: number; created: boolean; patches: string[] }>()
  for (const call of view.calls) {
    for (const item of call.items) {
      if (item.kind !== "diff") continue
      const path = str(item.file)
      const entry = files.get(path) ?? { path, add: 0, del: 0, created: false, patches: [] }
      const stats = diffStats(str(item.patch))
      entry.add += stats.add
      entry.del += stats.del
      entry.created ||= item.untracked === true
      entry.patches.push(hunks(str(item.patch)))
      files.set(path, entry)
    }
  }
  return [...files.values()]
}

function duration(seconds: number): string {
  const s = Math.max(1, Math.round(seconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

export function thought(seconds: number): string {
  if (seconds < 10) return `${Math.round(seconds * 10) / 10}s`
  if (seconds < 60) return `${Math.round(seconds)}s`
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}

// «Worked for 52s», lo que pensó Gemini y los ficheros cambiados; nada mientras agy siga trabajando.
export function workedFor(view: AgyView): { duration: string; thought: string; files: number; add: number; del: number } | undefined {
  if (view.live || view.calls.length === 0) return undefined
  const first = Date.parse(view.calls[0]!.start)
  const last = Date.parse(view.calls.at(-1)!.end ?? view.calls.at(-1)!.start)
  const files = filesChanged(view)
  const model = view.calls.reduce((sum, call) => sum + (call.modelSeconds ?? 0), 0)
  return {
    duration: duration((last - first) / 1000),
    thought: thought(model),
    files: files.length,
    add: files.reduce((sum, f) => sum + f.add, 0),
    del: files.reduce((sum, f) => sum + f.del, 0),
  }
}
