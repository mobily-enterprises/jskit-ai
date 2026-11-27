// The production build of the frontend that every browser-test server serves, as a staging or production server
// does: a page then loads a few bundled files instead of every source module from a development server. The build goes where the app
// server serves it from (dist/), never a folder of its own: the server tells every page which build it serves from
// dist/index.html, and a page from any other build offers a reload over the screen. It is reused while its inputs' contents
// are unchanged and dist/index.html is still the one it made, so a repeated focused run does not rebuild. Its inputs are
// what the build read: the modules it bundled, which @jskit-ai/kernel's createJskitClientBootstrapPlugin (in every JSKIT
// app's Vite config) records, the listing of every folder they came from, so an added file counts, and the files every
// build reads; an edit to server code alone reuses the build. Those are read after the build, so a build during which
// one of them changed is not kept for reuse: it may hold code from before the change. A build that records no modules (a
// Vite config without that plugin, or a build that is not Vite's) is keyed on every source file instead, taken before it
// runs, as it rewrites files it generates among them (a declaration file vue-router writes into src). Two runs in one
// tree build one at a time: the second waits, then reuses the first one's build.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync, writeSync
} from "node:fs";
import path from "node:path";
import process from "node:process";

// What the last browser-test build was made from, and the dist/index.html it made.
const FINGERPRINT_FILE = path.join("node_modules", ".cache", "jskit-browser-test-build.json");
// Held, with its holder's process id, while a run builds.
const BUILD_LOCK = path.join("node_modules", ".cache", "jskit-browser-test-build.lock");
const BUILD_WAIT_MS = 10 * 60_000;
const SERVED_INDEX = path.join("dist", "index.html");
// The file a build appends the ids of the modules it read to, one per line, when this variable names it
// (createJskitClientBootstrapPlugin in @jskit-ai/kernel/client/vite).
const BUILD_MODULES_VARIABLE = "JSKIT_BUILD_MODULES_FILE";
const BUILD_MODULES_FILE = path.join("node_modules", ".cache", "jskit-browser-test-build-modules.txt");
// Read by every build: Vite copies public/, and the installed packages decide the bundled code. Every file at the app's
// root is an input too (index.html, vite.config.*, favicon.svg, package.json, the .env files Vite reads), except other
// dotfiles, such as caches, and notes.
const INSTALLED_PACKAGES = "node_modules/.package-lock.json";
const ALWAYS_READ = Object.freeze(["public", INSTALLED_PACKAGES]);
// Without the modules a build read: the app's folders a frontend build may read, and the installed packages it bundles.
const SOURCE_DIRECTORIES = Object.freeze(["src", "packages", "shared", "config", "node_modules/@jskit-ai"]);
const NOT_AN_INPUT = /^\.(?!env(?:\.|$))|\.(?:md|log|txt)$/u;

const seconds = (since) => `${((performance.now() - since) / 1000).toFixed(1)}s`;
const digest = (file) => (existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex") : "");

/**
 * Every build input's path and contents, the build command and the VITE_ settings, hashed, and the input changed last.
 * The inputs are the files the last build read, with the listing of each folder they came from and the manifest
 * (package.json) of any such folder that has one, or, without them, every source file.
 * @param {string} appRoot
 * @param {string} build
 * @param {{ files: string[], directories: string[] } | null} [read] what the build read, relative to appRoot
 * @returns {{ inputs: string, newest: { path: string, time: number } }}
 */
function buildFingerprint(appRoot, build, read = null, env = process.env) {
  const hash = createHash("sha256").update(`${build}\n`);
  const newest = { path: "", time: 0 };
  const changed = (relative, stats) => {
    if (stats.mtimeMs > newest.time) Object.assign(newest, { path: relative, time: stats.mtimeMs });
    return stats;
  };
  const visit = (relative) => {
    const absolute = path.join(appRoot, relative);
    if (!existsSync(absolute)) return;
    const stats = changed(relative, statSync(absolute));
    if (!stats.isDirectory()) {
      hash.update(`${relative}\0${stats.size}\0`).update(readFileSync(absolute));
      return;
    }
    for (const entry of readdirSync(absolute).sort()) {
      if (entry !== "node_modules" && !entry.startsWith(".")) visit(path.join(relative, entry));
    }
  };
  for (const entry of readdirSync(appRoot, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() && !NOT_AN_INPUT.test(entry.name)) visit(entry.name);
  }
  ALWAYS_READ.forEach(visit);
  if (!read) {
    SOURCE_DIRECTORIES.forEach(visit);
  } else {
    read.files.forEach(visit);
    for (const directory of read.directories) {
      const absolute = path.join(appRoot, directory);
      let listing = "(missing)";
      if (existsSync(absolute)) {
        changed(directory, statSync(absolute));
        listing = readdirSync(absolute).sort().join("\0");
      }
      hash.update(`${directory}/\0${listing}\0`);
      visit(path.join(directory, "package.json"));
    }
  }
  for (const [name, value] of Object.entries(env).filter(([key]) => key.startsWith("VITE_")).sort()) {
    hash.update(`${name}=${value}\n`);
  }
  return { inputs: hash.digest("hex"), newest };
}

/**
 * The files and folders the build recorded reading, relative to appRoot, or null when it recorded no module. Virtual
 * modules and queries (`?vue&type=style`) are not files; installed packages' folders are left to their record.
 */
function readModules(appRoot, modulesFile) {
  if (!existsSync(modulesFile)) return null;
  // Vite names modules by their real paths.
  const root = realpathSync(appRoot);
  const files = new Set();
  const directories = new Set();
  for (const id of readFileSync(modulesFile, "utf8").split("\n")) {
    const file = id.split("?")[0];
    if (!path.isAbsolute(file) || !existsSync(file) || !statSync(file).isFile()) continue;
    const relative = path.relative(root, file);
    files.add(relative);
    if (relative.split(path.sep).includes("node_modules")) continue;
    for (let directory = path.dirname(relative); directory !== "."; directory = path.dirname(directory)) directories.add(directory);
  }
  return files.size ? { files: [...files].sort(), directories: [...directories].sort() } : null;
}

function runToCompletion(command, appRoot, environment = {}) {
  const [program, ...args] = String(command).trim().split(/\s+/u);
  return new Promise((resolve, reject) => {
    // The build a staging or production server serves, whatever NODE_ENV the launcher was given.
    const child = spawn(program, args, {
      cwd: appRoot,
      env: { ...process.env, ...environment, NODE_ENV: "production" },
      stdio: ["ignore", "ignore", "inherit"]
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => (code === 0 ? resolve() : reject(new Error(`${command} failed (${signal || `exit ${code}`}).`))));
  });
}

function lastBuild(appRoot) {
  try {
    return JSON.parse(readFileSync(path.join(appRoot, FINGERPRINT_FILE), "utf8"));
  } catch {
    return {};
  }
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/** Takes the tree's build lock, waiting while another live run holds it; a dead holder's lock is taken over. */
async function lockBuild(appRoot) {
  const lock = path.join(appRoot, BUILD_LOCK);
  mkdirSync(path.dirname(lock), { recursive: true });
  const deadline = Date.now() + BUILD_WAIT_MS;
  let reported = false;
  while (true) {
    try {
      const descriptor = openSync(lock, "wx");
      writeSync(descriptor, String(process.pid));
      closeSync(descriptor);
      return () => rmSync(lock, { force: true });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    let holder = 0;
    try {
      holder = Number.parseInt(readFileSync(lock, "utf8"), 10);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (holder && !isRunning(holder)) {
      rmSync(lock, { force: true });
      continue;
    }
    if (Date.now() > deadline) throw new Error(`Another run (process ${holder}) has been building the frontend for 10 minutes.`);
    if (!reported) console.log(`[browser-tests] Waiting for another run's frontend build (process ${holder}).`);
    reported = true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

function isCurrent(appRoot, build) {
  const last = lastBuild(appRoot);
  return Boolean(last.index) && last.index === digest(path.join(appRoot, SERVED_INDEX)) &&
    last.inputs === buildFingerprint(appRoot, build, last.read || null).inputs;
}

/**
 * Builds the frontend with `build` unless dist/ already holds the build of the current inputs.
 * @param {{ appRoot?: string, build?: string,
 *   run?: (command: string, appRoot: string, environment: Record<string, string>) => Promise<void> }} [options]
 * @returns {Promise<{ built: boolean }>}
 */
async function buildFrontend({ appRoot = process.cwd(), build = "npm run build", run = runToCompletion } = {}) {
  const started = performance.now();
  if (isCurrent(appRoot, build)) {
    console.log(`[browser-tests] Frontend build unchanged, reused (${seconds(started)}).`);
    return { built: false };
  }
  const unlock = await lockBuild(appRoot);
  try {
    // The run that held the lock may have just built these inputs.
    if (isCurrent(appRoot, build)) {
      console.log(`[browser-tests] Frontend built by another run, reused (${seconds(started)}).`);
      return { built: false };
    }
    const modulesFile = path.join(appRoot, BUILD_MODULES_FILE);
    // Made empty as the build starts: its modification time is the start by the file system's own clock, which stamps
    // the inputs' times too.
    writeFileSync(modulesFile, "");
    const buildStart = statSync(modulesFile).mtimeMs;
    const everySource = buildFingerprint(appRoot, build).inputs;
    await run(build, appRoot, { [BUILD_MODULES_VARIABLE]: modulesFile });
    const index = digest(path.join(appRoot, SERVED_INDEX));
    if (!index) throw new Error(`${build} made no ${SERVED_INDEX}, which the app server serves.`);
    const read = readModules(appRoot, modulesFile);
    rmSync(modulesFile, { force: true });
    let inputs = everySource;
    let note = "; it recorded no modules, so every source file is its input";
    if (read) {
      const { inputs: readInputs, newest } = buildFingerprint(appRoot, build, read);
      inputs = newest.time >= buildStart ? "" : readInputs;
      note = inputs ? "" : `; not kept for reuse, as ${newest.path} changed while it ran`;
    }
    writeFileSync(path.join(appRoot, FINGERPRINT_FILE), JSON.stringify({ inputs, index, read }));
    console.log(`[browser-tests] Frontend built in ${seconds(started)}${note}.`);
    return { built: true };
  } finally {
    unlock();
  }
}

export { buildFrontend };
