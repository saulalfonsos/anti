// Rutas dentro de la raíz del servidor (P13-c, D281), la regla única que comparten `leer` y `probar`. La raíz es el cwd con que
// agy arranca el servidor (medido en 1.2.14) y llega como parámetro: solo el borde lee el cwd del proceso. Toda ruta se resuelve
// contra ella (una absoluta, tal cual) y pasa por `realpath`, así que `..` y los symlinks que salen de la raíz dan error igual
// que una ruta absoluta de fuera. El disco llega por el puerto `realpath`.
import path from "node:path"

export type RootPorts = { readonly root: string; readonly realpath: (path: string) => Promise<string> }
export type Located = { readonly path: string } | { readonly error: "no existe" | "fuera del proyecto" }

// `path` es el realpath del destino. Una ruta que `realpath` no resuelve es «no existe», esté donde esté: de lo que no existe
// no se puede decir si está dentro.
export async function locate(ports: RootPorts, ruta: string): Promise<Located> {
  const real = await ports.realpath(path.resolve(ports.root, ruta)).catch(() => undefined)
  if (real === undefined) return { error: "no existe" }
  const relative = path.relative(await ports.realpath(ports.root), real)
  // `..foo` es un nombre legítimo dentro de la raíz: solo `..` solo, o seguido de separador, sale de ella.
  const outside = relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
  return outside ? { error: "fuera del proyecto" } : { path: real }
}
