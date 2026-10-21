import type { TuiPluginApi } from "@opencode-ai/plugin/tui"

// Atajo del selector de agentes. Sintaxis de @opentui/keymap: "<leader>x" (el líder es configurable, por
// defecto ctrl+x). "ctrl+x g" NO es una secuencia válida —se registraba sin efecto— y además <leader>g ya
// es `session_timeline` del host (packages/tui/src/config/keybind.ts); <leader>v está libre (verificado
// contra la lista completa de <leader>* del host, 1.18.31).
export const SELECT_KEY = "<leader>v"

// Texto para la barra: el líder lo elige el usuario en su config, así que se pregunta al keymap en vez de
// escribir "ctrl+x" a mano. Si la versión del host no expone formatKey, se cae al valor por defecto.
export function selectHint(api: TuiPluginApi): string {
  try {
    const fmt = (api.keymap as any)?.formatKey
    if (typeof fmt === "function") {
      const s = fmt.call(api.keymap, SELECT_KEY, { separator: " " })
      if (typeof s === "string" && s.trim()) return s
    }
  } catch {}
  return "ctrl+x v"
}
