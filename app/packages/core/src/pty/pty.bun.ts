import { spawn as create } from "bun-pty"
import type { Opts, Proc } from "./pty"
import { retained } from "./retained"

export type { Disp, Exit, Opts, Proc } from "./pty"

export function spawn(file: string, args: string[], opts: Opts): Proc {
  const pty = create(file, args, opts)
  const onExit = retained((listener) => pty.onExit(listener))
  return {
    pid: pty.pid,
    onData(listener) {
      return pty.onData(listener)
    },
    onExit,
    write(data) {
      pty.write(data)
    },
    resize(cols, rows) {
      pty.resize(cols, rows)
    },
    kill(signal) {
      pty.kill(signal)
    },
  }
}
