// El presentador de la tool `antigravity` en el chat (fase 15, D318, D321): convierte el desglose de agy (metadatos `agy` de la parte,
// que manda la config de anti) en las filas con el aspecto del IDE de Antigravity, un caso por herramienta y por situación. Los
// formatos de las salidas son los REALES del stream de agy (registros de ~/.cache/opencode-antigravity): `view_file` solo trae «N lines,
// M bytes», `list_dir` una entrada por línea, `run_command` la salida sin código de salida, `call_mcp_tool` los Arguments como texto.
import { describe, expect, test } from "bun:test"
import { diffStats, filesChanged, hunks, modelName, present, workedFor, type AgyItem, type AgyView, type Row, type StepRow } from "../../src/routes/session/agy/steps"

const T0 = "2026-10-07T10:00:00.000Z"
const tool = (name: string, parameters: Record<string, unknown>, extra: Record<string, unknown> = {}): AgyItem => ({ kind: "tool", t: T0, name, parameters, output: "", state: "done", images: [], ...extra })
const say = (text: string): AgyItem => ({ kind: "text", t: T0, text })
const diff = (file: string, patch: string, extra: Record<string, unknown> = {}): AgyItem => ({ kind: "diff", t: T0, tool: "replace_file_content", file, patch, ...extra })
const call = (items: AgyItem[], extra: Record<string, unknown> = {}) => ({
  n: 1, layer: "direct", model: "gemini-3.8-flash-low", start: T0, end: "2026-10-07T10:00:52.000Z", status: "SUCCESS", items,
  turns: 4, modelSeconds: 9.4, thinkingTokens: 0, usage: { tokens: { delta: 79000, total: 79000 }, seconds: { delta: 28, total: 28 } }, ...extra,
})
const view = (items: AgyItem[], extra: Record<string, unknown> = {}, live = false): AgyView =>
  ({ version: 1, cwd: "/p", live, calls: [call(items, live ? { end: null, status: null, ...extra } : extra)] }) as unknown as AgyView
// Las filas sin la cabecera de la llamada.
const body = (v: AgyView) => present(v).filter((r) => r.kind !== "call")
const steps = (rows: Row[]) => rows.filter((r): r is StepRow => r.kind === "step")
const only = (v: AgyView) => {
  const [r] = body(v)
  return r!
}

describe("D321: quién trabaja: la cabecera de cada llamada de Gemini", () => {
  test("modelo con nombre legible, lo que pensó, turnos, duración y tokens; estado terminado", () => {
    const [head] = present(view([say("hola")]))
    expect(head).toMatchObject({ kind: "call", model: "Gemini 3.8 Flash Low", pro: false, role: "", state: "ok", modelSeconds: 9.4, turns: 4, seconds: 52, tokens: 79000 })
  })

  test("en marcha, con Pro, en el orquestador por pasos y con preguntas, denegaciones, cortes y errores", () => {
    expect(present(view([], {}, true))[0]).toMatchObject({ state: "running" })
    expect(present(view([], { model: "gemini-3.1-pro-high" }))[0]).toMatchObject({ model: "Gemini 3.1 Pro High", pro: true })
    expect(present(view([], { layer: "orchestrate" }))[0]).toMatchObject({ role: "orquestador" })
    expect(present(view([], { layer: "implement", step: { k: 2, n: 3 } }))[0]).toMatchObject({ role: "paso 2/3 · implement" })
    expect(present(view([{ kind: "question", t: T0, text: "¿borro?" }]))[0]).toMatchObject({ state: "question" })
    expect(present(view([], { denied: true }))[0]).toMatchObject({ state: "denied" })
    expect(present(view([{ kind: "note", t: T0, text: "vigilante · corte: view_file en bucle tras 2 avisos" }], { status: "ERROR" }))[0]).toMatchObject({ state: "cut" })
    expect(present(view([], { status: "ERROR" }))[0]).toMatchObject({ state: "error" })
  })

  test("pausada por el detector de bucles para avisarle: ni error ni «tarea no hecha», y con su nombre de antes también", () => {
    for (const text of ["detector de bucles · aviso 1: 15 veces view_file sin editar", "vigilante · aviso 1: 15 veces view_file sin editar"]) {
      const rows = present(view([{ kind: "note", t: T0, text }], { status: "ERROR" }))
      expect(rows[0]).toMatchObject({ state: "nudged" })
      expect(rows.some((r) => r.kind === "error")).toBe(false)
      expect(rows).toContainEqual({ kind: "note", tone: "warning", text: "Detector de bucles: aviso 1: 15 veces view_file sin editar" })
    }
    expect(present(view([{ kind: "note", t: T0, text: "detector de bucles · corte: view_file en bucle tras 2 avisos" }], { status: "ERROR" }))[0])
      .toMatchObject({ state: "cut" })
  })

  test("modelName: los de Gemini se leen como en el IDE; otros quedan tal cual", () => {
    expect(modelName("gemini-3.8-flash-high")).toBe("Gemini 3.8 Flash High")
    expect(modelName("claude-x")).toBe("claude-x")
  })

  test("varias llamadas (avisos del vigilante, pasos del orquestador): una cabecera por llamada", () => {
    const v = { version: 1, cwd: "/p", live: false, calls: [call([say("a")], { n: 1 }), call([say("b")], { n: 2 })] } as unknown as AgyView
    expect(present(v).map((r) => r.kind)).toEqual(["call", "text", "call", "text"])
  })
})

describe("D321: terminal", () => {
  test("hecha: «Ran orden», ventana de terminal abierta con la salida", () => {
    expect(only(view([tool("run_command", { CommandLine: "git status" }, { output: "On branch main\n" })]))).toMatchObject({
      verb: "Ran", object: "git status", open: true, body: { kind: "terminal", command: "git status", output: "On branch main\n" },
    })
  })

  test("en marcha: «Running», abierta aunque no haya salida aún", () => {
    expect(only(view([tool("run_command", { CommandLine: "npm install" }, { state: "running" })], {}, true))).toMatchObject({ verb: "Running", running: true, open: true, body: { kind: "terminal", output: "" } })
  })

  test("sin salida: se dice, y no hay ventana vacía", () => {
    const r = only(view([tool("run_command", { CommandLine: "mkdir x" })])) as StepRow
    expect(r.detail).toBe("no output")
    expect(r.body).toBeUndefined()
  })

  test("ERROR del stream (denegada o no arrancó): «Failed to run» en rojo", () => {
    expect(only(view([tool("run_command", { CommandLine: "uname -a" }, { state: "error" })]))).toMatchObject({ verb: "Failed to run", tone: "error", object: "uname -a", detail: "denied or did not start" })
  })

  test("el `cd <proyecto> &&` del principio se quita; un cwd distinto se dice; en segundo plano, también", () => {
    expect(only(view([tool("run_command", { CommandLine: "cd /p && ls" })]))).toMatchObject({ object: "ls" })
    expect(only(view([tool("run_command", { CommandLine: "ls", Cwd: "/p/sub" })]))).toMatchObject({ detail: "in sub · no output" })
    expect(only(view([tool("run_command", { CommandLine: "npm run dev", RunPersistent: true }, { output: "ready" })]))).toMatchObject({ detail: "background" })
    // WaitMsBeforeAsync va en casi todas las órdenes: no basta para decir «background».
    expect(only(view([tool("run_command", { CommandLine: "ls", WaitMsBeforeAsync: 5000 }, { output: "a" })]))).toMatchObject({ detail: undefined })
  })

  test("resumen de tests en la salida: node --test, pytest y jest, con su tono", () => {
    expect(only(view([tool("run_command", { CommandLine: "node --test" }, { output: "ℹ tests 2\nℹ pass 2\nℹ fail 0\n" })]))).toMatchObject({ detail: "2 pass · 0 fail", tone: "ok" })
    expect(only(view([tool("run_command", { CommandLine: "node --test" }, { output: "ℹ pass 1\nℹ fail 1\n" })]))).toMatchObject({ detail: "1 pass · 1 fail", tone: "error" })
    expect(only(view([tool("run_command", { CommandLine: "pytest" }, { output: "==== 3 failed, 5 passed in 0.1s ====" })]))).toMatchObject({ detail: "5 pass · 3 fail", tone: "error" })
    expect(only(view([tool("run_command", { CommandLine: "npx jest" }, { output: "Tests:       4 passed, 4 total" })]))).toMatchObject({ detail: "4 pass · 0 fail", tone: "ok" })
  })

  test("estado e entrada de órdenes en segundo plano", () => {
    expect(only(view([tool("command_status", { CommandId: "c1" }, { output: "running" })]))).toMatchObject({ verb: "Checked command", body: { kind: "terminal" } })
    expect(only(view([tool("send_command_input", { CommandId: "c1", Input: "y\n" }, { output: "ok" })]))).toMatchObject({ verb: "Sent input to command" })
  })
})

describe("D321: ediciones y ficheros", () => {
  test("ruta relativa (no solo el nombre), +/− y el diff abierto; creado frente a editado", () => {
    const rows = steps(body(view([
      tool("write_to_file", { TargetFile: "/p/src/nuevo.ts" }),
      diff("src/nuevo.ts", "@@ -0,0 +1,2 @@\n+a\n+b\n", { untracked: true }),
      tool("replace_file_content", { TargetFile: "/p/lib/util.ts" }),
      diff("lib/util.ts", "@@ -1 +1 @@\n-a\n+z\n"),
    ])))
    expect(rows.map((r) => `${r.verb} ${r.object} +${r.add} -${r.del} ${r.open}`)).toEqual(["Created src/nuevo.ts +2 -0 true", "Edited lib/util.ts +1 -1 true"])
    expect(rows[1]!.body).toMatchObject({ kind: "diff" })
  })

  test("dos ediciones del mismo fichero: cada una con su propio diff", () => {
    const rows = steps(body(view([
      tool("replace_file_content", { TargetFile: "/p/a.ts" }),
      diff("a.ts", "-1\n+2\n"),
      say("·"),
      tool("replace_file_content", { TargetFile: "/p/a.ts" }),
      diff("a.ts", "-3\n+4\n+5\n"),
    ])))
    expect(rows.map((r) => `${r.add}/${r.del}`)).toEqual(["1/1", "2/1"])
  })

  test("diff recortado y edición sin diff (sin git)", () => {
    expect(only(view([tool("replace_file_content", { TargetFile: "/p/a.ts" }), diff("a.ts", "-a\n+b\n", { truncated: true })]))).toMatchObject({ detail: "diff truncated" })
    const rows = body(view([tool("replace_file_content", { TargetFile: "/p/a.ts" }), { kind: "note", t: T0, text: "sin git en /p: no hay diffs" }]))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ verb: "Edited", detail: "no diff: not a git repo" })
    expect((rows[0] as StepRow).body).toBeUndefined()
  })

  test("filesChanged: cada fichero una vez, con sus +/− sumados y si es nuevo", () => {
    const v = view([
      diff("a.ts", "+1\n+2\n", { untracked: true }),
      diff("a.ts", "-1\n+9\n"),
      diff("b.ts", "-x\n"),
    ])
    expect(filesChanged(v)).toEqual([
      { path: "a.ts", add: 3, del: 1, created: true, patches: ["+1\n+2\n", "-1\n+9\n"] },
      { path: "b.ts", add: 0, del: 1, created: false, patches: ["-x\n"] },
    ])
  })

  test("hunks quita las cabeceras de git y deja solo los trozos «@@»", () => {
    const git = "diff --git a/x b/x\nindex 19d3639..177f705 100644\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n-a\n+b\n c"
    expect(hunks(git)).toBe("@@ -1,2 +1,2 @@\n-a\n+b\n c")
    const created = "diff --git a/R.md b/R.md\nnew file mode 100644\nindex 0000000..812c736\n--- /dev/null\n+++ b/R.md\n@@ -0,0 +1,1 @@\n+# R"
    expect(hunks(created)).toBe("@@ -0,0 +1,1 @@\n+# R")
    // Dos ficheros seguidos: cada cabecera fuera.
    expect(hunks(`${git}\n${created}`)).toBe("@@ -1,2 +1,2 @@\n-a\n+b\n c\n@@ -0,0 +1,1 @@\n+# R")
    // Sin trozos (binario): se deja como venía, para que se vea algo.
    expect(hunks("diff --git a/i.png b/i.png\nBinary files differ")).toBe("diff --git a/i.png b/i.png\nBinary files differ")
  })

  test("las ventanas de diff (fila y tarjeta de ficheros) van sin cabeceras de git", () => {
    const patch = "diff --git a/a.ts b/a.ts\nindex 1..2 100644\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b"
    const v = view([tool("replace_file_content", { TargetFile: "/p/a.ts" }), diff("a.ts", patch)])
    expect((only(v) as StepRow).body).toEqual({ kind: "diff", patch: "@@ -1 +1 @@\n-a\n+b" })
    expect(filesChanged(v)[0]!.patches).toEqual(["@@ -1 +1 @@\n-a\n+b"])
  })

  test("diffStats cuenta + y − sin las cabeceras, aunque una línea borrada empiece por «--»", () => {
    expect(diffStats("--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n-a\n+b\n c\n")).toEqual({ add: 1, del: 1 })
    expect(diffStats("diff --git a/q.sql b/q.sql\n--- a/q.sql\n+++ b/q.sql\n@@ -1,2 +1,1 @@\n--- comentario\n-select 1\n+select 2\n\\ No newline at end of file")).toEqual({ add: 1, del: 2 })
  })
})

describe("D321: exploración (agrupada como en el IDE), con lo que trae cada salida", () => {
  test("view_file: rango y líneas del fichero; sin ventana (el stream no trae el contenido)", () => {
    const [g] = body(view([tool("view_file", { AbsolutePath: "/p/PLAN.md", StartLine: 1, EndLine: 40 }, { output: "102 lines, 6110 bytes" })]))
    expect(g).toMatchObject({ kind: "group", verb: "Explored", summary: "1 file" })
    if (g?.kind !== "group") return
    expect(g.children[0]).toMatchObject({ verb: "Viewed", object: "PLAN.md:1-40", detail: "102 lines", body: undefined })
  })

  test("list_dir, grep y find: cuántas entradas o resultados, y la lista en una ventana; sin resultados se dice", () => {
    const [g] = body(view([
      tool("list_dir", { DirectoryPath: "/p" }, { output: ".git/\nPLAN.md\ncounter.py\n" }),
      tool("grep_search", { Query: "TODO", SearchPath: "/p" }, { output: "" }),
      tool("grep_search", { Query: "complej", SearchPath: "/p/src" }, { output: "a.py:12:x\nb.py:3:y\n" }),
      tool("find_by_name", { Pattern: "*.py", SearchDirectory: "/p" }, { output: "a.py\nb.py\n" }),
    ]))
    if (g?.kind !== "group") throw new Error("se esperaba un grupo")
    expect(g.summary).toBe("1 folder, 3 searches")
    expect(g.children.map((c) => `${c.verb} ${c.object} · ${c.detail}`)).toEqual([
      "Listed directory p · 3 entries",
      "Searched for \"TODO\" · no results",
      "Searched for \"complej\" in src · 2 results",
      "Searched for files: *.py · 2 results",
    ])
  })

  test("leer de anti: cuenta los ficheros como lectura y avisa de los que no existen", () => {
    const [g] = body(view([tool("call_mcp_tool", { ServerName: "anti_anti", ToolName: "leer", Arguments: "{'ficheros': [{'ruta': 'contador.mjs'}, {'ruta': 'test/x.mjs'}]}" }, {
      output: "== contador.mjs · líneas 1-7 de 7\n1: a\n== test/x.mjs · error: no existe\n",
    })]))
    if (g?.kind !== "group") throw new Error("se esperaba un grupo")
    expect(g.summary).toBe("2 files")
    expect(g.children[0]).toMatchObject({ verb: "Read with anti", object: "contador.mjs, test/x.mjs", detail: "1 missing", body: { kind: "output" } })
  })

  test("web: búsqueda con respuesta en markdown o sin contenido; página leída o que falló, con su enlace", () => {
    const [g] = body(view([
      tool("search_web", { query: "horse glb" }, { output: "" }),
      tool("read_url_content", { Url: "https://www.example.com/a" }, { output: "Example Domain" }),
      tool("read_url_content", { Url: "https://poly.pizza/m/1" }, { state: "error" }),
    ]))
    if (g?.kind !== "group") throw new Error("se esperaba un grupo")
    expect(g.children.map((c) => `${c.verb} ${c.object} ${c.href ?? ""} ${c.tone ?? ""}`.trim())).toEqual([
      "Searched web for \"horse glb\"",
      "Read page example.com https://www.example.com/a",
      "Failed to read page poly.pizza https://poly.pizza/m/1 error",
    ])
  })

  test("un texto del agente corta el grupo; lo que está en curso va en gerundio y abierto", () => {
    expect(body(view([tool("list_dir", { DirectoryPath: "/p" }), say("x"), tool("grep_search", { Query: "y" })])).map((r) => r.kind)).toEqual(["group", "text", "group"])
    expect(body(view([tool("list_dir", { DirectoryPath: "/p" }, { state: "running" })], {}, true))[0]).toMatchObject({ verb: "Exploring", open: true, running: true })
  })
})

describe("D321: el resto de herramientas", () => {
  test("probar de anti: resumen con su tono y la salida", () => {
    expect(only(view([tool("call_mcp_tool", { ServerName: "anti_anti", ToolName: "probar", Arguments: "{'ficheros': ['contador.test.mjs']}" }, { output: "node --test: 2 tests · todos pasan" })]))).toMatchObject({
      verb: "Ran tests with anti", object: "contador.test.mjs", detail: "node --test: 2 tests · todos pasan", tone: "ok",
    })
    expect(only(view([tool("call_mcp_tool", { ServerName: "anti_anti", ToolName: "probar", Arguments: "{}" }, { output: "node --test: 2 tests · 1 falla\n✖ duplica" })]))).toMatchObject({ object: "all tests", tone: "error", open: true })
  })

  test("otra herramienta MCP, imagen, navegador, temporizador, tareas, pregunta y una desconocida; finish no se pinta", () => {
    const rows = body(view([
      tool("call_mcp_tool", { ServerName: "data-agent-kit", ToolName: "get_context" }, { output: "{}" }),
      say("·"),
      tool("generate_image", { ImageName: "circulo" }, { images: ["/p/circulo.png"] }),
      say("·"),
      tool("browser_subagent", { TaskName: "Open Example", Task: "Open https://example.com" }),
      say("·"),
      tool("schedule", { DurationSeconds: "30", Prompt: "Check if npm install finished" }, { output: "Wait cancelled" }),
      say("·"),
      tool("manage_task", { Action: "status", TaskId: "conv/task-20" }, { output: "Status: RUNNING" }),
      tool("manage_task", { Action: "kill", TaskId: "conv/task-20" }),
      tool("manage_task", { Action: "list" }),
      say("·"),
      tool("ask_question", {}),
      say("·"),
      tool("finish", { answer: "x" }),
      tool("zzz_nueva", { Foo: "bar" }),
    ])).filter((r) => r.kind === "step") as StepRow[]
    expect(rows.map((r) => `${r.verb}|${r.object}${r.detail ? `|${r.detail}` : ""}`)).toEqual([
      "MCP Tool|data-agent-kit / get_context",
      "Generated image|circulo.png",
      "Browsed|Open Example",
      "Timed|30 seconds|Check if npm install finished",
      "Checked task|task-20",
      "Cancelled task|task-20",
      "Listed|tasks",
      "Asked|1 question",
      "Used|zzz_nueva|bar",
    ])
  })
})

describe("D321: avisos, preguntas, permisos, errores y plan", () => {
  test("notas con su tono: aviso y corte del vigilante, aborto, tiempo máximo, regla añadida y sin git", () => {
    const rows = body(view([
      { kind: "note", t: T0, text: "vigilante · aviso 1: 15 veces view_file sin editar" },
      { kind: "note", t: T0, text: "vigilante · corte: view_file en bucle tras 2 avisos" },
      { kind: "note", t: T0, text: "abortada por el usuario" },
      { kind: "note", t: T0, text: "agy detenido por tiempo máximo" },
      { kind: "note", t: T0, text: "regla añadida (command(git)); paso repetido" },
      { kind: "note", t: T0, text: "sin git en /p: no hay diffs" },
    ]))
    // Sin ediciones a las que pegarse, «sin git» queda como nota.
    expect(rows.map((r) => r.kind === "note" && `${r.tone}:${r.text}`)).toEqual([
      "warning:Detector de bucles: aviso 1: 15 veces view_file sin editar",
      "error:Detector de bucles: corte: view_file en bucle tras 2 avisos",
      "error:Abortada por el usuario",
      "error:agy detenido por tiempo máximo",
      "muted:regla añadida (command(git)); paso repetido",
      "muted:sin git en /p: no hay diffs",
    ])
  })

  test("pregunta y permisos (concedido, rechazado, sin regla) con su texto", () => {
    const rows = body(view([
      { kind: "question", t: T0, text: "¿borro el fichero?" },
      { kind: "denied", t: T0, actions: [], rule: "command(rm)", outcome: "rejected" },
      { kind: "denied", t: T0, actions: [], rule: "command(git)", outcome: "allowed" },
      { kind: "denied", t: T0, actions: [], rule: null, outcome: "no-rule" },
    ]))
    expect(rows.map((r) => (r.kind === "denied" ? `${r.tone}:${r.text}` : r.kind))).toEqual([
      "question",
      "error:Acción denegada: command(rm) (rechazaste añadir la regla)",
      "ok:Permiso concedido: command(git)",
      "error:Acción denegada (sin regla que proponer)",
    ])
  })

  test("una llamada que no terminó bien deja su error y sus notas al final", () => {
    const rows = body(view([say("x")], { status: "ERROR", notes: ["Pro (/pro)"] }))
    expect(rows.at(-1)).toMatchObject({ kind: "error", text: "agy terminó con estado ERROR", notes: ["Pro (/pro)"] })
  })

  test("el plan del orquestador sale una vez, con el estado de cada paso", () => {
    const v = { ...view([{ kind: "plan", t: T0, answer: "", steps: [] }]), plan: { answer: "Hacer X", steps: [{ k: 1, layer: "implement", instruction: "a", status: "done" }, { k: 2, layer: "verify", instruction: "b", status: "running" }] } } as unknown as AgyView
    expect(body(v)[0]).toMatchObject({ kind: "plan", answer: "Hacer X", steps: [{ status: "done" }, { status: "running" }] })
  })
})

describe("D321: cierre", () => {
  test("workedFor: duración del trabajo, lo que pensó Gemini y los ficheros", () => {
    const v = view([diff("a.ts", "+a\n+b\n"), diff("b.ts", "-q\n")])
    expect(workedFor(v)).toEqual({ duration: "52s", thought: "9.4s", files: 2, add: 2, del: 1 })
    expect(workedFor(view([], {}, true))).toBeUndefined()
  })
})

describe("D322: subagentes", () => {
  test("invoke_subagent: «Launched subagent research», con su papel y el encargo en una ventana; en curso, «Running subagent»", () => {
    const params = { Subagents: [{ TypeName: "research", Role: "Codebase Researcher", Prompt: "Lista las funciones de src/", Model: "inherit" }] }
    expect(only(view([tool("invoke_subagent", params)]))).toMatchObject({ verb: "Launched subagent", object: "research", detail: "Codebase Researcher", body: { kind: "markdown", text: "Lista las funciones de src/" } })
    expect(only(view([tool("invoke_subagent", params, { state: "running" })]))).toMatchObject({ verb: "Running subagent", object: "research" })
    const two = { Subagents: [{ TypeName: "research", Prompt: "a" }, { TypeName: "self", Prompt: "b" }] }
    expect(only(view([tool("invoke_subagent", two)]))).toMatchObject({ object: "research, self", body: { kind: "markdown", text: "**research**\na\n\n**self**\nb" } })
  })
})

describe("D324: lo que hace un subagente", () => {
  test("view_file con el contenido (como lo guarda un subagente): líneas por «Total Lines» y el contenido en su ventana", () => {
    const out = "File Path: `file:///p/src/a.mjs`\nTotal Lines: 9\nTotal Bytes: 271\nShowing lines 1 to 9\n1: x"
    expect(only(view([tool("view_file", { AbsolutePath: "/p/src/a.mjs" }, { output: out })]))).toMatchObject({ verb: "Explored" })
    const child = (only(view([tool("view_file", { AbsolutePath: "/p/src/a.mjs" }, { output: out })])) as unknown as { children: StepRow[] }).children[0]!
    expect(child).toMatchObject({ verb: "Viewed", object: "src/a.mjs", detail: "9 lines", body: { kind: "output", text: out } })
  })

  test("send_message: «Sent report to main agent» con el mensaje en markdown", () => {
    expect(only(view([tool("send_message", { Message: "### Hecho\n- a", Recipient: "6512" })]))).toMatchObject({ verb: "Sent report", object: "to main agent", body: { kind: "markdown", text: "### Hecho\n- a" } })
  })
})

describe("D327: lo que agy deja abierto en su propia terminal", () => {
  test("`anti-mcp abrir -- <orden>` se ve como «Opened in its own terminal · orden», con lo que contestó", () => {
    const out = "Abierto en una ventana nueva de Ghostty: «npm run dev». Sigue abierto aunque esta conversación termine; no lo pares."
    expect(only(view([tool("run_command", { CommandLine: "/h/.anti/bin/anti-mcp abrir -- npm run dev" }, { output: out })]))).toMatchObject({ verb: "Opened in its own terminal", object: "npm run dev", detail: out, tone: "ok", open: false })
    expect(only(view([tool("run_command", { CommandLine: `bun "/a b/anti-mcp.ts" abrir -- python3 juego.py` }, { state: "running" })]))).toMatchObject({ verb: "Opening in its own terminal", object: "python3 juego.py" })
    expect(only(view([tool("run_command", { CommandLine: `& "C:\\t\\anti-mcp.exe" abrir -- npm start` })]))).toMatchObject({ object: "npm start" })
  })
})
