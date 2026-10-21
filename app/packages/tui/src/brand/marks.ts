import { drawHalfBlocks, PixelCanvas, type Put } from "./canvas"
import { Ink } from "./ink"
import { FrameScene } from "./scene"

// Marcas de una fila derivadas de la identidad de anti: el cursor que levita, gotas lila con su estela y un único acento, al
// tamaño de una línea de texto, para ir junto a lo que está trabajando.

type Dot = readonly [number, number]

const BRAILLE_BASE = 0x2800

/** Braille cell with the given dots lit; a cell is 2 dots wide and 4 dots tall. */
export function braille(dots: Iterable<Dot>) {
  let bits = 0
  for (const [x, y] of dots) {
    if (y < 3) bits |= 1 << (x === 0 ? y : y + 3)
    else bits |= x === 0 ? 0x40 : 0x80
  }
  return String.fromCharCode(BRAILLE_BASE + bits)
}

/** El cursor de «>_» subiendo y bajando en una sola celda: la forma más pequeña de la marca, como indicador de trabajo. */
export function cursorSpinnerFrames(): string[] {
  return ["▁", "▂", "▃", "▄", "▅", "▄", "▃", "▂"]
}

// El cursor de «>_anti» levitando, como en la animación «Levitación» del diseño: sube medio píxel, se queda arriba con su
// sombra debajo y baja. Lo que flota, flota hacia arriba.
const CURSOR: readonly (readonly [string, Ink, Ink | undefined])[] = [
  ["▄", Ink.Word, undefined],
  ["▄", Ink.Word, undefined],
  ["▀", Ink.Word, Ink.Shadow],
  ["▀", Ink.Word, Ink.Shadow],
  ["▀", Ink.Word, Ink.Shadow],
  ["▀", Ink.Word, Ink.Shadow],
  ["▄", Ink.Word, undefined],
  ["▄", Ink.Word, undefined],
]
const CURSOR_INTERVAL = 90

/**
 * La marca pequeña de anti, el indicador de trabajo: el símbolo «❯» en lila y el cursor, que levita mientras algo trabaja.
 * Sin `orbiting` el cursor está quieto: la forma fija de la marca. (El nombre se conserva por quien la usa.)
 */
export class RingsScene extends FrameScene {
  static readonly columns = 3

  constructor(readonly orbiting = true) {
    super(CURSOR_INTERVAL, CURSOR.length)
  }

  override advance(now: number) {
    return this.orbiting && super.advance(now)
  }

  draw(_width: number, _height: number, put: Put) {
    put(0, 0, "❯", Ink.Primary)
    const [char, fg, bg] = CURSOR[this.orbiting ? this.frame : 0]!
    put(2, 0, char, fg, bg)
  }
}

const TRACK_DROPS = 4
const TRACK_INTERVAL = 80

/**
 * Gotas lila con su estela dando la vuelta a una pista de una celda de alto (a la derecha por abajo, a la izquierda por
 * arriba): la barra de trabajo del cuadro de escribir.
 */
export class TrackScene extends FrameScene {
  private readonly canvas: PixelCanvas

  constructor(readonly columns: number) {
    super(TRACK_INTERVAL, columns * 2)
    this.canvas = new PixelCanvas({ left: 0, top: 0, width: columns, height: 2 })
  }

  draw(_width: number, _height: number, put: Put) {
    const length = this.columns * 2
    this.canvas.pixels.fill(Ink.Track)
    for (let drop = 0; drop < TRACK_DROPS; drop++) {
      const index = (this.frame + Math.round((drop * length) / TRACK_DROPS)) % length
      const [x, y] = index < this.columns ? [index, 1] : [length - 1 - index, 0]
      this.canvas.set(x, y, Ink.Primary)
      // Su estela: el píxel por el que acaba de pasar, en lila al 50 %.
      const back = (index - 1 + length) % length
      const [bx, by] = back < this.columns ? [back, 1] : [length - 1 - back, 0]
      if (this.canvas.get(bx, by) === Ink.Track) this.canvas.set(bx, by, Ink.Trail)
    }
    drawHalfBlocks(this.canvas, put)
  }
}

const RAIL_SPACING = 4
const RAIL_INTERVAL = 110

/**
 * Un raíl vertical (el borde izquierdo del cuadro de escribir). Mientras trabaja (`falling`, nombre heredado), las gotas lila
 * SUBEN por él con su estela debajo, porque en anti lo que flota flota hacia arriba; si no, es un raíl quieto. Con `cap`
 * la última fila cierra el raíl con medio trazo; sin él queda vacía.
 */
export class RailScene extends FrameScene {
  constructor(
    readonly falling: boolean,
    readonly cap = true,
  ) {
    super(RAIL_INTERVAL, RAIL_SPACING * 2)
  }

  override advance(now: number) {
    return this.falling && super.advance(now)
  }

  draw(_width: number, height: number, put: Put) {
    for (let row = 0; row < height; row++) {
      const last = row === height - 1
      if (last && !this.cap) continue
      put(0, row, last ? "╹" : "┃", this.falling ? this.ink(row) : Ink.Track)
    }
  }

  private ink(row: number): Ink {
    const phase = (((row + this.frame) % RAIL_SPACING) + RAIL_SPACING) % RAIL_SPACING
    if (phase === 0) return Ink.Primary
    // La fila de debajo de cada gota es su estela.
    if (phase === 1) return Ink.Trail
    return Ink.Track
  }
}
