import { describe, expect, test } from "bun:test"
import {
  adaptive,
  Ink,
  palette,
  PixelCanvas,
  terminalPalette,
  toAnsi,
  truecolor,
  wordmark,
  hexToRgb,
} from "../../src/brand"

const inks = palette({
  primary: hexToRgb("#E63329"),
  secondary: hexToRgb("#2350D9"),
  text: hexToRgb("#EEEEEE"),
  background: hexToRgb("#0B0B0C"),
})

function canvas(paint: [x: number, y: number, ink: Ink][]) {
  const result = new PixelCanvas({ left: 0, top: 0, width: 3, height: 2 })
  for (const [x, y, ink] of paint) result.set(x, y, ink)
  return result
}

describe("toAnsi", () => {
  test("without a palette: bare glyphs, two-tone cells as full blocks, trailing space trimmed", () => {
    const lines = toAnsi(
      canvas([
        [0, 0, Ink.Primary],
        [1, 0, Ink.Word],
        [1, 1, Ink.WordShade],
      ]),
    )
    expect(lines).toEqual(["▀█"])
  })

  test("truecolor: foreground and background SGR per cell", () => {
    const [line] = toAnsi(
      canvas([
        [0, 0, Ink.Primary],
        [0, 1, Ink.Secondary],
      ]),
      truecolor(inks),
    )
    expect(line).toBe("\x1b[38;2;230;51;41;48;2;35;80;217m▀\x1b[0m")
  })

  test("adaptive: the word uses the terminal's own foreground and grey", () => {
    const [line] = toAnsi(
      canvas([
        [0, 0, Ink.Word],
        [0, 1, Ink.WordShade],
      ]),
      adaptive(inks),
    )
    expect(line).toBe("\x1b[39;100m▀\x1b[0m")
  })

  test("a lower half that can only be foreground flips the cell to ▄", () => {
    const [line] = toAnsi(
      canvas([
        [0, 0, Ink.Primary],
        [0, 1, Ink.Word],
      ]),
      adaptive(inks),
    )
    expect(line).toBe("\x1b[39;48;2;230;51;41m▄\x1b[0m")
  })

  test("when neither half can be a background, the upper half wins", () => {
    const palette = { ...adaptive(inks), [Ink.Primary]: { fg: "31" } }
    const [line] = toAnsi(
      canvas([
        [0, 0, Ink.Primary],
        [0, 1, Ink.Word],
      ]),
      palette,
    )
    expect(line).toBe("\x1b[31m▀\x1b[0m")
  })
})
