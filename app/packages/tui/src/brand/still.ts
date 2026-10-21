import { adaptive, toAnsi, type AnsiInk } from "./ansi"
import { paint, STILL } from "./anti"
import { antiBase } from "./colors"
import { palette, type Palette } from "./ink"

/** El logo «>_anti» quieto, como píxeles. */
export function stillWord() {
  return paint(STILL)
}

// «>_» en miniatura (tres filas): el símbolo de anti para donde no cabe la palabra.
const MINI = [
  "2000000",
  "0200000",
  "0020000",
  "0200000",
  "2000111",
  "0000555",
]

/** El símbolo «>_» en miniatura. */
export function stillLink() {
  return paint(MINI)
}

/** El logo quieto en líneas de terminal; sin paleta, con bloques sin color para salida sin colores. */
export function wordmark(inks?: Palette<AnsiInk>) {
  return toAnsi(stillWord(), inks)
}

/** Tintas ANSI para salida de terminal sin TUI. La palabra toma los colores de la propia terminal (ver `adaptive`). */
export function terminalPalette(): Palette<AnsiInk> {
  return adaptive(palette(antiBase("dark")))
}
