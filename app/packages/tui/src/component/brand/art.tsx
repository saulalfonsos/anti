import { RGBA } from "@opentui/core"
import { createMemo, splitProps } from "solid-js"
import type { Palette } from "../../brand/ink"
import { useKV } from "../../context/kv"
import { useTheme, type Theme } from "../../context/theme"
import { brandInks, type ArtOptions } from "./renderable"

// Solid face of the anti marks inside the app: the `anti_art` renderable fed with the active theme's brand
// inks and silenced when the user turns animations off.

/** The background the mark sits on; transparent themes fall back to the panel, then to the terminal mode. */
function solidBackground(theme: Theme, mode: "dark" | "light"): RGBA {
  if (theme.background.a > 0) return theme.background
  if (theme.backgroundPanel.a > 0) return theme.backgroundPanel
  return mode === "dark" ? RGBA.fromInts(0, 0, 0) : RGBA.fromInts(255, 255, 255)
}

/** Brand inks resolved from the active theme. */
export function useBrandPalette() {
  const { theme, mode } = useTheme()
  return createMemo(() =>
    brandInks({
      brandPrimary: theme.brandPrimary,
      brandSecondary: theme.brandSecondary,
      text: theme.text,
      background: solidBackground(theme, mode()),
    }),
  )
}

/** Whether marks may move; the user can turn animations off from the command palette. */
export function useAnimations() {
  const kv = useKV()
  return () => kv.get("animations_enabled", true) !== false
}

export type ArtProps = Omit<ArtOptions, "palette" | "animate"> & {
  /** Overrides for some inks, e.g. a rail drawn in the agent's color. */
  inks?: Partial<Palette<RGBA>>
  /** Set to false to freeze the scene even when animations are on. */
  animate?: boolean
}

export function Art(props: ArtProps) {
  const brand = useBrandPalette()
  const animations = useAnimations()
  const [local, rest] = splitProps(props, ["inks", "animate"])
  const inks = createMemo(() => (local.inks ? { ...brand(), ...local.inks } : brand()))
  return <anti_art {...rest} palette={inks()} animate={local.animate !== false && animations()} />
}
