import { describe, expect, test } from "bun:test"
import { LOGO_HEIGHT, LOGO_WIDTH, PUENTE, PUENTE_MS, PuenteScene, STILL, WORD, WordScene, type Put } from "../../src/brand"

const draw = (scene: { draw: (w: number, h: number, put: Put) => void }) => {
  const cells: string[] = []
  scene.draw(0, 0, (x, y, char, fg, bg) => cells.push(`${x},${y},${char},${fg},${bg ?? ""}`))
  return cells.join("|")
}

describe("Puente (el hero de anti)", () => {
  test("los 27 fotogramas del diseño, de 42×16 píxeles, a 70 ms", () => {
    expect(PUENTE).toHaveLength(27)
    expect(PUENTE_MS).toBe(70)
    for (const frame of PUENTE) {
      expect(frame).toHaveLength(LOGO_HEIGHT)
      for (const row of frame) expect(row).toMatch(new RegExp(`^[0-5]{${LOGO_WIDTH}}$`))
    }
    expect(LOGO_WIDTH).toBe(42)
    expect(LOGO_HEIGHT).toBe(16)
  })

  test("42×8 celdas; un fotograma cada 70 ms (con pausas, como el diseño) y vuelve al principio tras 27", () => {
    const scene = new PuenteScene()
    expect(scene.columns).toBe(42)
    expect(scene.rows).toBe(8)
    scene.advance(0)
    const first = draw(scene)
    expect(scene.advance(69)).toBe(false)
    const seen = new Set<string>()
    for (let i = 0; i < 27; i++) {
      scene.advance(i * 70)
      seen.add(draw(scene))
    }
    expect(seen.size).toBeGreaterThan(5)
    scene.advance(27 * 70)
    expect(draw(scene)).toBe(first)
  })

  test("sin movimiento es el logo quieto y no avanza", () => {
    const scene = new PuenteScene(false)
    expect(scene.advance(70)).toBe(false)
    expect(STILL).toHaveLength(16)
  })

  test("la palabra sola, para terminales estrechas: 26×5 celdas", () => {
    const word = new WordScene()
    expect(word.columns).toBe(26)
    expect(word.rows).toBe(5)
    expect(WORD).toHaveLength(10)
    expect(draw(word)).not.toBe("")
  })
})
