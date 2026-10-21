/** @jsxImportSource @opentui/solid */
// /agy y /antigravity (fase 15, D323): elige qué modelo de agy usa el modo directo en las tareas nuevas. La lista sale de `agy models` (se pide una
// vez y se recuerda); la elección se guarda en la caché (lib/antigravity/model-choice.mjs), donde la lee la tool.
import type { TuiPluginApi, TuiDialogSelectOption } from "@opencode-ai/plugin/tui"
import { execFile } from "node:child_process"
import fs from "node:fs"
import { defaultModel, parseModels, readChoice, writeChoice } from "../../../lib/antigravity/model-choice.mjs"
import { safe } from "../safe"
import { agyBin } from "../../../lib/anti/onboarding.mjs"

const DEFAULT = "__defecto__"
let cached: { id: string; name: string }[] | undefined

function listModels(): Promise<{ id: string; name: string }[]> {
  if (cached) return Promise.resolve(cached)
  return new Promise((resolve, reject) => {
    execFile(agyBin(process.env as Record<string, string>), ["models"], { timeout: 30_000 }, (error, stdout) => {
      const models = parseModels(stdout ?? "")
      if (!models.length) return reject(new Error(error?.message || "agy models no devolvió ningún modelo"))
      cached = models
      resolve(models)
    })
  })
}

function configured() {
  try {
    return defaultModel(fs.readFileSync(new URL("../../../tools/agy.env", import.meta.url), "utf8"))
  } catch {
    return null
  }
}

const family = (id: string) => (id.startsWith("gemini-") ? "Gemini" : id.startsWith("claude-") ? "Claude" : "Otros")

export function openModelSelect(api: TuiPluginApi) {
  api.ui.toast({ message: "agy: pidiendo la lista de modelos…" })
  listModels().then(
    (models) =>
      safe(api, "modelo", () => {
        const base = configured()
        const chosen = readChoice()
        const name = (id: string | null) => models.find((m) => m.id === id)?.name ?? id ?? "—"
        const options: TuiDialogSelectOption<string>[] = [
          { title: `Por defecto · ${name(base)}`, value: DEFAULT, category: "Config", description: "el que trae la configuración" },
          ...models.map((m) => ({ title: m.name, value: m.id, category: family(m.id), description: m.id })),
        ]
        api.ui.dialog.replace(() => (
          <api.ui.DialogSelect
            title="Modelo de agy"
            placeholder="filtrar modelos"
            options={options}
            current={chosen ?? DEFAULT}
            onSelect={(o) =>
              safe(api, "elegir modelo", () => {
                api.ui.dialog.clear()
                writeChoice(o.value === DEFAULT ? null : o.value)
                api.ui.toast({ message: `agy: las próximas tareas usan ${o.value === DEFAULT ? name(base) : name(o.value)}${o.value === DEFAULT ? " (por defecto)" : ""}. /pro sigue usando Pro.` })
              })
            }
          />
        ))
      }),
    (error: Error) => api.ui.toast({ message: `agy: no pude leer los modelos (${error.message})` }),
  )
}
