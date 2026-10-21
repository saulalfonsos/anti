// lib/antigravity/tui/format.mjs — formatos cortos para sidebar/cabecera.
export function ago(iso, now = Date.now()) {
  if (!iso) return ""
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return ""
  const s = Math.max(0, Math.round((now - parsed) / 1000))
  if (s < 60) return `${s}s`; if (s < 3600) return `${Math.floor(s / 60)}m`; return `${Math.floor(s / 3600)}h`
}
export function elapsed(start, end, now = Date.now()) {
  if (!start) return ""
  const startMs = Date.parse(start)
  const endMs = end ? Date.parse(end) : now
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return ""
  const s = Math.max(0, Math.round((endMs - startMs) / 1000))
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`
}
// >= 999_500 redondea a 1000k al dividir entre 1000 y truncar a entero: se trata igual que 1_000_000 y se
// formatea como "1.0M" en vez de "1000k".
export function k(n) {
  if (n < 1000) return String(n)
  if (n < 999_500) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}
