// lib/antigravity/tui/btw-context.test.mjs — contexto en vivo que recibe Ling en cada pregunta /btw (spec §5.5).
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { reduce } from "../ui/render.mjs"
import { buildBtwContext, BTW_SYSTEM_HEADER } from "./btw-context.mjs"
const HERE = path.dirname(fileURLToPath(import.meta.url))
const SAMPLE = fs.readFileSync(path.join(HERE, "..", "fixtures", "events-sample.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))

test("buildBtwContext: secciones en orden, estado primero, plan con marcas, eventos acotados, diffs truncados", () => {
  const vm = reduce(SAMPLE)
  const ctx = buildBtwContext(vm, { maxEvents: 5, maxDiffLines: 3 })
  const order = ["ESTADO AHORA", "PLAN", "ÚLTIMOS EVENTOS", "DIFFS", "NOTAS"].map((s) => ctx.indexOf(`## ${s}`))
  assert.deepEqual([...order].sort((a, b) => a - b), order); assert.ok(order.every((i) => i >= 0))
  assert.match(ctx, /estado: (hecho|en marcha|fallo|pregunta|abortado)/)
  assert.match(ctx, /\[(✓|▶|○|\?|✗)\] 1\./)
  assert.ok((ctx.match(/^- \d\d:\d\d:\d\d /gm) ?? []).length <= 5)
  assert.match(ctx, /… \(\d+ líneas más\)/)
  assert.ok(ctx.length < 6000)
  assert.ok(BTW_SYSTEM_HEADER.includes("no ejecutas") || BTW_SYSTEM_HEADER.includes("No ejecutas"))
})
test("buildBtwContext: sin plan ni diffs no rompe", () => {
  const ctx = buildBtwContext(reduce(SAMPLE.slice(0, 2)))
  assert.match(ctx, /## PLAN\n\(sin plan todavía\)/); assert.match(ctx, /## DIFFS\n\(ninguno\)/)
})
