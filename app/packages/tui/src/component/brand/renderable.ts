import { Renderable, RGBA, type OptimizedBuffer, type RenderContext, type RenderableOptions } from "@opentui/core"
import { extend } from "@opentui/solid"
import { mapPalette, palette, type Palette, type Rgb } from "../../brand/ink"
import type { Scene } from "../../brand/scene"
import { onTick } from "../../brand/ticker"

// The one renderable behind every anti mark: it paints a brand Scene with a palette of RGBA inks and, while
// animated and visible, advances it on the shared ticker — requesting a frame only when the picture changed.

export type ArtOptions = RenderableOptions<ArtRenderable> & {
  scene?: Scene
  palette?: Palette<RGBA>
  animate?: boolean
}

const TRANSPARENT = RGBA.fromValues(0, 0, 0, 0)

export class ArtRenderable extends Renderable {
  private _scene: Scene | undefined
  private _palette: Palette<RGBA> | undefined
  private _animate = true
  private stopTicking: (() => void) | undefined

  constructor(ctx: RenderContext, options: ArtOptions) {
    super(ctx, options)
    this._scene = options.scene
    this._palette = options.palette
    this._animate = options.animate ?? true
    this.syncTicking()
  }

  set scene(value: Scene | undefined) {
    if (value === this._scene) return
    this._scene = value
    this.syncTicking()
    this.requestRender()
  }

  set palette(value: Palette<RGBA> | undefined) {
    if (value === this._palette) return
    this._palette = value
    this.requestRender()
  }

  set animate(value: boolean | undefined) {
    const next = value ?? true
    if (next === this._animate) return
    this._animate = next
    this.syncTicking()
  }

  override get visible() {
    return super.visible
  }

  override set visible(value: boolean) {
    super.visible = value
    this.syncTicking()
  }

  private syncTicking() {
    const wanted = this._animate && this._scene !== undefined && this.visible && !this.isDestroyed
    if (wanted && !this.stopTicking) {
      this.stopTicking = onTick((now) => {
        if (this._scene?.advance(now)) this.requestRender()
      })
    }
    if (!wanted && this.stopTicking) {
      this.stopTicking()
      this.stopTicking = undefined
    }
  }

  protected override renderSelf(buffer: OptimizedBuffer) {
    const scene = this._scene
    const inks = this._palette
    if (!scene || !inks || !this.visible) return
    const { width, height } = this
    scene.draw(width, height, (x, y, char, fg, bg) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return
      buffer.setCellWithAlphaBlending(this.x + x, this.y + y, char, inks[fg], bg === undefined ? TRANSPARENT : inks[bg])
    })
  }

  protected override destroySelf() {
    this.stopTicking?.()
    this.stopTicking = undefined
    super.destroySelf()
  }
}

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    anti_art: typeof ArtRenderable
  }
}

extend({ anti_art: ArtRenderable })

function toRgb(color: RGBA): Rgb {
  const [r, g, b] = color.toInts()
  return [r, g, b]
}

/** Brand inks from a theme's colors. Shades mix toward `background`, so pass the color the mark sits on. */
export function brandInks(colors: {
  brandPrimary: RGBA
  brandSecondary: RGBA
  text: RGBA
  background: RGBA
}): Palette<RGBA> {
  return mapPalette(
    palette({
      primary: toRgb(colors.brandPrimary),
      secondary: toRgb(colors.brandSecondary),
      text: toRgb(colors.text),
      background: toRgb(colors.background),
    }),
    ([r, g, b]) => RGBA.fromInts(r, g, b),
  )
}
