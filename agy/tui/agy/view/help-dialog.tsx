/** @jsxImportSource @opentui/solid */
// Diálogo de ayuda de teclas de la vista de agente (tecla "?"). api.ui.DialogAlert es solo el componente
// (adapters.tsx del host); mostrarlo de verdad requiere api.ui.dialog.replace(render) — el propio DialogAlert
// gestiona su cierre (return/esc/click) internamente, aquí no hace falta pasar onConfirm.
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { safe } from "../safe"

const HELP_TEXT = [
  "esc / q — volver al hilo",
  "← / → — agente anterior / siguiente",
  "f — seguir en vivo (auto-scroll)",
  "t — mostrar/ocultar pensamiento",
  "d — plegar/desplegar diffs",
  // Visor web solo en desarrollo (AGY_UI=0 en anti).
  ...(process.env.AGY_UI === "0" ? [] : ["o — abrir en el navegador (agy-ui)"]),
  "b — panel btw",
  "? — esta ayuda",
].join("\n")

export function openHelp(api: TuiPluginApi) {
  // Fix round 1, item 2 (ruling): envuelto en safe() como cualquier otro manejador que llama a api.* —
  // aquí api.ui.dialog.replace.
  safe(api, "ayuda", () => {
    api.ui.dialog.replace(() => <api.ui.DialogAlert title="Antigravity: teclas" message={HELP_TEXT} />)
  })
}
