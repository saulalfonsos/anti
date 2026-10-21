import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { headEvent, tailEvents, parseLine } from "./events-file.mjs"

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agy-ef-"))
test("headEvent/tailEvents leen cabeza y cola; línea partida y JSON roto se ignoran", () => {
  const f = path.join(tmp, "a.events.jsonl")
  const lines = []
  for (let i = 0; i < 3000; i++) lines.push(JSON.stringify({ t: "2026-01-01T00:00:00.000Z", type: i === 0 ? "call_start" : "agy", i, pad: "x".repeat(40) }))
  lines.push("{roto")
  fs.writeFileSync(f, lines.join("\n") + "\n")
  assert.equal(headEvent(f).type, "call_start")
  const tail = tailEvents(f)
  assert.equal(tail.at(-1).i, 2999)
  assert.ok(tail.length > 100 && tail.length < 3000)
  assert.equal(parseLine("nope"), null)
})
