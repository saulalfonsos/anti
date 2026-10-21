import { describe, expect, test } from "bun:test"
import type { Exit } from "../../src/pty/pty"
import { retained } from "../../src/pty/retained"

// Proceso simulado que avisa UNA sola vez a quien esté suscrito en ese momento, como `bun-pty`.
function source() {
  const listeners = new Set<(event: Exit) => void>()
  return {
    subscribe: (listener: (event: Exit) => void) => {
      listeners.add(listener)
      return { dispose: () => void listeners.delete(listener) }
    },
    exit: (event: Exit) => {
      const now = [...listeners]
      listeners.clear()
      now.forEach((listener) => listener(event))
    },
  }
}

describe("retained onExit", () => {
  test("un oyente tardío recibe el Exit de un proceso que salió antes de que nadie se suscribiera", async () => {
    const proc = source()
    const onExit = retained(proc.subscribe)
    proc.exit({ exitCode: 4 })
    const seen: Exit[] = []
    onExit((event) => seen.push(event))
    await Promise.resolve()
    expect(seen).toEqual([{ exitCode: 4 }])
  })

  test("un oyente temprano lo recibe una sola vez al salir, y un tardío después también", async () => {
    const proc = source()
    const onExit = retained(proc.subscribe)
    const early: Exit[] = []
    onExit((event) => early.push(event))
    proc.exit({ exitCode: 0, signal: 15 })
    const late: Exit[] = []
    onExit((event) => late.push(event))
    await Promise.resolve()
    expect(early).toEqual([{ exitCode: 0, signal: 15 }])
    expect(late).toEqual([{ exitCode: 0, signal: 15 }])
  })

  test("dispose evita la entrega, antes y después de la salida", async () => {
    const proc = source()
    const onExit = retained(proc.subscribe)
    const seen: Exit[] = []
    onExit((event) => seen.push(event)).dispose()
    proc.exit({ exitCode: 1 })
    onExit((event) => seen.push(event)).dispose()
    await Promise.resolve()
    expect(seen).toEqual([])
  })
})
