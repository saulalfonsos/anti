// `anti-mcp abrir` (D327): qué se lanza en cada sistema para que un programa siga abierto en su propia terminal, fuera de agy.
import { describe, expect, test } from "bun:test"
import { launches } from "../src/abrir"

const base = { command: "npm run dev", cwd: "/p/mi app", has: () => false }

describe("abrir: una ventana de terminal propia, fuera de agy", () => {
  test("macOS: la terminal que usa el usuario (Ghostty), y si falla, Terminal.app; al final, segundo plano", () => {
    const l = launches({ ...base, platform: "darwin", env: { TERM_PROGRAM: "ghostty", SHELL: "/bin/zsh" } })
    expect(l.map((x) => (x.kind === "window" ? x.app : "fondo"))).toEqual(["Ghostty", "Terminal", "fondo"])
    expect(l[0]).toMatchObject({ bin: "open", args: ["-na", "Ghostty", "--args", "--working-directory=/p/mi app", "-e", "/bin/zsh", "-lc", "cd '/p/mi app' && npm run dev; exec /bin/zsh"] })
    expect((l[1] as { args: readonly string[] }).args[3]).toBe(`tell application "Terminal" to do script "cd '/p/mi app' && npm run dev"`)
  })

  test("macOS dentro de tmux: Ghostty por GHOSTTY_RESOURCES_DIR, iTerm por LC_TERMINAL", () => {
    expect(launches({ ...base, platform: "darwin", env: { TERM_PROGRAM: "tmux", GHOSTTY_RESOURCES_DIR: "/Applications/Ghostty.app/Contents/Resources/ghostty" } })[0]).toMatchObject({ app: "Ghostty" })
    expect(launches({ ...base, platform: "darwin", env: { TERM_PROGRAM: "tmux", LC_TERMINAL: "iTerm2" } })[0]).toMatchObject({ app: "iTerm" })
  })

  test("macOS con iTerm o sin TERM_PROGRAM conocido; comillas en la orden", () => {
    const iterm = launches({ ...base, platform: "darwin", env: { TERM_PROGRAM: "iTerm.app" } })
    expect(iterm[0]).toMatchObject({ app: "iTerm", bin: "osascript" })
    const plain = launches({ ...base, command: `python -c "print('hola')"`, platform: "darwin", env: {} })
    expect(plain.map((x) => x.kind)).toEqual(["window", "background"])
    expect((plain[0] as { args: readonly string[] }).args[3]).toBe(`tell application "Terminal" to do script "cd '/p/mi app' && python -c \\"print('hola')\\""`)
  })

  test("Linux: con escritorio, las terminales instaladas; sin escritorio, solo segundo plano", () => {
    const desk = launches({ ...base, platform: "linux", env: { DISPLAY: ":0", SHELL: "/bin/bash" }, has: (b) => b === "gnome-terminal" })
    expect(desk[0]).toMatchObject({ app: "gnome-terminal", args: ["--", "sh", "-c", "cd '/p/mi app' && npm run dev; exec /bin/bash"] })
    expect(desk.at(-1)).toEqual({ kind: "background", shell: "/bin/bash", args: ["-lc", "cd '/p/mi app' && npm run dev"] })
    expect(launches({ ...base, platform: "linux", env: {}, has: () => true }).map((x) => x.kind)).toEqual(["background"])
  })

  test("Windows: una consola nueva con start, que se queda abierta (cmd /k)", () => {
    const [w] = launches({ ...base, cwd: "C:\\p\\app", platform: "win32", env: {} })
    expect(w).toEqual({ kind: "window", app: "una consola de Windows", bin: "cmd.exe", args: ["/c", "start", "anti", "cmd.exe", "/k", 'cd /d "C:\\p\\app" && npm run dev'] })
  })
})
