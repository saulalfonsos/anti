import { NotFoundError as StorageNotFoundError } from "@/storage/storage"
import type { Session } from "@/session/session"
import { MessageV2 } from "@/session/message-v2"
import { Effect } from "effect"
import * as ApiError from "../errors"

// C-A1 (ronda 1, paquete O, punto 1): era `Effect.mapError` sin filtrar por tag — funcionaba porque hasta
// ahora todo llamador solo tenía `StorageNotFoundError` en su canal de error, pero un `mapError` sin filtro
// confunde CUALQUIER error posterior (p. ej. `MessageV2.DecodeError` ya traducido por `mapDecodeError`) con
// "no encontrado". `catchIf` con el `isInstance` que la propia clase ya expone deja pasar intacto
// cualquier otro error — mismo comportamiento observable para los llamadores existentes (su canal solo
// trae `StorageNotFoundError`) y correcto para los que traen más (`catchTag` no infiere bien aquí porque
// el segundo tipo de error es un genérico abierto, no una unión conocida en el sitio de la llamada).
export function mapStorageNotFound<A, E, R>(self: Effect.Effect<A, StorageNotFoundError | E, R>) {
  return self.pipe(
    Effect.catchIf(StorageNotFoundError.isInstance, (error) => Effect.fail(ApiError.notFound(error.message))),
  )
}

// C-A1 (ronda 1 de arreglos, paquete O, punto 1): `MessageV2.get` propaga `DecodeError` tipado cuando la
// fila de un mensaje no decodifica (ver `message-v2.ts`) — el único camino HTTP que lee UN mensaje por id
// (`GET /session/:id/message/:messageID`). Se traduce a un 500 `UnknownError` con la MISMA traza
// (`ref`/`sessionID`/`messageID`, ya logueada dentro de `infoEffect`) en vez de dejar que
// `mapStorageNotFound` la confunda con un 404.
export function mapDecodeError<A, E, R>(self: Effect.Effect<A, E | MessageV2.DecodeError, R>) {
  return self.pipe(
    Effect.catchIf(
      (error): error is MessageV2.DecodeError => error instanceof MessageV2.DecodeError,
      (error) => Effect.fail(new ApiError.UnknownError({ message: error.message, ref: error.ref })),
    ),
  )
}

export function mapBusy<A, R>(self: Effect.Effect<A, Session.BusyError, R>) {
  return self.pipe(
    Effect.catchTag("SessionBusyError", (error) =>
      Effect.fail(
        new ApiError.SessionBusyError({
          sessionID: error.sessionID,
          message: `Session is busy: ${error.sessionID}`,
        }),
      ),
    ),
  )
}
