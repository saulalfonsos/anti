// lib/antigravity/state.test.mjs
import { test, beforeEach } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { loadConversation, saveConversation, bumpSessionPro, appendLog, gitChangedFiles, convPath, logPath, cacheDir, eventsPath, appendEvent, sessionFlag } from "./state.mjs"

let dir
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-state-"))
  process.env.ANTI_AGY_CACHE = dir
})

test("cacheDir respeta la variable de entorno", () => {
  assert.equal(cacheDir(), dir)
})
test("loadConversation sin fichero → estado vacío no corrupto; save/load hacen round-trip", () => {
  const s = loadConversation("c1")
  assert.equal(s.corrupt, false); assert.equal(s.pro, false); assert.deepEqual(s.plan, [])
  s.pro = true; s.plan = [{ layer: "fix", level: "normal", reason: "", instruction: "x" }]; s.next = 1; s.failures.verify = 2
  saveConversation("c1", s)
  const back = loadConversation("c1")
  assert.equal(back.pro, true); assert.equal(back.next, 1); assert.equal(back.failures.verify, 2); assert.equal(back.plan[0].layer, "fix")
  assert.equal(JSON.parse(fs.readFileSync(convPath("c1"), "utf8")).corrupt, undefined)
})
test("fichero corrupto → estado vacío con corrupt=true; ids con caracteres raros se sanean", () => {
  fs.writeFileSync(convPath("c2"), "{no json")
  const s = loadConversation("c2")
  assert.equal(s.corrupt, true); assert.equal(s.pro, false)
  assert.ok(convPath("../x/y").endsWith(path.join(dir, ".._x_y.json")))
})
test("fichero con forma inválida (JSON válido pero campos con el tipo equivocado) → también corrupt=true", () => {
  fs.writeFileSync(convPath("c4"), JSON.stringify({ plan: "nope", baseline_files: null }))
  const s = loadConversation("c4")
  assert.equal(s.corrupt, true)
  assert.deepEqual(s.plan, []); assert.deepEqual(s.baseline_files, [])
  assert.equal(s.pro, false); assert.equal(s.next, 0); assert.deepEqual(s.failures, { verify: 0, review: 0 })
})
test("bumpSessionPro acumula y 0 solo lee", () => {
  assert.equal(bumpSessionPro("s1", 1), 1)
  assert.equal(bumpSessionPro("s1", 1), 2)
  assert.equal(bumpSessionPro("s1", 0), 2)
  assert.equal(bumpSessionPro("s2", 0), 0)
})
test("appendLog añade líneas con hora", () => {
  appendLog("c3", "▶ implement")
  appendLog("c3", "🔧 run_command: ls")
  const lines = fs.readFileSync(logPath("c3"), "utf8").trim().split("\n")
  assert.equal(lines.length, 2)
  assert.match(lines[0], /^\d\d:\d\d:\d\d ▶ implement$/)
})
test("gitChangedFiles: rutas de git status --porcelain; sin repo → []", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "agy-git-"))
  execFileSync("git", ["-C", repo, "init", "-q"])
  fs.writeFileSync(path.join(repo, "a.txt"), "1")
  fs.mkdirSync(path.join(repo, "d")); fs.writeFileSync(path.join(repo, "d", "b.txt"), "2")
  assert.deepEqual(gitChangedFiles(repo).sort(), ["a.txt", "d/"])
  assert.deepEqual(gitChangedFiles(fs.mkdtempSync(path.join(os.tmpdir(), "agy-nogit-"))), [])
})
test("appendEvent escribe una línea JSON con t y cid; eventsPath en la caché", () => {
  appendEvent("c9", { type: "note", text: "hola" }); appendEvent("c9", { type: "call_end", status: "SUCCESS" })
  const lines = fs.readFileSync(eventsPath("c9"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
  assert.equal(lines.length, 2); assert.equal(lines[0].cid, "c9"); assert.equal(lines[0].type, "note")
  assert.match(lines[0].t, /^\d{4}-\d{2}-\d{2}T/); assert.equal(lines[1].status, "SUCCESS")
  assert.equal(eventsPath("a/b"), path.join(dir, "a_b.events.jsonl"))
})
test("sessionFlag lee/fija marcas sin pisar pro_calls, y bumpSessionPro conserva las marcas", () => {
  assert.equal(sessionFlag("s1", "ui_opened"), undefined)
  assert.equal(sessionFlag("s1", "ui_opened", true), undefined)
  assert.equal(sessionFlag("s1", "ui_opened"), true)
  assert.equal(bumpSessionPro("s1", 2), 2)
  assert.equal(sessionFlag("s1", "ui_opened"), true)
  assert.equal(bumpSessionPro("s1", 0), 2)
})
