// script/anti/readme-svg.mjs — los SVG del README desde los datos de marca de la app (packages/tui/src/brand/anti.ts): el logo «>_anti»
// en claro y en oscuro y la animación «Puente» del hero, fotograma a fotograma y al mismo ritmo (PUENTE_MS). Así el README no se desvía
// de lo que dibuja la terminal.
//   bun script/anti/readme-svg.mjs <carpeta de salida>
import fs from "node:fs"
import path from "node:path"
import { LOGO_HEIGHT, LOGO_WIDTH, PUENTE, PUENTE_MS, STILL } from "../../packages/tui/src/brand/anti.ts"

const out = process.argv[2]
if (!out) throw new Error("uso: bun script/anti/readme-svg.mjs <carpeta de salida>")
fs.mkdirSync(out, { recursive: true })

// Las tintas de anti.ts (0 vacío, 1 palabra, 2 lila, 3 estela, 4 tenue, 5 sombra) con los colores del tema en oscuro y en claro.
const DARK = { bg: "#111114", 1: "#ECEAF4", 2: "#B9A4F5", 3: "#6F6293", 4: "#3B344E", 5: "#2A2736" }
const LIGHT = { bg: "#FAF9FD", 1: "#17161C", 2: "#7559D9", 3: "#A592E3", 4: "#D3CAF2", 5: "#ECE8F7" }
const PX = 8 // un píxel de la marca

function rects(rows, ink) {
  const parts = []
  rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const d = row[x]
      let end = x
      while (end < row.length && row[end] === d) end++
      if (d !== "0") parts.push(`<rect x="${x * PX}" y="${y * PX}" width="${(end - x) * PX}" height="${PX}" fill="${ink[d]}"/>`)
      x = end
    }
  })
  return parts.join("")
}

function logo(ink, file) {
  const w = LOGO_WIDTH * PX, h = LOGO_HEIGHT * PX
  fs.writeFileSync(path.join(out, file), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" shape-rendering="crispEdges" role="img" aria-label="anti">${rects(STILL, ink)}</svg>\n`)
}
logo(LIGHT, "logo.svg")
logo(DARK, "logo-dark.svg")

// Animación: un <g> por fotograma; todos con la misma animación de paso, desfasada un fotograma cada uno.
const pad = 3 * PX
const w = LOGO_WIDTH * PX + 2 * pad, h = LOGO_HEIGHT * PX + 2 * pad
const total = PUENTE.length * PUENTE_MS
const share = 100 / PUENTE.length
const frames = PUENTE.map((rows, i) => `<g class="f" style="animation-delay:${i * PUENTE_MS - total}ms">${rects(rows, DARK)}</g>`).join("")
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" shape-rendering="crispEdges" role="img" aria-label="anti, animación del logo">
<style>.f{opacity:0;animation:p ${total}ms step-end infinite}@keyframes p{0%{opacity:1}${share.toFixed(4)}%{opacity:0}100%{opacity:0}}</style>
<rect width="${w}" height="${h}" rx="14" fill="${DARK.bg}"/><g transform="translate(${pad} ${pad})">${frames}</g></svg>\n`
fs.writeFileSync(path.join(out, "puente.svg"), svg)
console.log(`logo.svg, logo-dark.svg, puente.svg (${PUENTE.length} fotogramas × ${PUENTE_MS} ms) en ${out}`)
