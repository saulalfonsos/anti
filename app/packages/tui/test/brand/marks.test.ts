import { describe, expect, test } from "bun:test"
import { braille, cursorSpinnerFrames, Ink, RailScene, RingsScene, TrackScene, type Put } from "../../src/brand"

const cells = (scene: { draw: (w: number, h: number, put: Put) => void }, width = 0, height = 0) => {
  const out: [number, number, string, Ink, Ink | undefined][] = []
  scene.draw(width, height, (x, y, char, fg, bg) => out.push([x, y, char, fg, bg]))
  return out
}

describe("braille", () => {
  test("enciende los puntos pedidos", () => {
    expect(braille([])).toBe("⠀")
    expect(braille([[0, 0], [1, 3]])).toBe("⢁")
  })
})

describe("cursorSpinnerFrames", () => {
  test("el cursor sube y baja en una celda", () => {
    const frames = cursorSpinnerFrames()
    expect(frames[0]).toBe("▁")
    expect(frames).toContain("▅")
    expect(new Set(frames).size).toBeGreaterThan(3)
  })
})

describe("RingsScene (la marca pequeña: «❯» y el cursor)", () => {
  test("quieta: «❯» en lila y el cursor abajo", () => {
    const out = cells(new RingsScene(false))
    expect(out[0]).toEqual([0, 0, "❯", Ink.Primary, undefined])
    expect(out[1]).toEqual([2, 0, "▄", Ink.Word, undefined])
  })

  test("trabajando, el cursor levita: sube con su sombra debajo y vuelve", () => {
    const scene = new RingsScene()
    const seen = new Set<string>()
    for (let t = 0; t < 8 * 90; t += 90) {
      scene.advance(t)
      const [, cursor] = cells(scene)
      seen.add(`${cursor![2]}${cursor![4] ?? ""}`)
    }
    expect(seen).toContain("▄")
    expect(seen).toContain(`▀${Ink.Shadow}`)
  })
})

describe("TrackScene", () => {
  test("gotas lila con su estela sobre la pista", () => {
    const scene = new TrackScene(8)
    scene.advance(0)
    const inks = new Set(cells(scene).flatMap(([, , , fg, bg]) => [fg, bg]))
    expect(inks).toContain(Ink.Primary)
    expect(inks).toContain(Ink.Trail)
    expect(inks).not.toContain(Ink.Secondary)
  })
})

describe("RailScene", () => {
  test("quieto: todo pista; con tapa, la última fila es medio trazo", () => {
    const out = cells(new RailScene(false), 1, 4)
    expect(out.map(([, , char]) => char).join("")).toBe("┃┃┃╹")
    expect(new Set(out.map(([, , , fg]) => fg))).toEqual(new Set([Ink.Track]))
  })

  test("trabajando, las gotas suben: cada gota lleva su estela en la fila de debajo y avanzan hacia arriba", () => {
    const scene = new RailScene(true)
    scene.advance(0)
    const before = cells(scene, 1, 8).map(([, , , fg]) => fg)
    const drop = before.indexOf(Ink.Primary)
    expect(before[drop + 1]).toBe(Ink.Trail)
    scene.advance(110)
    const after = cells(scene, 1, 8).map(([, , , fg]) => fg)
    expect(after.indexOf(Ink.Primary)).toBe((drop - 1 + 4) % 4)
  })
})
