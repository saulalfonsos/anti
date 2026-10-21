/** @jsxImportSource @opentui/solid */
// Onboarding de anti (fase 15, D325): la primera vez (o con /configurar o `anti setup`) guía, con los diálogos de OpenCode, por
// lo que hace falta para que funcione: el proveedor del traductor (OpenRouter, OpenCode Zen u otro de OpenCode) y su clave, el modelo
// traductor, dónde está agy y que agy tenga la sesión de Google. Cada paso explica qué es y para qué, comprueba de verdad (OpenRouter responde, el modelo contesta, agy arranca, `agy models`
// devuelve modelos) y deja volver atrás. La lógica está en lib/anti/onboarding.mjs (con tests); aquí solo la interfaz y los efectos
// (red, órdenes, terminal). Nunca lee las credenciales de agy.
import type { TuiPluginApi, TuiDialogSelectOption } from "@opencode-ai/plugin/tui"
import { execFile, spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  KEYS_URL, RECOMMENDED, ZEN, ZEN_URL, agyCandidates, agyInstall, agySession, checkKey, freeToolModels, hasCredentials, otherProviders,
  pending, probeAgy, providerOf, readState, readTraductor, savedAgy, testModel, toolModels, writeAgy, writeState, writeTraductor,
} from "../../lib/anti/onboarding.mjs"
import { agyDirs, openUrlCommand, terminalCommands } from "../../lib/anti/platform.mjs"

type Api = TuiPluginApi
const env = () => process.env as Record<string, string>
const exists = (p: string) => {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}
// El PATH de una app lanzada desde el Dock o desde otro programa puede no traer la carpeta donde instala agy el instalador oficial.
const runEnv = () => ({ ...process.env, PATH: [process.env.PATH ?? "", ...agyDirs(env())].join(path.delimiter) })
// La entrada se cierra en seguida: agy 1.4 espera a que acabe antes de responder (`agy models` con la entrada abierta no termina).
// `agy models` pregunta a Google y tarda entre unos segundos y más de medio minuto: 90 s de margen.
const run = (bin: string, args: string[]) =>
  new Promise<{ code: number; stdout: string; stderr: string; timedOut?: boolean }>((resolve) => {
    execFile(bin, args, { timeout: 90_000, env: runEnv() }, (error, stdout, stderr) =>
      resolve({ code: error ? (typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : 1) : 0, stdout: String(stdout ?? ""), stderr: String(stderr ?? error?.message ?? ""), timedOut: !!(error as { killed?: boolean } | null)?.killed }))
      .stdin?.end()
  })
const launch = (bin: string, args: string[]) =>
  new Promise<boolean>((resolve) => {
    const p = spawn(bin, args, { stdio: "ignore", detached: true })
    p.once("error", () => resolve(false))
    p.once("spawn", () => { p.unref(); resolve(true) })
  })
const inPath = (bin: string) => (process.env.PATH ?? "").split(path.delimiter).some((d) => exists(path.join(d, bin)))
const openUrl = (url: string) => { const [bin, args] = openUrlCommand(url); void launch(bin, args) }
// Una terminal de verdad, a la vista del usuario, con la orden escrita (instalar agy o iniciar sesión en agy). En Linux, la primera de
// las instaladas que arranque. Devuelve si pudo abrir alguna.
async function openTerminal(command: string) {
  for (const [bin, args] of terminalCommands(command, process.platform, inPath)) if (await launch(bin, args)) return true
  return false
}
const authFile = () => path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local/share"), "anti", "auth.json")
// Las claves que guarda OpenCode (auth.json), por proveedor.
function readAuth(): Record<string, { key?: string }> {
  try {
    return JSON.parse(fs.readFileSync(authFile(), "utf8")) ?? {}
  } catch {
    return {}
  }
}
// La clave de un proveedor que usará OpenCode, en su mismo orden: la guardada (auth.json) pisa la de sus variables de entorno.
function keySource(provider = "openrouter", envNames = ["OPENROUTER_API_KEY"]): { key: string; from: string } | undefined {
  const saved = readAuth()[provider]?.key
  if (typeof saved === "string") return { key: saved, from: "guardada en anti" }
  const name = envNames.find((n) => process.env[n])
  if (name) return { key: process.env[name]!, from: `de la variable ${name} de tu terminal` }
}
const savedKey = () => keySource()?.key
const masked = (key: string) => `${key.slice(0, 9)}…${key.slice(-4)}`
const home = (p: string) => (p.startsWith(os.homedir()) ? `~${p.slice(os.homedir().length)}` : p)

// ¿Toca enseñarlo al arrancar? Solo en anti (no en la config de desarrollo), y solo lo que falte.
export function onboardingSteps() {
  if (!process.env.ANTI_HOME) return []
  const all = ["bienvenida", "proveedor", "clave", "modelo", "agy", "sesion"]
  if (process.env.ANTI_ONBOARDING === "force") return all
  const agy = savedAgy(env()) || agyCandidates(env(), exists)[0] || null
  const state = readState(env())
  const hasKey = hasCredentials({ provider: providerOf(readTraductor(env())), auth: readAuth(), env: env(), envNames: state?.envNames ?? [] })
  return pending({ state, hasKey, agy })
}

// Un paso: un selector con la explicación arriba. Devuelve lo elegido, o undefined si se cierra con esc.
export function ask<T>(api: Api, props: { title: string; intro: () => any; options: TuiDialogSelectOption<T>[]; filter?: boolean; current?: T }) {
  return new Promise<T | undefined>((resolve) => {
    let settled = false
    const done = (v: T | undefined) => { if (!settled) { settled = true; resolve(v) } }
    api.ui.dialog.replace(
      () => <api.ui.DialogSelect title={props.title} intro={props.intro} renderFilter={props.filter ?? false} options={props.options} current={props.current} onSelect={(o) => done(o.value)} />,
      () => done(undefined),
    )
    api.ui.dialog.setSize("large")
  })
}

function busy(api: Api, title: string, text: string) {
  const t = api.theme.current
  api.ui.dialog.replace(() => (
    <box paddingLeft={4} paddingRight={4} paddingBottom={1} gap={1}>
      <text fg={t.text}><b>{title}</b></text>
      <text fg={t.textMuted}>{text}</text>
    </box>
  ))
  api.ui.dialog.setSize("large")
}

export function Lines(props: { api: Api; lines: (string | [string, "ok" | "error" | "warn" | "muted" | "accent"])[] }) {
  const t = props.api.theme.current
  const color = (tone?: string) => tone === "ok" ? t.success : tone === "error" ? t.error : tone === "warn" ? t.warning : tone === "accent" ? t.primary : tone === "muted" ? t.textMuted : t.text
  return (
    <box flexDirection="column">
      {props.lines.map((l) => (typeof l === "string" ? <text wrapMode="word" fg={t.text}>{l}</text> : <text wrapMode="word" fg={color(l[1])}>{l[0]}</text>))}
    </box>
  )
}

const BACK = "__atras__"
const step = (n: number, of: number, name: string) => `Configurar anti · ${n}/${of} · ${name}`

type ProviderChoice = { id: string; name: string; env: string[] }
type Result = { provider?: ProviderChoice; key?: string; keyInfo?: string; model?: string; agy?: { path: string; version: string }; session?: { ok: boolean; text: string } }
const OPENROUTER: ProviderChoice = { id: "openrouter", name: "OpenRouter", env: ["OPENROUTER_API_KEY"] }
const ZEN_CHOICE: ProviderChoice = { id: ZEN, name: "OpenCode Zen", env: ["OPENCODE_API_KEY"] }
// El proveedor elegido en esta pasada o, si no, el del traductor guardado.
function providerOfRun(r: Result): ProviderChoice {
  if (r.provider) return r.provider
  const id = providerOf(readTraductor(env()))
  if (id === "openrouter") return OPENROUTER
  if (id === ZEN) return ZEN_CHOICE
  return { id, name: id, env: readState(env())?.envNames ?? [] }
}

export async function runOnboarding(api: Api, steps = onboardingSteps()) {
  if (!steps.length) return
  const r: Result = {}
  const of = steps.filter((s) => s !== "bienvenida").length
  let i = 0
  while (i < steps.length) {
    const s = steps[i]!
    const n = steps.slice(0, i + 1).filter((x) => x !== "bienvenida").length
    const out = s === "bienvenida" ? await welcome(api) : s === "proveedor" ? await providerStep(api, n, of, r) : s === "clave" ? await keyStep(api, n, of, r) : s === "modelo" ? await modelStep(api, n, of, r) : s === "agy" ? await agyStep(api, n, of, r) : await sessionStep(api, n, of, r)
    if (out === "salir") {
      api.ui.dialog.clear()
      api.ui.toast({ message: "Configuración a medias: te la vuelvo a enseñar la próxima vez (o escribe /configurar)." })
      return
    }
    i = out === "atras" ? Math.max(0, i - 1) : i + 1
  }
  await summary(api, r)
}

async function welcome(api: Api) {
  const v = await ask(api, {
    title: "Bienvenido a anti",
    intro: () => (
      <Lines api={api} lines={[
        "Aquí hablas con un modelo, el «traductor», que pasa lo que pides a Gemini a través de agy (la herramienta oficial de Google Antigravity para la terminal). Gemini hace el trabajo con tu plan de Google; el traductor puede ser un modelo gratuito.",
        "",
        ["Vamos a dejar listas 4 cosas (unos 3 minutos):", "accent"],
        "  1. De dónde sale el traductor (OpenRouter, OpenCode Zen u otro proveedor) y su clave, si la pide.",
        "  2. Qué modelo hace de traductor.",
        "  3. Dónde está agy en tu ordenador (lo busco yo).",
        "  4. Que agy tenga tu sesión de Google.",
        "",
        ["Tu clave la guarda anti en tu ordenador. anti nunca lee tus credenciales de Google: de eso se encarga agy.", "muted"],
      ]} />
    ),
    options: [
      { title: "Empezar", value: "ok" },
      { title: "Ahora no", value: "no", description: "te lo vuelvo a preguntar la próxima vez" },
    ],
  })
  return v === "ok" ? "seguir" : "salir"
}

async function providerStep(api: Api, n: number, of: number, r: Result): Promise<"seguir" | "atras" | "salir"> {
  const current = providerOfRun(r).id
  const picked = await ask(api, {
    title: step(n, of, "proveedor del traductor"),
    current: current === "openrouter" || current === ZEN ? current : "otro",
    intro: () => (
      <Lines api={api} lines={[
        "El traductor solo pasa mensajes, así que basta con un modelo pequeño. Puede venir de cualquier proveedor que soporte OpenCode.",
        "",
        ["OpenRouter: muchos modelos gratis con una clave gratuita. Es lo que más se ha probado con anti.", "muted"],
        ["OpenCode Zen: con una clave de Zen con saldo (su capa gratuita solo funciona desde OpenCode).", "muted"],
        ["Otro proveedor: Anthropic, OpenAI, Google, DeepSeek, Groq… con tu clave de API (y su precio).", "muted"],
      ]} />
    ),
    options: [
      { title: "OpenRouter", value: "openrouter", description: "recomendado · modelos gratis" },
      { title: "OpenCode Zen", value: ZEN, description: "con tu clave de Zen" },
      { title: "Otro proveedor", value: "otro", description: "con tu clave de API" },
      { title: "Atrás", value: BACK },
    ],
  })
  if (picked === undefined) return "salir"
  if (picked === BACK) return "atras"
  if (picked === "openrouter") { r.provider = OPENROUTER; return "seguir" }
  if (picked === ZEN) { r.provider = ZEN_CHOICE; return "seguir" }
  busy(api, step(n, of, "proveedor del traductor"), "Pidiendo a OpenCode la lista de proveedores…")
  const list = otherProviders((await api.client.provider.list()).data?.all)
  const other = await ask(api, {
    title: step(n, of, "proveedor del traductor"),
    filter: true,
    current: current,
    intro: () => <Lines api={api} lines={[["Escribe para filtrar. Los que necesitan algo más que una clave (Bedrock, Vertex, Azure) se configuran con sus variables de entorno.", "muted"]]} />,
    options: [...list.map((p) => ({ title: p.name, value: p.id, description: p.env.join(", ") })), { title: "Atrás", value: BACK }],
  })
  if (other === undefined) return "salir"
  if (other === BACK) return providerStep(api, n, of, r)
  r.provider = list.find((p) => p.id === other)!
  return "seguir"
}

async function keyStep(api: Api, n: number, of: number, r: Result): Promise<"seguir" | "atras" | "salir"> {
  const provider = providerOfRun(r)
  if (provider.id === ZEN) return zenKeyStep(api, n, of, r)
  if (provider.id !== "openrouter") return apiKeyStep(api, n, of, r, provider)
  for (;;) {
    const source = keySource()
    const current = source?.key
    const howTo = [
      "OpenRouter da acceso a muchos modelos de IA con una sola clave, y algunos son gratis: el traductor usa uno de esos.",
      "",
      ["Cómo sacar la clave:", "accent"],
      "  1. Entra en openrouter.ai y crea una cuenta (vale con Google o GitHub).",
      `  2. Ve a ${KEYS_URL} y pulsa «Create API key». Ponle un nombre (por ejemplo, anti); el límite de crédito puede quedar vacío: los modelos gratis no gastan.`,
      "  3. Copia la clave (empieza por sk-or-v1-; solo se enseña una vez) y pégala aquí.",
    ] as const
    const choice = await ask(api, {
      title: step(n, of, "clave de OpenRouter"),
      intro: () => <Lines api={api} lines={[...howTo, ...(source ? ["", [`Ya hay una clave, ${source.from}: ${masked(source.key)}`, "ok"] as [string, "ok"]] : [])]} />,
      options: [
        ...(current ? [{ title: "Usar esa clave", value: "guardada", description: masked(current) }] : []),
        { title: current ? "Pegar otra clave" : "Ya la tengo: pegarla", value: "pegar" },
        { title: "Abrir la página de claves en el navegador", value: "abrir", description: KEYS_URL },
        { title: "Atrás", value: BACK },
      ],
    })
    if (choice === undefined) return "salir"
    if (choice === BACK) return "atras"
    if (choice === "abrir") { openUrl(KEYS_URL); continue }
    const key = choice === "guardada" ? current! : await pasteKey(api, n, of)
    if (!key) continue
    busy(api, step(n, of, "clave de OpenRouter"), "Comprobando la clave con OpenRouter…")
    const check = await checkKey(key, fetch)
    if (!check.ok) {
      const env = choice === "guardada" && source?.from.startsWith("de la variable")
      await ask(api, {
        title: step(n, of, "clave de OpenRouter"),
        intro: () => <Lines api={api} lines={[[check.error, "error"], ...(env ? [["Esa clave viene de OPENROUTER_API_KEY (tu ~/.zshrc o similar). Pega una buena: la que guardes aquí tiene prioridad.", "muted"] as [string, "muted"]] : [])]} />,
        options: [{ title: "Volver", value: "otra" }],
      })
      continue
    }
    if (choice !== "guardada") {
      await api.client.auth.set({ providerID: "openrouter", auth: { type: "api", key } })
      await api.client.instance.dispose()
    }
    r.key = key
    r.keyInfo = `${check.freeTier ? "cuenta gratuita" : "cuenta con créditos"}${check.daily ? ` · hoy te quedan ${check.daily.remaining} de ${check.daily.limit} peticiones a modelos gratis` : ""}`
    return "seguir"
  }
}

// Zen, con una clave de Zen: su capa gratuita (sin clave) solo se acepta desde OpenCode y rechaza a anti.
async function zenKeyStep(api: Api, n: number, of: number, r: Result): Promise<"seguir" | "atras" | "salir"> {
  for (;;) {
    const source = keySource(ZEN, ZEN_CHOICE.env)
    const choice = await ask(api, {
      title: step(n, of, "clave de OpenCode Zen"),
      intro: () => (
        <Lines api={api} lines={[
          "Zen pide una clave con saldo: se saca en opencode.ai/zen. Sus modelos gratuitos solo funcionan desde OpenCode, no desde anti.",
          ["Cada mensaje se cobra según el precio del modelo que elijas.", "muted"],
          ...(source ? ["", [`Ya hay una clave, ${source.from}: ${masked(source.key)}`, "ok"] as [string, "ok"]] : []),
        ]} />
      ),
      options: [
        ...(source ? [{ title: "Usar esa clave", value: "seguir", description: masked(source.key) }] : []),
        { title: source ? "Pegar otra clave" : "Pegar la clave de Zen", value: "pegar" },
        { title: "Abrir Zen en el navegador", value: "abrir", description: ZEN_URL },
        { title: "Atrás", value: BACK },
      ],
    })
    if (choice === undefined) return "salir"
    if (choice === BACK) return "atras"
    if (choice === "abrir") { openUrl(ZEN_URL); continue }
    if (choice === "pegar") {
      const key = await pasteKey(api, n, of, "clave de Zen")
      if (!key) continue
      await api.client.auth.set({ providerID: ZEN, auth: { type: "api", key } })
      await api.client.instance.dispose()
      r.key = key
    } else r.key = source!.key
    r.keyInfo = "clave guardada"
    return "seguir"
  }
}

// Cualquier otro proveedor de OpenCode: su clave de API. No hay una forma común de comprobarla sin gastar, así que se guarda tal cual;
// si no vale, el traductor lo dirá en el primer mensaje.
async function apiKeyStep(api: Api, n: number, of: number, r: Result, provider: ProviderChoice): Promise<"seguir" | "atras" | "salir"> {
  for (;;) {
    const source = keySource(provider.id, provider.env)
    const choice = await ask(api, {
      title: step(n, of, `clave de ${provider.name}`),
      intro: () => (
        <Lines api={api} lines={[
          `Pega la clave de API de ${provider.name}. Se guarda en anti, en tu ordenador. También vale tenerla en la variable ${provider.env.join(" o ")} de tu terminal.`,
          ["Ten en cuenta que este proveedor cobra cada mensaje según su precio, salvo que el modelo sea gratuito.", "muted"],
          ...(source ? ["", [`Ya hay una clave, ${source.from}: ${masked(source.key)}`, "ok"] as [string, "ok"]] : []),
        ]} />
      ),
      options: [
        ...(source ? [{ title: "Usar esa clave", value: "guardada", description: masked(source.key) }] : []),
        { title: source ? "Pegar otra clave" : "Pegar la clave", value: "pegar" },
        { title: "Atrás", value: BACK },
      ],
    })
    if (choice === undefined) return "salir"
    if (choice === BACK) return "atras"
    const key = choice === "guardada" ? source!.key : await pasteKey(api, n, of, `clave de ${provider.name}`, "")
    if (!key) continue
    if (choice !== "guardada") {
      await api.client.auth.set({ providerID: provider.id, auth: { type: "api", key } })
      await api.client.instance.dispose()
    }
    r.key = key
    r.keyInfo = "guardada"
    return "seguir"
  }
}

function pasteKey(api: Api, n: number, of: number, what = "pega tu clave", placeholder = "sk-or-v1-…") {
  return new Promise<string | undefined>((resolve) => {
    let settled = false
    const done = (v: string | undefined) => { if (!settled) { settled = true; resolve(v) } }
    api.ui.dialog.replace(
      () => (
        <api.ui.DialogPrompt
          title={step(n, of, what)}
          placeholder={placeholder}
          description={() => <Lines api={api} lines={[["Pega con cmd+v y pulsa enter. Se guarda en anti, en tu ordenador.", "muted"]]} />}
          onConfirm={(v) => done(v.trim() || undefined)}
          onCancel={() => done(undefined)}
        />
      ),
      () => done(undefined),
    )
  })
}

// Zen y los demás proveedores: los modelos con herramientas de la lista de OpenCode.
async function providerModelStep(api: Api, n: number, of: number, r: Result, provider: ProviderChoice): Promise<"seguir" | "atras" | "salir"> {
  busy(api, step(n, of, "modelo traductor"), `Pidiendo a OpenCode los modelos de ${provider.name}…`)
  const all = (await api.client.provider.list()).data?.all ?? []
  const models = toolModels(all.find((p) => p.id === provider.id), readTraductor(env()))
  const picked = await ask(api, {
    title: step(n, of, "modelo traductor"),
    filter: true,
    current: readTraductor(env()) ?? undefined,
    intro: () => (
      <Lines api={api} lines={models.length ? [
        "El traductor lee lo que escribes, se lo pasa a Gemini y te resume lo que hizo. No programa: con uno pequeño y rápido basta.",
        ["Solo salen los modelos que saben usar herramientas, porque las necesita para llamar a Gemini. Escribe para filtrar.", "muted"],
      ] : [[`${provider.name} no tiene modelos con herramientas disponibles. Vuelve atrás y elige otro proveedor.`, "warn"]]} />
    ),
    options: [
      ...models.map((m) => ({
        title: m.name,
        value: m.id,
        category: m.free ? "Gratis" : "De pago",
        description: `${m.context ? `${Math.round(m.context / 1000)}k de contexto` : m.id}${m.current ? " · el actual" : ""}`,
      })),
      { title: "Atrás", value: BACK, category: "" },
    ],
  })
  if (picked === undefined) return "salir"
  if (picked === BACK) return "atras"
  writeTraductor(env(), picked)
  await api.client.instance.dispose()
  r.model = models.find((m) => m.id === picked)?.name ?? picked
  return "seguir"
}

async function modelStep(api: Api, n: number, of: number, r: Result): Promise<"seguir" | "atras" | "salir"> {
  const provider = providerOfRun(r)
  if (provider.id !== "openrouter") return providerModelStep(api, n, of, r, provider)
  for (;;) {
    busy(api, step(n, of, "modelo traductor"), "Pidiendo a OpenRouter la lista de modelos gratis…")
    let models: ReturnType<typeof freeToolModels> = []
    try {
      models = freeToolModels(await (await fetch("https://openrouter.ai/api/v1/models")).json(), readTraductor(env()))
    } catch (error) {
      const again = await ask(api, {
        title: step(n, of, "modelo traductor"),
        intro: () => <Lines api={api} lines={[[`No pude descargar la lista de modelos (${(error as Error).message}).`, "error"]]} />,
        options: [{ title: "Probar otra vez", value: "otra" }, { title: `Usar el recomendado sin comprobar (${RECOMMENDED.split("/").at(-1)})`, value: "recomendado" }, { title: "Atrás", value: BACK }],
      })
      if (again === undefined) return "salir"
      if (again === BACK) return "atras"
      if (again === "recomendado") { writeTraductor(env(), RECOMMENDED); r.model = RECOMMENDED; return "seguir" }
      continue
    }
    const picked = await ask(api, {
      title: step(n, of, "modelo traductor"),
      filter: true,
      current: readTraductor(env()) ?? RECOMMENDED,
      intro: () => (
        <Lines api={api} lines={[
          "El traductor lee lo que escribes, se lo pasa a Gemini y te resume lo que hizo. No programa: con uno pequeño y rápido basta.",
          ["Solo salen los modelos gratis que saben usar herramientas, porque las necesita para llamar a Gemini. ★ = probado con anti.", "muted"],
          ["Los modelos gratis cambian: si uno deja de ir, vuelve aquí con /configurar. Escribe para filtrar.", "muted"],
        ]} />
      ),
      options: [
        ...models.map((m) => ({
          title: `${m.recommended ? "★ " : ""}${m.name}`,
          value: m.id,
          category: m.recommended || m.current ? "Recomendado" : "Gratis con herramientas",
          description: `${Math.round(m.context / 1000)}k de contexto${m.current ? " · el actual" : ""}${m.expires ? ` · deja de estar el ${m.expires}` : ""}`,
          // La primera frase, recortada por el final: el selector corta por el medio los detalles de más de 76 caracteres.
          details: m.description ? [((d) => (d.length > 72 ? `${d.slice(0, 71).trimEnd()}…` : d))(m.description.split(/(?<=\.)\s/)[0]!)] : undefined,
        })),
        { title: "Atrás", value: BACK, category: "" },
      ],
    })
    if (picked === undefined) return "salir"
    if (picked === BACK) return "atras"
    const name = models.find((m) => m.id === picked)?.name ?? picked
    if (r.key || savedKey()) {
      busy(api, step(n, of, "modelo traductor"), `Probando ${name} con una pregunta corta…`)
      const t = await testModel(r.key ?? savedKey()!, picked, fetch)
      if (!t.ok) {
        const next = await ask(api, {
          title: step(n, of, "modelo traductor"),
          intro: () => <Lines api={api} lines={[[`${name}: ${t.error}`, "error"]]} />,
          options: [{ title: "Elegir otro", value: "otro" }, { title: "Usarlo igualmente", value: "usar", description: "a veces es un mal momento puntual" }],
        })
        if (next !== "usar") continue
      }
    }
    writeTraductor(env(), picked)
    await api.client.instance.dispose()
    r.model = name
    return "seguir"
  }
}

async function agyStep(api: Api, n: number, of: number, r: Result): Promise<"seguir" | "atras" | "salir"> {
  for (;;) {
    busy(api, step(n, of, "agy"), "Buscando agy en tu ordenador…")
    const found = (await Promise.all(agyCandidates(env(), exists).map((p) => probeAgy(p, run)))).filter((p) => p.ok) as { path: string; version: string }[]
    const what = "agy es la herramienta oficial de Google Antigravity para la terminal. anti la lanza para que Gemini haga el trabajo, con tu sesión y sin tocar nada de ella."
    const picked = await ask(api, {
      title: step(n, of, "agy"),
      intro: () => (
        <Lines api={api} lines={found.length ? [what, "", [found.length === 1 ? "Lo he encontrado:" : `He encontrado ${found.length}; elige cuál usar:`, "ok"]] : [
          what, "", ["No lo encuentro en tu ordenador.", "warn"],
          `Se instala con la orden oficial (lo deja en ${process.platform === "win32" ? "%LOCALAPPDATA%\\agy\\bin" : "~/.local/bin"}):`,
          [`  ${agyInstall()}`, "accent"],
          ["«Instalar agy ahora» abre una terminal con esa orden escrita para que la veas; cuando acabe, pulsa «Buscar de nuevo».", "muted"],
        ]} />
      ),
      options: [
        ...found.map((f) => ({ title: home(f.path), value: f.path, description: `agy ${f.version}${f.path === savedAgy(env()) ? " · el elegido" : ""}` })),
        ...(found.length ? [] : [{ title: "Instalar agy ahora", value: "instalar", description: "abre una terminal con la orden" }]),
        { title: "Lo tengo en otra carpeta: escribir la ruta", value: "ruta" },
        { title: "Buscar de nuevo", value: "buscar" },
        { title: "Abrir la guía de instalación", value: "guia", description: "antigravity.google/docs/cli/install" },
        { title: "Atrás", value: BACK },
      ],
    })
    if (picked === undefined) return "salir"
    if (picked === BACK) return "atras"
    if (picked === "buscar") continue
    if (picked === "instalar") {
      if (!(await openTerminal(agyInstall()))) await noTerminal(api, step(n, of, "agy"), agyInstall())
      continue
    }
    if (picked === "guia") { openUrl("https://antigravity.google/docs/cli/install/"); continue }
    const bin = picked === "ruta" ? await typePath(api, n, of) : picked
    if (!bin) continue
    const probe = found.find((f) => f.path === bin) ?? await probeAgy(bin, run)
    if (!("version" in probe) || !probe.version) {
      await ask(api, { title: step(n, of, "agy"), intro: () => <Lines api={api} lines={[[`${home(bin)} no responde como agy: ${(probe as { error?: string }).error ?? ""}`, "error"]]} />, options: [{ title: "Volver", value: "v" }] })
      continue
    }
    writeAgy(env(), bin)
    r.agy = { path: bin, version: probe.version }
    return "seguir"
  }
}

function typePath(api: Api, n: number, of: number) {
  return new Promise<string | undefined>((resolve) => {
    let settled = false
    const done = (v: string | undefined) => { if (!settled) { settled = true; resolve(v) } }
    api.ui.dialog.replace(
      () => (
        <api.ui.DialogPrompt
          title={step(n, of, "ruta de agy")}
          placeholder={process.platform === "win32" ? "C:\\Users\\tu\\AppData\\Local\\agy\\bin\\agy.exe" : "/home/tu/.local/bin/agy"}
          description={() => <Lines api={api} lines={[[`La ruta completa al programa agy. Si no la sabes, en una terminal: ${process.platform === "win32" ? "where agy" : "which agy"}`, "muted"]]} />}
          onConfirm={(v) => done(v.trim() ? path.resolve(v.trim().replace(/^~(?=\/)/, os.homedir())) : undefined)}
          onCancel={() => done(undefined)}
        />
      ),
      () => done(undefined),
    )
  })
}

async function sessionStep(api: Api, n: number, of: number, r: Result): Promise<"seguir" | "atras" | "salir"> {
  const bin = r.agy?.path ?? savedAgy(env()) ?? "agy"
  for (;;) {
    busy(api, step(n, of, "sesión de agy"), "Comprobando que agy tiene tu sesión de Google (pido la lista de modelos; no gasta cuota)…")
    const s = await agySession(bin, run)
    if (s.ok) {
      r.session = { ok: true, text: `sesión iniciada · ${s.models} modelos disponibles` }
      return "seguir"
    }
    const v = await ask(api, {
      title: step(n, of, "sesión de agy"),
      intro: () => (
        <Lines api={api} lines={s.slow ? [
          [`No he podido comprobarlo: ${s.error}.`, "warn"],
          "Prueba otra vez. Si se repite, abre agy en una terminal para ver si te pide entrar con tu cuenta de Google.",
        ] : [
          ["agy no tiene tu sesión de Google iniciada.", "warn"],
          [`(agy dice: ${s.error})`, "muted"],
          "",
          "Hay que abrir agy una vez en una terminal: te pedirá entrar con tu cuenta de Google en el navegador (la de tu plan de Google AI).",
          "Cuando veas agy listo para escribir, ciérralo con ctrl+c y vuelve aquí.",
        ]} />
      ),
      options: [
        ...(s.slow ? [{ title: "Comprobar de nuevo", value: "comprobar" }] : []),
        { title: "Abrir agy en una terminal", value: "abrir" },
        ...(s.slow ? [] : [{ title: "Ya está: comprobar de nuevo", value: "comprobar" }]),
        { title: "Saltar por ahora", value: "saltar", description: "anti no podrá trabajar hasta que lo hagas" },
        { title: "Atrás", value: BACK },
      ],
    })
    if (v === undefined) return "salir"
    if (v === BACK) return "atras"
    if (v === "abrir") {
      const cmd = process.platform === "win32" ? `& '${bin.replace(/'/g, "''")}'` : `'${bin.replace(/'/g, "'\\''")}'`
      if (!(await openTerminal(cmd))) await noTerminal(api, step(n, of, "sesión de agy"), cmd)
      continue
    }
    if (v === "saltar") { r.session = { ok: false, text: "sin sesión (abre agy y entra con tu cuenta de Google)" }; return "seguir" }
  }
}

async function summary(api: Api, r: Result) {
  const provider = providerOfRun(r)
  const hasKey = !!r.key || hasCredentials({ provider: provider.id, auth: readAuth(), env: env(), envNames: provider.env })
  const ok = hasKey && (r.agy || savedAgy(env())) && r.session?.ok !== false
  const line = (good: boolean, label: string, text: string): [string, "ok" | "error"] => [`${good ? "✓" : "✗"} ${label}: ${text}`, good ? "ok" : "error"]
  const lines = [
    line(hasKey, provider.name, r.keyInfo ?? (hasKey ? "clave guardada" : "falta la clave")),
    line(true, "Traductor", r.model ?? (readTraductor(env()) ?? RECOMMENDED).split("/").slice(1).join("/")),
    line(!!(r.agy || savedAgy(env())), "agy", r.agy ? `${home(r.agy.path)} (${r.agy.version})` : savedAgy(env()) ? home(savedAgy(env())!) : "falta"),
    ...(r.session ? [line(r.session.ok, "Sesión de agy", r.session.text)] : []),
  ]
  if (ok) writeState(env(), { done: true, at: new Date().toISOString(), envNames: provider.env })
  const v = await ask(api, {
    title: ok ? "anti está listo" : "Casi: falta algo",
    intro: () => (
      <Lines api={api} lines={[...lines, "", ok
        ? ["Escribe lo que quieras hacer y Gemini se pone a ello. /agy cambia el modelo de Gemini, /orquestar reparte el trabajo en pasos y /configurar vuelve a este asistente.", "muted"]
        : ["Lo que falta sale en rojo. Puedes usar anti, pero no funcionará del todo hasta arreglarlo; te lo vuelvo a enseñar la próxima vez.", "warn"]]} />
    ),
    options: [{ title: ok ? "Empezar" : "Entendido", value: "fin" }, { title: "Repetir la configuración", value: "otra" }],
  })
  api.ui.dialog.clear()
  if (v === "otra") return runOnboarding(api, ["proveedor", "clave", "modelo", "agy", "sesion"])
}

// Sin terminal que abrir (Linux sin entorno gráfico, por ejemplo): la orden, para copiarla.
async function noTerminal(api: Api, title: string, command: string) {
  await ask(api, {
    title,
    intro: () => <Lines api={api} lines={[["No he podido abrir una terminal. Abre una tú y escribe:", "warn"], [`  ${command}`, "accent"]]} />,
    options: [{ title: "Hecho", value: "ok" }],
  })
}
