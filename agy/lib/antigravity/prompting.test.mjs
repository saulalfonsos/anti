// lib/antigravity/prompting.test.mjs — el aviso de `anti-mcp abrir` en lo que recibe agy (D327).
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildPrompt, openerHint } from "./prompting.mjs"

test("openerHint: con el binario del paquete, con el .ts de desarrollo (vía bun) y sin servidor anti", () => {
  assert.match(openerHint({ anti_mcp: "/h/.anti/bin/anti-mcp" }, "darwin"), /`\/h\/\.anti\/bin\/anti-mcp abrir -- <command>`/)
  assert.match(openerHint({ anti_mcp: "/a b/anti-mcp.ts", anti_bun: "bun" }, "linux"), /`bun "\/a b\/anti-mcp\.ts" abrir -- <command>`/)
  assert.equal(openerHint({ anti_mcp: "" }), "")
  assert.match(openerHint({ anti_mcp: "C:\\t\\bin\\anti-mcp.exe" }, "win32"), /PowerShell, prefix that line with `& `/)
  assert.doesNotMatch(openerHint({ anti_mcp: "/x/anti-mcp" }, "darwin"), /PowerShell/)
})

test("buildPrompt: el aviso va en las capas que ejecutan órdenes, no en las de solo lectura", () => {
  const hint = openerHint({ anti_mcp: "/x/anti-mcp" }, "darwin")
  for (const layer of ["direct", "implement", "fix", "verify"]) assert.match(buildPrompt(layer, "haz algo", {}, [], hint), /abrir -- <command>/, layer)
  for (const layer of ["architect", "research", "review"]) assert.doesNotMatch(buildPrompt(layer, "mira algo", {}, [], hint), /abrir --/, layer)
  assert.doesNotMatch(buildPrompt("direct", "haz algo", {}, []), /abrir --/)
})
