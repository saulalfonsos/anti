import anti from "../theme/assets/anti.json" with { type: "json" }
import type { ThemeJson } from "../theme"
import { hexToRgb, type BrandBase } from "./ink"

/**
 * The colors of the mark as the anti theme file defines them: the one source for places that draw the mark
 * outside the anti theme (CLI output, themes generated from the terminal palette). The theme module itself is
 * not used here: it loads the renderer, which CLI commands that print a banner should not pay for.
 */
export function antiBase(mode: "dark" | "light"): BrandBase {
  const theme = anti as ThemeJson
  const color = (key: keyof ThemeJson["theme"]) => hexToRgb(resolveHex(theme, theme.theme[key], mode))
  return {
    primary: color("brandPrimary"),
    secondary: color("brandSecondary"),
    text: color("text"),
    background: color("background"),
  }
}

/** Follows a theme color through variants and references down to its hex value. */
function resolveHex(theme: ThemeJson, value: unknown, mode: "dark" | "light", chain: string[] = []): string {
  if (typeof value === "object" && value !== null) return resolveHex(theme, Reflect.get(value, mode), mode, chain)
  if (typeof value !== "string") throw new Error(`Unsupported color in the anti theme: ${String(value)}`)
  if (value.startsWith("#")) return value
  if (chain.includes(value)) throw new Error(`Circular color reference: ${[...chain, value].join(" -> ")}`)
  const next = theme.defs?.[value] ?? Reflect.get(theme.theme, value)
  return resolveHex(theme, next, mode, [...chain, value])
}
