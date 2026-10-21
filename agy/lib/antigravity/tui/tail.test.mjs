import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createTailer } from "./tail.mjs"

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agy-tail-"))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const line = (o) => JSON.stringify(o) + "\n"

test("tailer: entrega lo existente al crear, luego lo nuevo; retiene línea parcial; ignora JSON roto", async () => {
  const f = path.join(tmp, "t1.jsonl")
  fs.writeFileSync(f, line({ type: "call_start", call: 1 }) + line({ type: "agy", n: 1 }))
  const got = []
  const t = createTailer(f, (evs) => got.push(...evs), { intervalMs: 20 })
  assert.equal(got.length, 2)
  fs.appendFileSync(f, '{"type":"agy","n":2}\n{"type":"ag')   // segunda línea partida
  await sleep(80)
  assert.equal(got.length, 3)
  fs.appendFileSync(f, 'y","n":3}\n{roto}\n' + line({ type: "call_end", call: 1 }))
  await sleep(80)
  assert.deepEqual(got.map((e) => e.type), ["call_start", "agy", "agy", "agy", "call_end"])
  t.stop()
})
test("tailer: multibyte partido entre lecturas llega intacto", async () => {
  const f = path.join(tmp, "t2.jsonl"); fs.writeFileSync(f, "")
  const got = []
  const t = createTailer(f, (evs) => got.push(...evs), { intervalMs: 20 })
  const buf = Buffer.from(line({ type: "note", text: "ñ€😀" }))
  fs.appendFileSync(f, buf.subarray(0, 12)); await sleep(60)
  fs.appendFileSync(f, buf.subarray(12)); await sleep(60)
  assert.equal(got[0].text, "ñ€😀")
  t.stop()
})
test("tailer: fichero grande al abrir → arranca en size-maxInitialBytes y marca truncated", async () => {
  const f = path.join(tmp, "t3.jsonl")
  fs.writeFileSync(f, Array.from({ length: 500 }, (_, i) => line({ type: "agy", i })).join(""))
  const got = []; let flag = null
  const t = createTailer(f, (evs, meta) => { got.push(...evs); flag = meta.truncated }, { intervalMs: 20, maxInitialBytes: 2000 })
  assert.equal(flag, true); assert.ok(got.length < 500 && got.length > 0); assert.equal(got.at(-1).i, 499)
  t.stop()
})
test("tailer: fichero inexistente al crear → sin error, aparece después", async () => {
  const f = path.join(tmp, "t4.jsonl")
  const got = []
  const t = createTailer(f, (evs) => got.push(...evs), { intervalMs: 20 })
  await sleep(40); fs.writeFileSync(f, line({ type: "call_start" })); await sleep(80)
  assert.equal(got.length, 1); t.stop()
})
test("tailer: stop() detiene el temporizador (no quedan handles)", async () => {
  const f = path.join(tmp, "t5.jsonl"); fs.writeFileSync(f, "")
  const t = createTailer(f, () => {}, { intervalMs: 20 }); t.stop()
  fs.appendFileSync(f, line({ type: "agy" })); await sleep(60)
  assert.equal(t.offset, 0)
})
test("tailer: si onEvents lanza en el primer lote, el tailer sigue vivo y entrega lo siguiente", async () => {
  const f = path.join(tmp, "t6.jsonl")
  fs.writeFileSync(f, line({ type: "call_start" }))
  const got = []
  let calls = 0
  const t = createTailer(f, (evs) => { calls++; if (calls === 1) throw new Error("boom"); got.push(...evs) }, { intervalMs: 20 })
  fs.appendFileSync(f, line({ type: "call_end" }))
  await sleep(80)
  assert.deepEqual(got.map((e) => e.type), ["call_end"])
  t.stop()
})
test("tailer: apertura truncada cuyo primer trozo no trae '\\n' → dropFirst no se pierde; la línea en curso se descarta aunque acabe siendo JSON válido", async () => {
  const f = path.join(tmp, "t7.jsonl")
  const prior = line({ type: "agy", i: 1 })   // línea previa completa, solo para que la truncada no empiece en offset 0
  const partial = '{"type":"agy","i":999'     // línea en curso de escritura: sin '}' ni '\n' todavía
  fs.writeFileSync(f, prior + partial)
  const got = []
  // maxInitialBytes = longitud exacta de `partial` → offset cae justo al principio de esa línea sin terminar:
  // el primer trozo leído no contiene ningún '\n'.
  const t = createTailer(f, (evs) => got.push(...evs), { intervalMs: 20, maxInitialBytes: partial.length })
  assert.equal(got.length, 0)   // cae entera dentro de la línea sin terminar: nada que entregar todavía
  fs.appendFileSync(f, '}\n')   // se completa ESA MISMA línea (la truncada) con JSON por lo demás válido
  await sleep(80)
  assert.equal(got.length, 0)   // sigue siendo "la primera tras el truncado": se descarta pase lo que pase
  fs.appendFileSync(f, line({ type: "agy", i: 1000 }))   // esta sí es una línea nueva y legítima
  await sleep(80)
  assert.deepEqual(got.map((e) => e.i), [1000])
  t.stop()
})

test("tailer: si el fichero se recrea por fuera, el siguiente lote llega con meta.reset", async () => {
  const file = path.join(tmp, "reset.events.jsonl")
  fs.writeFileSync(file, line({ t: 1, type: "note", text: "a" }) + line({ t: 2, type: "note", text: "b" }))
  const batches = []
  const t = createTailer(file, (events, meta) => batches.push({ n: events.length, reset: !!meta.reset }), { intervalMs: 20 })
  await sleep(60)
  assert.deepEqual(batches, [{ n: 2, reset: false }], "entrega inicial, sin reset")
  fs.writeFileSync(file, line({ t: 3, type: "note", text: "c" }))   // más corto que el anterior: truncado externo
  await sleep(80)
  t.stop()
  assert.deepEqual(batches.slice(1), [{ n: 1, reset: true }], "tras el truncado, el lote avisa de que hay que reiniciar lo acumulado")
})
