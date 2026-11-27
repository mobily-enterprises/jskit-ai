// The webServer of a local browser run (browser-tests.mjs): builds the production frontend unless its build is current
// (browser-test-build.mjs), runs the app's `prepare` module once for every worker's environment (its own database), then
// starts one app server per Playwright worker, each on its own port, and prints the ready line Playwright waits for.
// Each worker's server environment is also left, readable only by this user, where the worker's own process takes it
// (browser-tests.mjs). With the app's `signIn` module, each server is then signed in once, and its storage state left
// for its worker. Each server's output goes to test-results/browser-test-servers/worker-<n>.log; a server that stops
// ends the run. A port that already answers is refused before anything is built or started: a server left there by an
// earlier run would answer for this run's. Stopped by Playwright (SIGTERM), by Ctrl-C, by its terminal's hang-up (SIGHUP,
// which a host such as Vibe64 sends a target's command first), by the end of the stdin pipe Playwright gives its
// webServer (a Playwright that ended without stopping it) or by a write its output refused (a hung-up terminal answers
// EIO, a pipe without a reader EPIPE), the launcher stops its servers and waits for them, then
// drops the numbered database copies the prepare module made, within Playwright's grace, before it exits; it drops
// them too when its start fails. `jskit browser-test-server` (browser-test-server.mjs) runs it
// for one server a host starts, with `terminal`: that server's output also reaches the launcher's own. A run takes free
// ports of its own, so its worker environments and signed-in states have names of their own; the launcher removes them
// when it stops, so they never pile up in the cache, nor outlive the sessions they hold.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, fstatSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { buildFrontend } from "./browser-test-build.mjs";
import { useTestAppEnvironment } from "./test-environment.mjs";

const SETTINGS_VARIABLE = "JSKIT_BROWSER_TESTS";
const LOG_DIRECTORY = path.join("test-results", "browser-test-servers");
const READY_TIMEOUT_MS = 60_000;
// Within the 10 s gracefulShutdown browser-tests.mjs gives Playwright's webServer: the servers stop first (one still
// running then is killed), since a server's sessions keep its database copy, then the copies are dropped.
const STOP_WAIT_MS = 4_000;
const DROP_WAIT_MS = 5_000;
// Where database-runtime's prepareTestDatabases() keeps, in this process, each set of numbered copies it made with its
// drop: the app's prepare module loads the app's own copy of that package, so the launcher reads them here.
const PREPARED_COPIES = Symbol.for("@jskit-ai/database-runtime/preparedTestDatabaseCopies");

const seconds = (since) => `${((performance.now() - since) / 1000).toFixed(1)}s`;
const words = (command) => String(command).trim().split(/\s+/u).filter(Boolean);

/** Each worker's server environment from the app's prepare module, given each worker's base URL, or none. */
async function prepareWorkers(appRoot, prepare, workers, baseUrls) {
  if (!prepare) return Array.from({ length: workers }, () => ({}));
  const { default: prepareWorkerEnvironments } = await import(pathToFileURL(path.resolve(appRoot, prepare)).href);
  const environments = await prepareWorkerEnvironments({ workers, baseUrls });
  if (!Array.isArray(environments) || environments.length < workers) {
    throw new Error(`${prepare} prepared ${environments?.length ?? 0} worker environment(s) for ${workers} worker(s); ` +
      "let the database user create the copies, or set PLAYWRIGHT_WORKERS lower.");
  }
  return environments;
}

/** Signs each worker's server in once through the app's signIn module, and leaves its storage state for that worker. */
async function signInWorkers(appRoot, signIn, baseUrls, environments, signedInStates) {
  const started = performance.now();
  const { default: signInWorker } = await import(pathToFileURL(path.resolve(appRoot, signIn)).href);
  // The app's own Playwright, which its tests run on.
  const { request } = createRequire(path.join(appRoot, "package.json"))("@playwright/test");
  await Promise.all(baseUrls.map(async (baseURL, index) => {
    const context = await request.newContext({ baseURL });
    try {
      await signInWorker({ request: context, baseURL, workerIndex: index, env: environments[index] });
      // It holds a session's cookies: only this user may read it.
      writeFileSync(`${signedInStates}-${index}.json`, JSON.stringify(await context.storageState()), { mode: 0o600 });
    } finally {
      await context.dispose();
    }
  }));
  console.log(`[browser-tests] ${baseUrls.length} worker(s) signed in in ${seconds(started)}.`);
}

const answers = (host, port) => new Promise((resolve) => {
  const socket = net.connect(port, host);
  socket.once("connect", () => { socket.destroy(); resolve(true); });
  socket.once("error", () => resolve(false));
});

async function refuseBusyPorts(host, ports) {
  const taken = await Promise.all(ports.map((port) => answers(host, port)));
  const busy = ports.filter((_, index) => taken[index]);
  if (busy.length > 0) {
    throw new Error(`Port ${busy.join(", ")} on ${host} already answers: a server left there would answer for this run's. ` +
      "Stop it, or set PLAYWRIGHT_PORT to free ports.");
  }
}

async function waitUntilReady(url, server, name) {
  const started = performance.now();
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (server.exitCode !== null || server.signalCode !== null) throw new Error(`${name} stopped while starting.`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) {
        console.log(`[browser-tests] ${name} started in ${seconds(started)}.`);
        return;
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${name} was not ready at ${url} within ${READY_TIMEOUT_MS / 1000}s.`);
}

const servers = [];
let stopping = false;
// The files this run leaves for its workers, which it removes when it stops.
let runFiles = [];
// The prepare module's work, which a stop waits for (within DROP_WAIT_MS) so the copies it is making are dropped too.
let preparing = Promise.resolve();
const running = (server) => server.exitCode === null && server.signalCode === null;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms, false));
function stopServers() {
  stopping = true;
  for (const server of servers) if (running(server)) server.kill("SIGTERM");
}
/** Drops every set of numbered copies prepare made, once the servers have exited, and says what it did. */
async function dropPreparedCopies(exited) {
  await Promise.all([preparing.catch(() => {}), exited]);
  const drops = [...(globalThis[PREPARED_COPIES]?.values() ?? [])];
  for (const report of await Promise.all(drops.map((drop) => drop()))) if (report) console.log(`[browser-tests] ${report}.`);
  return true;
}
async function stopAndExit(code) {
  if (stopping) return;
  stopServers();
  const stopped = Promise.all(servers.filter(running).map((server) => once(server, "exit")));
  await Promise.race([stopped, delay(STOP_WAIT_MS)]);
  const killed = servers.filter(running);
  for (const server of killed) server.kill("SIGKILL");
  const exited = Promise.all(killed.map((server) => once(server, "exit")));
  if (!(await Promise.race([dropPreparedCopies(exited), delay(DROP_WAIT_MS)]))) {
    console.error(`[browser-tests] The prepared test database copies were not all dropped within ${DROP_WAIT_MS / 1000}s; ` +
      "the next run makes them afresh and drops them.");
  }
  for (const file of runFiles) rmSync(file, { force: true });
  process.exit(code);
}
// Kept for every signal, not once: a host's stop signals more than once (Vibe64's wrapper SIGTERM, its terminal's
// SIGHUP, then the process group's SIGTERM), and a signal with no handler left would kill the launcher mid-stop.
process.on("SIGINT", () => stopAndExit(130));
process.on("SIGTERM", () => stopAndExit(143));
process.on("SIGHUP", () => stopAndExit(129));
// Its servers' output passes through its own, which can go before its stop does: a write that fails there stops it like
// a signal, never as an uncaught error that would end it before its copies are dropped.
for (const output of [process.stdout, process.stderr]) output.on("error", () => stopAndExit(1));
// Only a pipe ends when Playwright does; a launcher started without one (stdin ignored, /dev/null) would end at once.
const input = fstatSync(0);
if (input.isFIFO() || input.isSocket()) {
  process.stdin.once("end", () => stopAndExit(1));
  process.stdin.resume();
}
process.once("exit", stopServers);

const started = performance.now();
const appRoot = process.cwd();
const {
  workers, host, basePort, server, build, prepare, env, health, workerEnvironments: workerEnvironmentsFile, signIn,
  signedInStates, terminal
} = JSON.parse(process.env[SETTINGS_VARIABLE] || "{}");
// The servers, and the databases prepared for them, are APP_ENV=test.
useTestAppEnvironment(process.env, "jskit browser tests");
const baseEnvironment = { ...process.env };
delete baseEnvironment[SETTINGS_VARIABLE];
const baseUrls = Array.from({ length: workers }, (_, index) => `http://${host}:${basePort + index}`);
runFiles = [workerEnvironmentsFile, ...(signedInStates ? baseUrls.map((_, index) => `${signedInStates}-${index}.json`) : [])]
  .filter(Boolean);
try {
  await refuseBusyPorts(host, baseUrls.map((_, index) => basePort + index));
  preparing = prepareWorkers(appRoot, prepare, workers, baseUrls);
  // Both settle before a failure of either ends the start, so the copies prepare makes are all made when they are dropped.
  const [built, prepared] = await Promise.allSettled([buildFrontend({ appRoot, build }), preparing]);
  for (const result of [built, prepared]) if (result.status === "rejected") throw result.reason;
  // A stop during the start drops the copies; no server starts on them.
  if (stopping) throw new Error("The run was stopped while it started.");
  const workerEnvironments = prepared.value;
  mkdirSync(path.join(appRoot, LOG_DIRECTORY), { recursive: true });
  mkdirSync(path.dirname(workerEnvironmentsFile), { recursive: true });
  writeFileSync(workerEnvironmentsFile, JSON.stringify(workerEnvironments.slice(0, workers)), { mode: 0o600 });
  const [program, ...args] = words(server);
  const serverEnvironments = workerEnvironments.slice(0, workers).map((workerEnvironment, index) => ({
    ...baseEnvironment,
    ...env,
    ...workerEnvironment,
    HOST: host,
    PORT: String(basePort + index),
    TEST_PARALLEL_INDEX: String(index),
    APP_ENV: "test"
  }));
  await Promise.all(serverEnvironments.map((serverEnvironment, index) => {
    const baseUrl = baseUrls[index];
    const name = `The browser test server of worker ${index} (${baseUrl})`;
    const log = path.join(LOG_DIRECTORY, `worker-${index}.log`);
    const child = spawn(program, args, { cwd: appRoot, env: serverEnvironment, stdio: ["ignore", "pipe", "pipe"] });
    const output = createWriteStream(path.join(appRoot, log));
    child.stdout.pipe(output);
    child.stderr.pipe(output);
    if (terminal) {
      child.stdout.pipe(process.stdout, { end: false });
      child.stderr.pipe(process.stderr, { end: false });
    }
    child.once("exit", (code, signal) => {
      if (stopping) return;
      console.error(`[browser-tests] ${name} stopped (${signal || `exit ${code}`}); log: ${log}`);
      stopAndExit(1);
    });
    servers.push(child);
    return waitUntilReady(new URL(health, baseUrl), child, name);
  }));
  if (signIn) await signInWorkers(appRoot, signIn, baseUrls, serverEnvironments, signedInStates);
  console.log(`jskit browser tests: ${workers} server(s) ready in ${seconds(started)}; logs in ${LOG_DIRECTORY}.`);
} catch (error) {
  console.error(`[browser-tests] ${error.message}`);
  await stopAndExit(1);
}
