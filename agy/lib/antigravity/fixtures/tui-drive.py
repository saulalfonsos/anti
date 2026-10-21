#!/usr/bin/env python3
# lib/antigravity/fixtures/tui-drive.py — conduce la TUI REAL de OpenCode por un pseudo-terminal y comprueba
# texto en pantalla. Uso: python3 tui-drive.py [--keep] [escenario]  (escenarios: load, sidebar, select, view, btw)
# Usa un repo temporal, una caché temporal con DOS conversaciones fixture (demo-1: events-sample.jsonl,
# multi-llamada orchestrate→implement→verify; demo-2: events-sample-2.jsonl, una sola llamada "review" — fix
# round 1, item 1: sin una segunda conversación no hay forma de comprobar de verdad que ←/→ remonta la vista
# en vez de quedarse pegada al primer cid) y un tui.jsonc temporal vía OPENCODE_TUI_CONFIG.
import fcntl, os, pty, re, select, shutil, struct, subprocess, sys, tempfile, termios, time, json

HERE = os.path.dirname(os.path.abspath(__file__))
CFG = os.path.abspath(os.path.join(HERE, "..", "..", ".."))          # ~/.config/opencode
ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[=>]|\x1b\[[0-9 ]*q|\x1bP.*?\x1b\\")

class Tui:
    def __init__(self, cwd, env):
        self.buf = b""
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            os.environ.update(env); os.environ["TERM"] = "xterm-256color"; os.environ["COLUMNS"] = "140"; os.environ["LINES"] = "45"
            os.chdir(cwd); os.execvp("opencode", ["opencode"])
    def read(self, seconds):
        end = time.time() + seconds
        while time.time() < end:
            r, _, _ = select.select([self.fd], [], [], 0.2)
            if r:
                try: self.buf += os.read(self.fd, 65536)
                except OSError: return
    def screen(self):
        t = ANSI.sub("", self.buf.decode("utf8", "replace")); return re.sub(r"\s+", " ", t)
    def type(self, s, wait=1.0): os.write(self.fd, s.encode()); self.read(wait)
    def key(self, b, wait=1.0): os.write(self.fd, b); self.read(wait)
    def wait_for(self, needle, timeout=20):
        end = time.time() + timeout
        while time.time() < end:
            self.read(0.5)
            if needle in self.screen(): return True
        return False
    def wait_for_any(self, needles, timeout=20):
        # Devuelve la aguja que ha hecho match (o None si agota el timeout) — no solo True/False: así el
        # llamador puede DEJAR CONSTANCIA de qué rama ocurrió (respuesta real vs error) en vez de
        # esconderlo detrás de un booleano (fix round 1, I2).
        end = time.time() + timeout
        while time.time() < end:
            self.read(0.5)
            s = self.screen()
            for n in needles:
                if n in s: return n
        return None
    def repaint(self, settle=2.0):
        # opentui solo retransmite las CELDAS QUE CAMBIAN: si algo se pintó antes de vaciar el buffer, no
        # vuelve a enviarse y wait_for() da un falso rojo. Cambiar el tamaño de la ventana (SIGWINCH) fuerza
        # un repintado completo, así que screen() pasa a contener el frame entero.
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", 44, 139, 0, 0)); self.read(1.2)
        self.buf = b""
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", 45, 140, 0, 0)); self.read(settle)
        return self.screen()
    def close(self):
        try: os.kill(self.pid, 15)
        except ProcessLookupError: pass
        self.read(1)

def check(cond, msg):
    print(("OK   " if cond else "FAIL ") + msg)
    if not cond: sys.exit(1)

def main():
    keep = "--keep" in sys.argv
    scenario = next((a for a in sys.argv[1:] if not a.startswith("--")), "load")
    tmp = tempfile.mkdtemp(prefix="octui-")  # NO empezar por "agy": el pie de la TUI muestra el cwd y "agy" en el
    # propio prefijo del directorio temporal falsea la comprobación "el plugin agy se ha cargado" de más abajo
    repo = os.path.join(tmp, "repo"); os.makedirs(repo)
    subprocess.run(["git", "init", "-q", repo], check=True)
    cache = os.path.join(tmp, "cache"); os.makedirs(cache)
    demo1 = os.path.join(cache, "demo-1.events.jsonl")
    demo2 = os.path.join(cache, "demo-2.events.jsonl")
    shutil.copy(os.path.join(HERE, "events-sample.jsonl"), demo1)
    shutil.copy(os.path.join(HERE, "events-sample-2.jsonl"), demo2)
    # listAgents (registry.mjs) ordena por mtime descendente: mtimes explícitos (no el orden de copia, que
    # podría caer en el mismo tick de reloj) garantizan que demo-1 sale primero en el selector/siblings — así
    # el resto del script (qué fila selecciona el primer <enter>, qué es "next" desde ahí) es determinista.
    now = time.time()
    os.utime(demo2, (now - 60, now - 60))
    os.utime(demo1, (now, now))
    tuicfg = os.path.join(tmp, "tui.jsonc")
    with open(tuicfg, "w") as f: json.dump({"$schema": "https://opencode.ai/tui.json", "plugin": [os.path.join(CFG, "tui", "agy", "index.tsx")]}, f)
    # El pensamiento del modelo NO está en el fichero de eventos: agy lo escribe en su transcript interno
    # (brain/<cid>/.system_generated/logs/transcript_full.jsonl) y el plugin lo lee con readThinking().
    # AGY_BRAIN_DIR permite plantar uno falso sin tocar ~/.gemini.
    brain = os.path.join(tmp, "brain", "demo-1", ".system_generated", "logs")
    os.makedirs(brain)
    with open(os.path.join(brain, "transcript_full.jsonl"), "w") as f:
        f.write(json.dumps({"step_index": 1, "created_at": "2026-09-16T10:00:00Z", "thinking": "PENSAMIENTO-FIXTURE: repaso el plan"}) + "\n")
    env = {"OPENCODE_TUI_CONFIG": tuicfg, "ANTI_AGY_CACHE": cache, "AGY_UI": "0", "AGY_BRAIN_DIR": os.path.join(tmp, "brain")}
    t = Tui(repo, env)
    try:
        check(t.wait_for("Ask anything", 25), "la TUI arranca")
        # Marca específica de carga: el título exacto del comando en la paleta (ctrl+p), no una subcadena
        # "agy" que también aparecería por casualidad en, p. ej., el propio directorio temporal.
        t.key(b"\x10", 1.0); t.type("Antigrav", 1.0)
        check(t.wait_for("Antigravity: agentes", 5), "el plugin agy se ha cargado (comando en la paleta)")
        t.key(b"\x1b", 1.0)
        if scenario in ("select", "view", "btw", "sidebar"):
            t.type("/agentes"); t.key(b"\r", 2)
            # El diálogo real (no un toast: el toast antiguo "agentes: N en esta sesión, M otras" nunca
            # contiene "demo"): la fila de demo-1 lleva short="demo" (shortId de un único cid "demo-1" → 4
            # caracteres) en su título "icono layer · short".
            check(t.wait_for("demo", 5), "el selector lista la conversación demo-1")
        if scenario == "select":
            # Regresión (verificación manual T11): el atajo del selector. "ctrl+x g" NO era una secuencia
            # válida de @opentui/keymap (la sintaxis es "<leader>g") y además <leader>g ya es
            # `session_timeline` del host: el atajo que anunciaba la barra no abría nada y la 'g' se escribía
            # en el prompt. Se comprueba con el diálogo real, y t.buf se vacía antes para que el match sea del
            # repintado nuevo y no del diálogo que abrió "/agentes" más arriba.
            t.key(b"\x1b", 1)
            t.buf = b""
            t.key(b"\x18", 0.8); t.key(b"v", 1.5)
            check(t.wait_for("Agentes Antigravity", 5), "el atajo del selector (líder+v) abre el diálogo")
        if scenario == "sidebar":
            # Este escenario nunca crea una sesión real (no se envía ningún mensaje), así que store.sessionID()
            # es undefined y store.agents().mine queda vacío por construcción (ver listAgents: sin sessionID no
            # hay "mine") — esta comprobación NO prueba el filtrado por sesión de rowsForSession(), que es lo
            # que de verdad decide qué agentes son "propios" del sidebar/barra: ese filtro está probado por
            # separado en registry.test.mjs y su verificación end-to-end (con una sesión real) queda para la
            # verificación manual, Task 11.
            check("agy:" not in t.screen(), "sin sesión abierta la barra de agentes no aparece (el filtro por sesión se valida en la verificación manual, Task 11)")
        if scenario in ("view", "btw"):
            t.key(b"\r", 3)
            # Fix round 1, item 9: la cabecera muestra la capa de la ÚLTIMA llamada (lo que summarize()
            # realmente calcula, comprobado aparte con node -e), no la primera — para demo-1 eso es
            # "verify" (llamada 3, sin call_end, todavía en marcha) — más el id corto completo (demo-1: con
            # dos conversaciones "demo-*" en caché, shortId ya no puede resolver con solo 4 caracteres).
            check(t.wait_for("verify", 5), "la vista muestra la cabecera de la conversación (capa 'verify', la de la última llamada)")
            check("demo-1" in t.screen(), "la cabecera muestra el id corto (demo-1, tras resolver la colisión con demo-2)")
            check("plan" in t.screen().lower(), "la vista muestra el plan")
            check("counter.py" in t.screen(), "la vista muestra un diff/herramienta sobre counter.py")
        if scenario == "view":
            # El pensamiento vive fuera del fichero de eventos (ver AGY_BRAIN_DIR arriba): con la tecla "t"
            # apagada se ve el marcador colapsado, y al pulsarla aparece el texto del transcript. Si el store
            # no leyera el transcript, no habría ni marcador (era el caso antes de la revisión final, I1).
            check("pensamiento (t para ver)" in t.repaint(), "el pensamiento del transcript llega a la vista (marcador colapsado)")
            t.key(b"t", 2)
            check("PENSAMIENTO-FIXTURE" in t.repaint(), "la tecla t despliega el texto real del pensamiento")
            t.key(b"t", 1)   # se deja como estaba (la preferencia se guarda en api.kv)
            # Fix round 1, item 1 (CRÍTICO): demo-1 es la primera fila de la lista (mtime más reciente, ver
            # arriba) así que "siguiente" es demo-2 ("review", una sola llamada) — si la vista no remontara
            # de verdad al cambiar de cid (el bug que este fix corrige: el host reconcilia la misma ruta
            # "agy" en vez de re-invocar render()), la cabecera se quedaría clavada en "verify" para siempre.
            # t.buf se vacía antes de cada tecla porque screen() acumula TODO lo pintado desde que arrancó
            # el proceso: sin vaciar, "verify" (ya en pantalla desde el <enter> de más arriba) seguiría
            # "encontrándose" aunque ← no hiciera nada — el check no probaría lo que dice probar.
            t.key(b"\x1b[C", 2)  # flecha derecha
            # repaint() en vez de vaciar el buffer y esperar: con el frame completo delante, "review" y
            # "demo-2" se comprueban sobre el MISMO estado de pantalla (vaciar el buffer solo deja lo que se
            # repinte después, que puede ser media cabecera).
            s2 = t.repaint()
            check("review" in s2, "→ remonta la vista en el agente siguiente (demo-2, capa 'review')")
            check("demo-2" in s2, "la cabecera del agente siguiente muestra su propio id corto")
            t.key(b"\x1b[D", 2)  # flecha izquierda
            s1 = t.repaint()
            check("verify" in s1, "← remonta de vuelta al agente anterior (demo-1, capa 'verify')")
            check("counter.py" in s1, "el agente anterior vuelve a traer su propio contenido (counter.py de demo-1)")
        if scenario == "btw":
            # t.buf se vacía antes: "btw" ya está en pantalla desde antes (paleta "/agentes" con el comando
            # "Antigravity: btw", y la propia cabecera trae "btw {n} [b]" siempre) — sin vaciar, wait_for("btw")
            # sería un falso verde (comprobado: pasa incluso sin implementar el panel — ver informe de la
            # tarea). El marcador real de que el panel se ha montado es su propio texto ("Ling sobre este
            # agente"), que solo BtwPanel pinta.
            t.key(b"b", 2)
            # repaint(): el frame completo evita tanto el falso verde (texto viejo en el buffer) como el
            # falso rojo (opentui no retransmite lo que no cambia).
            sp = t.repaint()
            check("Ling sobre este agente" in sp, "el panel btw se abre")
            check("pregunta sobre este agente" in sp, "el panel btw muestra su input (placeholder)")
            t.type("¿qué está haciendo?")
            check("¿qué está haciendo?" in t.screen(), "el texto escrito llega al input del panel")
            t.key(b"\r", 2)
            check(t.wait_for("tú: ¿qué está haciendo?", 5), "la pregunta se añade al historial del panel")
            # El contador "btw N" de la cabecera: era un número plano (sin señal), así que el texto se
            # quedaba congelado en "btw 0" para siempre (M1 de la revisión final).
            check("btw 1" in t.repaint(), "la cabecera cuenta la pregunta (btw 1)")
            # Respuesta real de Ling (necesita red + cuota free de OpenRouter) o, sin red, la línea de error en
            # rojo (btw.tsx: describeError()) — cualquiera de las dos confirma que ask() llegó al servidor;
            # informativo (con "or True") porque este escenario debe pasar también sin red. Fix round 1, I2:
            # se imprime qué aguja hizo match (o ninguna) para que quede constancia en el log de qué rama
            # ocurrió, no solo un booleano ciego.
            # opentui solo retransmite las celdas que cambian: "ling: …" → "ling: <texto>" no reenvía "l", así que
            # "ling: " casi nunca aparece entero en el buffer crudo. "▍" (cursor de streaming) sí es texto nuevo.
            replied = t.wait_for_any(["▍", "ing: El", "ing: ", "Falta el agente btw", "network error", "sin respuesta"], 70)
            print("btw: comprobación de respuesta — marcador:", repr(replied) if replied else "ninguno (timeout, informativo)")
            check(replied is not None or True, "pregunta enviada — respuesta real de Ling o error visible (comprobación informativa)")
            # Fix round 1, I2: la comprobación anterior ("esc suelta el foco pero NO cierra el panel") era
            # hueca — no vaciaba t.buf antes del <esc>, así que "Ling sobre este agente" ya estaba en pantalla
            # desde que se abrió el panel más arriba y el check habría dado verde aunque esc SÍ cerrara el
            # panel de verdad (mismo defecto, documentado, que ya se corrigió para el escenario "view").
            #
            # Fix intentado con vaciar el buffer y esperar a que "Ling sobre este agente" se REPINTA: falso
            # rojo, no falso verde — opentui (como la mayoría de renderers de terminal) solo retransmite las
            # celdas que cambian; blurToView() no toca esa línea (es texto estático), así que tras vaciar el
            # buffer nunca vuelve a emitirse aunque el panel siga perfectamente abierto (comprobado: falla
            # sistemáticamente con el código correcto). Sustituido por una comprobación que SÍ fuerza un
            # cambio real de contenido: tras el primer esc (blur, sin cerrar), "b" debería volver a estar en
            # la capa agy.view (la capa "agy.btw.input" se sacó de la pila al soltar el foco) y CERRAR el
            # panel de verdad — si el primer esc hubiera cerrado la vista en vez de solo soltar el foco,
            # "Ask anything" ya estaría en pantalla aquí; si esc no hubiera soltado el modo "agy.btw.input"
            # (bug de fuga de modo, ver I4a), "b" se escribiría como texto en el input en vez de cerrar nada,
            # y "Ling sobre este agente" seguiría en pantalla tras vaciar el buffer y pulsar "b".
            t.buf = b""
            t.key(b"\x1b", 2)
            check("Ask anything" not in t.screen(), "esc (1) no cierra el panel — no ha vuelto al hilo todavía")
            t.buf = b""
            t.key(b"b", 2)
            check("Ling sobre este agente" not in t.screen(), "tras esc (1), 'b' vuelve a estar en la capa de la vista y cierra el panel de verdad (prueba que esc soltó el modo agy.btw.input)")
        if scenario in ("view", "btw"):
            t.key(b"\x1b", 2)
            check("Ask anything" in t.screen() or t.wait_for("Ask anything", 5), "esc vuelve al hilo")
        print("PASS", scenario)
    finally:
        t.close()
        if keep: print("tmp:", tmp)
        else: shutil.rmtree(tmp, ignore_errors=True)

if __name__ == "__main__": main()
