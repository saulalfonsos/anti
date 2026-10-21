// lib/antigravity/diffs.mjs — diff de un fichero respecto a git tras una edición de Antigravity (spec §5.1).
// Asíncrono para no bloquear el stream. Cuando no hay diff que mostrar devuelve {skip: "outside"|"no-git"|
// "error"} en vez de null a secas: tool-core solo debe anotar "sin git" para el caso no-git — un fichero
// fuera del cwd, o un fallo del propio `git diff`, no significa que falte el repo.
import { execFile } from "node:child_process"
import path from "node:path"

const MAX = 200 * 1024

function git(cwd, args) {
  return new Promise((resolve) => execFile("git", ["-C", cwd, ...args], { maxBuffer: 16 * 1024 * 1024 },
    (err, stdout) => resolve({ code: err ? (typeof err.code === "number" ? err.code : -1) : 0, out: stdout ?? "" })))
}

export async function gitDiffFile(cwd, file) {
  const rel = path.isAbsolute(file) ? path.relative(cwd, file) : path.normalize(file)
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return { skip: "outside" }
  if ((await git(cwd, ["rev-parse", "--is-inside-work-tree"])).code !== 0) return { skip: "no-git" }
  const tracked = (await git(cwd, ["ls-files", "--error-unmatch", "--", rel])).code === 0
  const r = tracked
    ? await git(cwd, ["diff", "--no-color", "--", rel])
    : await git(cwd, ["diff", "--no-color", "--no-index", "--", "/dev/null", rel])   // exit 1 = hay diferencias
  if (r.code === -1) return { skip: "error" }
  return { file: rel, untracked: !tracked, truncated: r.out.length > MAX, patch: r.out.slice(0, MAX) }
}
