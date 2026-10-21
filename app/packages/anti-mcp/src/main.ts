// Servidor MCP de anti por stdio (P13-c, D280, D281, D288): el borde de la capa `src/mcp`. Es lo único que toca el proceso
// (stdin, stdout, stderr y el cwd), `node:fs` y el puerto `fs` de `LocalHost`; la capa recibe todo eso por parámetro.
// agy lo arranca con su `command` y `args` del `mcp_config.json` de un plugin del espacio de trabajo (la evaluación lo instala
// en el clon de cada celda) y lo cierra al terminar: EOF en stdin. La raíz (D281) es `--raiz` o, sin él, el cwd: agy arranca el
// servidor de un plugin con el cwd en la carpeta del plugin (medido en 1.2.14), así que la evaluación pasa el clon con `--raiz`.
//
// Uso: bun src/main.ts [--log <fichero>] [--etiqueta <texto>] [--raiz <directorio>]
//      bun src/main.ts abrir -- <orden>    abre la orden en su propia ventana de terminal y sale (D327, src/abrir/abrir.ts)
//   --log        añade al fichero una línea JSON al arrancar ({t, etiqueta, evento: "arranque", cwd, raiz}) y otra por cada tools/call (D288);
//                sin él no se registra nada. La de arranque distingue «el servidor arrancó y no se usó» de «no arrancó»
//   --etiqueta   se copia a cada línea del registro: la evaluación pasa la clave de la celda, para unirla con su fila
//   --raiz       la raíz contra la que se resuelven las rutas de `leer` y donde corre `probar`; por defecto, el cwd
//
// Una línea JSON-RPC entra, una sale (si no era una notificación), EN ORDEN: cada petición espera a la respuesta de la anterior.
import { appendFileSync, mkdirSync, openSync, statSync } from "node:fs"
import { spawn } from "node:child_process"
import { homedir } from "node:os"
import { delimiter, join } from "node:path"
import { launches, type Launch } from "./abrir"
import { realpath } from "node:fs/promises"
import { parseArgs } from "node:util"
import { run } from "./run"
import { make } from "./memo"
import { handler, type CallRecord } from "./protocol"
import { readTool } from "./read"
import { testsTool } from "./run-tests"
import { MCP_SERVER } from "./names"
import { splitLines } from "./lines"

const VERSION = "0.1.0"

async function main(): Promise<void> {
  if (process.argv[2] === "abrir") return abrir(process.argv.slice(3))
  const options = parseArgs({ args: process.argv.slice(2), options: { log: { type: "string" }, etiqueta: { type: "string" }, raiz: { type: "string" } }, strict: true }).values
  const file = options.log
  const root = options.raiz ?? process.cwd()
  // D288: la primera línea del registro es el arranque, antes de atender nada: con el cwd con que agy lo lanzó, la raíz (D281) y la
  // etiqueta de la celda queda dicho que el servidor arrancó para ese clon, se use o no después.
  if (file !== undefined) write(file, { t: new Date().toISOString(), etiqueta: options.etiqueta, evento: "arranque", cwd: process.cwd(), raiz: root })
  // Una sola memoria para todo el proceso: la separación por conversación la hace ella misma con el id de `_meta`.
  const ports = { root, realpath: (path: string) => realpath(path) }
  const serve = handler({
    name: MCP_SERVER,
    version: VERSION,
    tools: [
      readTool({ ...ports, readFile: (path) => Bun.file(path).bytes() }, make()),
      testsTool({ ...ports, run: (cmd, cwd, opts) => run(cmd, cwd, opts) }),
    ],
    onCall: file === undefined ? undefined : (record) => append(file, options.etiqueta, record),
  })

  const decoder = new TextDecoder()
  let rest = ""
  // `getReader()` y no `for await`, como `worker/process.ts`: no depende de la augmentación de `[Symbol.asyncIterator]` de @types/bun.
  const reader = Bun.stdin.stream().getReader()
  while (true) {
    const next = await reader.read()
    if (next.done) break
    const split = splitLines(rest, decoder.decode(next.value, { stream: true }))
    rest = split.rest
    for (const line of split.lines) await answer(serve, line)
  }
  // La última petición puede llegar sin salto de línea final.
  await answer(serve, rest + decoder.decode())
}

async function answer(serve: (line: string) => Promise<string | undefined>, line: string): Promise<void> {
  if (line.trim() === "") return
  const reply = await serve(line)
  if (reply !== undefined) await Bun.write(Bun.stdout, `${reply}\n`)
}

// D288: una línea JSON por tools/call. Va a `write`, igual que la de arranque.
function append(file: string, label: string | undefined, record: CallRecord): void {
  write(file, {
    t: new Date().toISOString(),
    etiqueta: label,
    conversation: record.meta.conversation,
    tool: record.tool,
    args: record.args,
    isError: record.result.isError === true,
    chars: record.result.text.length,
    stats: record.result.stats,
  })
}

// El registro es una medición, no el servicio: si no se puede escribir se dice por stderr (stdout es solo del protocolo) y las
// respuestas siguen saliendo. Síncrono y no `appendJsonl`: son unos cientos de bytes y así el orden es el de los hechos. Una clave
// `undefined` (sin etiqueta, sin conversación) no sale en la línea: `JSON.stringify` la omite.
function write(file: string, entry: Readonly<Record<string, unknown>>): void {
  try {
    appendFileSync(file, `${JSON.stringify(entry)}\n`)
  } catch (error) {
    process.stderr.write(`anti-mcp: no se pudo escribir el registro ${file}: ${error instanceof Error ? error.message : String(error)}\n`)
  }
}

await main().catch((error: unknown) => {
  console.error(`FALLO: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(2)
})

// D327: `abrir -- <orden>`. Prueba cada forma de abrir una ventana hasta que una arranque; una ventana cuenta como abierta si su lanzador
// (open, osascript, start…) termina bien o sigue vivo a los 5 s. Si ninguna, en segundo plano en su propia sesión (detached = setsid),
// así que tampoco muere con agy. Lo que imprime es lo que lee agy.
async function abrir(argv: string[]): Promise<void> {
  const command = (argv[0] === "--" ? argv.slice(1) : argv).join(" ").trim()
  if (!command) {
    console.error("uso: anti-mcp abrir -- <orden>")
    process.exit(2)
  }
  const has = (bin: string) => (process.env.PATH ?? "").split(delimiter).some((d) => { try { return statSync(join(d, bin)).isFile() } catch { return false } })
  for (const l of launches({ command, cwd: process.cwd(), platform: process.platform, env: process.env, has })) {
    if (l.kind === "background") {
      const dir = join(homedir(), ".cache", "anti", "abiertos")
      mkdirSync(dir, { recursive: true })
      const log = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.log`)
      const fd = openSync(log, "a")
      const child = spawn(l.shell, [...l.args], { detached: true, stdio: ["ignore", fd, fd] })
      child.unref()
      console.log(`No hay una terminal con ventana que abrir: «${command}» sigue en segundo plano (pid ${child.pid}) aunque esta conversación termine. Su salida va a ${log}.`)
      return
    }
    if (await opened(l)) {
      console.log(`Abierto en una ventana nueva de ${l.app}: «${command}». Sigue abierto aunque esta conversación termine; no lo pares.`)
      return
    }
  }
}

function opened(l: Extract<Launch, { kind: "window" }>): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(l.bin, [...l.args], { detached: true, stdio: "ignore" })
    const timer = setTimeout(() => { child.unref(); resolve(true) }, 5000)
    child.once("error", () => { clearTimeout(timer); resolve(false) })
    child.once("exit", (code) => { clearTimeout(timer); resolve(code === 0) })
  })
}
