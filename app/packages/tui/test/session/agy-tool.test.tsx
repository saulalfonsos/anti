/** @jsxImportSource @opentui/solid */
// La tool `antigravity` pintada con el aspecto del IDE de Antigravity (fase 15, D318, D320, D321): cabecera de Gemini, cada cosa separada
// por una línea, terminal y diffs a la vista, avisos con su color y la tarjeta de ficheros. AGY_TOOL_FRAME=1 vuelca cada pantalla;
// AGY_TOOL_HTML=<dir> la guarda además con colores en HTML, para capturarla con un navegador.
import { afterEach, describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import type { JSX } from "solid-js"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { AgyTool } from "../../src/routes/session/agy/agy-tool"
import type { AgyItem, AgyView } from "../../src/routes/session/agy/steps"
import { tmpdir } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

let setup: Awaited<ReturnType<typeof testRender>> | undefined
let tmp: Awaited<ReturnType<typeof tmpdir>> | undefined

afterEach(async () => {
  setup?.renderer.destroy()
  setup = undefined
  await tmp?.[Symbol.asyncDispose]()
  tmp = undefined
})

async function mount(node: () => JSX.Element, options: { width?: number; height?: number } = {}) {
  tmp = await tmpdir()
  const dir = tmp.path
  const state = path.join(dir, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")
  setup = await testRender(
    () => (
      <TestTuiContexts directory={dir} paths={{ home: dir, state, worktree: dir }}>
        <TuiConfigProvider config={createTuiResolvedConfig({})}>
          <KVProvider>
            <ThemeProvider mode="dark">{node()}</ThemeProvider>
          </KVProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    { width: options.width ?? 100, height: options.height ?? 60 },
  )
  await Bun.sleep(50)
  await setup.renderOnce()
  return setup
}

let shot = 0
function frame(name: string): string {
  const text = setup!.captureCharFrame()
  if (process.env.AGY_TOOL_FRAME) console.log(`\n== ${name}\n${text}\n`)
  const dir = process.env.AGY_TOOL_HTML
  if (dir) {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    const hex = (c: unknown) => {
      const rgba = c as { r?: number; g?: number; b?: number } | undefined
      if (!rgba) return undefined
      return `rgb(${Math.round((rgba.r ?? 0) * 255)},${Math.round((rgba.g ?? 0) * 255)},${Math.round((rgba.b ?? 0) * 255)})`
    }
    const lines = (setup!.captureSpans() as unknown as { lines: { spans: { text: string; fg?: unknown; bg?: unknown; attributes?: number }[] }[] }).lines
    const body = lines.map((line) => line.spans.map((span) => `<span style="color:${hex(span.fg) ?? "#ddd"};background:${hex(span.bg) ?? "transparent"};${(span.attributes ?? 0) & 1 ? "font-weight:bold;" : ""}">${esc(span.text)}</span>`).join("")).join("\n")
    Bun.write(path.join(dir, `${String(++shot).padStart(2, "0")}-${name}.html`), `<html><body style="margin:0;background:#0b0b0c"><pre style="font:14px/1.3 Menlo,monospace;margin:10px">${body}</pre></body></html>`)
  }
  return text
}

const T0 = "2026-10-07T10:00:00.000Z"
const tool = (name: string, parameters: Record<string, unknown>, extra: Record<string, unknown> = {}): AgyItem => ({ kind: "tool", t: T0, name, parameters, output: "", state: "done", images: [], ...extra })
const say = (text: string): AgyItem => ({ kind: "text", t: T0, text })
const diff = (file: string, patch: string, extra: Record<string, unknown> = {}): AgyItem => ({ kind: "diff", t: T0, tool: "replace_file_content", file, patch, ...extra })
const call = (items: AgyItem[], extra: Record<string, unknown> = {}) => ({
  n: 1, layer: "direct", model: "gemini-3.8-flash-low", start: T0, end: "2026-10-07T10:00:52.000Z", status: "SUCCESS", items,
  turns: 5, modelSeconds: 9.4, thinkingTokens: 0, usage: { tokens: { delta: 79000, total: 79000 } }, notes: [], ...extra,
})
const view = (calls: unknown[], extra: Record<string, unknown> = {}): AgyView => ({ version: 1, cwd: "/p", live: false, calls, ...extra }) as unknown as AgyView

// Una iteración que toca dos ficheros, lee, busca, ejecuta los tests (fallan) y los vuelve a ejecutar (pasan).
const work: AgyItem[] = [
  tool("view_file", { AbsolutePath: "/p/src/contador.mjs" }, { output: "7 lines, 120 bytes" }),
  tool("grep_search", { Query: "duplica", SearchPath: "/p" }, { output: "src/contador.mjs:5:export function duplica(n) {\ntest/contador.test.mjs:6:test(\"duplica\")\n" }),
  say("Los dos fallos están en `src/contador.mjs` y `src/texto.mjs`."),
  tool("run_command", { CommandLine: "cd /p && node --test" }, { output: "✖ duplica multiplica por dos\nℹ tests 3\nℹ pass 1\nℹ fail 2\n" }),
  tool("replace_file_content", { TargetFile: "/p/src/contador.mjs" }),
  diff("src/contador.mjs", "@@ -1,7 +1,7 @@\n export function incrementa(n) {\n-  return n - 1\n+  return n + 1\n }\n"),
  tool("write_to_file", { TargetFile: "/p/src/texto.mjs" }),
  diff("src/texto.mjs", "@@ -0,0 +1,3 @@\n+export function grita(s) {\n+  return s.toUpperCase()\n+}\n", { untracked: true }),
  tool("run_command", { CommandLine: "node --test" }, { output: "ℹ tests 3\nℹ pass 3\nℹ fail 0\n" }),
  say("### Hecho\n- Arreglé `incrementa`.\n- Creé [`texto.mjs`](file:///p/src/texto.mjs).\n```bash\nnode --test\n```"),
]

describe("D321: la tool antigravity en el chat y en la vista de agente", () => {
  test("en curso: cabecera de Gemini trabajando, cada cosa separada, terminal y diffs abiertos", async () => {
    const live = view([call([...work.slice(0, 6), tool("run_command", { CommandLine: "npm install" }, { state: "running", output: "added 12 packages" })], { end: null, status: null })], { live: true })
    await mount(() => <AgyTool view={live} running={true} />, { height: 80 })
    const text = frame("en-curso")
    expect(text).toContain("◆ Gemini 3.8 Flash Low · pensó 9.4s en 5 turnos · +79k tok")
    expect(text).toContain("────")
    expect(text).toContain("Explored 1 file, 1 search ›")
    expect(text).toContain("Ran node --test · 1 pass · 2 fail ⌄")
    expect(text).toContain("$ node --test")
    expect(text).toContain("✖ duplica multiplica por dos")
    expect(text).toContain("Edited ▤ src/contador.mjs +1 -1")
    expect(text).toContain("+  return n + 1")
    expect(text).toContain("Running npm install")
    expect(text).toContain("added 12 packages")
    expect(text).not.toContain("Worked for")
  })

  test("terminada en el chat: «Worked for» de Gemini, el último mensaje y los ficheros con su diff", async () => {
    await mount(() => <AgyTool view={view([call(work)])} running={false} />)
    const text = frame("chat-terminada")
    expect(text).toContain("◆ Gemini 3.8 Flash Low · Worked for 52s · pensó 9.4s en 5 turnos · +79k tok ✓ ›")
    expect(text).toContain("Hecho")
    expect(text).toContain("Creé texto.mjs.")
    expect(text).toContain("2 files changed +4 -1")
    expect(text).toContain("▤ src/contador.mjs +1 -1")
    expect(text).toContain("▤ src/texto.mjs (nuevo) +3 -0")
    expect(text).toContain("+  return s.toUpperCase()")
    expect(text).not.toContain("Explored")
    // Las órdenes siguen a la vista, una línea cada una, con su resultado; la salida, a un clic.
    expect(text).toContain("Ran node --test · 1 pass · 2 fail ›")
    expect(text).toContain("Ran node --test · 3 pass · 0 fail ›")
    expect(text).not.toContain("✖ duplica multiplica por dos")
    expect(text).not.toContain("diff --git")
  })

  test("vista de agente (sin plegar): todo, y la tarjeta de ficheros al final", async () => {
    await mount(() => <AgyTool view={view([call(work)])} running={false} collapse={false} />, { height: 110 })
    const text = frame("vista-agente")
    expect(text).toContain("◆ Gemini 3.8 Flash Low · pensó 9.4s en 5 turnos · 52s · +79k tok ✓")
    expect(text).toContain("Created ▤ src/texto.mjs +3 -0")
    expect(text).toContain("· 3 pass · 0 fail")
    expect(text).toContain("2 files changed +4 -1")
  })

  test("markdown real de agy: enlaces dentro de negrita, listas numeradas y separadores", async () => {
    const text = "### Archivos modificados\n\n1. **[`src/precio.mjs`](file:///p/src/precio.mjs)**\n   - **Cambio:** de `1.12` a `1.21`.\n2. **[`README.md`](file:///p/README.md)**\n3. [**carrito.mjs**](file:///p/src/carrito.mjs)\n\n---\nVerificación"
    await mount(() => <AgyTool view={view([call([say(text)])])} running={false} />)
    const frameText = frame("markdown")
    expect(frameText).toContain("1. src/precio.mjs")
    expect(frameText).toContain("• Cambio: de 1.12 a 1.21.")
    expect(frameText).toContain("2. README.md")
    expect(frameText).not.toContain("](file:")
    expect(frameText).not.toContain("**")
    expect(frameText).toContain("3. carrito.mjs")
    expect(frameText).not.toContain("---")
    expect(frameText).toMatch(/─{20,}\s*\n\s*Verificación/)
  })

  test("D327: plegado, sigue a la vista lo que agy dejó abierto en su propia terminal", async () => {
    const opened = view([call([tool("run_command", { CommandLine: "/h/.anti/bin/anti-mcp abrir -- npm run dev" }, { output: "Abierto en una ventana nueva de Ghostty: «npm run dev»." }), say("Listo.")])])
    await mount(() => <AgyTool view={opened} running={false} />)
    expect(frame("abierto")).toContain("Opened in its own terminal npm run dev · Abierto en una ventana nueva de Ghostty")
  })

  test("los avisos no se esconden al plegar: corte del vigilante, permiso denegado y error", async () => {
    const bad = view([call([
      tool("view_file", { AbsolutePath: "/p/a.ts" }, { output: "9 lines, 80 bytes" }),
      { kind: "note", t: T0, text: "vigilante · aviso 1: 15 veces view_file sin editar" },
      { kind: "denied", t: T0, actions: [], rule: "command(rm)", outcome: "rejected" },
      { kind: "note", t: T0, text: "vigilante · corte: view_file en bucle tras 2 avisos" },
    ], { status: "ERROR" })])
    await mount(() => <AgyTool view={bad} running={false} />)
    const text = frame("avisos")
    expect(text).toContain("⏹ cortada por el")
    expect(text).toContain("⚠ Detector de bucles: aviso 1")
    expect(text).toContain("🔒 Acción denegada: command(rm)")
    expect(text).toContain("■ Detector de bucles: corte")
  })

  test("terminal estrecha: la cabecera y las filas largas se parten por palabras, sin montarse", async () => {
    const long = view([call([tool("run_command", { CommandLine: "node --test test/contador.test.mjs test/texto.test.mjs test/otro.test.mjs" }, { output: "ℹ pass 3\nℹ fail 0\n" })], { model: "gemini-3.1-pro-high", notes: ["Pro (/pro)"] })])
    await mount(() => <AgyTool view={long} running={false} />, { width: 60 })
    const text = frame("estrecha")
    expect(text).toContain("◆ Gemini 3.1 Pro High · Worked for 52s · pensó 9.4s en 5")
    expect(text).toMatch(/turnos · \+79k tok ✓ ›/)
    expect(text).toContain("Pro (/pro)")
  })

  test("galería: orquestador con plan, pregunta, anti, web, imagen, orden fallida y error", async () => {
    const gallery = view([
      call([
        tool("call_mcp_tool", { ServerName: "anti_anti", ToolName: "leer", Arguments: "{'ficheros': [{'ruta': 'a.mjs'}, {'ruta': 'b.mjs'}]}" }, { output: "== a.mjs · líneas 1-3 de 3\n1: x\n== b.mjs · error: no existe\n" }),
        tool("search_web", { query: "example domain" }, { output: "**example.com** está reservado.\n- Para documentación[1]" }),
        tool("read_url_content", { Url: "https://example.com" }, { output: "Example Domain" }),
        say("·"),
        tool("call_mcp_tool", { ServerName: "anti_anti", ToolName: "probar", Arguments: "{}" }, { output: "node --test: 2 tests · 1 falla\n✖ duplica" }),
        tool("run_command", { CommandLine: "uname -a" }, { state: "error" }),
        tool("generate_image", { ImageName: "circulo" }, { images: ["/p/circulo.png"] }),
        { kind: "question", t: T0, text: "¿Borro el fichero antiguo?" },
      ], { layer: "orchestrate", model: "gemini-3.1-pro-high" }),
      call([say("No pude.")], { n: 2, layer: "implement", step: { k: 1, n: 2 }, status: "ERROR", notes: ["Pro (/pro)"] }),
    ], { plan: { answer: "Arreglar y probar", steps: [{ k: 1, layer: "implement", instruction: "Arregla a.mjs", status: "failed" }, { k: 2, layer: "verify", instruction: "Ejecuta los tests", status: "pending" }] } })
    await mount(() => <AgyTool view={gallery} running={false} collapse={false} />, { height: 110 })
    const text = frame("galeria")
    expect(text).toContain("◆ Gemini 3.1 Pro High · orquestador")
    expect(text).toContain("Plan · Arreglar y probar")
    expect(text).toContain("Read with anti ▤ a.mjs, b.mjs · 1 missing")
    expect(text).toContain("Ran tests with anti all tests · node --test: 2 tests · 1 falla")
    expect(text).toContain("Failed to run uname -a · denied or did not start")
    expect(text).toContain("? Antigravity pregunta: ¿Borro el fichero antiguo?")
    expect(text).toContain("paso 1/2 · implement")
    expect(text).toContain("✗ agy terminó con estado ERROR. La tarea no está hecha.")
  })
})
