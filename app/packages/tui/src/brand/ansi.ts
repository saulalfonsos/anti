import { drawHalfBlocks, type PixelCanvas } from "./canvas"
import { Ink, mapPalette, type Palette, type Rgb } from "./ink"

// ANSI rendering of the mark for plain terminal output (CLI banners, the session epilogue), where there is no
// renderer to composite cells. Inks become SGR parameters; an ink without a background form can only be drawn
// as foreground, so cells are flipped (▀ ↔ ▄) when that keeps both halves.

export type AnsiInk = Readonly<{ fg: string; bg?: string }>

const ESC = "\x1b["
const RESET = `${ESC}0m`

export function truecolor(palette: Palette<Rgb>): Palette<AnsiInk> {
  return mapPalette(palette, ([r, g, b]) => ({ fg: `38;2;${r};${g};${b}`, bg: `48;2;${r};${g};${b}` }))
}

/**
 * Keeps the brand colors but draws the word in the terminal's own foreground and grey, so it reads on light
 * and dark terminals alike when the background is unknown.
 */
export function adaptive(palette: Palette<Rgb>): Palette<AnsiInk> {
  const colors = truecolor(palette)
  return {
    ...colors,
    [Ink.Word]: { fg: "39" },
    [Ink.WordShade]: { fg: "90", bg: "100" },
  }
}

/** Renders the canvas as lines of text; without a palette, as bare block glyphs. */
export function toAnsi(canvas: PixelCanvas, palette?: Palette<AnsiInk>): string[] {
  const lines = Array.from({ length: canvas.rows }, () => Array<string>(canvas.columns).fill(" "))
  drawHalfBlocks(canvas, (x, y, char, fg, bg) => {
    const row = lines[y]!
    if (!palette) {
      row[x] = bg === undefined ? char : "█"
      return
    }
    row[x] = cell(char, palette[fg], bg === undefined ? undefined : palette[bg])
  })
  return lines.map((row) => row.join("").trimEnd())
}

function cell(char: string, fg: AnsiInk, bg: AnsiInk | undefined) {
  if (!bg) return `${ESC}${fg.fg}m${char}${RESET}`
  if (bg.bg) return `${ESC}${fg.fg};${bg.bg}m${char}${RESET}`
  // The lower half can only be a foreground: draw it as ▄ over the upper half as background.
  if (fg.bg) return `${ESC}${bg.fg};${fg.bg}m${flip(char)}${RESET}`
  return `${ESC}${fg.fg}m${char}${RESET}`
}

function flip(char: string) {
  return char === "▀" ? "▄" : char === "▄" ? "▀" : char
}
