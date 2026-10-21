// Herramienta `leer` (P13-c, T2, D281, D282, D289), con directorios temporales reales y los puertos del borde (`realpath` de
// node:fs/promises y `Bun.file().bytes()`): lo que se prueba es lo que el modelo vería, línea a línea.
import { expect, test } from "bun:test"
import fs from "node:fs"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { make } from "../src/memo"
import { MAX_CHARS, MAX_FILES, MAX_LINE_CHARS, readTool, type ReadPorts } from "../src/read"
import { MCP_TOOL } from "../src/names"

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mcp-read-")))
const ports = (root: string): ReadPorts => ({ root, realpath: (p) => fsp.realpath(p), readFile: (p) => Bun.file(p).bytes() })

function project(files: Readonly<Record<string, string | Uint8Array>>): string {
  const dir = tmp()
  Object.entries(files).forEach(([name, content]) => {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
    fs.writeFileSync(path.join(dir, name), content)
  })
  return dir
}

// `n` líneas de `width` caracteres cada una, con salto final.
const uniform = (n: number, width: number) => `${Array.from({ length: n }, () => "x".repeat(width)).join("\n")}\n`
// Cinco líneas distinguibles.
const FIVE = "uno\ndos\ntres\ncuatro\ncinco\n"

const read = (dir: string, ficheros: unknown, meta: { readonly conversation?: string } = {}, memo = make()) => readTool(ports(dir), memo).invoke({ ficheros }, meta)
const text = async (...args: Parameters<typeof read>) => (await read(...args)).text

test("D282: los topes de la herramienta son los del diseño y su nombre MCP es el de schema/mcp.ts", () => {
  expect(MAX_FILES).toBe(10)
  expect(MAX_CHARS).toBe(60_000)
  expect(readTool(ports(tmp()), make()).name).toBe(MCP_TOOL.read)
})

test("D289: la descripción de leer cabe en 350 caracteres (cada carácter se paga en todas las llamadas) y nombra el uso", () => {
  const description = readTool(ports(tmp()), make()).description
  expect(description.length).toBeLessThanOrEqual(350)
  expect(description).toContain("view_file")
})

test("D282: el inputSchema anuncia de 1 a MAX_FILES ficheros con ruta y rango opcional", () => {
  expect(readTool(ports(tmp()), make()).inputSchema).toEqual({
    type: "object",
    properties: {
      ficheros: {
        type: "array",
        minItems: 1,
        maxItems: MAX_FILES,
        items: { type: "object", properties: { ruta: { type: "string" }, desde: { type: "integer", minimum: 1 }, hasta: { type: "integer", minimum: 1 } }, required: ["ruta"] },
      },
    },
    required: ["ficheros"],
  })
})

test("D282: un fichero entero da su cabecera con el rango y el total, y una línea numerada por línea de texto", async () => {
  const dir = project({ "a.txt": "uno\ndos\ntres\n" })
  const result = await read(dir, [{ ruta: "a.txt" }])
  expect(result.text).toBe("== a.txt · líneas 1-3 de 3\n1: uno\n2: dos\n3: tres")
  expect(result.isError).toBeUndefined()
})

test("D282: con o sin salto final cuenta las mismas líneas; el texto se lee como UTF-8 y un \\r final no se devuelve", async () => {
  const dir = project({ "con.txt": "a\nb\n", "sin.txt": "a\nb", "crlf.txt": "á\r\né\r\n", "solo-salto.txt": "\n" })
  expect(await text(dir, [{ ruta: "con.txt" }, { ruta: "sin.txt" }, { ruta: "crlf.txt" }, { ruta: "solo-salto.txt" }])).toBe(
    ["== con.txt · líneas 1-2 de 2", "1: a", "2: b", "== sin.txt · líneas 1-2 de 2", "1: a", "2: b", "== crlf.txt · líneas 1-2 de 2", "1: á", "2: é", "== solo-salto.txt · líneas 1-1 de 1", "1: "].join("\n"),
  )
})

test("D282: un rango da solo esas líneas, con su numeración real; desde sin hasta llega al final", async () => {
  const dir = project({ "a.txt": FIVE })
  expect(await text(dir, [{ ruta: "a.txt", desde: 2, hasta: 3 }])).toBe("== a.txt · líneas 2-3 de 5\n2: dos\n3: tres")
  expect(await text(dir, [{ ruta: "a.txt", desde: 4 }])).toBe("== a.txt · líneas 4-5 de 5\n4: cuatro\n5: cinco")
  expect(await text(dir, [{ ruta: "a.txt", hasta: 2 }])).toBe("== a.txt · líneas 1-2 de 5\n1: uno\n2: dos")
  expect(await text(dir, [{ ruta: "a.txt", desde: 5, hasta: 5 }])).toBe("== a.txt · líneas 5-5 de 5\n5: cinco")
})

test("D282: un hasta mayor que el total se recorta al total y la cabecera dice lo que de verdad se devolvió", async () => {
  const dir = project({ "a.txt": FIVE })
  expect(await text(dir, [{ ruta: "a.txt", desde: 4, hasta: 900 }])).toBe("== a.txt · líneas 4-5 de 5\n4: cuatro\n5: cinco")
})

test("D282: un lote devuelve los ficheros en el orden pedido, cada uno con su rango", async () => {
  const dir = project({ "src/a.ts": "const a = 1\nconst b = 2\n", "src/b.ts": FIVE, "c.md": "# título\n" })
  expect(await text(dir, [{ ruta: "src/a.ts" }, { ruta: "src/b.ts", desde: 2, hasta: 3 }, { ruta: "c.md" }])).toBe(
    ["== src/a.ts · líneas 1-2 de 2", "1: const a = 1", "2: const b = 2", "== src/b.ts · líneas 2-3 de 5", "2: dos", "3: tres", "== c.md · líneas 1-1 de 1", "1: # título"].join("\n"),
  )
})

test("D281: una ruta absoluta dentro de la raíz vale, y se resuelve igual que la relativa", async () => {
  const dir = project({ "src/a.ts": "x\n" })
  expect(await text(dir, [{ ruta: path.join(dir, "src", "a.ts") }])).toBe(`== ${path.join(dir, "src", "a.ts")} · líneas 1-1 de 1\n1: x`)
})

test("D281: ../ que sale de la raíz, una ruta absoluta de fuera y un symlink que sale son «fuera del proyecto», aunque el fichero exista", async () => {
  const base = tmp()
  const root = path.join(base, "proyecto")
  fs.mkdirSync(root)
  fs.writeFileSync(path.join(base, "secreto.txt"), "no sales\n")
  fs.writeFileSync(path.join(root, "dentro.txt"), "hola\n")
  fs.symlinkSync(path.join(base, "secreto.txt"), path.join(root, "enlace.txt"))
  const result = await read(root, [{ ruta: "../secreto.txt" }, { ruta: path.join(base, "secreto.txt") }, { ruta: "enlace.txt" }, { ruta: "dentro.txt" }])
  expect(result.text).toBe(
    ["== ../secreto.txt · error: fuera del proyecto", `== ${path.join(base, "secreto.txt")} · error: fuera del proyecto`, "== enlace.txt · error: fuera del proyecto", "== dentro.txt · líneas 1-1 de 1", "1: hola"].join("\n"),
  )
  // Y el contenido de fuera no aparece en ningún caso.
  expect(result.text).not.toContain("no sales")
})

test("D282: inexistente, directorio, binario y vacío son errores o marcas de ese fichero, sin tumbar el lote", async () => {
  const dir = project({ "sub/x.txt": "x\n", "bin.dat": new Uint8Array([104, 105, 0, 106]), "vacio.txt": "", "ok.txt": "ok\n" })
  const result = await read(dir, [{ ruta: "no-existe.ts" }, { ruta: "sub" }, { ruta: "sub/" }, { ruta: "." }, { ruta: "bin.dat" }, { ruta: "vacio.txt" }, { ruta: "vacio.txt", desde: 3, hasta: 4 }, { ruta: "ok.txt" }])
  expect(result.text).toBe(
    [
      "== no-existe.ts · error: no existe",
      "== sub · error: es un directorio",
      "== sub/ · error: es un directorio",
      "== . · error: es un directorio",
      "== bin.dat · error: fichero binario",
      "== vacio.txt · vacío",
      "== vacio.txt · vacío",
      "== ok.txt · líneas 1-1 de 1",
      "1: ok",
    ].join("\n"),
  )
  expect(result.isError).toBeUndefined()
})

test("D282: es binario si hay un NUL en los primeros 8000 bytes; pasados esos, se lee como texto", async () => {
  const at = (index: number) => {
    const bytes = new Uint8Array(9000).fill(97)
    bytes[index] = 0
    return bytes
  }
  const dir = project({ "dentro.dat": at(7999), "fuera.dat": at(8000) })
  expect(await text(dir, [{ ruta: "dentro.dat" }])).toBe("== dentro.dat · error: fichero binario")
  expect(await text(dir, [{ ruta: "fuera.dat" }])).toStartWith("== fuera.dat · líneas 1-1 de 1\n1: aaa")
})

test("D282: desde pasado el final, hasta < desde y el singular de «línea» son errores de ese fichero con su motivo", async () => {
  const dir = project({ "a.txt": FIVE, "una.txt": "sola\n" })
  expect(await text(dir, [{ ruta: "a.txt", desde: 6 }, { ruta: "a.txt", desde: 99, hasta: 100 }, { ruta: "una.txt", desde: 2 }, { ruta: "a.txt", desde: 4, hasta: 3 }])).toBe(
    ["== a.txt · error: el fichero tiene 5 líneas", "== a.txt · error: el fichero tiene 5 líneas", "== una.txt · error: el fichero tiene 1 línea", "== a.txt · error: rango vacío"].join("\n"),
  )
})

test("D282: isError solo si TODOS los ficheros dieron error", async () => {
  const dir = project({ "a.txt": "a\n" })
  const todos = await read(dir, [{ ruta: "x" }, { ruta: "y" }])
  const alguno = await read(dir, [{ ruta: "x" }, { ruta: "a.txt" }])
  expect(todos.isError).toBe(true)
  expect(alguno.isError).toBeUndefined()
})

test("D282: un error de lectura que no es «directorio» (permisos, disco) es el error de ese fichero y el resto del lote sigue", async () => {
  const dir = project({ "a.txt": "a\n", "b.txt": "b\n", "c.txt": "c\n" })
  const failing: ReadPorts = {
    ...ports(dir),
    readFile: async (p) => {
      if (p.endsWith("a.txt")) throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" })
      if (p.endsWith("b.txt")) throw "se cayó el disco"
      return Bun.file(p).bytes()
    },
  }
  const result = await readTool(failing, make()).invoke({ ficheros: [{ ruta: "a.txt" }, { ruta: "b.txt" }, { ruta: "c.txt" }] }, {})
  expect(result.text).toBe(
    ["== a.txt · error: no se pudo leer: EACCES: permission denied", "== b.txt · error: no se pudo leer: se cayó el disco", "== c.txt · líneas 1-1 de 1", "1: c"].join("\n"),
  )
  expect(result.isError).toBeUndefined()
})

test("D281: la raíz puede ser un symlink; lo de dentro se lee y lo de fuera no", async () => {
  const base = tmp()
  const real = path.join(base, "real")
  fs.mkdirSync(real)
  fs.writeFileSync(path.join(real, "a.txt"), "a\n")
  fs.writeFileSync(path.join(base, "fuera.txt"), "fuera\n")
  const link = path.join(base, "enlace")
  fs.symlinkSync(real, link)
  expect(await text(link, [{ ruta: "a.txt" }, { ruta: "../fuera.txt" }])).toBe("== a.txt · líneas 1-1 de 1\n1: a\n== ../fuera.txt · error: fuera del proyecto")
})

test("D282: el tope de MAX_CHARS caracteres por llamada recorta el fichero, dice desde qué línea seguir y omite los que ya no caben", async () => {
  const dir = project({ "grande.ts": uniform(5000, 30), "otro.ts": uniform(3, 200) })
  const lines = (await text(dir, [{ ruta: "grande.ts" }, { ruta: "otro.ts" }])).split("\n")
  const header = /^== grande\.ts · líneas 1-(\d+) de 5000 · recortado por el tope de 60000 caracteres: sigue desde la línea (\d+)$/.exec(lines[0])
  expect(header).not.toBeNull()
  const shown = Number(header?.[1])
  expect(Number(header?.[2])).toBe(shown + 1)
  // Las líneas devueltas son exactamente las primeras, numeradas, y llenan el tope sin pasarse: la siguiente ya no cabía.
  const body = lines.slice(1, shown + 1)
  expect(body).toEqual(Array.from({ length: shown }, (_, i) => `${i + 1}: ${"x".repeat(30)}`))
  const used = body.reduce((sum, line) => sum + line.length + 1, 0)
  expect(used).toBeLessThanOrEqual(MAX_CHARS)
  expect(used + `${shown + 1}: ${"x".repeat(30)}`.length + 1).toBeGreaterThan(MAX_CHARS)
  expect(lines.slice(shown + 1)).toEqual(["== otro.ts · omitido: tope de 60000 caracteres de esta llamada"])
})

test("D282: lo que sigue a un recorte se pide con desde y vuelve a empezar su propio tope", async () => {
  const dir = project({ "grande.ts": uniform(5000, 30) })
  const first = (await text(dir, [{ ruta: "grande.ts" }])).split("\n")
  const shown = Number(/líneas 1-(\d+) de/.exec(first[0])?.[1])
  const second = (await text(dir, [{ ruta: "grande.ts", desde: shown + 1 }])).split("\n")
  expect(second[0]).toStartWith(`== grande.ts · líneas ${shown + 1}-`)
  expect(second[1]).toBe(`${shown + 1}: ${"x".repeat(30)}`)
})

test("D282: el tope es de MAX_CHARS caracteres exactos: lo que lo llena justo cabe entero y un carácter de más recorta la última línea", async () => {
  // Cada línea cuesta su numeración «N: » (3), el texto y el salto (1): con 9996 de texto son 10000, y seis hacen el tope.
  const dir = project({ "justo.txt": uniform(6, 9_996), "pasado.txt": uniform(6, 9_997) })
  expect((await text(dir, [{ ruta: "justo.txt" }])).split("\n")[0]).toBe("== justo.txt · líneas 1-6 de 6")
  expect((await text(dir, [{ ruta: "pasado.txt" }])).split("\n")[0]).toBe("== pasado.txt · líneas 1-5 de 6 · recortado por el tope de 60000 caracteres: sigue desde la línea 6")
})

test("D282: una línea más larga que MAX_LINE_CHARS se corta con el aviso de cuánto falta, y el recorte por tope siempre avanza", async () => {
  const dir = project({ "min.js": `${"y".repeat(MAX_LINE_CHARS + 500)}\nsegunda\n`, "todo-largo.js": uniform(10, MAX_LINE_CHARS * 2) })
  const minified = (await text(dir, [{ ruta: "min.js" }])).split("\n")
  expect(minified).toEqual(["== min.js · líneas 1-2 de 2", `1: ${"y".repeat(MAX_LINE_CHARS)}… (+500 caracteres)`, "2: segunda"])
  const largo = (await text(dir, [{ ruta: "todo-largo.js" }])).split("\n")
  const header = /^== todo-largo\.js · líneas 1-(\d+) de 10 · recortado por el tope de 60000 caracteres: sigue desde la línea (\d+)$/.exec(largo[0])
  // Aunque cada línea pese casi un sexto del tope, caben varias: el modelo nunca se queda sin poder avanzar.
  expect(Number(header?.[1])).toBeGreaterThanOrEqual(5)
  expect(Number(header?.[2])).toBe(Number(header?.[1]) + 1)
})

test("D282: sin conversación no hay memoria: la misma lectura repetida devuelve siempre el texto", async () => {
  const dir = project({ "a.txt": FIVE })
  const memo = make()
  const once = await text(dir, [{ ruta: "a.txt" }], {}, memo)
  const twice = await text(dir, [{ ruta: "a.txt" }], {}, memo)
  expect(twice).toBe(once)
  expect(twice).not.toContain("sin cambios")
  // Y esas lecturas no consumieron números de lectura de ninguna conversación.
  await read(dir, [{ ruta: "a.txt" }], { conversation: "c1" }, memo)
  expect(await text(dir, [{ ruta: "a.txt" }], { conversation: "c1" }, memo)).toBe("== a.txt · líneas 1-5 de 5 · sin cambios desde la lectura 1")
})

test("D282: un rango ya devuelto entero y sin cambios en la misma conversación da «sin cambios desde la lectura N» en vez del texto", async () => {
  const dir = project({ "a.txt": FIVE })
  const memo = make()
  const meta = { conversation: "c1" }
  expect(await text(dir, [{ ruta: "a.txt" }], meta, memo)).toBe("== a.txt · líneas 1-5 de 5\n1: uno\n2: dos\n3: tres\n4: cuatro\n5: cinco")
  expect(await text(dir, [{ ruta: "a.txt" }], meta, memo)).toBe("== a.txt · líneas 1-5 de 5 · sin cambios desde la lectura 1")
  expect(await text(dir, [{ ruta: "a.txt", desde: 2, hasta: 3 }], meta, memo)).toBe("== a.txt · líneas 2-3 de 5 · sin cambios desde la lectura 1")
})

test("D282: un rango que no estaba entero en lo ya devuelto trae el texto, y lo nuevo se suma a la memoria", async () => {
  const dir = project({ "a.txt": FIVE })
  const memo = make()
  const meta = { conversation: "c1" }
  await read(dir, [{ ruta: "a.txt", desde: 1, hasta: 3 }], meta, memo)
  expect(await text(dir, [{ ruta: "a.txt", desde: 2, hasta: 5 }], meta, memo)).toBe("== a.txt · líneas 2-5 de 5\n2: dos\n3: tres\n4: cuatro\n5: cinco")
  // La lectura 2 completó el resto: ahora 4-5 está cubierto, por la lectura 2.
  expect(await text(dir, [{ ruta: "a.txt", desde: 4, hasta: 5 }], meta, memo)).toBe("== a.txt · líneas 4-5 de 5 · sin cambios desde la lectura 2")
})

test("D282: un rango cubierto por la unión de dos lecturas cita la más reciente de las dos", async () => {
  const dir = project({ "a.txt": FIVE })
  const memo = make()
  const meta = { conversation: "c1" }
  await read(dir, [{ ruta: "a.txt", desde: 1, hasta: 2 }], meta, memo)
  await read(dir, [{ ruta: "a.txt", desde: 3, hasta: 5 }], meta, memo)
  expect(await text(dir, [{ ruta: "a.txt" }], meta, memo)).toBe("== a.txt · líneas 1-5 de 5 · sin cambios desde la lectura 2")
})

test("D282: si el fichero cambió, el texto vuelve a salir y desde entonces la memoria es la del contenido nuevo", async () => {
  const dir = project({ "a.txt": FIVE })
  const memo = make()
  const meta = { conversation: "c1" }
  await read(dir, [{ ruta: "a.txt" }], meta, memo)
  fs.writeFileSync(path.join(dir, "a.txt"), "uno\nDOS\ntres\ncuatro\ncinco\n")
  expect(await text(dir, [{ ruta: "a.txt", desde: 1, hasta: 2 }], meta, memo)).toBe("== a.txt · líneas 1-2 de 5\n1: uno\n2: DOS")
  expect(await text(dir, [{ ruta: "a.txt", desde: 1, hasta: 2 }], meta, memo)).toBe("== a.txt · líneas 1-2 de 5 · sin cambios desde la lectura 2")
  // Lo que solo se había leído antes del cambio no cuenta como leído.
  expect(await text(dir, [{ ruta: "a.txt", desde: 3, hasta: 5 }], meta, memo)).toBe("== a.txt · líneas 3-5 de 5\n3: tres\n4: cuatro\n5: cinco")
})

test("D282: dos conversaciones no comparten memoria ni numeración de lecturas", async () => {
  const dir = project({ "a.txt": FIVE, "b.txt": "b\n" })
  const memo = make()
  await read(dir, [{ ruta: "a.txt" }], { conversation: "c1" }, memo)
  // c2 no leyó nada: ve el texto, no «sin cambios».
  expect(await text(dir, [{ ruta: "a.txt" }], { conversation: "c2" }, memo)).toStartWith("== a.txt · líneas 1-5 de 5\n1: uno")
  expect(await text(dir, [{ ruta: "a.txt" }], { conversation: "c1" }, memo)).toBe("== a.txt · líneas 1-5 de 5 · sin cambios desde la lectura 1")
  await read(dir, [{ ruta: "b.txt" }], { conversation: "c1" }, memo)
  expect(await text(dir, [{ ruta: "b.txt" }], { conversation: "c1" }, memo)).toBe("== b.txt · líneas 1-1 de 1 · sin cambios desde la lectura 3")
  expect(await text(dir, [{ ruta: "a.txt" }], { conversation: "c2" }, memo)).toBe("== a.txt · líneas 1-5 de 5 · sin cambios desde la lectura 1")
})

test("D282: el fichero de la memoria es su realpath: la misma lectura por otra ruta (./, .. o un symlink) también está leída", async () => {
  const dir = project({ "src/a.ts": "x\ny\n" })
  fs.symlinkSync(path.join(dir, "src", "a.ts"), path.join(dir, "enlace.ts"))
  const memo = make()
  const meta = { conversation: "c1" }
  await read(dir, [{ ruta: "src/a.ts" }], meta, memo)
  const hits = await text(dir, [{ ruta: "./src/../src/a.ts" }, { ruta: "enlace.ts" }, { ruta: path.join(dir, "src", "a.ts") }], meta, memo)
  expect(hits.split("\n")).toEqual([
    "== ./src/../src/a.ts · líneas 1-2 de 2 · sin cambios desde la lectura 1",
    "== enlace.ts · líneas 1-2 de 2 · sin cambios desde la lectura 1",
    `== ${path.join(dir, "src", "a.ts")} · líneas 1-2 de 2 · sin cambios desde la lectura 1`,
  ])
})

test("D282: solo cuenta como leído lo que de verdad se devolvió: tras un recorte por tope, lo recortado se vuelve a pedir y lo devuelto no", async () => {
  const dir = project({ "grande.ts": uniform(5000, 30) })
  const memo = make()
  const meta = { conversation: "c1" }
  const first = await text(dir, [{ ruta: "grande.ts" }], meta, memo)
  const shown = Number(/líneas 1-(\d+) de/.exec(first)?.[1])
  expect(await text(dir, [{ ruta: "grande.ts", desde: 1, hasta: shown }], meta, memo)).toBe(`== grande.ts · líneas 1-${shown} de 5000 · sin cambios desde la lectura 1`)
  // La última línea devuelta y la primera recortada: esta no se había visto, así que el rango entero se vuelve a leer.
  expect(await text(dir, [{ ruta: "grande.ts", desde: shown, hasta: shown + 1 }], meta, memo)).toBe(
    `== grande.ts · líneas ${shown}-${shown + 1} de 5000\n${shown}: ${"x".repeat(30)}\n${shown + 1}: ${"x".repeat(30)}`,
  )
})

test("D282: un fichero repetido en el mismo lote cuenta como leído por la primera aparición; lo omitido por el tope no se da por leído", async () => {
  const dir = project({ "a.txt": "a\n", "grande.ts": uniform(5000, 30), "otro.ts": uniform(3, 200) })
  const memo = make()
  const meta = { conversation: "c1" }
  expect(await text(dir, [{ ruta: "a.txt" }, { ruta: "a.txt" }], meta, memo)).toBe("== a.txt · líneas 1-1 de 1\n1: a\n== a.txt · líneas 1-1 de 1 · sin cambios desde la lectura 1")
  await read(dir, [{ ruta: "grande.ts" }, { ruta: "otro.ts" }], meta, memo)
  // otro.ts salió «omitido»: no se devolvió nada de él, así que se vuelve a pedir y entonces sí llega.
  expect(await text(dir, [{ ruta: "otro.ts" }], meta, memo)).toStartWith("== otro.ts · líneas 1-3 de 3\n1: xxx")
})

test("D282: stats cuenta ficheros, aciertos de memoria, caracteres devueltos y caracteres evitados", async () => {
  const dir = project({ "a.txt": "uno\ndos\ntres\n" })
  const memo = make()
  const meta = { conversation: "c1" }
  const first = await read(dir, [{ ruta: "a.txt" }], meta, memo)
  expect(first.stats).toEqual({ ficheros: 1, memoria: 0, caracteres: first.text.length, evitados: 0 })
  const second = await read(dir, [{ ruta: "a.txt" }, { ruta: "falta.txt" }, { ruta: "a.txt", desde: 2, hasta: 3 }], meta, memo)
  // Lo evitado es lo que habría salido: «1: uno\n2: dos\n3: tres» (21) y «2: dos\n3: tres» (14).
  expect(second.stats).toEqual({ ficheros: 3, memoria: 2, caracteres: second.text.length, evitados: 21 + 14 })
})

test("D282: los argumentos que no cumplen el esquema son un error con el motivo y no leen nada", async () => {
  const dir = project({ "a.txt": "a\n" })
  let lecturas = 0
  const counted: ReadPorts = {
    ...ports(dir),
    readFile: async (p) => {
      lecturas += 1
      return Bun.file(p).bytes()
    },
  }
  const tool = readTool(counted, make())
  const eleven = Array.from({ length: MAX_FILES + 1 }, () => ({ ruta: "a.txt" }))
  const bad = [
    { ficheros: [] },
    { ficheros: eleven },
    { ficheros: [{ ruta: "a.txt", desde: 0 }] },
    { ficheros: [{ ruta: "a.txt", hasta: 0 }] },
    { ficheros: [{ ruta: "a.txt", desde: 1.5 }] },
    { ficheros: [{ ruta: "a.txt", desde: "1" }] },
    { ficheros: [{}] },
    { ficheros: "a.txt" },
    {},
    undefined,
  ]
  const results = await Promise.all(bad.map((args) => tool.invoke(args, {})))
  expect(results.every((r) => r.isError === true && r.text.startsWith("argumentos no válidos"))).toBe(true)
  expect(lecturas).toBe(0)
  // En el límite de lo admitido sí lee.
  const ten = await tool.invoke({ ficheros: Array.from({ length: MAX_FILES }, () => ({ ruta: "a.txt" })) }, {})
  expect(ten.isError).toBeUndefined()
  expect(lecturas).toBe(MAX_FILES)
})
