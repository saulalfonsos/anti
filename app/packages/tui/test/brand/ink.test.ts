import { describe, expect, test } from "bun:test"
import { hexToRgb, Ink, INKS, luminance, mapPalette, mix, palette, type Rgb } from "../../src/brand"

// Los colores del diseño de identidad de anti.
const design = {
  primary: hexToRgb("#B9A4F5"),
  secondary: hexToRgb("#ECEAF4"),
  text: hexToRgb("#ECEAF4"),
  background: hexToRgb("#111114"),
}

function near(actual: Rgb, expected: string, tolerance: number) {
  const target = hexToRgb(expected)
  return actual.every((channel, i) => Math.abs(channel - target[i]!) <= tolerance)
}

describe("palette", () => {
  test("derives every ink", () => {
    expect(Object.keys(palette(design)).map(Number).sort()).toEqual([...INKS].sort())
  })

  test("reproduce los tonos del diseño de identidad: estela al 50 % y al 25 % y sombra del cursor", () => {
    const inks = palette(design)
    expect(inks[Ink.Word]).toEqual(design.text)
    expect(inks[Ink.Primary]).toEqual(design.primary)
    expect(near(inks[Ink.Trail], "#6E6394", 3)).toBe(true)
    expect(near(inks[Ink.Faint], "#3A3550", 3)).toBe(true)
    expect(near(inks[Ink.Shadow], "#2A2833", 3)).toBe(true)
  })

  test("the glint is the lightest neutral: the text on dark, the background on light", () => {
    expect(palette(design)[Ink.Spark]).toEqual(design.text)
    const light = { ...design, text: hexToRgb("#121212"), background: hexToRgb("#FAFAFA") }
    expect(palette(light)[Ink.Spark]).toEqual(light.background)
  })

  test("the track sits close to the background", () => {
    const track = palette(design)[Ink.Track]
    expect(luminance(track)).toBeLessThan(luminance(palette(design)[Ink.WordShade]))
    expect(luminance(track)).toBeGreaterThan(luminance(design.background))
  })
})

describe("color helpers", () => {
  test("mix clamps its amount", () => {
    expect(mix([0, 0, 0], [200, 100, 50], 0.5)).toEqual([100, 50, 25])
    expect(mix([0, 0, 0], [200, 100, 50], 2)).toEqual([200, 100, 50])
    expect(mix([0, 0, 0], [200, 100, 50], -1)).toEqual([0, 0, 0])
  })

  test("hexToRgb reads long and short forms and rejects garbage", () => {
    expect(hexToRgb("#E63329")).toEqual([230, 51, 41])
    expect(hexToRgb("fff")).toEqual([255, 255, 255])
    expect(() => hexToRgb("#12")).toThrow("Invalid hex color")
    expect(() => hexToRgb("#zzzzzz")).toThrow("Invalid hex color")
  })

  test("luminance spans black to white", () => {
    expect(luminance([0, 0, 0])).toBe(0)
    expect(luminance([255, 255, 255])).toBeCloseTo(1, 6)
  })

  test("mapPalette converts every ink", () => {
    const hex = mapPalette(palette(design), ([r, g, b]) => `${r},${g},${b}`)
    expect(hex[Ink.Primary]).toBe("185,164,245")
    expect(Object.keys(hex)).toHaveLength(INKS.length)
  })
})
