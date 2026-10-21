import { describe, expect, test } from "bun:test"
import { spawn } from "#pty"

// Regresión de extremo a extremo con procesos reales: un proceso que sale al instante entrega su código a quien se
// suscribe justo tras crearlo y a quien lo hace tarde. Antes del parche de `bun-pty` (bucle de lectura diferido) y
// de `retained`, el primer PTY frío podía disparar `onExit` dentro del constructor y la salida se perdía.
const testPty = process.platform === "win32" ? test.skip : test

describe("pty onExit con procesos reales", () => {
  testPty(
    "40 procesos `exit 4`: todos entregan su código, al oyente inmediato y al tardío",
    async () => {
      const codes = await Promise.all(
        Array.from({ length: 40 }, async () => {
          const proc = spawn("/usr/bin/env", ["sh", "-c", "exit 4"], { name: "xterm-256color", cwd: "/tmp", env: {} })
          const early = new Promise<number>((resolve) => proc.onExit((event) => resolve(event.exitCode)))
          await new Promise((resolve) => setTimeout(resolve, 50))
          const late = new Promise<number>((resolve) => proc.onExit((event) => resolve(event.exitCode)))
          return Promise.all([early, late])
        }),
      )
      expect(codes.flat()).toEqual(Array(80).fill(4))
    },
    20_000,
  )
})
