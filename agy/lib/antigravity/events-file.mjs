// lib/antigravity/events-file.mjs — lectura barata de <cid>.events.jsonl (cabeza y cola) compartida por el
// visor web (server.mjs) y el plugin de TUI (registry). Nunca lee el fichero entero.
import fs from "node:fs"
export const HEAD_BYTES = 16 * 1024, TAIL_BYTES = 64 * 1024
export function readChunkBuffer(file, start, len) {
  const fd = fs.openSync(file, "r")
  try { const buf = Buffer.alloc(len); const n = fs.readSync(fd, buf, 0, len, start); return buf.subarray(0, n) }
  finally { fs.closeSync(fd) }
}
export function parseLine(line) { try { return JSON.parse(line) } catch { return null } }
// Primer evento del registro (call_start): basta con la cabeza del fichero.
export function headEvent(file) { return parseLine(readChunkBuffer(file, 0, HEAD_BYTES).toString("utf8").split("\n")[0] ?? "") }
// Últimos eventos completos: basta con la cola; la primera línea puede venir partida y se descarta.
export function tailEvents(file) {
  const size = fs.statSync(file).size
  const start = Math.max(0, size - TAIL_BYTES)
  const parts = readChunkBuffer(file, start, size - start).toString("utf8").split("\n")
  if (start > 0) parts.shift()
  return parts.filter(Boolean).map(parseLine).filter(Boolean)
}
