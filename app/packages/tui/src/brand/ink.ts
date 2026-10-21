// Inks are the named colors of the anti mark. Scenes paint with inks, never with concrete colors; a palette
// resolves them late (from the active theme in the TUI, from the anti theme file in the CLI), so the mark
// follows whatever theme is active without any scene knowing about themes. The two brand colors are named by
// role, primary and secondary, so the brand can change color without the code lying about it.

export const Ink = {
  Word: 1,
  WordShade: 2,
  Primary: 3,
  PrimaryShade: 4,
  Secondary: 5,
  SecondaryShade: 6,
  Spark: 7,
  Track: 8,
  // La identidad de anti: la estela del lila al 50 % y al 25 % y la sombra del cursor (brand/anti.ts).
  Trail: 9,
  Faint: 10,
  Shadow: 11,
} as const
export type Ink = (typeof Ink)[keyof typeof Ink]

export const INKS: readonly Ink[] = Object.values(Ink)

export type Rgb = readonly [number, number, number]
export type Palette<Color> = Readonly<Record<Ink, Color>>

/** The four theme colors every ink derives from. */
export type BrandBase = {
  primary: Rgb
  secondary: Rgb
  text: Rgb
  background: Rgb
}

// The word's shaded rows sit half way from the text to the background (#7A7A7A between #EEEEEE and the design's
// background). The brand colors' shadows are the colors at 62% brightness, as the brand palette defines them
// (#7486F5 → #485398, #4DB896 → #30725D): darker in both modes, so a drop reads as shadow on light themes too.
const WORD_SHADE = 0.5
const BRAND_SHADE = 0.62
const TRACK_SHADE = 0.9
// Los tonos del diseño de identidad, medidos sobre sus colores: #6E6394 y #3A3550 son el lila #B9A4F5 al 60 % y al 32 % de
// brillo, y #2A2833 es el fondo con un 15 % de lila.
const TRAIL = 0.6
const FAINT = 0.32
const SHADOW = 0.15

export function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  const t = Math.max(0, Math.min(1, amount))
  return [
    Math.round(from[0] + (to[0] - from[0]) * t),
    Math.round(from[1] + (to[1] - from[1]) * t),
    Math.round(from[2] + (to[2] - from[2]) * t),
  ]
}

export function luminance(color: Rgb) {
  const [r, g, b] = color.map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

export function palette(base: BrandBase): Palette<Rgb> {
  const lightest = luminance(base.text) >= luminance(base.background) ? base.text : base.background
  return {
    [Ink.Word]: base.text,
    [Ink.WordShade]: mix(base.text, base.background, WORD_SHADE),
    [Ink.Primary]: base.primary,
    [Ink.PrimaryShade]: mix([0, 0, 0], base.primary, BRAND_SHADE),
    [Ink.Secondary]: base.secondary,
    [Ink.SecondaryShade]: mix([0, 0, 0], base.secondary, BRAND_SHADE),
    [Ink.Spark]: lightest,
    [Ink.Track]: mix(base.text, base.background, TRACK_SHADE),
    [Ink.Trail]: mix([0, 0, 0], base.primary, TRAIL),
    [Ink.Faint]: mix([0, 0, 0], base.primary, FAINT),
    [Ink.Shadow]: mix(base.background, base.primary, SHADOW),
  }
}

export function mapPalette<From, To>(source: Palette<From>, fn: (color: From, ink: Ink) => To): Palette<To> {
  return Object.fromEntries(INKS.map((ink) => [ink, fn(source[ink], ink)])) as Record<Ink, To>
}

export function hexToRgb(hex: string): Rgb {
  const value = hex.replace(/^#/, "")
  const full = value.length === 3 ? [...value].map((char) => char + char).join("") : value.slice(0, 6)
  const number = Number.parseInt(full, 16)
  if (full.length !== 6 || Number.isNaN(number)) throw new Error(`Invalid hex color: ${hex}`)
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255]
}

const CUBE = [0, 95, 135, 175, 215, 255]

/**
 * Index of the closest color in the xterm 256-color palette (the 6×6×6 cube or the grey ramp), for output that
 * must not depend on true color support.
 */
export function xterm256(color: Rgb): number {
  const [r, g, b] = color.map((channel) =>
    CUBE.reduce(
      (best, level, index) => (Math.abs(level - channel) < Math.abs(CUBE[best]! - channel) ? index : best),
      0,
    ),
  ) as [number, number, number]
  const grey = Math.max(0, Math.min(23, Math.round(((color[0] + color[1] + color[2]) / 3 - 8) / 10)))
  const distance = (other: Rgb) => other.reduce((sum, channel, i) => sum + (channel - color[i]!) ** 2, 0)
  const greyLevel = 8 + 10 * grey
  if (distance([CUBE[r]!, CUBE[g]!, CUBE[b]!]) <= distance([greyLevel, greyLevel, greyLevel]))
    return 16 + 36 * r + 6 * g + b
  return 232 + grey
}
