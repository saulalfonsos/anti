import { expect, test } from "bun:test"
import { onTick, TICK_MS } from "../../src/brand"

test("ticks listeners with a monotonic time until they unsubscribe", async () => {
  const times: number[] = []
  const stop = onTick((now) => times.push(now))
  await Bun.sleep(TICK_MS * 4)
  stop()
  const count = times.length
  expect(count).toBeGreaterThanOrEqual(2)
  expect(times.every((time, i) => i === 0 || time >= times[i - 1]!)).toBe(true)
  await Bun.sleep(TICK_MS * 3)
  expect(times.length).toBe(count)
})

test("one timer serves every listener, and each unsubscribes on its own", async () => {
  const a: number[] = []
  const b: number[] = []
  const stopA = onTick((now) => a.push(now))
  const stopB = onTick((now) => b.push(now))
  await Bun.sleep(TICK_MS * 3)
  stopA()
  const countA = a.length
  await Bun.sleep(TICK_MS * 3)
  stopB()
  expect(a.length).toBe(countA)
  expect(b.length).toBeGreaterThan(countA)
  expect(b.slice(0, countA)).toEqual(a)
})
