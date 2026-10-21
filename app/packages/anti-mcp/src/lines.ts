// Partición incremental de un flujo NDJSON: devuelve las líneas completas y conserva el resto sin terminar.
export function splitLines(rest: string, chunk: string): { lines: string[]; rest: string } {
  const parts = (rest + chunk).split("\n")
  return { lines: parts.slice(0, -1), rest: parts.at(-1) ?? "" }
}
