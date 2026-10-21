// Memoria de lecturas por conversación (P13-c, T2, D282). Es una pieza pura: cada caso la usa como la usa `leer`, con
// `covered` antes de devolver texto y `record` después de devolverlo.
import { expect, test } from "bun:test"
import { make } from "../src/memo"

const A = { conversation: "c1", file: "/p/a.ts", hash: "h1" }
const range = (from: number, to: number) => ({ ...A, from, to })

test("D282: un rango ya devuelto entero, con el mismo contenido, está cubierto por esa lectura; cualquier subrango también", () => {
  const memo = make()
  memo.record({ ...range(1, 80), read: 1 })
  expect(memo.covered(range(1, 80))).toBe(1)
  expect(memo.covered(range(10, 20))).toBe(1)
  expect(memo.covered(range(80, 80))).toBe(1)
})

test("D282: un rango que no está del todo devuelto no está cubierto (se pasa de los extremos, o no se ha leído nada)", () => {
  const memo = make()
  expect(memo.covered(range(1, 10))).toBeUndefined()
  memo.record({ ...range(10, 20), read: 1 })
  expect(memo.covered(range(9, 20))).toBeUndefined()
  expect(memo.covered(range(10, 21))).toBeUndefined()
  expect(memo.covered(range(30, 40))).toBeUndefined()
})

test("D282: dos lecturas contiguas cubren juntas el rango que ninguna cubre sola, y la que cuenta es la más reciente de las necesarias", () => {
  const memo = make()
  memo.record({ ...range(1, 50), read: 3 })
  memo.record({ ...range(51, 100), read: 4 })
  expect(memo.covered(range(1, 100))).toBe(4)
  expect(memo.covered(range(40, 60))).toBe(4)
  // Lo que una sola ya devolvió sigue citando a esa.
  expect(memo.covered(range(1, 50))).toBe(3)
  expect(memo.covered(range(51, 100))).toBe(4)
})

test("D282: dos lecturas con un hueco de una línea no cubren el rango que las abarca", () => {
  const memo = make()
  memo.record({ ...range(1, 50), read: 1 })
  memo.record({ ...range(52, 100), read: 2 })
  expect(memo.covered(range(1, 100))).toBeUndefined()
  expect(memo.covered(range(51, 51))).toBeUndefined()
  expect(memo.covered(range(52, 100))).toBe(2)
})

test("D282: una lectura posterior dentro de lo ya devuelto no cambia a qué lectura se remite: desde la primera ya lo tenía", () => {
  const memo = make()
  memo.record({ ...range(1, 100), read: 1 })
  memo.record({ ...range(5, 10), read: 7 })
  expect(memo.covered(range(5, 10))).toBe(1)
  expect(memo.covered(range(1, 100))).toBe(1)
})

test("D282: lecturas solapadas se funden: cubren la unión", () => {
  const memo = make()
  memo.record({ ...range(1, 60), read: 1 })
  memo.record({ ...range(40, 100), read: 2 })
  expect(memo.covered(range(1, 100))).toBe(2)
  expect(memo.covered(range(1, 60))).toBe(1)
})

test("D282: con otro hash la entrada del fichero se sustituye: lo anterior deja de contar y solo vale lo leído tras el cambio", () => {
  const memo = make()
  memo.record({ ...range(1, 100), read: 1 })
  expect(memo.covered({ ...range(1, 100), hash: "h2" })).toBeUndefined()
  memo.record({ ...range(1, 10), hash: "h2", read: 2 })
  expect(memo.covered({ ...range(1, 10), hash: "h2" })).toBe(2)
  // El contenido viejo ya no está: ni con el hash viejo ni para lo que solo existía antes del cambio.
  expect(memo.covered(range(1, 10))).toBeUndefined()
  expect(memo.covered({ ...range(1, 100), hash: "h2" })).toBeUndefined()
})

test("D282: la memoria es de cada conversación y de cada fichero: una no ve lo que leyó otra", () => {
  const memo = make()
  memo.record({ ...range(1, 10), read: 1 })
  expect(memo.covered({ ...range(1, 10), conversation: "c2" })).toBeUndefined()
  expect(memo.covered({ ...range(1, 10), file: "/p/b.ts" })).toBeUndefined()
  memo.record({ ...range(1, 10), conversation: "c2", read: 1 })
  expect(memo.covered({ ...range(1, 10), conversation: "c2" })).toBe(1)
})

test("D282: un par conversación+fichero no se confunde con otro cuyas cadenas se concatenan igual con un separador cualquiera", () => {
  const memo = make()
  memo.record({ ...range(1, 10), conversation: "a:b", file: "c", read: 1 })
  memo.record({ ...range(1, 10), conversation: "a/b", file: "c", read: 2 })
  expect(memo.covered({ ...range(1, 10), conversation: "a", file: "b:c" })).toBeUndefined()
  expect(memo.covered({ ...range(1, 10), conversation: "a", file: "b/c" })).toBeUndefined()
  expect(memo.covered({ ...range(1, 10), conversation: "a:b", file: "c" })).toBe(1)
  expect(memo.covered({ ...range(1, 10), conversation: "a/b", file: "c" })).toBe(2)
})

test("D282: nextRead numera las lecturas 1, 2, 3… por conversación, cada una con su cuenta", () => {
  const memo = make()
  expect([memo.nextRead("c1"), memo.nextRead("c1"), memo.nextRead("c2"), memo.nextRead("c1"), memo.nextRead("c2")]).toEqual([1, 2, 1, 3, 2])
})
