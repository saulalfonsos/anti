import type { Ink } from "./ink"

// The mark is pixel art on a grid where one pixel is one terminal column wide and half a row tall, so a
// terminal cell holds two stacked pixels and pixels come out square. `PixelCanvas` is a window onto that
// grid in world coordinates; `drawHalfBlocks` turns it into cells.

/** Receives one terminal cell. `bg` is omitted when the cell's second half is empty (transparent). */
export type Put = (x: number, y: number, char: string, fg: Ink, bg?: Ink) => void

export type Viewport = Readonly<{ left: number; top: number; width: number; height: number }>

const UPPER = "▀"
const LOWER = "▄"
const FULL = "█"

export class PixelCanvas {
  readonly pixels: Uint8Array

  constructor(readonly viewport: Viewport) {
    this.pixels = new Uint8Array(viewport.width * viewport.height)
  }

  /** Width and height in terminal cells. */
  get columns() {
    return this.viewport.width
  }

  get rows() {
    return Math.ceil(this.viewport.height / 2)
  }

  clear() {
    this.pixels.fill(0)
  }

  /** Paints a world-coordinate pixel; pixels outside the viewport are dropped. */
  set(x: number, y: number, ink: Ink) {
    const index = this.index(x, y)
    if (index !== -1) this.pixels[index] = ink
  }

  get(x: number, y: number): Ink | undefined {
    const index = this.index(x, y)
    if (index === -1) return
    return (this.pixels[index] || undefined) as Ink | undefined
  }

  private index(x: number, y: number) {
    const { left, top, width, height } = this.viewport
    const column = x - left
    const row = y - top
    if (column < 0 || row < 0 || column >= width || row >= height) return -1
    return row * width + column
  }
}

/** Emits the canvas as half-block cells relative to its top-left corner; empty cells are skipped. */
export function drawHalfBlocks(canvas: PixelCanvas, put: Put) {
  const { width, height } = canvas.viewport
  const pixels = canvas.pixels
  for (let row = 0; row * 2 < height; row++) {
    const upper = row * 2 * width
    const lower = upper + width
    const hasLower = row * 2 + 1 < height
    for (let x = 0; x < width; x++) {
      const top = pixels[upper + x] as Ink | 0
      const bottom = (hasLower ? pixels[lower + x] : 0) as Ink | 0
      if (!top && !bottom) continue
      if (!bottom) put(x, row, UPPER, top as Ink)
      else if (!top) put(x, row, LOWER, bottom)
      else if (top === bottom) put(x, row, FULL, top)
      else put(x, row, UPPER, top, bottom)
    }
  }
}
