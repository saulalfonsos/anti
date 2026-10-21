/** @jsxImportSource @opentui/solid */
// Diálogo selector de agentes (/agentes, <leader>v y /btw cuando hay varios en marcha). Solo cableado
// api.ui.DialogSelect ↔ store: la lista viene de store.agents(), ya ordenada por actividad.
import type { TuiPluginApi, TuiDialogSelectOption } from "@opencode-ai/plugin/tui"
import type { Store, AgentRow } from "../store"
import { ago } from "./format"
import { safe } from "../safe"

// Debe coincidir con ROUTE en index.tsx (ver AGY_ROUTE en store.tsx): no se importa de index.tsx para
// evitar el ciclo index↔view que Task 9 introduciría (import de openAgentSelect desde index.tsx).
const AGY_ROUTE = "agy"

const STATUS_ES: Record<string, string> = { running: "en marcha", done: "hecho", failed: "fallo", question: "pregunta", aborted: "abortado" }

function row(r: AgentRow, category: string): TuiDialogSelectOption<string> {
  return {
    title: `${r.icon} ${r.layer} · ${r.short}`,
    value: r.cid,
    category,
    description: `${STATUS_ES[r.status]} · ${r.lastTool?.arg || r.lastTool?.name || "—"} · hace ${ago(r.lastAt)}${r.first ? " · " + r.first.slice(0, 50) : ""}`,
  }
}

export function openAgentSelect(api: TuiPluginApi, store: Store, onPick: (cid: string) => void) {
  store.refreshAgents()
  // "Esta sesión" viene de store.agents().mine, que a su vez sale de store.sessionID() — y un comando (a
  // diferencia del sidebar, que recibe su propio session_id autoritativo por el slot) no tiene ningún id de
  // sesión propio al que preguntar: solo puede fiarse del que el store ya dedujo de la ruta actual
  // (api.route.current, con el fallback lastKnownSessionID de store.tsx). Justo tras una navegación esa
  // deducción puede ir un paso por detrás (store.sessionID() ve la ruta vieja hasta el próximo refreshAgents),
  // así que "Esta sesión" puede tardar hasta un ciclo de navegación en reflejar el cambio. Se acepta (fix
  // round 1, ruling #2): no hay comportamiento nuevo, solo se documenta por qué no se corrige aquí.
  const a = store.agents()
  const options = [...a.mine.map((r) => row(r, "Esta sesión")), ...a.others.map((r) => row(r, "Otras"))]
  if (!options.length) { api.ui.toast({ message: "agy: todavía no hay conversaciones de Antigravity" }); return }
  const cur = api.route.current as { name: string; params?: { cid?: string } }
  api.ui.dialog.replace(() => (
    <api.ui.DialogSelect
      title="Agentes Antigravity"
      placeholder="filtrar por rol, id o herramienta"
      options={options}
      current={cur.name === AGY_ROUTE ? cur.params?.cid : undefined}
      onSelect={(o) => safe(api, "seleccionar agente", () => { api.ui.dialog.clear(); onPick(o.value) })}
    />
  ))
}
