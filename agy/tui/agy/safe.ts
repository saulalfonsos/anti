// tui/agy/safe.ts — envoltorio común de errores para callbacks de UI (comandos y diálogos): notifica con un
// toast en vez de dejar que la excepción suba y tumbe el runtime de la TUI. Vive en su propio módulo (no en
// index.tsx, de donde salió originalmente) porque agent-select.tsx (bajo view/) también lo necesita para su
// onSelect (fix round 1, ruling #1) y ya importa cosas de index.tsx crearía un ciclo index→view→index.
// Sin JSX ni import de solid-js: puede ser .ts (el loader solo intercepta solid-js en .tsx, ver store.tsx).
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"

export function safe(api: TuiPluginApi, what: string, fn: () => void | Promise<void>) {
  const report = (e: unknown) => api.ui.toast({ variant: "error", message: `agy: ${what}: ${(e as Error).message}` })
  try {
    // Hay manejadores async (p. ej. "abrir en navegador", que sondea /api/health antes de lanzar el
    // navegador): con un try síncrono el bloque termina antes de que la promesa se resuelva, así que un
    // throw posterior salía como unhandled rejection —sin toast y sin nadie que lo capture en el proceso
    // de la TUI— en vez del aviso que este envoltorio promete.
    const r = fn() as unknown as Promise<void> | void
    if (r && typeof (r as Promise<void>).then === "function") (r as Promise<void>).then(undefined, report)
  } catch (e) {
    report(e)
  }
}
