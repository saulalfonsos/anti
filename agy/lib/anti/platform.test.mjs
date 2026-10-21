// lib/anti/platform.test.mjs — lo que cambia entre macOS, Linux y Windows (D326): abrir una web, abrir una terminal con una
// orden, cómo se instala agy y dónde suele estar.
import { test } from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { openUrlCommand, terminalCommands, agyInstall, agyExe, agyDirs, revealCommand } from "./platform.mjs"

test("abrir una web: open (macOS), xdg-open (Linux), start (Windows)", () => {
  assert.deepEqual(openUrlCommand("https://x.y", "darwin"), ["open", ["https://x.y"]])
  assert.deepEqual(openUrlCommand("https://x.y", "linux"), ["xdg-open", ["https://x.y"]])
  assert.deepEqual(openUrlCommand("https://x.y", "win32"), ["cmd.exe", ["/c", "start", "", "https://x.y"]])
})

test("abrir una terminal con una orden: Terminal.app; en Linux la que haya; en Windows PowerShell en su ventana", () => {
  const [mac] = terminalCommands("agy", "darwin", () => true)
  assert.equal(mac[0], "osascript")
  assert.match(mac[1].join(" "), /do script "agy"/)
  assert.match(terminalCommands('echo "hola"', "darwin", () => true)[0][1].join(" "), /do script "echo \\"hola\\""/)
  const linux = terminalCommands("agy", "linux", (bin) => ["gnome-terminal", "xterm"].includes(bin))
  assert.deepEqual(linux.map((c) => c[0]), ["gnome-terminal", "xterm"])
  assert.deepEqual(linux[0][1], ["--", "sh", "-c", "agy; exec sh"])
  assert.deepEqual(linux[1][1], ["-e", "sh", "-c", "agy; exec sh"])
  assert.deepEqual(terminalCommands("agy", "linux", () => false), [])
  assert.deepEqual(terminalCommands("agy", "win32", () => true), [["cmd.exe", ["/c", "start", "", "powershell", "-NoExit", "-Command", "agy"]]])
})

test("instalar agy: la orden oficial de cada sistema y dónde lo deja", () => {
  assert.equal(agyInstall("darwin"), "curl -fsSL https://antigravity.google/cli/install.sh | bash")
  assert.equal(agyInstall("linux"), "curl -fsSL https://antigravity.google/cli/install.sh | bash")
  assert.equal(agyInstall("win32"), "irm https://antigravity.google/cli/install.ps1 | iex")
  assert.equal(agyExe("win32"), "agy.exe")
  assert.equal(agyExe("linux"), "agy")
  assert.deepEqual(agyDirs({ HOME: "/h" }, "linux"), ["/h/.local/bin", "/usr/local/bin", "/usr/bin", "/h/bin", "/h/.antigravity/bin"])
  assert.ok(agyDirs({ HOME: "/h" }, "darwin").includes("/opt/homebrew/bin"))
  const win = agyDirs({ USERPROFILE: "C:\\Users\\a", LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" }, "win32")
  assert.equal(win[0], path.win32.join("C:\\Users\\a\\AppData\\Local", "agy", "bin"))
})

test("enseñar el .zip en su carpeta: Finder, Explorador o la carpeta en Linux", () => {
  assert.deepEqual(revealCommand("/h/Downloads/d.zip", "darwin"), ["open", ["-R", "/h/Downloads/d.zip"]])
  assert.deepEqual(revealCommand("C:\\U\\a\\Downloads\\d.zip", "win32"), ["explorer.exe", ["/select,C:\\U\\a\\Downloads\\d.zip"]])
  assert.deepEqual(revealCommand("/home/a/Downloads/d.zip", "linux"), ["xdg-open", ["/home/a/Downloads"]])
})
