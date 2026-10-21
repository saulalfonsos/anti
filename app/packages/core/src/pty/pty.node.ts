import * as pty from "@lydell/node-pty"
import type { Opts, Proc } from "./pty"
import { retained } from "./retained"

export type { Disp, Exit, Opts, Proc } from "./pty"

export function spawn(file: string, args: string[], opts: Opts): Proc {
  const proc = pty.spawn(file, args, {
    ...opts,
    ...(process.platform === "win32" ? { useConptyDll: true } : {}),
  })
  const onExit = retained((listener) => proc.onExit(listener))
  return {
    pid: proc.pid,
    onData(listener) {
      return proc.onData(listener)
    },
    onExit,
    write(data) {
      proc.write(data)
    },
    resize(cols, rows) {
      proc.resize(cols, rows)
    },
    kill(signal) {
      proc.kill(signal)
    },
  }
}
