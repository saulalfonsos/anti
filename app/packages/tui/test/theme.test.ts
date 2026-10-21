import { expect, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import type { RGBA, TerminalColors } from "@opentui/core"
import { DEFAULT_THEME, DEFAULT_THEMES, addTheme, allThemes, hasTheme, resolveTheme, terminalMode } from "../src/theme"
import { luminance } from "../src/brand"
import { discoverThemes } from "../src/context/theme"
import { tmpdir } from "./fixture/fixture"

test("addTheme writes into module theme store", () => {
  const name = `plugin-theme-${Date.now()}`
  expect(addTheme(name, DEFAULT_THEMES.opencode)).toBe(true)
  expect(allThemes()[name]).toBeDefined()
})

test("addTheme keeps first theme for duplicate names", () => {
  const name = `plugin-theme-keep-${Date.now()}`
  const one = structuredClone(DEFAULT_THEMES.opencode)
  const two = structuredClone(DEFAULT_THEMES.opencode)
  one.theme.primary = "#101010"
  two.theme.primary = "#fefefe"

  expect(addTheme(name, one)).toBe(true)
  expect(addTheme(name, two)).toBe(false)
  expect(allThemes()[name]!.theme.primary).toBe("#101010")
})

test("addTheme ignores entries without a theme object", () => {
  const name = `plugin-theme-invalid-${Date.now()}`
  expect(addTheme(name, { defs: { a: "#ffffff" } })).toBe(false)
  expect(allThemes()[name]).toBeUndefined()
})

test("hasTheme checks theme presence", () => {
  const name = `plugin-theme-has-${Date.now()}`
  expect(hasTheme(name)).toBe(false)
  expect(addTheme(name, DEFAULT_THEMES.opencode)).toBe(true)
  expect(hasTheme(name)).toBe(true)
})

test("resolveTheme rejects circular color refs", () => {
  const item = structuredClone(DEFAULT_THEMES.opencode)
  item.defs = { ...item.defs, one: "two", two: "one" }
  item.theme.primary = "one"
  expect(() => resolveTheme(item, "dark")).toThrow("Circular color reference")
})

function terminalColors(defaultBackground: string | null, palette: Array<string | null> = []): TerminalColors {
  return {
    palette,
    defaultForeground: null,
    defaultBackground,
    cursorColor: null,
    mouseForeground: null,
    mouseBackground: null,
    tekForeground: null,
    tekBackground: null,
    highlightBackground: null,
    highlightForeground: null,
  }
}

test("terminalMode derives mode from refreshed background", () => {
  expect(terminalMode(terminalColors("#fbf1c7"))).toBe("light")
  expect(terminalMode(terminalColors("#1a1b26"))).toBe("dark")
})

test("terminalMode does not derive mode from ANSI slot zero", () => {
  expect(terminalMode(terminalColors(null, ["#000000"]))).toBeUndefined()
})

test("custom theme precedence follows directory order", async () => {
  await using tmp = await tmpdir()
  const global = path.join(tmp.path, "global")
  const project = path.join(tmp.path, "project")
  await mkdir(path.join(global, "themes"), { recursive: true })
  await mkdir(path.join(project, "themes"), { recursive: true })
  await writeFile(path.join(global, "themes", "custom.json"), JSON.stringify({ source: "global" }))
  await writeFile(path.join(project, "themes", "custom.json"), JSON.stringify({ source: "project" }))

  await expect(discoverThemes([global, project])).resolves.toEqual({ custom: { source: "project" } })
})

test("anti is the default theme and resolves in both modes", () => {
  expect(DEFAULT_THEME).toBe("anti")
  expect(hasTheme(DEFAULT_THEME)).toBe(true)
  for (const mode of ["dark", "light"] as const) {
    expect(resolveTheme(DEFAULT_THEMES[DEFAULT_THEME]!, mode).background.a).toBe(1)
  }
})

test("brand colors fall back to primary and secondary when a theme leaves them out", () => {
  const theme = resolveTheme(DEFAULT_THEMES.opencode!, "dark")
  expect(theme.brandPrimary).toEqual(theme.primary)
  expect(theme.brandSecondary).toEqual(theme.secondary)
})

test("anti brand colors are the design's: lila mark, and the wordmark in the text color of each mode", () => {
  for (const mode of ["dark", "light"] as const) {
    const theme = resolveTheme(DEFAULT_THEMES.anti!, mode)
    expect(theme.brandPrimary.toInts()).toEqual([0xb9, 0xa4, 0xf5, 255])
  }
  expect(resolveTheme(DEFAULT_THEMES.anti!, "dark").brandSecondary.toInts()).toEqual([0xec, 0xea, 0xf4, 255])
  expect(resolveTheme(DEFAULT_THEMES.anti!, "light").brandSecondary.toInts()).toEqual([0x17, 0x16, 0x1c, 255])
})

test("anti text colors keep readable contrast on the background in both modes", () => {
  const contrast = (a: RGBA, b: RGBA) => {
    const [la, lb] = [a, b].map((color) => luminance(color.toInts().slice(0, 3) as [number, number, number]))
    return (Math.max(la!, lb!) + 0.05) / (Math.min(la!, lb!) + 0.05)
  }
  const text = [
    "text",
    "textMuted",
    "primary",
    "secondary",
    "accent",
    "error",
    "warning",
    "success",
    "info",
    "markdownLink",
    "diffAdded",
    "diffRemoved",
  ] as const
  for (const mode of ["dark", "light"] as const) {
    const theme = resolveTheme(DEFAULT_THEMES.anti!, mode)
    for (const key of text)
      expect([mode, key, contrast(theme[key], theme.background) >= 4.5]).toEqual([mode, key, true])
    // Comments are meant to recede, but must stay legible.
    expect(contrast(theme.syntaxComment, theme.background)).toBeGreaterThanOrEqual(3)
  }
})
