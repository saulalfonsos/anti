// One clock for every animated mark on screen, so they step together and cost a single timer. It only runs
// while something listens, and never keeps the process alive.

export type Tick = (now: number) => void

/** 30 steps per second: the rate the logo simulation was designed at; slower marks skip ticks. */
export const TICK_MS = 1000 / 30

const listeners = new Set<Tick>()
let timer: ReturnType<typeof setInterval> | undefined

export function onTick(listener: Tick): () => void {
  listeners.add(listener)
  if (!timer) {
    timer = setInterval(tick, TICK_MS)
    timer.unref?.()
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size || !timer) return
    clearInterval(timer)
    timer = undefined
  }
}

function tick() {
  const now = performance.now()
  for (const listener of listeners) listener(now)
}
