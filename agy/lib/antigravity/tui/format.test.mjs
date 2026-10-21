import { test } from "node:test"
import assert from "node:assert/strict"
import { ago, elapsed, k } from "./format.mjs"
test("format: ago/elapsed/k", () => {
  const now = Date.parse("2026-01-01T00:10:00Z")
  assert.equal(ago("2026-01-01T00:09:48Z", now), "12s"); assert.equal(ago("2026-01-01T00:07:00Z", now), "3m"); assert.equal(ago("2025-12-31T22:00:00Z", now), "2h"); assert.equal(ago(null, now), "")
  assert.equal(elapsed("2026-01-01T00:00:00Z", "2026-01-01T00:00:25Z"), "25s"); assert.equal(elapsed("2026-01-01T00:00:00Z", "2026-01-01T00:02:05Z"), "2m05s")
  assert.equal(k(51154), "51k"); assert.equal(k(950), "950"); assert.equal(k(1_250_000), "1.3M")
})
test("format: k en el borde 999_500 pasa a millones (evita '1000k')", () => {
  assert.equal(k(999_499), "999k"); assert.equal(k(999_500), "1.0M"); assert.equal(k(999_999), "1.0M")
})
test("format: ago/elapsed con fecha ilegible devuelven '' (nunca 'NaNs')", () => {
  assert.equal(ago("no-es-una-fecha"), "")
  assert.equal(elapsed("no-es-una-fecha", null), "")
  assert.equal(elapsed("2026-01-01T00:00:00Z", "tampoco-esto"), "")
})
