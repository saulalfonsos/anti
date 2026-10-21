// Resolución de rutas dentro de la raíz del servidor (P13-c, T2, D281), la regla única que comparten `leer` y `probar`.
// Con directorios temporales reales: los symlinks y el `realpath` son justo lo que importa y no se pueden simular.
import { expect, test } from "bun:test"
import fs from "node:fs"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { locate } from "../src/paths"

// En macOS el directorio temporal pasa por un symlink (`/var` → `/private/var`): se parte de la ruta ya resuelta.
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mcp-paths-")))
const ports = (root: string) => ({ root, realpath: (p: string) => fsp.realpath(p) })

function layout() {
  const base = tmp()
  const root = path.join(base, "proyecto")
  fs.mkdirSync(path.join(root, "src"), { recursive: true })
  fs.writeFileSync(path.join(root, "src", "a.ts"), "a\n")
  fs.writeFileSync(path.join(root, "..oculto"), "x\n")
  fs.writeFileSync(path.join(base, "secreto.txt"), "no sales\n")
  return { base, root }
}

test("D281: una ruta relativa se resuelve contra la raíz y da su realpath", async () => {
  const { root } = layout()
  expect(await locate(ports(root), "src/a.ts")).toEqual({ path: path.join(root, "src", "a.ts") })
  expect(await locate(ports(root), "./src/../src/a.ts")).toEqual({ path: path.join(root, "src", "a.ts") })
})

test("D281: una ruta absoluta se toma tal cual: dentro de la raíz vale", async () => {
  const { root } = layout()
  const absolute = path.join(root, "src", "a.ts")
  expect(await locate(ports(root), absolute)).toEqual({ path: absolute })
})

test("D281: la raíz misma está dentro; un nombre que empieza por .. dentro de la raíz no es salir de ella", async () => {
  const { root } = layout()
  expect(await locate(ports(root), ".")).toEqual({ path: root })
  expect(await locate(ports(root), "..oculto")).toEqual({ path: path.join(root, "..oculto") })
})

test("D281: .. que sale de la raíz, y una ruta absoluta de fuera, son «fuera del proyecto» aunque existan", async () => {
  const { base, root } = layout()
  expect(await locate(ports(root), "../secreto.txt")).toEqual({ error: "fuera del proyecto" })
  expect(await locate(ports(root), path.join(base, "secreto.txt"))).toEqual({ error: "fuera del proyecto" })
  expect(await locate(ports(root), "src/../../secreto.txt")).toEqual({ error: "fuera del proyecto" })
  expect(await locate(ports(root), "..")).toEqual({ error: "fuera del proyecto" })
})

test("D281: un symlink dentro de la raíz que apunta fuera es «fuera del proyecto»; uno que apunta a otro sitio de dentro se resuelve a su destino", async () => {
  const { base, root } = layout()
  fs.symlinkSync(path.join(base, "secreto.txt"), path.join(root, "enlace-fuera.txt"))
  fs.symlinkSync(path.join(base), path.join(root, "enlace-dir"))
  fs.symlinkSync(path.join(root, "src", "a.ts"), path.join(root, "enlace-dentro.ts"))
  expect(await locate(ports(root), "enlace-fuera.txt")).toEqual({ error: "fuera del proyecto" })
  expect(await locate(ports(root), "enlace-dir/secreto.txt")).toEqual({ error: "fuera del proyecto" })
  expect(await locate(ports(root), "enlace-dentro.ts")).toEqual({ path: path.join(root, "src", "a.ts") })
})

test("D281: una ruta que no existe es «no existe» (realpath rechaza), esté donde esté", async () => {
  const { root } = layout()
  expect(await locate(ports(root), "src/no-existe.ts")).toEqual({ error: "no existe" })
  expect(await locate(ports(root), "../no-existe.txt")).toEqual({ error: "no existe" })
})

test("D281: la raíz puede ser ella misma un symlink: lo de dentro sigue dentro y lo de fuera, fuera", async () => {
  const { base, root } = layout()
  const link = path.join(base, "raiz-enlace")
  fs.symlinkSync(root, link)
  expect(await locate(ports(link), "src/a.ts")).toEqual({ path: path.join(root, "src", "a.ts") })
  expect(await locate(ports(link), "../secreto.txt")).toEqual({ error: "fuera del proyecto" })
})
