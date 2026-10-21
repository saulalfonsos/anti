// Reexporta los formatos cortos (lib/antigravity/tui/format.mjs, Node puro y testado ahí): la lógica se
// comparte entre las tres vistas de la TUI, así que vive en un único sitio fuera de solid-js.
export { ago, elapsed, k } from "../../../lib/antigravity/tui/format.mjs"

// cap: recorta texto libre que llega de fuera (argumentos de herramienta, preguntas, notas, líneas de
// diff...) para que una única línea larguísima no reviente el ancho de la tarjeta. Fix round 1, item 7.
// Vive aquí (no en lib/antigravity/tui/format.mjs) porque solo la usan los componentes de la vista para
// acotar lo que se pinta en pantalla — no es lógica de negocio que necesite su propio test en Node.
export function cap(s: unknown, n: number): string {
  const t = String(s ?? "").replace(/\s+/g, " ")
  return t.length > n ? t.slice(0, n) + "…" : t
}
