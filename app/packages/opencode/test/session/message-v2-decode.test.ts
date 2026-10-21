// C-A1 (fase P10, ronda 1, paquete O): `message-v2.ts#info` usaba `decodeUnknownSync` — una sola fila
// vieja que no decodifica mataba (defecto) TODA lectura de la sesión, incluido el bucle de prompt
// (`MessageV2.filterCompactedEffect`, que arma el contexto que se manda al modelo). Este fichero fija en
// rojo el defecto real antes de implementar el arreglo: decodificar con efecto (`MessageV2.DecodeError`,
// mismo patrón que `Session.MessageDecodeError` en `packages/core/src/session/error.ts`) y decidir por
// llamador: lectura en lista (`hydrate`, de la que salen `page`/`stream`/`session.messages`, incluido el
// bucle de prompt) descarta la fila corrupta con traza (`ref`/`sessionID`/`messageID`) y sigue; lectura de
// UN mensaje por id (`MessageV2.get`, el único camino de `GET /session/:id/message/:messageID`) propaga el
// error tipado, que el borde HTTP traduce a un 500 `UnknownError` con la misma traza.
import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { MessageTable } from "@opencode-ai/core/session/sql"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Session } from "@/session/session"
import { MessageV2 } from "@/session/message-v2"
import { MessageID, SessionID } from "@/session/schema"
import { SessionPaths } from "@/server/routes/instance/httpapi/groups/session"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "../server/httpapi-layer"

const it = testEffect(Layer.mergeAll(LayerNode.compile(LayerNode.group([Session.node, Database.node])), httpApiLayer))

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

function pathFor(path: string, params: Record<string, string>) {
  return Object.entries(params).reduce((result, [key, value]) => result.replace(`:${key}`, value), path)
}

/** Escribe un mensaje válido y luego pisa `data` con un JSON que la fila real de una sesión vieja podría
 *  tener: bypassa `Schema` a propósito, igual que `httpapi-schema-error-body.test.ts#seedCorruptStepFinishPart`. */
const corrupt = Effect.fn("corrupt")(function* (sessionID: SessionID, data: Record<string, unknown>) {
  const session = yield* Session.Service
  const message = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "assistant",
    sessionID,
    parentID: MessageID.ascending(),
    time: { created: Date.now() },
    modelID: ModelV2.ID.make("test"),
    providerID: ProviderV2.ID.make("test"),
    mode: "build",
    agent: "build",
    path: { cwd: "/tmp", root: "/tmp" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  })
  const { db } = yield* Database.Service
  yield* db
    .update(MessageTable)
    .set({ data: data as never })
    .where(eq(MessageTable.id, message.id))
    .run()
    .pipe(Effect.orDie)
  return message.id
})

const goodMessage = Effect.fn("goodMessage")(function* (sessionID: SessionID) {
  const session = yield* Session.Service
  return yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
    time: { created: Date.now() },
  })
})

describe("MessageV2 decode failures (C-A1)", () => {
  it.instance(
    "una fila con cost:null, error fuera de la union y sin agent no mata la lista, y las buenas sobreviven",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        void test
        const session = yield* Session.Service
        const info = yield* session.create({})
        const good1 = yield* goodMessage(info.id)
        const costNull = yield* corrupt(info.id, {
          role: "assistant",
          time: { created: Date.now() },
          parentID: good1.id,
          modelID: "test",
          providerID: "test",
          mode: "build",
          agent: "build",
          path: { cwd: "/tmp", root: "/tmp" },
          cost: null,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        })
        const errorOutsideUnion = yield* corrupt(info.id, {
          role: "assistant",
          time: { created: Date.now() },
          parentID: good1.id,
          modelID: "test",
          providerID: "test",
          mode: "build",
          agent: "build",
          path: { cwd: "/tmp", root: "/tmp" },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          error: { name: "SomeRetiredErrorFromBeforeR1", message: "legacy" },
        })
        const missingAgent = yield* corrupt(info.id, {
          role: "assistant",
          time: { created: Date.now() },
          parentID: good1.id,
          modelID: "test",
          providerID: "test",
          mode: "build",
          path: { cwd: "/tmp", root: "/tmp" },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        })
        const good2 = yield* goodMessage(info.id)

        // ANTES del arreglo: esto muere con un defecto (`decodeUnknownSync` sin capturar) en cuanto
        // `hydrate` procesa la primera fila corrupta, y las dos buenas nunca se ven.
        const messages = yield* session.messages({ sessionID: info.id })
        const ids = messages.map((m) => m.info.id)
        expect(ids).toContain(good1.id)
        expect(ids).toContain(good2.id)
        expect(ids).not.toContain(costNull)
        expect(ids).not.toContain(errorOutsideUnion)
        expect(ids).not.toContain(missingAgent)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "el bucle de prompt (filterCompactedEffect) no muere con una fila corrupta de por medio",
    () =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const info = yield* session.create({})
        const good1 = yield* goodMessage(info.id)
        yield* corrupt(info.id, {
          role: "assistant",
          time: { created: Date.now() },
          parentID: good1.id,
          modelID: "test",
          providerID: "test",
          mode: "build",
          path: { cwd: "/tmp", root: "/tmp" },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        })

        const msgs = yield* MessageV2.filterCompactedEffect(info.id).pipe(Effect.provideService(Database.Service, yield* Database.Service))
        expect(msgs.some((m) => m.info.id === good1.id)).toBe(true)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "MessageV2.get sobre UN mensaje corrupto falla tipado, no con un defecto opaco",
    () =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const info = yield* session.create({})
        const good1 = yield* goodMessage(info.id)
        const messageID = yield* corrupt(info.id, {
          role: "assistant",
          time: { created: Date.now() },
          parentID: good1.id,
          modelID: "test",
          providerID: "test",
          mode: "build",
          path: { cwd: "/tmp", root: "/tmp" },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        })

        const error = yield* MessageV2.get({ sessionID: info.id, messageID }).pipe(
          Effect.provideService(Database.Service, yield* Database.Service),
          Effect.flip,
        )
        expect(error._tag).toBe("MessageV2.DecodeError")
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "GET /session/:id/message/:messageID de un mensaje corrupto devuelve 500 UnknownError con ref",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const session = yield* Session.Service
        const info = yield* session.create({})
        const good1 = yield* goodMessage(info.id)
        const messageID = yield* corrupt(info.id, {
          role: "assistant",
          time: { created: Date.now() },
          parentID: good1.id,
          modelID: "test",
          providerID: "test",
          mode: "build",
          path: { cwd: "/tmp", root: "/tmp" },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        })

        const response = yield* requestInDirectory(
          pathFor(SessionPaths.message, { sessionID: info.id, messageID }),
          test.directory,
        )
        expect(response.status).toBe(500)
        const body = yield* response.text
        const parsed = JSON.parse(body)
        expect(parsed._tag).toBe("UnknownError")
        expect(parsed.ref).toBe("message-v2#info")
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "decodificar y volver a codificar una fila con una clave desconocida NO la conserva hoy (documentado, D167-adyacente)",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        void test
        const session = yield* Session.Service
        const info = yield* session.create({})
        const good1 = yield* goodMessage(info.id)
        const messageID = yield* corrupt(info.id, {
          role: "assistant",
          time: { created: Date.now() },
          parentID: good1.id,
          modelID: "test",
          providerID: "test",
          mode: "build",
          agent: "build",
          path: { cwd: "/tmp", root: "/tmp" },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          // clave que una build futura del núcleo escribiría y esta build aún no conoce
          futureField: "written-by-a-newer-opencode",
        })

        const { db } = yield* Database.Service
        const row = yield* db.select().from(MessageTable).where(eq(MessageTable.id, messageID)).get().pipe(Effect.orDie)
        expect(row?.data).toMatchObject({ futureField: "written-by-a-newer-opencode" })

        const decoded = yield* Schema.decodeUnknownEffect(SessionV1.Info)({
          ...row!.data,
          id: row!.id,
          sessionID: row!.session_id,
        })
        const reencoded = yield* Schema.encodeEffect(SessionV1.Info)(decoded)
        // Justificación (informe P10 ronda1 paquete O, punto 1): `Schema.Struct` no conserva propiedades
        // que no declara, así que un `updateMessage(target.info)` sobre un mensaje decodificado (patrón
        // real de `session/summary.ts#summarize`) SÍ pierde una clave desconocida al reescribir. Arreglarlo
        // exigiría que `updateMessage` fusionara el JSON crudo original en vez de partir del `Info`
        // decodificado, un cambio de forma de `Session.Service` fuera del alcance de C-A1 (que es sobre el
        // defecto síncrono, no sobre preservación de esquema hacia adelante). Se deja consignado y en rojo
        // aquí en vez de silenciado.
        expect((reencoded as Record<string, unknown>).futureField).toBeUndefined()
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})
