import type { RGBA } from "@opentui/core"
import { createMemo, Show } from "solid-js"
import { Ink } from "../../brand/ink"
import { RailScene, RingsScene, TrackScene } from "../../brand/marks"
import { tint, useTheme } from "../../context/theme"
import { formatDuration } from "../../util/format"
import { createNow } from "../../util/signal"
import { Art } from "./art"

/** «❯» y el cursor que levita: marca la línea de lo que está trabajando. Con `still`, el cursor quieto. */
export function Rings(props: { still?: boolean }) {
  const scene = createMemo(() => new RingsScene(!props.still))
  return <Art scene={scene()} width={RingsScene.columns} height={1} flexShrink={0} />
}

/** Gotas lila con su estela dando la vuelta a una pista: el indicador de trabajo del cuadro de escribir. */
export function BusyTrack(props: { columns?: number }) {
  const scene = createMemo(() => new TrackScene(props.columns ?? 8))
  return <Art scene={scene()} width={scene().columns} height={1} flexShrink={0} />
}

/**
 * The prompt's left edge. Idle, a plain rail in `color`; while the agent works, the rail dims and drops fall
 * down it in the brand colors. It takes the height of the row it sits in.
 */
export function Rail(props: { color: RGBA; busy: boolean; cap?: boolean }) {
  const { theme } = useTheme()
  const scene = createMemo(() => new RailScene(props.busy, props.cap))
  const track = createMemo(() => (props.busy ? tint(theme.background, props.color, 0.45) : props.color))
  return <Art scene={scene()} width={1} flexShrink={0} inks={{ [Ink.Track]: track() }} />
}

/** Time since `since` (epoch ms), counting up every second; hidden until `after` ms have passed. */
export function Elapsed(props: { since: number; after?: number; fg?: RGBA }) {
  const { theme } = useTheme()
  const now = createNow(1000)
  const elapsed = createMemo(() => Math.max(0, now() - props.since))
  return (
    <Show when={elapsed() >= (props.after ?? 0)}>
      <text fg={props.fg ?? theme.textMuted} flexShrink={0} wrapMode="none">
        {formatDuration(Math.floor(elapsed() / 1000)) || "0s"}
      </text>
    </Show>
  )
}
