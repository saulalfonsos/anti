// Entry and exit splash banners for direct interactive mode scrollback.
//
// Renders the anti link mark (two interlocked rings) with the product name on
// entry and the session metadata and resume command on exit. These are
// scrollback snapshots, so they become immutable terminal history once
// committed. The mark is half-block pixel art from the brand library, drawn cell
// by cell in the theme's mark colors.
import {
  BoxRenderable,
  type ColorInput,
  TextAttributes,
  TextRenderable,
  type ScrollbackRenderContext,
  type ScrollbackSnapshot,
  type ScrollbackWriter,
} from "@opentui/core"
import * as Locale from "@/util/locale"
import { drawHalfBlocks, Ink, NAME, stillLink } from "@opencode-ai/tui/brand"
import type { RunSplashTheme } from "./theme"

export const SPLASH_TITLE_LIMIT = 50
export const SPLASH_TITLE_FALLBACK = "Untitled session"

type SplashInput = {
  title: string | undefined
  session_id: string
}

type SplashWriterInput = SplashInput & {
  theme: RunSplashTheme
  showSession?: boolean
  detail?: string
}

export type SplashMeta = {
  title: string
  session_id: string
}

function title(text: string | undefined): string {
  if (!text) {
    return SPLASH_TITLE_FALLBACK
  }

  let value = ""
  let gap = false
  for (const char of text.trim()) {
    if (char === " " || char === "\n" || char === "\r" || char === "\t") {
      gap = true
      continue
    }

    if (gap && value.length > 0) {
      value += " "
    }

    value += char
    gap = false
  }

  if (!value) {
    return SPLASH_TITLE_FALLBACK
  }

  return Locale.truncate(value, SPLASH_TITLE_LIMIT)
}

function write(
  root: BoxRenderable,
  ctx: ScrollbackRenderContext,
  line: {
    left: number
    top: number
    text: string
    fg: ColorInput
    bg?: ColorInput
    attrs?: number
  },
): void {
  if (line.left >= ctx.width) {
    return
  }

  root.add(
    new TextRenderable(ctx.renderContext, {
      position: "absolute",
      left: line.left,
      top: line.top,
      width: Math.max(1, ctx.width - line.left),
      height: 1,
      wrapMode: "none",
      content: line.text,
      fg: line.fg,
      bg: line.bg,
      attributes: line.attrs,
    }),
  )
}

type Line = { left: number; top: number; text: string; fg: ColorInput; bg?: ColorInput; attrs?: number }

function push(
  lines: Line[],
  left: number,
  top: number,
  text: string,
  fg: ColorInput,
  bg?: ColorInput,
  attrs?: number,
): void {
  lines.push({ left, top, text, fg, bg, attrs })
}

/** Draws the link mark with its top-left corner at `top`; returns its size in cells. */
function drawMark(lines: Line[], top: number, theme: RunSplashTheme) {
  const mark = stillLink()
  const inks: Partial<Record<Ink, ColorInput>> = { [Ink.Primary]: theme.primary, [Ink.Word]: theme.secondary, [Ink.Shadow]: theme.left }
  drawHalfBlocks(mark, (x, y, char, fg, bg) => {
    push(lines, x, top + y, char, inks[fg]!, bg === undefined ? undefined : inks[bg])
  })
  return { width: mark.columns, height: mark.rows }
}

function build(input: SplashWriterInput, kind: "entry" | "exit", ctx: ScrollbackRenderContext): ScrollbackSnapshot {
  const width = Math.max(1, ctx.width)
  const meta = splashMeta(input)
  const lines: Line[] = []
  const left = input.theme.left
  const right = input.theme.right
  let height = 1

  if (kind === "entry") {
    const top = 1
    const mark = drawMark(lines, top, input.theme)
    const body_left = mark.width + 2

    push(lines, body_left, top, NAME, right, undefined, TextAttributes.BOLD)
    if (input.detail) {
      push(
        lines,
        body_left,
        top + 1,
        Locale.truncateMiddle(input.detail, Math.max(1, width - body_left)),
        left,
        undefined,
      )
    }
    height = top + mark.height
  }

  if (kind === "exit") {
    const top = 1
    const mark = drawMark(lines, top, input.theme)
    const body_left = mark.width + 2
    const session = "Session  "
    const label = "Continue "

    if (input.showSession !== false) {
      push(lines, body_left, top, session, left, undefined, TextAttributes.DIM)
      push(lines, body_left + session.length, top, meta.title, right, undefined, TextAttributes.BOLD)
    }

    push(lines, body_left, top + 1, label, left, undefined, TextAttributes.DIM)
    push(
      lines,
      body_left + label.length,
      top + 1,
      `opencode --mini -s ${meta.session_id}`,
      right,
      undefined,
      TextAttributes.BOLD,
    )
    height = top + mark.height
  }

  const root = new BoxRenderable(ctx.renderContext, {
    position: "absolute",
    left: 0,
    top: 0,
    width,
    height,
  })

  for (const line of lines) {
    write(root, ctx, line)
  }

  return {
    root,
    width,
    height,
    rowColumns: width,
    startOnNewLine: true,
    trailingNewline: false,
  }
}

export function splashMeta(input: SplashInput): SplashMeta {
  return {
    title: title(input.title),
    session_id: input.session_id,
  }
}

export function entrySplash(input: SplashWriterInput): ScrollbackWriter {
  return (ctx) => build(input, "entry", ctx)
}

export function exitSplash(input: SplashWriterInput): ScrollbackWriter {
  return (ctx) => build(input, "exit", ctx)
}
