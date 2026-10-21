// `anti-mcp abrir -- <orden>` (fase 15, D327): abre un programa que debe seguir en marcha (servidor de desarrollo, juego, app) en su
// PROPIA ventana de terminal, fuera de agy. Lo que agy lanza como tarea de fondo es hijo suyo y muere cuando la conversación termina; lo
// que abre una terminal aparte, no. Aquí solo se decide qué lanzar (puro); el borde (src/main.ts) lo lanza y prueba la siguiente
// opción si una falla. Sin terminal que abrir (un Linux sin escritorio), la última opción lo deja en segundo plano en su propia sesión,
// con la salida en un fichero.
export type Launch =
  | { readonly kind: "window"; readonly app: string; readonly bin: string; readonly args: readonly string[] }
  | { readonly kind: "background"; readonly shell: string; readonly args: readonly string[] }

export type AbrirInput = {
  readonly command: string
  readonly cwd: string
  readonly platform: NodeJS.Platform
  readonly env: Readonly<Record<string, string | undefined>>
  // ¿Hay un programa con ese nombre en el PATH? (para las terminales de Linux y WezTerm)
  readonly has: (bin: string) => boolean
}

// Para meter un texto entre comillas simples de sh.
const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
// Para meter un texto entre comillas dobles de AppleScript.
const as = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')

const LINUX: readonly (readonly [string, (script: string) => string[]])[] = [
  ["x-terminal-emulator", (c) => ["-e", "sh", "-c", c]],
  ["gnome-terminal", (c) => ["--", "sh", "-c", c]],
  ["konsole", (c) => ["-e", "sh", "-c", c]],
  ["xfce4-terminal", (c) => ["-x", "sh", "-c", c]],
  ["kitty", (c) => ["sh", "-c", c]],
  ["alacritty", (c) => ["-e", "sh", "-c", c]],
  ["wezterm", (c) => ["start", "--", "sh", "-c", c]],
  ["xterm", (c) => ["-e", "sh", "-c", c]],
]

export function launches(input: AbrirInput): Launch[] {
  const { command, cwd, platform, env } = input
  if (platform === "win32") {
    // `start` abre una consola nueva e independiente; `cmd /k` la deja abierta al acabar la orden.
    return [{ kind: "window", app: "una consola de Windows", bin: "cmd.exe", args: ["/c", "start", "anti", "cmd.exe", "/k", `cd /d "${cwd}" && ${command}`] }]
  }
  const shell = env.SHELL || (platform === "darwin" ? "/bin/zsh" : "/bin/sh")
  // La orden en su carpeta y, al acabar, la shell sigue abierta para ver qué pasó.
  const script = `cd ${sq(cwd)} && ${command}; exec ${shell}`
  const background: Launch = { kind: "background", shell, args: ["-lc", `cd ${sq(cwd)} && ${command}`] }
  if (platform === "darwin") {
    const out: Launch[] = []
    // La misma app de terminal que esté usando el usuario (la hereda agy de anti), y si no, Terminal.app.
    // Dentro de tmux, TERM_PROGRAM es «tmux»: Ghostty e iTerm se reconocen también por las variables que dejan a sus procesos.
    const term = [env.TERM_PROGRAM, env.LC_TERMINAL, env.GHOSTTY_RESOURCES_DIR ? "ghostty" : ""].join(" ")
    if (/ghostty/i.test(term)) out.push({ kind: "window", app: "Ghostty", bin: "open", args: ["-na", "Ghostty", "--args", `--working-directory=${cwd}`, "-e", shell, "-lc", script] })
    if (/iTerm/i.test(term))
      out.push({ kind: "window", app: "iTerm", bin: "osascript", args: ["-e", `tell application "iTerm" to create window with default profile command "${as(`${shell} -lc ${sq(script)}`)}"`] })
    if (/WezTerm/i.test(term) && input.has("wezterm")) out.push({ kind: "window", app: "WezTerm", bin: "wezterm", args: ["start", "--cwd", cwd, "--", shell, "-lc", script] })
    out.push({ kind: "window", app: "Terminal", bin: "osascript", args: ["-e", 'tell application "Terminal" to activate', "-e", `tell application "Terminal" to do script "${as(`cd ${sq(cwd)} && ${command}`)}"`] })
    return [...out, background]
  }
  // Linux: solo si hay escritorio; si no, en segundo plano.
  const desktop = !!(env.DISPLAY || env.WAYLAND_DISPLAY)
  const windows: Launch[] = desktop ? LINUX.filter(([bin]) => input.has(bin)).map(([bin, args]) => ({ kind: "window", app: bin, bin, args: args(script) })) : []
  return [...windows, background]
}
