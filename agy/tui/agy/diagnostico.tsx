/** @jsxImportSource @opentui/solid */
// El diagnóstico desde la app (D329): `/diagnostico` en cualquier momento y, cuando algo falla, un aviso que ofrece crearlo. Explica en
// sencillo qué se incluye y qué no (sin la conversación, RGPD) y crea el .zip en Descargas; nada se envía. La recogida y la limpieza
// son de lib/anti/diagnostico*.mjs.
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { spawn } from "node:child_process"
import { crearDiagnostico } from "../../lib/anti/diagnostico-crear.mjs"
import { LEEME } from "../../lib/anti/diagnostico.mjs"
import { revealCommand } from "../../lib/anti/platform.mjs"
import { ask, Lines } from "./onboarding"

type Api = TuiPluginApi
const KV_NEVER = "anti.diagnostico.no_preguntar"
const OFFER_EVERY_MS = 10 * 60_000
let lastOffer = 0

const RESUMEN: (string | [string, "ok" | "error" | "warn" | "muted" | "accent"])[] = [
  "Crea un .zip en tu ordenador con lo indispensable para encontrar el fallo: las versiones de anti y de agy, tu sistema, los ajustes de anti y qué hizo el agente en cada tarea (qué herramientas usó, cuánto tardó, qué falló y con qué error).",
  "",
  ["No incluye nada de lo que escribes ni de lo que responde la IA, ni el contenido de tus ficheros, ni tus claves, correos o tu nombre de usuario: las rutas se cambian por marcadores.", "ok"],
  "",
  ["No se envía nada: el .zip se queda en tu carpeta de Descargas y tú decides si lo compartes. Puedes abrirlo y revisarlo antes. Se recoge solo lo indispensable, como pide el RGPD.", "muted"],
]

// `/diagnostico`: explica, deja ver el detalle y crea el .zip.
export async function openDiagnostico(api: Api, motivo?: string) {
  for (;;) {
    const v = await ask(api, {
      title: motivo ? "Algo ha fallado · diagnóstico" : "Diagnóstico de anti",
      intro: () => <Lines api={api} lines={[...(motivo ? [[motivo, "warn"] as [string, "warn"], ""] : []), ...RESUMEN]} />,
      options: [
        { title: "Crear el .zip de diagnóstico", value: "crear" },
        { title: "Ver qué incluye exactamente", value: "detalle" },
        ...(motivo ? [{ title: "No volver a preguntar", value: "nunca", description: "siempre puedes usar /diagnostico" }] : []),
        { title: "Ahora no", value: "no" },
      ],
    })
    if (v === "detalle") {
      await ask(api, { title: "Qué lleva el .zip", intro: () => <Lines api={api} lines={LEEME.split("\n")} />, options: [{ title: "Volver", value: "v" }] })
      continue
    }
    if (v === "nunca") api.kv.set(KV_NEVER, true)
    if (v !== "crear") return api.ui.dialog.clear()
    return crear(api)
  }
}

async function crear(api: Api) {
  api.ui.dialog.clear()
  api.ui.toast({ message: "anti: creando el .zip de diagnóstico…" })
  try {
    const { dest, files } = crearDiagnostico({ app: api.app.version })
    const done: (string | [string, "ok"])[] = [
      [`✓ ${dest}`, "ok"],
      "",
      `${files} ficheros, sin nada de tus conversaciones. Ábrelo para revisarlo si quieres y, si lo compartes, adjúntalo tal cual.`,
    ]
    const v = await ask(api, {
      title: "Diagnóstico creado",
      intro: () => <Lines api={api} lines={done} />,
      options: [{ title: "Mostrar en su carpeta", value: "mostrar" }, { title: "Listo", value: "ok" }],
    })
    if (v === "mostrar") {
      const [bin, args] = revealCommand(dest)
      spawn(bin, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref()
    }
    api.ui.dialog.clear()
  } catch (error) {
    api.ui.dialog.clear()
    api.ui.toast({ variant: "error", message: `anti: no pude crear el diagnóstico: ${(error as Error).message}` })
  }
}

// Cuando algo falla: ofrecerlo, como mucho una vez cada diez minutos, sin tapar otro diálogo y salvo «no volver a preguntar».
export function offerDiagnostico(api: Api, motivo: string) {
  if (api.kv.get(KV_NEVER, false)) return
  if (api.ui.dialog.open) return
  if (Date.now() - lastOffer < OFFER_EVERY_MS) return
  lastOffer = Date.now()
  void openDiagnostico(api, motivo)
}

// Qué cuenta como fallo: una tarea de Gemini que termina mal (la tool lo marca con `next: "problem"` o acaba en error) y los errores
// de sesión de la app que no son una cancelación del usuario.
export function watchFailures(api: Api) {
  const offPart = api.event.on("message.part.updated", (ev: any) => {
    const part = ev?.properties?.part
    if (part?.type !== "tool" || part.tool !== "antigravity") return
    const st = part.state
    if (st?.status === "error" || (st?.status === "completed" && st?.metadata?.next === "problem"))
      offerDiagnostico(api, "La última tarea de Gemini no ha terminado bien.")
  })
  const offError = api.event.on("session.error", (ev: any) => {
    const name = ev?.properties?.error?.name
    if (name === "MessageAbortedError") return
    offerDiagnostico(api, "anti ha tenido un error.")
  })
  return () => {
    if (typeof offPart === "function") offPart()
    if (typeof offError === "function") offError()
  }
}
