// Del documento JSON Schema draft-2020-12 que produce Effect al dialecto plano que agy aceptó en
// tools/orchestrate.schema.json: sin $ref/$defs (se inlinean), sin allOf (se funde en el padre), NullOr como
// type: [x, "null"], tuplas homogéneas como items + minItems/maxItems, sin additionalProperties.
// Único sitio que cambia si agy rechaza alguna restricción.
import { Option, Schema } from "effect"

type Json = Record<string, unknown>
const DROP = ["additionalProperties", "$schema", "$id", "title", "$comment"]
const JsonObject = Schema.Record(Schema.String, Schema.Unknown)
const decodeDocument = Schema.decodeUnknownOption(Schema.Struct({ schema: JsonObject, definitions: Schema.optionalKey(Schema.Record(Schema.String, JsonObject)) }))

export function toPlainJsonSchema(schema: Schema.Top): Json {
  const document = Option.getOrUndefined(decodeDocument(Schema.toJsonSchemaDocument(schema)))
  if (!document) throw new Error("toPlainJsonSchema: documento JSON Schema inesperado")
  return plain(document.schema, document.definitions ?? {})
}

function plain(node: Json, defs: Record<string, Json>): Json {
  if (typeof node.$ref === "string") return plain(defs[node.$ref.replace("#/$defs/", "")] ?? {}, defs)
  const merged = mergeAllOf(node)
  const nullable = nullOr(merged)
  if (nullable) {
    const inner = plain(nullable, defs)
    return { ...without(merged, ["anyOf"]), ...inner, type: [inner.type, "null"] }
  }
  const out = without(merged, DROP)
  if (isRecord(out.properties)) out.properties = Object.fromEntries(Object.entries(out.properties).map(([k, v]) => [k, isRecord(v) ? plain(v, defs) : v]))
  if (isRecord(out.items)) out.items = plain(out.items, defs)
  if (Array.isArray(out.prefixItems)) {
    const items = out.prefixItems.filter(isRecord).map((p) => plain(p, defs))
    const first = JSON.stringify(items[0])
    if (items.every((p) => JSON.stringify(p) === first)) return { ...without(out, ["prefixItems"]), items: items[0] }
  }
  return out
}

// Las restricciones (.check) salen como entradas de allOf; el padre manda si repiten claves.
function mergeAllOf(node: Json): Json {
  if (!Array.isArray(node.allOf)) return node
  return { ...node.allOf.filter(isRecord).reduce<Json>((acc, part) => ({ ...acc, ...part }), {}), ...without(node, ["allOf"]) }
}

// anyOf: [X, { type: "null" }] → X marcado como anulable.
function nullOr(node: Json): Json | undefined {
  if (!Array.isArray(node.anyOf) || node.anyOf.length !== 2) return undefined
  const [a, b] = node.anyOf.filter(isRecord)
  return a && b && b.type === "null" && typeof a.type === "string" ? a : undefined
}

function without(node: Json, keys: readonly string[]): Json {
  return Object.fromEntries(Object.entries(node).filter(([k]) => !keys.includes(k)))
}

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
