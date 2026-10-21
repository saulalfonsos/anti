// El agy falso de los tests: agy-stub.mjs en macOS y Linux; en Windows, agy-stub.exe (compilado de agy-stub.mjs con
// `bun build --compile`), porque Windows solo lanza ejecutables, igual que el agy.exe de verdad.
import path from "node:path"
import { fileURLToPath } from "node:url"

export const STUB = path.join(path.dirname(fileURLToPath(import.meta.url)), process.platform === "win32" ? "agy-stub.exe" : "agy-stub.mjs")
