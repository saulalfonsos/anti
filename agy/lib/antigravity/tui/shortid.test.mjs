// lib/antigravity/tui/shortid.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { shortId, resolveConversation } from "./shortid.mjs"

test("shortId: 4 hex, 6 con colisión, 8 con doble colisión", () => {
  assert.equal(shortId("3f195a3f-3243"), "3f19")
  assert.equal(shortId("3f195a3f-3243", ["3f19aaaa-1"]), "3f195a")
  assert.equal(shortId("3f195a3f-3243", ["3f195aaa-1"]), "3f195a3f")
  assert.equal(shortId("3f195a3f-3243", ["3f195a3f-3243"]), "3f19")   // él mismo no cuenta
})
test("resolveConversation: exacto, prefijo único, ambiguo, inexistente, prefijo demasiado corto", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-sid-"))
  for (const c of ["3f195a3f-1111", "3f19bbbb-2222", "de2e6293-3333"]) fs.writeFileSync(path.join(dir, `${c}.events.jsonl`), "")
  fs.writeFileSync(path.join(dir, "aaaa0000-4444.json"), "{}")   // solo estado, sin eventos: también cuenta
  assert.deepEqual(resolveConversation("de2e6293-3333", dir), { cid: "de2e6293-3333" })
  assert.deepEqual(resolveConversation("de2e", dir), { cid: "de2e6293-3333" })
  assert.deepEqual(resolveConversation("aaaa", dir), { cid: "aaaa0000-4444" })
  assert.deepEqual(resolveConversation("3f19", dir), { ambiguous: ["3f195a3f-1111", "3f19bbbb-2222"] })
  assert.deepEqual(resolveConversation("3f195", dir), { cid: "3f195a3f-1111" })
  assert.deepEqual(resolveConversation("zzzz", dir), { missing: true })
  assert.deepEqual(resolveConversation("3f", dir), { missing: true })   // < 4 caracteres no se resuelve
})

test("resolveConversation: un id exacto que además es prefijo de otro es ambiguo, no ganador", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-sid-fantasma-"))
  // "3f19" existe (fantasma creado por una llamada con el id corto) y también "3f195a3f-…" (el real).
  fs.writeFileSync(path.join(dir, "3f19.events.jsonl"), "")
  fs.writeFileSync(path.join(dir, "3f195a3f-0000-4000-8000-000000000000.events.jsonl"), "")
  const r = resolveConversation("3f19", dir)
  assert.equal(r.cid, undefined, "no elige el fantasma en silencio")
  assert.deepEqual(r.ambiguous, ["3f19", "3f195a3f-0000-4000-8000-000000000000"])
  // Un id exacto que no es prefijo de nadie sigue resolviendo directo.
  assert.equal(resolveConversation("3f195a3f-0000-4000-8000-000000000000", dir).cid, "3f195a3f-0000-4000-8000-000000000000")
})
