import type { Put } from "./canvas"

/**
 * An animated picture made of terminal cells. Time is passed in, never read, so scenes are deterministic and a
 * single clock can drive every scene on screen.
 */
export interface Scene {
  /** Moves the animation to `now` (milliseconds, monotonic). Returns whether the picture changed. */
  advance(now: number): boolean
  /** Paints the current picture into a `width`×`height` box of cells. */
  draw(width: number, height: number, put: Put): void
}

/** Base for scenes that show one of a fixed number of frames, switching every `interval` milliseconds. */
export abstract class FrameScene implements Scene {
  protected frame = 0

  constructor(
    protected readonly interval: number,
    protected readonly frames: number,
  ) {}

  advance(now: number) {
    const frame = Math.floor(now / this.interval) % this.frames
    if (frame === this.frame) return false
    this.frame = frame
    return true
  }

  abstract draw(width: number, height: number, put: Put): void
}
