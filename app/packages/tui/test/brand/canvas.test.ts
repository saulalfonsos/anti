import { describe, expect, test } from "bun:test"
import { drawHalfBlocks, Ink, PixelCanvas } from "../../src/brand"

type Cell = [x: number, y: number, char: string, fg: Ink, bg?: Ink]

function cells(canvas: PixelCanvas) {
  const out: Cell[] = []
  drawHalfBlocks(canvas, (x, y, char, fg, bg) => out.push(bg === undefined ? [x, y, char, fg] : [x, y, char, fg, bg]))
  return out
}

describe("PixelCanvas", () => {
  test("addresses pixels in world coordinates through its viewport", () => {
    const canvas = new PixelCanvas({ left: -3, top: -2, width: 4, height: 4 })
    canvas.set(-3, -2, Ink.Primary)
    canvas.set(0, 1, Ink.Secondary)
    expect(canvas.get(-3, -2)).toBe(Ink.Primary)
    expect(canvas.get(0, 1)).toBe(Ink.Secondary)
    expect(canvas.get(-2, -2)).toBeUndefined()
  })

  test("drops pixels outside the viewport", () => {
    const canvas = new PixelCanvas({ left: 0, top: 0, width: 2, height: 2 })
    for (const [x, y] of [
      [-1, 0],
      [0, -1],
      [2, 0],
      [0, 2],
    ] as const)
      canvas.set(x, y, Ink.Primary)
    expect(canvas.pixels.every((pixel) => pixel === 0)).toBe(true)
    expect(canvas.get(5, 5)).toBeUndefined()
  })

  test("measures cells: one column per pixel, two pixel rows per cell, rounding odd heights up", () => {
    const canvas = new PixelCanvas({ left: 0, top: 0, width: 7, height: 5 })
    expect([canvas.columns, canvas.rows]).toEqual([7, 3])
  })
})

describe("drawHalfBlocks", () => {
  test("picks the glyph from which halves are painted", () => {
    const canvas = new PixelCanvas({ left: 0, top: 0, width: 5, height: 2 })
    canvas.set(0, 0, Ink.Primary) // upper only
    canvas.set(1, 1, Ink.Secondary) // lower only
    canvas.set(2, 0, Ink.Word) // both, same ink
    canvas.set(2, 1, Ink.Word)
    canvas.set(3, 0, Ink.Word) // both, different inks
    canvas.set(3, 1, Ink.WordShade)
    // column 4 stays empty and is skipped
    expect(cells(canvas)).toEqual([
      [0, 0, "▀", Ink.Primary],
      [1, 0, "▄", Ink.Secondary],
      [2, 0, "█", Ink.Word],
      [3, 0, "▀", Ink.Word, Ink.WordShade],
    ])
  })

  test("treats the missing lower half of an odd last row as empty", () => {
    const canvas = new PixelCanvas({ left: 0, top: 0, width: 1, height: 3 })
    canvas.set(0, 2, Ink.Secondary)
    expect(cells(canvas)).toEqual([[0, 1, "▀", Ink.Secondary]])
  })
})
