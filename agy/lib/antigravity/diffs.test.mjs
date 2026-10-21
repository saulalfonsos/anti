// lib/antigravity/diffs.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { gitDiffFile } from "./diffs.mjs"

function repo() {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agy-diff-")))
  const git = (...a) => execFileSync("git", ["-C", d, ...a], { stdio: "ignore" })
  git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t")
  fs.writeFileSync(path.join(d, "a.py"), "x = 1\n"); git("add", "."); git("commit", "-qm", "init")
  return d
}
test("fichero seguido modificado → parche unificado con +/-", async () => {
  const d = repo(); fs.writeFileSync(path.join(d, "a.py"), "x = 2\n")
  const r = await gitDiffFile(d, path.join(d, "a.py"))
  assert.equal(r.file, "a.py"); assert.equal(r.untracked, false); assert.equal(r.truncated, false)
  assert.match(r.patch, /^diff --git a\/a\.py b\/a\.py[\s\S]*-x = 1\n\+x = 2/)
})
test("fichero nuevo sin seguimiento → parche contra /dev/null y untracked", async () => {
  const d = repo(); fs.writeFileSync(path.join(d, "n.py"), "print(1)\n")
  const r = await gitDiffFile(d, "n.py")
  assert.equal(r.untracked, true); assert.match(r.patch, /\+\+\+ b\/n\.py[\s\S]*\+print\(1\)/)
})
test("sin cambios → parche vacío; fuera del cwd o sin repo → {skip}; parche enorme → truncated", async () => {
  const d = repo()
  assert.equal((await gitDiffFile(d, "a.py")).patch, "")
  assert.deepEqual(await gitDiffFile(d, "/etc/hosts"), { skip: "outside" })
  assert.deepEqual(await gitDiffFile(d, "a/../../etc/hosts"), { skip: "outside" })
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), "agy-nogit-")); fs.writeFileSync(path.join(plain, "f"), "1")
  assert.deepEqual(await gitDiffFile(plain, "f"), { skip: "no-git" })
  fs.writeFileSync(path.join(d, "a.py"), "y\n".repeat(150_000))
  const big = await gitDiffFile(d, "a.py"); assert.equal(big.truncated, true); assert.equal(big.patch.length, 200 * 1024)
})
