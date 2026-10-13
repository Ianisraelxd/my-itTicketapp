// One command to run everything:   npm start        (or double-click start.bat on Windows)
//   npm run dev:all   does the same with the live-reload dev server on http://localhost:5173
//
// It checks Node, installs packages if needed, starts MySQL from XAMPP when it is not running,
// builds the website when it is missing or out of date, starts the server (which creates the
// database and demo accounts on first run) and opens your browser.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import "../server/env.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const dev = process.argv.includes("--dev");
const isWindows = process.platform === "win32";
const npm = isWindows ? "npm.cmd" : "npm";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const say = (text) => console.log(`\n▶ ${text}`);
const port = Number(process.env.PORT) || 3001;

const major = Number(process.versions.node.split(".")[0]);
if (major < 20) {
  console.error(`Node.js 20 or newer is required (you have ${process.versions.node}). Install it from https://nodejs.org`);
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: isWindows });
  if (result.status !== 0) {
    console.error(`\n"${command} ${args.join(" ")}" failed.`);
    process.exit(result.status || 1);
  }
}

const canConnect = (host, tcpPort) =>
  new Promise((resolve) => {
    const socket = net.connect({ host, port: tcpPort, timeout: 1500 });
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => (socket.destroy(), resolve(false)));
  });

// 1. packages
if (!fs.existsSync(path.join(root, "node_modules", "express"))) {
  say("Installing packages (first run only)...");
  run(npm, ["install"]);
}

// 2. MySQL
const dbHost = process.env.DB_HOST || "localhost";
const dbPort = Number(process.env.DB_PORT) || 3306;
if (!(await canConnect(dbHost, dbPort))) {
  const xampp = ["C:/xampp", "D:/xampp", "E:/xampp"].find((dir) => fs.existsSync(`${dir}/mysql/bin/mysqld.exe`));
  if (xampp && ["localhost", "127.0.0.1", "::1"].includes(dbHost)) {
    say("MySQL is not running. Starting it from XAMPP...");
    const child = spawn(`${xampp}/mysql/bin/mysqld.exe`, [`--defaults-file=${xampp}/mysql/bin/my.ini`, "--standalone"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    for (let i = 0; i < 30 && !(await canConnect(dbHost, dbPort)); i += 1) await sleep(1000);
  }
  if (!(await canConnect(dbHost, dbPort))) {
    console.error(`\nMySQL is not reachable at ${dbHost}:${dbPort}.\nOpen the XAMPP Control Panel, press Start next to MySQL, then run this again.`);
    process.exit(1);
  }
}

// 3. website build (production mode only)
function newest(dir) {
  let latest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    latest = Math.max(latest, entry.isDirectory() ? newest(full) : fs.statSync(full).mtimeMs);
  }
  return latest;
}
if (!dev) {
  const built = path.join(root, "dist", "index.html");
  const stale =
    !fs.existsSync(built) ||
    fs.statSync(built).mtimeMs < Math.max(newest(path.join(root, "src")), fs.statSync(path.join(root, "index.html")).mtimeMs);
  if (stale) {
    say("Building the website...");
    run(npm, ["run", "build"]);
  }
}

// 4. start
const children = [];
const start = (command, args, name) => {
  const child = spawn(command, args, { stdio: "inherit", shell: isWindows && command === npm });
  child.on("exit", (code) => {
    if (code) console.error(`${name} stopped (exit code ${code}).`);
    for (const other of children) if (other !== child) other.kill();
    process.exit(code || 0);
  });
  children.push(child);
};

say(dev ? "Starting the API and the live-reload website..." : "Starting HelpDesk...");
start(process.execPath, ["server/index.js"], "The server");
if (dev) start(npm, ["run", "dev", "--", "--open"], "The dev server");

// 5. open the browser once the server answers
const url = dev ? "http://localhost:5173" : `http://localhost:${port}`;
for (let i = 0; i < 60; i += 1) {
  if (await canConnect("127.0.0.1", port)) break;
  await sleep(500);
}
if (!dev && !process.argv.includes("--no-open")) {
  const opener = isWindows ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    spawn(opener[0], opener[1], { stdio: "ignore", detached: true }).unref();
  } catch {
    // no browser available: the address below is enough
  }
}
console.log(`\n✔ HelpDesk is running at ${url}   (press Ctrl+C to stop)\n`);

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => children.forEach((child) => child.kill()));
