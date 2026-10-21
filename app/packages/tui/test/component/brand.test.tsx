/** @jsxImportSource @opentui/solid */
import { afterEach, describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { createSignal, Show, type JSX } from "solid-js"
import type { Put, Scene } from "../../src/brand"
import { Art } from "../../src/component/brand/art"
import { BusyTrack, Rail, Rings } from "../../src/component/brand/marks"
import { RGBA } from "@opentui/core"
import { Logo } from "../../src/component/logo"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { InlineToolRow } from "../../src/routes/session"
import { tmpdir } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

let setup: Awaited<ReturnType<typeof testRender>> | undefined
let tmp: Awaited<ReturnType<typeof tmpdir>> | undefined

afterEach(async () => {
  setup?.renderer.destroy()
  setup = undefined
  await tmp?.[Symbol.asyncDispose]()
  tmp = undefined
})

async function mount(
  node: () => JSX.Element,
  options: { kv?: Record<string, unknown>; width?: number; height?: number } = {},
) {
  tmp = await tmpdir()
  const dir = tmp.path
  const state = path.join(dir, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), JSON.stringify(options.kv ?? {}))
  setup = await testRender(
    () => (
      <TestTuiContexts directory={dir} paths={{ home: dir, state, worktree: dir }}>
        <TuiConfigProvider config={createTuiResolvedConfig({})}>
          <KVProvider>
            <ThemeProvider mode="dark">{node()}</ThemeProvider>
          </KVProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    { width: options.width ?? 80, height: options.height ?? 12 },
  )
  // KV loads asynchronously; give it a moment before the first frame that matters.
  await Bun.sleep(50)
  await setup.renderOnce()
  return setup
}

/** A scene that counts how often the renderable advances it. */
class Probe implements Scene {
  advances = 0
  advance() {
    this.advances++
    return true
  }
  draw(_width: number, _height: number, put: Put) {
    put(0, 0, "x", 1)
  }
}

describe("Art", () => {
  test("advances its scene while visible, stops when hidden, and releases the clock when destroyed", async () => {
    const probe = new Probe()
    const [visible, setVisible] = createSignal(true)
    const [mounted, setMounted] = createSignal(true)
    await mount(() => (
      <Show when={mounted()}>
        <Art scene={probe} width={1} height={1} visible={visible()} />
      </Show>
    ))
    await Bun.sleep(150)
    expect(probe.advances).toBeGreaterThan(0)

    setVisible(false)
    await Bun.sleep(40)
    const hidden = probe.advances
    await Bun.sleep(150)
    expect(probe.advances).toBe(hidden)

    setVisible(true)
    await Bun.sleep(150)
    expect(probe.advances).toBeGreaterThan(hidden)

    setMounted(false)
    await Bun.sleep(40)
    const destroyed = probe.advances
    await Bun.sleep(150)
    expect(probe.advances).toBe(destroyed)
  })

  test("stays still when animations are turned off", async () => {
    const probe = new Probe()
    await mount(() => <Art scene={probe} width={1} height={1} />, { kv: { animations_enabled: false } })
    await Bun.sleep(150)
    expect(probe.advances).toBe(0)
    expect(setup!.captureCharFrame()).toContain("x")
  })
})

describe("Rings", () => {
  test("la marca de anti: «❯» y el cursor, quieto o levitando", async () => {
    await mount(() => (
      <box>
        <Rings still />
        <Rings />
      </box>
    ))
    const [still, moving] = setup!.captureCharFrame().split("\n")
    expect(still!.trim()).toBe("❯ ▄")
    expect(moving!.trim()).toMatch(/^❯ [▀▄]$/)
  })
})

describe("BusyTrack", () => {
  test("una fila de medios bloques, ocho de ancho por defecto", async () => {
    await mount(() => (
      <box>
        <BusyTrack />
        <BusyTrack columns={5} />
      </box>
    ))
    const [wide, narrow] = setup!.captureCharFrame().split("\n")
    expect(wide!.trim()).toMatch(/^[▀▄█]{8}$/)
    expect(narrow!.trim()).toMatch(/^[▀▄█]{5}$/)
  })
})

describe("Rail", () => {
  const color = RGBA.fromHex("#5C85F2")
  const rail = (busy: boolean, cap?: boolean) => (
    <box flexDirection="row" height={5}>
      <Rail color={color} busy={busy} cap={cap} />
      <text>prompt</text>
    </box>
  )
  const column = () =>
    setup!
      .captureCharFrame()
      .split("\n")
      .slice(0, 5)
      .map((line) => line[0])
      .join("")
  const inks = () =>
    setup!
      .captureSpans()
      .lines.slice(0, 5)
      .map((line) => line.spans[0]!.fg.toInts().slice(0, 3).join(","))

  test("idle: takes the height of its row and ends in a half stroke, all in the given color", async () => {
    await mount(() => rail(false))
    expect(column()).toBe("┃┃┃┃╹")
    expect(new Set(inks())).toEqual(new Set(["92,133,242"]))
  })

  test("without a cap the last row is left empty", async () => {
    await mount(() => rail(false, false))
    expect(column()).toBe("┃┃┃┃ ")
  })

  test("trabajando: el raíl se apaga y por él suben gotas lila con su estela", async () => {
    await mount(() => (
      <box flexDirection="row" height={9}>
        <Rail color={color} busy={true} />
        <text>prompt</text>
      </box>
    ))
    const colors = setup!
      .captureSpans()
      .lines.slice(0, 9)
      .map((line) => line.spans[0]!.fg.toInts().slice(0, 3).join(","))
    expect(colors).not.toContain("92,133,242")
    expect(colors).toContain("185,164,245")
  })
})

describe("InlineToolRow", () => {
  const row = (props: { running?: boolean; since?: number; failed?: boolean }) => (
    <InlineToolRow
      icon="⚙"
      complete={true}
      pending=""
      failed={props.failed}
      running={props.running}
      since={props.since}
    >
      antigravity [step=next]
    </InlineToolRow>
  )

  test("a working tool is trailed by the anti mark and, once it drags on, its running time", async () => {
    await mount(() => row({ running: true, since: Date.now() - 65_000 }))
    const line = setup!.captureCharFrame().split("\n")[0]!
    expect(line).toMatch(/⚙ antigravity \[step=next\] ❯ [▀▄] 1m 5s/)
  })

  test("a tool that just started shows the mark but not yet a time", async () => {
    await mount(() => row({ running: true, since: Date.now() }))
    const line = setup!.captureCharFrame().split("\n")[0]!
    expect(line).toMatch(/\] ❯ [▀▄]\s*$/)
  })

  test("finished and failed tools carry no activity mark", async () => {
    await mount(() => (
      <box>
        {row({})}
        {row({ running: true, failed: true, since: Date.now() - 65_000 })}
      </box>
    ))
    expect(setup!.captureCharFrame()).not.toMatch(/❯|\d+s/)
  })
})

describe("Logo", () => {
  test("el hero «Puente» entero cuando la terminal tiene sitio: 42×8", async () => {
    await mount(() => <Logo />, { width: 100, height: 40 })
    const rows = setup!
      .captureCharFrame()
      .split("\n")
      .filter((line) => line.trim())
    expect(rows.length).toBeGreaterThan(3)
    expect(rows.length).toBeLessThanOrEqual(8)
  })

  test("solo la palabra en una terminal pequeña: 5 filas, 26 columnas", async () => {
    await mount(() => <Logo />, { width: 40, height: 20 })
    const rows = setup!
      .captureCharFrame()
      .split("\n")
      .filter((line) => line.trim())
    expect(rows).toHaveLength(5)
    expect(Math.max(...rows.map((line) => line.trimEnd().length))).toBe(26)
  })
})
