// lib/antigravity/ui/brain.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { readThinking, transcriptPath } from "./brain.mjs"

test("readThinking: solo líneas con thinking, step_index > after; errores → []", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-brain-")); process.env.AGY_BRAIN_DIR = dir
  const f = transcriptPath("c1"); fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, [
    JSON.stringify({ step_index: 0, type: "USER_INPUT", content: "hola", created_at: "2026-09-14T10:00:00Z" }),
    JSON.stringify({ step_index: 1, type: "PLANNER_RESPONSE", thinking: "**Plan**\nleo", created_at: "2026-09-14T10:00:01Z" }),
    "esto no es json",
    JSON.stringify({ step_index: 3, type: "PLANNER_RESPONSE", thinking: "   " }),
    JSON.stringify({ step_index: 4, type: "PLANNER_RESPONSE", thinking: "ejecuto", created_at: "2026-09-14T10:00:04Z" }),
  ].join("\n") + "\n")
  assert.deepEqual(readThinking("c1", -1), [{ step_index: 1, t: "2026-09-14T10:00:01Z", thinking: "**Plan**\nleo" }, { step_index: 4, t: "2026-09-14T10:00:04Z", thinking: "ejecuto" }])
  assert.deepEqual(readThinking("c1", 1).map((x) => x.step_index), [4])
  assert.deepEqual(readThinking("no-existe", -1), [])
  assert.equal(transcriptPath("c1"), path.join(dir, "c1", ".system_generated", "logs", "transcript_full.jsonl"))
})
