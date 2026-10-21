// La conversación de un subagente de agy (D324): se busca entre las bases de agy la que lanzó la tarea `parent` con ese encargo, y se
// lee de una copia (nunca se escribe en ~/.gemini). La traducción de los pasos a eventos es de lib/antigravity/subagent.mjs.
import { Database } from "bun:sqlite"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { decodeSubagent, matchesParent } from "../../lib/antigravity/subagent.mjs"

export type SubRef = { parent: string; type: string; prompt: string; startedAt?: string | null; model?: string; session?: string; cwd?: string }

const dir = () => process.env.AGY_CONVERSATIONS || path.join(os.homedir(), ".gemini", "antigravity-cli", "conversations")
// Lo que ya se encontró: el subagente no cambia de base.
const found = new Map<string, string>()

// Las bases de agy van en modo WAL: abrirlas en solo lectura falla si no está su -shm, y abrirlas normal escribiría en ~/.gemini. Se
// copian (con su -wal, que trae lo último) a una carpeta temporal y se lee la copia.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "anti-subagentes-"))
process.once("exit", () => fs.rmSync(scratch, { recursive: true, force: true }))

function rows(file: string, where = "") {
  const copy = path.join(scratch, path.basename(file))
  fs.copyFileSync(file, copy)
  fs.rmSync(`${copy}-wal`, { force: true })
  fs.rmSync(`${copy}-shm`, { force: true })
  if (fs.existsSync(`${file}-wal`)) fs.copyFileSync(`${file}-wal`, `${copy}-wal`)
  const db = new Database(copy)
  try {
    return db.query(`select idx, step_type, status, step_payload as payload from steps ${where} order by idx`).all() as { idx: number; step_type: number; status: number; payload: Uint8Array }[]
  } finally {
    db.close()
  }
}

// Solo se miran las bases tocadas desde un minuto antes de que se lanzara: hay cientos y cada una es un fichero.
export function findSubagent(ref: SubRef): string | undefined {
  const key = `${ref.parent}\n${ref.prompt}`
  const hit = found.get(key)
  if (hit && fs.existsSync(hit)) return hit
  const since = ref.startedAt ? Date.parse(ref.startedAt) - 60_000 : 0
  let names: string[] = []
  try {
    names = fs.readdirSync(dir()).filter((n) => n.endsWith(".db"))
  } catch {
    return undefined
  }
  for (const name of names) {
    const file = path.join(dir(), name)
    try {
      if (fs.statSync(file).mtimeMs < since) continue
      const head = rows(file, "where idx = 0")[0]
      if (head && matchesParent(head, ref.parent, ref.prompt)) {
        found.set(key, file)
        return file
      }
    } catch {
      // Base a medio escribir o de otra versión: se salta.
    }
  }
  return undefined
}

export function readSubagent(file: string, ref: SubRef) {
  return decodeSubagent(rows(file), { cid: path.basename(file, ".db"), layer: ref.type, model: ref.model ?? "", session: ref.session ?? "", cwd: ref.cwd ?? "" })
}
