import { describe, expect, test } from "bun:test"
import { hexToRgb, Ink, stillLink, stillWord, terminalPalette, wordmark } from "../../src/brand"
import { antiBase } from "../../src/brand/colors"

describe("wordmark", () => {
  test("el logo «>_anti» quieto: 42 columnas y 8 filas", () => {
    const lines = wordmark()
    expect(lines).toHaveLength(8)
    expect(Math.max(...lines.map((line) => line.length))).toBe(42)
  })

  test("lleva el texto (letras y cursor) y el único acento lila", () => {
    const inks = new Set(stillWord().pixels)
    expect(inks.has(Ink.Word)).toBe(true)
    expect(inks.has(Ink.Primary)).toBe(true)
  })

  test("terminalPalette lee los colores de marca del tema de anti", () => {
    expect(antiBase("dark").primary).toEqual(hexToRgb("#B9A4F5"))
    expect(antiBase("dark").text).toEqual(hexToRgb("#ECEAF4"))
    expect(Object.keys(terminalPalette()).length).toBeGreaterThan(0)
  })
})

describe("stillLink", () => {
  test("«>_» en miniatura: tres filas, el símbolo en lila y el cursor en texto con su sombra", () => {
    const mark = stillLink()
    expect(mark.rows).toBe(3)
    const inks = new Set(mark.pixels)
    expect(inks.has(Ink.Primary)).toBe(true)
    expect(inks.has(Ink.Word)).toBe(true)
    expect(inks.has(Ink.Shadow)).toBe(true)
  })
})
