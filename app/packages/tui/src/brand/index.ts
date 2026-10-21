// La marca de anti: el logo «>_anti» con su animación «Puente» y las marcas pequeñas derivadas de él. Pure — no renderer, no theme
// context — so the TUI, the CLI and tests share it; component/brand adapts it to OpenTUI.

/** Product name, as written in the wordmark. */
export const NAME = "anti"

export { Ink, INKS, palette, mapPalette, mix, luminance, hexToRgb, xterm256 } from "./ink"
export type { Rgb, Palette, BrandBase } from "./ink"
export { PixelCanvas, drawHalfBlocks } from "./canvas"
export type { Put, Viewport } from "./canvas"
export { PuenteScene, WordScene, PUENTE, STILL, WORD, LOGO_WIDTH, LOGO_HEIGHT, PUENTE_MS, paint } from "./anti"
export { FrameScene } from "./scene"
export type { Scene } from "./scene"
export { RingsScene, TrackScene, RailScene, cursorSpinnerFrames, braille } from "./marks"
export { onTick, TICK_MS } from "./ticker"
export type { Tick } from "./ticker"
export { toAnsi, truecolor, adaptive } from "./ansi"
export type { AnsiInk } from "./ansi"
export { stillWord, stillLink, wordmark, terminalPalette } from "./still"
export { antiBase } from "./colors"
