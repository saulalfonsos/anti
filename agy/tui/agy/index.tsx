/** @jsxImportSource @opentui/solid */
// Plugin de TUI "agy": visor de agentes Antigravity dentro de OpenCode + /btw. Solo cableado api.* ↔ store ↔
// vistas; la lógica vive en lib/antigravity/tui/*.mjs (testada con node --test).
import type { TuiPlugin } from "@opencode-ai/plugin/tui"
import { SELECT_KEY } from "./keys"
import { Show, createMemo } from "solid-js"
import { createStore, navigateAgent, type Store } from "./store"
import { AgentsSidebar } from "./view/agents-sidebar"
import { AgentsBar } from "./view/agents-bar"
import { AgentView } from "./view/agent-view"
import { SubagentView } from "./view/subagent-view"
import { openAgentSelect } from "./view/agent-select"
import { openModelSelect } from "./view/model-select"
import { onboardingSteps, runOnboarding } from "./onboarding"
import { openDiagnostico, watchFailures } from "./diagnostico"
import { BtwPanel } from "./view/btw-panel"
import { createBtw } from "./btw"
import { safe } from "./safe"

export const ROUTE = "agy"
const SUB_ROUTE = "agy.sub"

// navigateAgent vive en store.tsx (Fix round 1, item 3: agent-view.tsx también la necesita para ←/→, y
// store.tsx es el módulo neutral que ambos pueden importar sin ciclo index↔view — mismo motivo que
// siblings, ya movida allí en Task 9). Se reexporta aquí para quien la busque por su ruta original.
export { navigateAgent }

const tui: TuiPlugin = async (api) => {
  const store: Store = createStore(api)
  const btw = createBtw(api, store)

  // Contrato de params de ROUTE: cid identifica al agente; returnRoute (la ruta desde la que se navegó,
  // normalmente api.route.current en ese momento) es de dónde store.sessionID() saca el sessionID cuando
  // esta ruta no lo trae directo (spec store.ts). Quien navegue aquí (el selector, Task 7) debe seguir
  // pasando returnRoute: api.route.current — si se omite, "mine" se queda vacío mientras se ve un agente.
  const offRoute = api.route.register([
    {
      // D324: la ruta de un subagente; se remonta por subagente (keyed sobre el encargo y la tarea que lo lanzó).
      name: SUB_ROUTE,
      render: () => {
        const sub = createMemo(() => {
          const cur = api.route.current as { name: string; params?: { sub?: any } }
          return cur.name === SUB_ROUTE && cur.params?.sub ? cur.params.sub : undefined
        })
        return (
          <Show when={sub()} keyed>
            {(s) => <SubagentView api={api} sub={s} returnRoute={(api.route.current as any).params?.returnRoute} />}
          </Show>
        )
      },
    },
    {
      name: ROUTE,
      render: () => {
        // Fix round 1, item 1 (CRÍTICO): el host reconcilia los datos de ruta para el mismo id de plugin
        // en vez de volver a invocar render() en cada navegación agy→agy (context/route.tsx:38,
        // app.tsx:1086) — por eso `cid` se lee aquí dentro, reactivamente sobre api.route.current, en vez
        // de desestructurar params del argumento de render (eso capturaría el cid de la PRIMERA vez y se
        // quedaría pegado en él para siempre: AgentView nunca se remontaría al pulsar ←/→, así que nunca
        // haría watch() del cid nuevo ni unwatch() del viejo, y btwOpen/follow arrastrarían el estado del
        // agente anterior).
        // <Show keyed> es la pieza que fuerza el remonte real: cuando el VALOR de `when` cambia (no solo su
        // veracidad), Solid destruye el árbol anterior — dispara los onCleanup de la AgentView vieja (pop
        // de modo, des-registro de la capa de teclas, unwatch) — y crea uno nuevo desde cero para el cid
        // nuevo (watch, mode.push y registerLayer frescos, estado local reiniciado).
        const cid = createMemo(() => {
          const cur = api.route.current as { name: string; params?: { cid?: unknown } }
          return cur.name === ROUTE ? String(cur.params?.cid ?? "") : ""
        })
        return (
          <Show when={cid()} keyed>
            {(c) => {
              // returnRoute/btw se leen una vez por montaje (cuando `c` cambia), no reactivamente: son el
              // estado de ARRANQUE de esta instancia de AgentView, coherente con "fresh watch/unwatch,
              // fresh local state" — btw en concreto es solo la semilla inicial de btwOpen (ver
              // agent-view.tsx), no algo que deba seguir cambiando por su cuenta tras el montaje.
              const cur = api.route.current as { params?: { returnRoute?: unknown; btw?: unknown } }
              return (
                <AgentView
                  api={api}
                  store={store}
                  cid={c}
                  returnRoute={cur.params?.returnRoute as any}
                  btw={!!cur.params?.btw}
                  btwPanel={(p) => <BtwPanel api={api} btw={btw} cid={p.cid} parentSessionID={store.sessionID()} onBlur={() => {}} />}
                  btwCount={btw.count}
                />
              )
            }}
          </Show>
        )
      },
    },
  ])
  const offKeys = api.keymap.registerLayer({
    commands: [
      {
        name: "agy.select", title: "Antigravity: agentes", slashName: "agentes", category: "Antigravity", namespace: "palette",
        run() { safe(api, "agentes", () => openAgentSelect(api, store, (cid) => navigateAgent(api, cid))) },
      },
      {
        // D329: el .zip de diagnóstico, sin nada de la conversación.
        name: "anti.diagnostico", title: "anti: diagnóstico (.zip sin datos personales)", slashName: "diagnostico", slashAliases: ["diagnostic"], category: "Antigravity", namespace: "palette",
        run() { safe(api, "diagnóstico", () => openDiagnostico(api)) },
      },
      {
        // D325: el onboarding otra vez (proveedor y clave del traductor, modelo, agy y su sesión).
        name: "anti.setup", title: "anti: configurar", slashName: "configurar", slashAliases: ["setup", "onboarding"], category: "Antigravity", namespace: "palette",
        run() { safe(api, "configurar", () => runOnboarding(api, ["bienvenida", "proveedor", "clave", "modelo", "agy", "sesion"])) },
      },
      {
        // D323: qué modelo de agy usan las tareas nuevas del modo directo.
        name: "agy.model", title: "Antigravity: modelo", slashName: "agy", slashAliases: ["antigravity"], category: "Antigravity", namespace: "palette",
        run() { safe(api, "modelo", () => openModelSelect(api)) },
      },
      {
        // /btw desde el hilo: exactamente un agente en marcha en "mine" → entra directo con btw:true; varios →
        // abre el selector (y aplica btw:true a lo que se elija); ninguno → toast. El panel btw en sí (Task 10)
        // solo recibe el parámetro por ahora, aquí no se abre nada más.
        name: "agy.btw", title: "Antigravity: btw", slashName: "btw", category: "Antigravity", namespace: "palette",
        run() {
          safe(api, "btw", () => {
            store.refreshAgents()
            const running = store.agents().mine.filter((r) => r.status === "running")
            if (running.length === 1) { navigateAgent(api, running[0].cid, { btw: true }); return }
            if (running.length > 1) { openAgentSelect(api, store, (cid) => navigateAgent(api, cid, { btw: true })); return }
            api.ui.toast({ message: "agy: no hay agentes en marcha" })
          })
        },
      },
    ],
    bindings: [{ key: SELECT_KEY, cmd: "agy.select", desc: "Antigravity: agentes" }],
  })
  // Al abrir un agente desde el sidebar hay que seguir pasando returnRoute: api.route.current — es de ahí
  // de donde store.sessionID() saca el sessionID mientras se ve la ruta "agy" (ver comentario más arriba).
  // D324: un subagente de invoke_subagent se abre con el aspecto del chat; lo demás, en la vista de agente.
  const open = (row: { cid: string; sub?: unknown }) =>
    row.sub ? safe(api, "abrir subagente", () => api.route.navigate(SUB_ROUTE, { sub: row.sub, returnRoute: api.route.current })) : navigateAgent(api, row.cid)
  api.slots.register({
    order: 450,
    slots: {
      sidebar_content(_ctx, props) { return <AgentsSidebar api={api} store={store} session_id={props.session_id} onOpen={open} /> },
      app_bottom() { return <AgentsBar api={api} store={store} btwCount={() => store.agents().mine.reduce((n, r) => n + btw.count(r.cid), 0)} /> },
    },
  })

  // D325: la primera vez en anti (o con `anti setup`), el onboarding; después, solo si falta algo. Se espera a que la TUI esté
  // lista para no tapar el arranque.
  const steps = onboardingSteps()
  if (steps.length) {
    const start = () => (api.state.ready ? safe(api, "onboarding", () => runOnboarding(api, steps)) : setTimeout(start, 200))
    setTimeout(start, 300)
  }

  // D329: cuando algo falla, ofrecer el diagnóstico.
  const offFailures = watchFailures(api)

  api.lifecycle.onDispose(() => {
    offFailures()
    if (typeof offKeys === "function") offKeys()
    if (typeof offRoute === "function") offRoute()
    btw.dispose()
    store.dispose()
  })
}

export default { id: "agy", tui }
