// lib/antigravity/tui/tail.mjs — sigue un events.jsonl y entrega eventos completos por lotes. Sin fs.watch
// (en macOS falla con ficheros que se crean después y con editores que reemplazan el inode): sondeo por
// tamaño cada intervalMs, igual que el SSE del visor web.
import fs from "node:fs"
import { StringDecoder } from "node:string_decoder"
import { readChunkBuffer, parseLine } from "../events-file.mjs"

export function createTailer(file, onEvents, { intervalMs = 250, maxInitialBytes = 2 * 1024 * 1024 } = {}) {
  // decoder por tailer (no por lectura): un carácter multibyte puede caer justo en la frontera entre dos
  // sondeos; StringDecoder retiene los bytes finales incompletos y los completa en la siguiente llamada.
  let decoder = new StringDecoder("utf8")
  let offset = 0, rest = "", truncated = false, dropFirst = false, timer = null, first = true, stopped = false, lastError = null
  // Se pone a true cuando el fichero se recrea/trunca por fuera y viaja en meta.reset del SIGUIENTE lote: el
  // consumidor acumula (el reductor del store), así que sin avisarle se le reenvían desde el byte 0 eventos
  // que ya había reducido y la vista sale duplicada. Hoy appendEvent solo añade, pero limpiar la caché en
  // caliente sí lo provoca.
  let resetPending = false
  const pump = () => {
    let size
    try { size = fs.statSync(file).size } catch { return } // fichero aún no existe: nada que hacer este ciclo
    // Todo lo demás (lectura, parseo y sobre todo la llamada a onEvents, que es código del llamador) va
    // dentro del try: si algo lanza aquí, un setInterval sin capturar tumbaría el proceso entero
    // (uncaughtException) — igual que hace sse() en server.mjs, se traga el fallo y el tailer sigue vivo.
    try {
      if (first) {
        first = false
        if (size > maxInitialBytes) { offset = size - maxInitialBytes; truncated = true; dropFirst = true }
      }
      if (size < offset) {
        // fichero recreado/truncado por fuera: el decoder puede tener bytes multibyte a medio decodificar
        // de la sesión anterior (ya no aplican a este fichero nuevo) — se descarta y se crea uno limpio.
        decoder.end(); decoder = new StringDecoder("utf8")
        offset = 0; rest = ""; dropFirst = false; truncated = false; resetPending = true
      }
      if (size === offset) return
      const buf = readChunkBuffer(file, offset, size - offset)
      const text = decoder.write(buf)
      // offset avanza según los bytes REALMENTE leídos (buf.length), no según `size`: si el fichero encoge
      // entre el stat() de arriba y esta lectura, fs.readSync puede devolver menos bytes de los pedidos, y
      // saltar a `size` perdería silenciosamente ese hueco.
      offset += buf.length
      const parts = (rest + text).split("\n")
      const pending = parts.pop() ?? "" // última línea, posiblemente partida: candidata a retenerse
      if (dropFirst) {
        // Arranque truncado: la primera línea que se lea es, por definición, parcial. Mientras no aparezca
        // un '\n' real que la cierre (parts.length === 0 tras el pop), no hay límite de línea que cruzar
        // todavía — se descarta lo acumulado en vez de arrastrarlo, y dropFirst se mantiene para el próximo
        // sondeo. Solo cuando el '\n' aparece (parts.length > 0) se descarta esa primera línea con shift()
        // y se abandona dropFirst; de lo contrario esa línea (aunque termine siendo JSON válido) fugaría.
        if (parts.length > 0) { parts.shift(); dropFirst = false; rest = pending }
        else rest = ""
      } else rest = pending
      const events = []
      for (const l of parts) { if (l === "") continue; const e = parseLine(l); if (e) events.push(e) } // JSON roto se ignora
      if (events.length) { onEvents(events, { truncated, reset: resetPending }); resetPending = false }
    } catch (err) { lastError = err } // p.ej. onEvents lanza: se traga y el tailer sigue vivo en el siguiente sondeo
  }
  pump() // primera entrega síncrona si el fichero ya existe
  timer = setInterval(() => { if (!stopped) pump() }, intervalMs)
  timer.unref?.() // que un tailer vivo no impida salir a los tests ni a la TUI
  return { stop() { stopped = true; clearInterval(timer) }, get truncated() { return truncated }, get offset() { return offset }, get lastError() { return lastError } }
}
