import path from "path"
import { pathToFileURL } from "url"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { InstallationVersion } from "@opencode-ai/core/installation/version"

// `anti diagnostico` (D329): el .zip de diagnóstico sin datos personales, desde la terminal. La recogida y la limpieza son de la capa de
// agy instalada (lib/anti/diagnostico*.mjs, la misma que usa /diagnostico dentro de la app).
export const DiagnosticoCommand = cmd({
  command: "diagnostico",
  aliases: ["diagnostic"],
  describe: "crea un .zip de diagnóstico sin datos personales (sin la conversación)",
  handler: async () => {
    const dir = process.env.OPENCODE_CONFIG_DIR
    if (!dir) {
      UI.error("No encuentro la instalación de anti (falta OPENCODE_CONFIG_DIR). Lánzalo con el comando anti.")
      process.exitCode = 1
      return
    }
    const { crearDiagnostico } = await import(pathToFileURL(path.join(dir, "lib", "anti", "diagnostico-crear.mjs")).href)
    UI.println("Diagnóstico de anti")
    UI.println("")
    UI.println("Crea un .zip en tu ordenador con lo indispensable para encontrar fallos: versiones, sistema, ajustes de anti y qué hizo")
    UI.println("el agente en cada tarea (herramientas, tiempos, errores). No incluye nada de lo que escribes ni de lo que responde la IA,")
    UI.println("ni el contenido de tus ficheros, ni tus claves, correos o tu nombre de usuario. No se envía nada: tú decides si lo compartes.")
    UI.println("")
    const { dest, files } = crearDiagnostico({ app: InstallationVersion })
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + "✓ " + dest + UI.Style.TEXT_NORMAL + ` (${files} ficheros)`)
    UI.println("Dentro va LEEME.txt con el detalle de qué incluye y qué no.")
  },
})
