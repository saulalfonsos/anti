// lib/anti/platform.mjs — lo que cambia entre macOS, Linux y Windows (D326). Funciones puras: devuelven la orden a lanzar; quien
// las usa la lanza (y prueba la siguiente si una falla).

// Abrir una web en el navegador del sistema.
export function openUrlCommand(url, platform = process.platform) {
  if (platform === "darwin") return ["open", [url]]
  if (platform === "win32") return ["cmd.exe", ["/c", "start", "", url]]
  return ["xdg-open", [url]]
}

// Abrir una terminal a la vista del usuario con una orden escrita (instalar agy, iniciar sesión en agy). En Linux no hay una terminal
// fija: se devuelven, en orden, las que estén instaladas (`has(bin)`), y quien llama usa la primera que arranque. Al acabar la orden,
// la terminal se queda abierta.
const LINUX_TERMINALS = [
  ["x-terminal-emulator", (c) => ["-e", "sh", "-c", c]],
  ["gnome-terminal", (c) => ["--", "sh", "-c", c]],
  ["konsole", (c) => ["-e", "sh", "-c", c]],
  ["xfce4-terminal", (c) => ["-x", "sh", "-c", c]],
  ["kitty", (c) => ["sh", "-c", c]],
  ["alacritty", (c) => ["-e", "sh", "-c", c]],
  ["wezterm", (c) => ["start", "--", "sh", "-c", c]],
  ["xterm", (c) => ["-e", "sh", "-c", c]],
]
export function terminalCommands(command, platform = process.platform, has = () => true) {
  if (platform === "darwin") {
    const script = command.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
    return [["osascript", ["-e", 'tell application "Terminal" to activate', "-e", `tell application "Terminal" to do script "${script}"`]]]
  }
  if (platform === "win32") return [["cmd.exe", ["/c", "start", "", "powershell", "-NoExit", "-Command", command]]]
  return LINUX_TERMINALS.filter(([bin]) => has(bin)).map(([bin, args]) => [bin, args(`${command}; exec sh`)])
}

// La orden oficial para instalar agy (antigravity.google/docs/cli/install).
export const agyInstall = (platform = process.platform) =>
  platform === "win32" ? "irm https://antigravity.google/cli/install.ps1 | iex" : "curl -fsSL https://antigravity.google/cli/install.sh | bash"

export const agyExe = (platform = process.platform) => (platform === "win32" ? "agy.exe" : "agy")

// Dónde suele estar agy además del PATH: el instalador oficial lo deja en ~/.local/bin (Windows: %LOCALAPPDATA%\agy\bin).
export function agyDirs(env, platform = process.platform) {
  if (platform === "win32") {
    const local = env.LOCALAPPDATA || `${env.USERPROFILE}\\AppData\\Local`
    return [`${local}\\agy\\bin`, `${env.USERPROFILE}\\.local\\bin`, `${env.ProgramFiles || "C:\\Program Files"}\\agy\\bin`]
  }
  const home = env.HOME
  const common = [`${home}/.local/bin`, "/usr/local/bin"]
  if (platform === "darwin") return [...common, "/opt/homebrew/bin", `${home}/bin`, `${home}/.antigravity/bin`]
  return [...common, "/usr/bin", `${home}/bin`, `${home}/.antigravity/bin`]
}

// Enseñar un fichero en su carpeta: Finder con el fichero marcado, el Explorador de Windows igual; en Linux, abrir la carpeta.
export function revealCommand(file, platform = process.platform) {
  if (platform === "darwin") return ["open", ["-R", file]]
  if (platform === "win32") return ["explorer.exe", [`/select,${file}`]]
  return ["xdg-open", [file.replace(/[\\/][^\\/]*$/, "") || "/"]]
}
