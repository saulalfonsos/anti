// Procesos por argv (nunca una cadena de shell): el código de salida y toda la salida, con tope opcional (SIGKILL). Lo usa `probar`.
export type RunResult = { readonly exit: number; readonly out: string }

export async function run(cmd: readonly string[], cwd: string, opts?: { readonly timeoutMs?: number }): Promise<RunResult> {
  const proc = Bun.spawn([...cmd], { cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore", timeout: opts?.timeoutMs, killSignal: "SIGKILL" })
  const [stdout, stderr, exit] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { exit, out: stdout + stderr }
}
