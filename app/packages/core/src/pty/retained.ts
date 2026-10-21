import type { Disp, Exit } from "./pty"

// Evento de salida RETENIDO (contrato de `Proc.onExit`). Los envoltorios lo suscriben al proceso en el mismo tick
// síncrono del `spawn`, guardan el `Exit` y se lo entregan a quien se suscriba después. Sin esto la salida se perdía:
// `bun-pty` arranca su bucle de lectura en el constructor y a los ~8 ms avisa UNA vez a los oyentes que haya en ese
// momento; `Pty.create` registra el suyo en otro paso de la fibra, y bajo carga un proceso que termina al instante
// (`sh -c "exit 4"`) ya había salido, la sesión nunca pasaba a `exited`.
export function retained(subscribe: (listener: (event: Exit) => void) => Disp): (listener: (event: Exit) => void) => Disp {
  const listeners = new Set<(event: Exit) => void>()
  let exit: Exit | undefined
  subscribe((event) => {
    exit = event
    const pending = [...listeners]
    listeners.clear()
    pending.forEach((listener) => listener(event))
  })
  return (listener) => {
    if (exit === undefined) {
      listeners.add(listener)
      return { dispose: () => void listeners.delete(listener) }
    }
    // Diferido a un microtask: quien se suscribe aún no ha terminado de ejecutar su propio paso (puede usar
    // constantes declaradas después del `onExit`); `dispose` antes de la entrega la cancela.
    const event = exit
    let live = true
    queueMicrotask(() => live && listener(event))
    return { dispose: () => void (live = false) }
  }
}
