// lib/antigravity/subagent.mjs — lo que hizo un subagente de agy (invoke_subagent), leído de su propia conversación (fase 15, D324).
// El stream de la tarea principal solo dice que el subagente empezó y acabó; sus pasos están en su base de agy
// (~/.gemini/antigravity-cli/conversations/<id>.db, tabla `steps`, que aquí solo se lee). Cada paso es un protobuf; los campos que se
// usan se averiguaron con una conversación real (fixtures/subagente-5050.json):
//   · tipo 101 (mensaje del padre): 114/4/3 id de la conversación que lo lanzó, 114/4/4 el encargo;
//   · tipo 15 (turno del modelo): 20/1 lo que dice, 20/3 lo que piensa (no se enseña);
//   · tipo 132 (herramienta): 5/4/2 nombre, 5/4/3 parámetros (JSON), 140/2/1 la salida que vio el modelo;
//   · en todos, 5/1/1 y 5/8/1 son los segundos de inicio y fin.
// Se convierte en los mismos eventos que el stream de la tarea principal, así que el chat lo pinta igual (render.mjs + AgyTool).

function varint(b, i) {
  let r = 0
  let s = 0
  for (;;) {
    if (i >= b.length) throw new Error("varint")
    const c = b[i++]
    r += (c & 0x7f) * 2 ** s
    s += 7
    if (c < 0x80) return [r, i]
  }
}

// Campos de un mensaje: [{f, v}] con v número o Buffer. Lanza si los bytes no son un mensaje.
function fields(b) {
  const out = []
  let i = 0
  while (i < b.length) {
    const [key, j] = varint(b, i)
    const f = Math.floor(key / 8)
    const w = key % 8
    if (f === 0) throw new Error("campo 0")
    if (w === 0) { const [v, k] = varint(b, j); out.push({ f, v }); i = k }
    else if (w === 1) { i = j + 8 }
    else if (w === 5) { i = j + 4 }
    else if (w === 2) {
      const [n, k] = varint(b, j)
      if (k + n > b.length) throw new Error("longitud")
      out.push({ f, v: b.subarray(k, k + n) })
      i = k + n
    } else throw new Error("tipo")
    if (i > b.length) throw new Error("fin")
  }
  return out
}

// El primer valor en la ruta (p. ej. [5, 4, 2]); undefined si no está o los bytes no se entienden.
function at(b, path) {
  let cur = b
  for (const [n, f] of path.entries()) {
    let fs
    try { fs = fields(cur) } catch { return undefined }
    const hit = fs.find((x) => x.f === f)
    if (!hit) return undefined
    if (n === path.length - 1) return hit.v
    if (!Buffer.isBuffer(hit.v)) return undefined
    cur = hit.v
  }
}
const text = (b, path) => {
  const v = at(b, path)
  return Buffer.isBuffer(v) ? v.toString("utf8") : undefined
}
const iso = (b, path) => {
  const v = at(b, path)
  return typeof v === "number" ? new Date(v * 1000).toISOString() : undefined
}

const PARENT = 101
const MODEL = 15
const TOOL = 132

// ¿Es la conversación de un subagente lanzado por `parent`? Con `prompt`, además, el encargo tiene que empezar igual (un mismo
// invoke_subagent puede lanzar varios).
export function matchesParent(head, parent, prompt) {
  if (!head || head.step_type !== PARENT) return false
  const payload = Buffer.from(head.payload ?? [])
  if (text(payload, [114, 4, 3]) !== parent) return false
  if (!prompt) return true
  const mine = (text(payload, [114, 4, 4]) ?? "").trim()
  const want = prompt.trim()
  return mine.startsWith(want.slice(0, 120)) || want.startsWith(mine.slice(0, 120))
}

// `run_command` guarda «The command exited with code N.\nOutput:\n…» con \r\n: queda la salida limpia, y el código si no es 0.
function cleanOutput(name, out) {
  const plain = String(out ?? "").replace(/\r\n?/g, "\n").replace(/^\n+/, "")
  if (name !== "run_command") return plain
  const m = /^The command exited with code (-?\d+)\.\n(?:Output:\n)?/.exec(plain)
  if (!m) return plain
  const rest = plain.slice(m[0].length)
  return m[1] === "0" ? rest : `${rest}${rest.endsWith("\n") || !rest ? "" : "\n"}(código de salida ${m[1]})`
}

export function decodeSubagent(rows, { cid, layer, model, session, cwd = "" }) {
  const sorted = [...rows].sort((a, b) => a.idx - b.idx).map((r) => ({ ...r, payload: Buffer.from(r.payload ?? []) }))
  const head = sorted.find((r) => r.step_type === PARENT)
  const parent = head ? text(head.payload, [114, 4, 3]) : undefined
  const instruction = head ? (text(head.payload, [114, 4, 4]) ?? "") : ""
  const start = (head && iso(head.payload, [5, 1, 1])) ?? new Date(0).toISOString()
  const events = [{ type: "call_start", call: 1, cid, layer, model, level: "normal", pro: false, step: null, session, cwd, instruction, t: start }]
  const step = (t, step_update) => events.push({ type: "agy", call: 1, t, ev: { event: "step_update", step_update } })
  let last = start
  let done = false
  for (const r of sorted) {
    const t = iso(r.payload, [5, 8, 1]) ?? iso(r.payload, [5, 1, 1]) ?? last
    last = t
    if (r.step_type === TOOL) {
      const name = text(r.payload, [5, 4, 2]) ?? "?"
      let parameters = {}
      try { parameters = JSON.parse(text(r.payload, [5, 4, 3]) ?? "{}") } catch { /* parámetros ilegibles: sin ellos */ }
      const output = cleanOutput(name, text(r.payload, [140, 2, 1]))
      step(iso(r.payload, [5, 1, 1]) ?? t, { step_index: r.idx, step_type: "tool", state: "ACTIVE", tool_info: { name, parameters } })
      step(t, { step_index: r.idx, step_type: "tool", state: "DONE", tool_info: { name, parameters, output } })
      done = false
    } else if (r.step_type === MODEL) {
      const said = text(r.payload, [20, 1])
      const calls = at(r.payload, [20, 7, 2])
      if (said?.trim()) step(t, { step_index: r.idx, step_type: "agent_response", state: "ACTIVE", text_delta: said })
      // Un turno del modelo que no pide ninguna herramienta es su respuesta final.
      done = calls === undefined
    }
  }
  if (done) events.push({ type: "call_end", call: 1, status: "SUCCESS", advanced: false, t: last })
  return { parent, instruction, done, events }
}
