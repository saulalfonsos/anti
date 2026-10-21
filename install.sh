#!/bin/sh
# Instalador de anti para macOS y Linux. Clona el código en ~/.anti (o lo actualiza), descarga en ~/.anti/.bun la versión de bun
# que fija app/package.json, instala las dependencias y enlaza ~/.local/bin/anti, el único comando. No toca tu configuración de agy.
#   curl -fsSL https://raw.githubusercontent.com/saulalfonsos/anti/main/install.sh | sh
# Instala la última versión publicada (la etiqueta vX.Y.Z más alta), no lo que haya en main.
#   ANTI_REF=<rama o etiqueta>   instala esa (ANTI_REF=main: lo último, en desarrollo);   ANTI_REPO=<url de git>   desde otro repositorio
set -eu
REPO="${ANTI_REPO:-https://github.com/saulalfonsos/anti.git}"
DEST="${ANTI_HOME:-$HOME/.anti}"
BIN="$HOME/.local/bin"
die() { echo "$*" >&2; exit 1; }

case "$(uname -s)" in
  Darwin) OS=darwin ;;
  Linux) OS=linux ;;
  *) die "anti se instala en macOS y Linux." ;;
esac
case "$(uname -m)" in
  arm64|aarch64) ARCH=aarch64 ;;
  x86_64|amd64) ARCH=x64 ;;
  *) die "Procesador no soportado: $(uname -m) (anti funciona en arm64 y x64)." ;;
esac
for c in git curl; do command -v "$c" >/dev/null 2>&1 || die "Falta $c: instálalo y vuelve a ejecutar el instalador."; done
REF="${ANTI_REF:-$(git ls-remote --tags --refs --sort=-v:refname "$REPO" 'v[0-9]*' | sed -n '1s|.*refs/tags/||p')}"
[ -n "$REF" ] || die "No encuentro ninguna versión publicada en $REPO."

# 1. El código: un clon superficial que se actualiza en el sitio. Lo que git ignora (node_modules, .bun) se queda para ir rápido.
if [ -d "$DEST/.git" ]; then
  echo "Actualizando anti en $DEST ($REF)"
  git -C "$DEST" remote set-url origin "$REPO"
  git -C "$DEST" fetch -q --depth 1 origin "$REF"
  git -C "$DEST" reset -q --hard FETCH_HEAD
  git -C "$DEST" clean -qfd
else
  # La beta se repartía compilada (bin/anti-core): se sustituye. Cualquier otra cosa en $DEST no es nuestra.
  if [ -x "$DEST/bin/anti-core" ]; then rm -rf "$DEST"; fi
  [ ! -e "$DEST" ] || die "$DEST ya existe y no es una instalación de anti: muévelo o elige otra carpeta con ANTI_HOME."
  echo "Descargando anti en $DEST ($REF)"
  git -c advice.detachedHead=false clone -q --depth 1 --branch "$REF" "$REPO" "$DEST"
fi

# 2. bun, el que usa el proyecto, verificado con el SHASUMS256.txt de su versión.
BUNV=$(sed -n 's/.*"packageManager": *"bun@\([^"]*\)".*/\1/p' "$DEST/app/package.json")
[ -n "$BUNV" ] || die "No encuentro la versión de bun en $DEST/app/package.json."
if [ "$("$DEST/.bun/bun" --version 2>/dev/null || true)" != "$BUNV" ]; then
  T="bun-$OS-$ARCH"
  # Un shell x64 bajo Rosetta en un Mac con Apple: el bun nativo.
  if [ "$T" = bun-darwin-x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || true)" = 1 ]; then T=bun-darwin-aarch64; ARCH=aarch64; fi
  if [ "$OS" = linux ] && { [ -f /etc/alpine-release ] || ldd --version 2>&1 | grep -qi musl; }; then T="$T-musl"; fi
  if [ "$ARCH" = x64 ]; then
    if [ "$OS" = linux ]; then grep -q avx2 /proc/cpuinfo || T="$T-baseline"
    else sysctl -n machdep.cpu.leaf7_features 2>/dev/null | grep -q AVX2 || T="$T-baseline"; fi
  fi
  echo "Descargando bun $BUNV ($T)"
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  URL="https://github.com/oven-sh/bun/releases/download/bun-v$BUNV"
  curl -fsSL "$URL/$T.zip" -o "$tmp/$T.zip"
  curl -fsSL "$URL/SHASUMS256.txt" | grep " $T.zip\$" > "$tmp/sum" || die "bun $BUNV no tiene $T.zip."
  if command -v shasum >/dev/null 2>&1; then (cd "$tmp" && shasum -a 256 -c sum >/dev/null); else (cd "$tmp" && sha256sum -c sum >/dev/null); fi \
    || die "La descarga de bun no coincide con su sha256: no se instala."
  if command -v unzip >/dev/null 2>&1; then unzip -q "$tmp/$T.zip" -d "$tmp"
  elif command -v python3 >/dev/null 2>&1; then python3 -m zipfile -e "$tmp/$T.zip" "$tmp"
  else die "Falta unzip (o python3) para descomprimir bun: instálalo y vuelve a ejecutar el instalador."; fi
  mkdir -p "$DEST/.bun"
  mv "$tmp/$T/bun" "$DEST/.bun/bun"
  chmod +x "$DEST/.bun/bun"
fi
BUN="$DEST/.bun/bun"

# 3. Las dependencias: solo las de OpenCode y el servidor MCP de anti (no las de la web, el escritorio ni la consola de OpenCode).
# --ignore-scripts: los scripts de la raíz son de desarrollo (husky); el único que hace falta, el de node-pty, va aparte.
echo "Instalando dependencias (la primera vez tarda un par de minutos)"
(cd "$DEST/app" && "$BUN" install --frozen-lockfile --ignore-scripts --filter ./packages/opencode --filter ./packages/anti-mcp >/dev/null)
(cd "$DEST/app" && "$BUN" run --cwd packages/core fix-node-pty >/dev/null)
(cd "$DEST/agy" && "$BUN" install --frozen-lockfile --production >/dev/null)

# 4. El comando.
mkdir -p "$BIN"
other=$(command -v anti 2>/dev/null || true)
ln -sf "$DEST/bin/anti" "$BIN/anti"
case "$other" in ""|"$BIN/anti") ;; *) echo "Aviso: ya hay otro «anti» en $other, que va antes en tu PATH: quítalo o pon $BIN antes en el PATH." >&2 ;; esac
echo "anti $(cat "$DEST/VERSION") instalado en $DEST ($(git -C "$DEST" rev-parse --short HEAD))"
case ":$PATH:" in *":$BIN:"*) ;; *) echo "Añade $BIN a tu PATH (por ejemplo en ~/.zshrc o ~/.bashrc: export PATH=\"\$HOME/.local/bin:\$PATH\")." ;; esac
echo "Ejecuta: anti   (la primera vez te guía para dejarlo listo)."
