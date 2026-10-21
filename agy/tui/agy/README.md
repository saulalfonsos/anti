# agy — agentes Antigravity dentro de la TUI de OpenCode

Plugin de TUI que muestra, sin salir de OpenCode, los agentes Antigravity (Gemini) que Ling ha lanzado:
qué hay, en qué estado, y su conversación en vivo. Con `/btw` le preguntas a Ling qué está haciendo un
agente, en un panel lateral, **sin tocar la conversación real**.

Spec: `docs/superpowers/specs/2026-09-15-antigravity-tui-plugin-design.md`. Probado con OpenCode **1.18.31**
(si la tuya es más nueva verás un aviso una vez; si algo falla, desactívalo en `/plugins`).

## Activación

Los plugins de TUI se declaran en `tui.jsonc` (no en `opencode.jsonc`):

```jsonc
{ "plugin": ["./tui/agy/index.tsx"] }
```

`/btw` necesita además el agente `btw` en `opencode.jsonc` (prompt en `prompts/btw.md`, todos los permisos en
`deny`: solo lee el registro que le pasamos, no ejecuta ni edita nada). Si falta, el panel lo dice.

## Uso

| Dónde | Qué |
|---|---|
| Sidebar | Bloque **Agentes** de la sesión actual: `●` trabajando, `✓` hecho, `✗` fallo, `?` pregunta, `■` abortado |
| Barra inferior | Resumen corto cuando hay agentes activos |
| `/agentes` o `ctrl+x v` (líder + `v`) | Selector de agentes (esta sesión / otras) → Enter abre la vista |
| `/btw` | Un agente en marcha → entra directo con el panel btw abierto; varios → selector; ninguno → aviso |

### Vista del agente

Cabecera (capa, modelo, id corto `conv=…`, paso, tokens, tiempo), plan, llamadas a herramientas, diffs y
banners. Sigue en vivo el fichero de eventos.

| Tecla | Acción |
|---|---|
| `esc` / `q` | Volver a donde estabas |
| `←` / `→` | Agente anterior / siguiente de la misma sesión |
| `f` | Seguir el final (auto-scroll) |
| `t` | Mostrar/ocultar pensamiento |
| `d` | Mostrar/ocultar diffs |
| `o` | Abrir el visor web (agy-ui) |
| `b` | Abrir/cerrar el panel btw |
| `?` | Ayuda |

### Panel btw

- Un hilo por agente = una sesión hija de OpenCode con el agente `btw`. Ling recibe en cada pregunta el
  contexto vivo del agente (estado, plan, últimos eventos, diffs). La conversación del agente no cambia.
- Escribe y `enter`; puedes seguir preguntando sobre sus respuestas (multi-turno). Mientras Ling responde,
  `enter` avisa y conserva el borrador.
- `esc` suelta el input (vuelven las teclas de la vista); otro `b` o `esc` cierra el panel. El hilo se
  conserva: al reabrir ves lo que ya hablaste.
- En terminales de menos de 100 columnas el panel va debajo de la vista.

## Pruebas

```sh
node --test lib/antigravity/                                   # unitarios (lib/antigravity/tui/*)
python3 lib/antigravity/fixtures/tui-drive.py load|sidebar|select|view|btw   # TUI real por pty
```

`tui-drive.py` usa un repo, una caché y un `tui.jsonc` temporales (`octui-*`) con conversaciones fixture; no
toca tu configuración ni `~/.gemini`. El escenario `btw` hace una pregunta real a Ling (necesita red) e imprime
qué marcador vio (`▍` = respuesta en streaming); sin red, pasa igualmente mostrando el error en el panel.

## Estructura

- `index.tsx` — registro: ruta `agy`, slots (sidebar, barra), comandos y atajos.
- `store.tsx` — estado: tail de eventos por conversación + registro de agentes.
- `btw.tsx` — adaptador btw (sesión hija, `promptAsync`, reconstrucción desde `api.state`).
- `view/` — componentes (selector, vista, cabecera, plan, llamadas, diffs, panel btw, ayuda).
- Lógica pura y testada en `lib/antigravity/tui/` (tail, registry, shortid, btw-context, format).

Cualquier módulo que importe `solid-js` debe ser `.tsx`: el cargador de OpenCode solo transforma esos.
