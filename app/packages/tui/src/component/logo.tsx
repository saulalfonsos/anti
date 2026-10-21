import { useTerminalDimensions } from "@opentui/solid"
import { createMemo } from "solid-js"
import { PuenteScene, WordScene } from "../brand/anti"
import { Art } from "./brand/art"

/** Rows the home screen needs besides the logo: prompt, hints, footer and breathing room. */
const HOME_ROWS = 14
/** Columns of horizontal padding around the home content. */
const HOME_PADDING = 4

/**
 * El hero de anti: «>_anti» con la animación «Puente» del diseño de identidad cuando cabe; si no, solo la palabra.
 */
export function Logo() {
  const dimensions = useTerminalDimensions()
  const fits = createMemo(
    () => dimensions().width >= PuenteScene.columns + HOME_PADDING && dimensions().height >= PuenteScene.rows + HOME_ROWS,
  )
  const scene = createMemo(() => (fits() ? new PuenteScene() : new WordScene()))
  return <Art scene={scene()} width={scene().columns} height={scene().rows} flexShrink={0} />
}
