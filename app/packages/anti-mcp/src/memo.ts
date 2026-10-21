// Memoria de lecturas por conversación (P13-c, D282). Responde a una sola pregunta: ¿ya devolví entero este rango de este
// contenido en esta conversación? Si sí, `leer` dice «sin cambios desde la lectura N» en vez de repetir el texto. La clave es
// la conversación (la de agy, de `_meta`), el fichero (su realpath) y el hash del contenido: con otro hash el contenido
// cambió y lo anterior deja de valer. Es por conversación, no por proceso: si agy reutilizara un servidor entre
// conversaciones, una vería «sin cambios» de algo que nunca leyó. PURA: ni disco ni reloj.
export type Memo = {
  // La lectura más reciente de las que, juntas, ya devolvieron ENTERO [from, to] de ese contenido (hash) en esa conversación.
  readonly covered: (input: { readonly conversation: string; readonly file: string; readonly hash: string; readonly from: number; readonly to: number }) => number | undefined
  // Con otro hash, la entrada del fichero se sustituye (el contenido cambió).
  readonly record: (input: { readonly conversation: string; readonly file: string; readonly hash: string; readonly from: number; readonly to: number; readonly read: number }) => void
  readonly nextRead: (conversation: string) => number // 1, 2, 3… por conversación
}

type Read = { readonly from: number; readonly to: number; readonly read: number }
type Entry = { readonly hash: string; readonly reads: readonly Read[] }

export function make(): Memo {
  const entries = new Map<string, Entry>()
  const counters = new Map<string, number>()
  // JSON y no una concatenación: dos pares distintos nunca dan la misma clave, sea cual sea el separador.
  const keyOf = (input: { readonly conversation: string; readonly file: string }) => JSON.stringify([input.conversation, input.file])

  return {
    covered: (input) => {
      const entry = entries.get(keyOf(input))
      if (entry?.hash !== input.hash) return undefined
      // «La más reciente de las que juntas lo devolvieron» es la primera lectura N tal que las lecturas hasta N ya cubren el
      // rango: desde la N lo tenía entero, y lo que se leyó después dentro de eso no cambia a qué lectura se remite.
      const ordered = [...entry.reads].sort((a, b) => a.read - b.read)
      return ordered.map((r) => r.read).find((number) => covers(ordered.filter((r) => r.read <= number), input.from, input.to))
    },
    record: (input) => {
      const previous = entries.get(keyOf(input))
      const reads = previous?.hash === input.hash ? previous.reads : []
      entries.set(keyOf(input), { hash: input.hash, reads: [...reads, { from: input.from, to: input.to, read: input.read }] })
    },
    nextRead: (conversation) => {
      const next = (counters.get(conversation) ?? 0) + 1
      counters.set(conversation, next)
      return next
    },
  }
}

// ¿Cubren las lecturas, juntas, todas las líneas de `from` a `to`? Las contiguas cuentan (1-50 y 51-100 cubren 1-100); un hueco, no.
// Recorrido por inicio: `next` es la primera línea que aún falta y cada lectura que empieza a tiempo la adelanta.
function covers(reads: readonly Read[], from: number, to: number): boolean {
  const next = [...reads].sort((a, b) => a.from - b.from).reduce((missing, r) => (r.from <= missing ? Math.max(missing, r.to + 1) : missing), from)
  return next > to
}
