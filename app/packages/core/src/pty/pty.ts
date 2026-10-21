export type Disp = {
  dispose(): void
}

export type Exit = {
  exitCode: number
  signal?: number | string
}

export type Opts = {
  name: string
  cols?: number
  rows?: number
  cwd?: string
  env?: Record<string, string>
}

export type Proc = {
  pid: number
  onData(listener: (data: string) => void): Disp
  // RETENIDO: si el proceso ya salió cuando alguien se suscribe, el oyente recibe igualmente su `Exit` (una vez).
  // Los envoltorios lo garantizan con `retained` (`./retained`); un oyente tardío nunca debe perder la salida.
  onExit(listener: (event: Exit) => void): Disp
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
}
