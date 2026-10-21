// lib/antigravity/tui/shortid.mjs — ids cortos de conversación (spec §5.1, §5.6). 4 caracteres bastan para
// una persona; ante colisión en el directorio se alarga a 6 y 8. La resolución acepta el id completo o un
// prefijo (≥ 4) y nunca adivina: ambiguo → lista de candidatas.
import fs from "node:fs"
const MIN = 4
export function shortId(cid, all = []) {
  for (const n of [4, 6, 8]) {
    const p = cid.slice(0, n)
    if (!all.some((o) => o !== cid && o.startsWith(p))) return p
  }
  return cid.slice(0, 8)
}
export function knownConversations(dir) {
  let names = []
  try { names = fs.readdirSync(dir) } catch { return [] }
  const ids = new Set()
  for (const n of names) {
    if (n.endsWith(".events.jsonl")) ids.add(n.slice(0, -".events.jsonl".length))
    else if (n.endsWith(".json") && !n.startsWith("session-")) ids.add(n.slice(0, -".json".length))
  }
  return [...ids].sort()
}
export function resolveConversation(idOrPrefix, dir) {
  const q = String(idOrPrefix ?? "").trim()
  const all = knownConversations(dir)
  // Match exacto, PERO no si ese id es además prefijo de otro: si la caché se limpia con un id vivo en el
  // contexto de Ling, la siguiente llamada con el id corto (4 caracteres, los que anuncia el informe) crea
  // un "<prefijo>.events.jsonl" fantasma, y a partir de entonces ese fantasma ganaría siempre por match
  // exacto y secuestraría en silencio a la conversación real. Cayendo a `ambiguous`, la tool pide más
  // caracteres en vez de elegir mal (revisión final, M4′).
  if (all.includes(q) && !all.some((c) => c !== q && c.startsWith(q))) return { cid: q }
  if (q.length < MIN) return { missing: true }
  const hits = all.filter((c) => c.startsWith(q))
  if (hits.length === 1) return { cid: hits[0] }
  if (hits.length > 1) return { ambiguous: hits }
  return { missing: true }
}
