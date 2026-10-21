// Lector puro del TAP de `node --test --test-reporter=tap` (P13-c, D283). Solo extrae lo que `probar` necesita: los totales de
// nivel 0 y los fallos, cada uno con el nombre completo, su ubicación y su mensaje. El formato se leyó de salida REAL de node
// (v26.8.2, fixtures `test/fixtures/node-tap-*.txt`), no de la especificación de TAP:
//   - cada test lleva delante `# Subtest: nombre` y, detrás, `ok N - nombre` o `not ok N - nombre`, con un bloque YAML sangrado
//     dos espacios más entre `---` y `...`; los hijos van sangrados cuatro espacios y ANTES del `ok`/`not ok` de su padre;
//   - `location` y `failureType` son escalares; `error` es un escalar entre comillas (`util.inspect`: simples, dobles o de eco, o
//     `~`) o, si tiene saltos de línea, un bloque `|-` sangrado dos espacios más;
//   - un padre cuyos hijos fallan sale como `not ok` con `failureType: 'subtestsFailed'`: no es un fallo más, es el mismo;
//   - un `# tests`/`# pass`/`# fail`/`# cancelled` de nivel 0 cierra la salida; una salida cortada no los trae;
//   - un fichero que ni carga (módulo inexistente, error de sintaxis) sale como UN `not ok` con `exitCode` y el genérico
//     `error: 'test failed'`; lo que dice la causa es lo que el proceso escribió en stderr, que el reporter imprime ANTES, en
//     líneas `# …` en la columna 0 (la salida de los propios tests también, escapada: `# \# …`).
// PURO: una cadena entra y un resumen sale. Nunca lanza: lo que no reconoce, lo ignora.
export type TapFailure = { readonly name: string; readonly location?: string; readonly message: string }
export type TapSummary = {
  readonly tests?: number
  readonly pass?: number
  readonly fail?: number
  // Aparte de `fail` en node: un test que vence su tiempo o cuyo padre falla no es un `fail` pero tampoco pasó.
  readonly cancelled?: number
  readonly failures: readonly TapFailure[]
}

const SUBTEST = /^( *)# Subtest: (.*)$/
const POINT = /^( *)(not ok|ok) \d+(?: - (.*))?$/
const TOTAL = /^# (tests|pass|fail|cancelled) (\d+)$/
const DIAGNOSTIC = /^# ?(.*)$/
const DIRECTIVE = / # (TODO|SKIP)\b.*$/

export function parseTap(out: string): TapSummary {
  const lines = out.split("\n")
  const failures: TapFailure[] = []
  const totals = new Map<string, number>()
  // Los # Subtest que siguen abiertos (los de menor sangría que el test que se está leyendo son sus padres).
  const parents: { readonly indent: number; readonly name: string }[] = []
  // Lo que los procesos escribieron desde el último test: es el motivo de un fichero que ni cargó.
  const diagnostics: string[] = []

  lines.forEach((line, index) => {
    const subtest = SUBTEST.exec(line)
    if (subtest) {
      const indent = subtest[1].length
      while ((parents.at(-1)?.indent ?? -1) >= indent) parents.pop()
      parents.push({ indent, name: unescape(subtest[2]) })
      return
    }
    const total = TOTAL.exec(line)
    if (total) {
      totals.set(total[1], Number(total[2]))
      return
    }
    const point = POINT.exec(line)
    if (point) {
      const indent = point[1].length
      const failure = point[2] === "not ok" ? failureOf(lines, index, indent, point[3] ?? "", parents, diagnostics) : undefined
      if (failure) failures.push(failure)
      diagnostics.length = 0
      return
    }
    const diagnostic = DIAGNOSTIC.exec(line)
    if (diagnostic) diagnostics.push(unescape(diagnostic[1]))
  })

  return { tests: totals.get("tests"), pass: totals.get("pass"), fail: totals.get("fail"), cancelled: totals.get("cancelled"), failures }
}

// El fallo que describe un `not ok`, o nada si no es uno: un TODO (node no lo cuenta en `# fail`) o un padre que solo falla
// porque fallan sus hijos, que ya salen por su cuenta.
function failureOf(
  lines: readonly string[],
  index: number,
  indent: number,
  text: string,
  parents: readonly { readonly indent: number; readonly name: string }[],
  diagnostics: readonly string[],
): TapFailure | undefined {
  const yaml = block(lines, index, indent)
  const pad = " ".repeat(indent + 2)
  if (DIRECTIVE.exec(text)?.[1] === "TODO" || field(yaml, pad, "failureType") === "subtestsFailed") return undefined
  const own = unescape(text.replace(DIRECTIVE, "")).trim()
  const location = field(yaml, pad, "location")
  // Con `exitCode` el `not ok` es el del fichero entero y su `error` es el genérico: la causa está en lo escrito antes.
  const crashed = yaml.some((line) => line.startsWith(`${pad}exitCode:`))
  const message = crashed && diagnostics.length > 0 ? diagnostics.join("\n") : (field(yaml, pad, "error") ?? "")
  return {
    name: [...parents.filter((parent) => parent.indent < indent).map((parent) => parent.name), own === "" ? "(sin nombre)" : own].join(" > "),
    ...(location === undefined ? {} : { location }),
    message,
  }
}

// Las líneas del bloque YAML de un test (entre `---` y `...`, sin ellas). Una salida cortada puede no traer el `...`: entonces
// llega hasta donde la salida llegó, o hasta la primera línea de menor sangría.
function block(lines: readonly string[], index: number, indent: number): readonly string[] {
  const pad = " ".repeat(indent + 2)
  if (lines[index + 1] !== `${pad}---`) return []
  const rest = lines.slice(index + 2)
  const end = rest.findIndex((line) => line === `${pad}...` || (line.trim() !== "" && !line.startsWith(pad)))
  return end === -1 ? rest : rest.slice(0, end)
}

// El valor de una clave del bloque, sangrada exactamente `pad`: un escalar, o el texto de un `|-` sin su sangría.
function field(yaml: readonly string[], pad: string, key: string): string | undefined {
  const start = yaml.findIndex((line) => line.startsWith(`${pad}${key}:`))
  if (start === -1) return undefined
  const value = yaml[start].slice(pad.length + key.length + 1).trim()
  if (value !== "|-" && value !== "|") return unquote(value)
  const rest = yaml.slice(start + 1)
  // Las líneas en blanco del texto vienen con su sangría o sin ella: pertenecen al bloque hasta la siguiente clave.
  const stop = rest.findIndex((line) => line.trim() !== "" && !line.startsWith(`${pad}  `))
  return (stop === -1 ? rest : rest.slice(0, stop)).map((line) => line.slice(pad.length + 2)).join("\n")
}

// node imprime el valor de una sola línea con `util.inspect`: entre comillas simples, dobles o de eco según lo que lleve dentro,
// con `\\`, la comilla y `\t`/`\n` escapados; `~` es null. Lo demás (números) va tal cual.
function unquote(value: string): string | undefined {
  if (value === "~") return undefined
  const quoted = /^(['"`])(.*)\1$/.exec(value)
  if (!quoted) return value
  return quoted[2].replace(/\\([\\'"`nt])/g, (_, char: string) => (char === "n" ? "\n" : char === "t" ? "\t" : char))
}

// El reporter escapa `\` y `#` en los nombres de test y en lo que escriben los procesos.
const unescape = (text: string) => text.replace(/\\([\\#])/g, "$1")
