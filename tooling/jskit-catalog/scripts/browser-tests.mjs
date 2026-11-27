import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { testConcurrency } from "./test-budget.mjs";

// An application's Playwright configuration: `defineConfig(browserTestConfig({ ... }))`. A local run builds the
// production frontend once (cached by its sources) and starts one app server per Playwright worker, each on its own port
// and, through the app's `prepare` module, its own database, so workers run in parallel without sharing data
// (browser-test-servers.mjs). With the app's `signIn` module, each worker's server is signed in once and every test of
// that worker starts from its signed-in state. With PLAYWRIGHT_BASE_URL set, the tests use that managed target instead,
// as its host serves it and with the login state its host supplies, one worker at a time unless the runner sets
// PLAYWRIGHT_WORKERS. A host serving such a target several app servers (Vibe64's targets whose Run step takes
// {workers}) lists them in PLAYWRIGHT_WORKER_TARGETS: one Playwright worker per server, each with its own signed-in
// state.

const SERVERS = fileURLToPath(new URL("./browser-test-servers.mjs", import.meta.url));
const SLOWEST_TESTS = fileURLToPath(new URL("./browser-test-times.mjs", import.meta.url));
const SETTINGS_VARIABLE = "JSKIT_BROWSER_TESTS";
const READY = /^jskit browser tests: \d+ server\(s\) ready/mu;
const HOST = "127.0.0.1";
// A whole run's default bound, as work: 80 worker-minutes, so 20 minutes on 4 workers and 80 on one, never under 20
// minutes, so a run with fewer browsers is not cut short for the host's size. A suite that would take hours stops
// instead, and says so. A suite measured to need longer passes its own globalTimeout, with the measurement beside it.
const WORKER_MINUTES_MS = 80 * 60_000;
const MIN_GLOBAL_TIMEOUT_MS = 20 * 60_000;
// A click, fill or navigation waiting on something that never comes (a stale locator) fails in seconds, with its own
// error, instead of holding the test until its 60 s timeout. Over 652 passing app tests the slowest action or page
// load took 9.0 s, and expect already waits 10 s.
const ACTION_TIMEOUT_MS = 15_000;
const NAVIGATION_TIMEOUT_MS = 30_000;
// Building the frontend when its sources changed, preparing the databases and starting every server.
const SERVERS_TIMEOUT_MS = 180_000;
// Where the servers' launcher leaves each worker's server environment, for that worker's own process.
const WORKER_ENVIRONMENTS = path.join("node_modules", ".cache", "jskit-browser-tests");
// The peak resident memory of the largest app server of the last local run, which its launcher records as its servers
// stop (browser-test-servers.mjs).
const SERVER_MEMORY = "server-memory.json";
const GIB = 1024 ** 3;
// The variables that name a worker's own test database, which its tests may open.
const DATABASE_VARIABLES = Object.freeze(["DB_NAME", "TEST_DB_NAME", "BROWSER_TEST_DB_NAME"]);
// The databases a test process may open, and how it reaches one: @jskit-ai/database-runtime's testDatabaseGuard.js
// reads it, and the app's knexfile settings and runtime refuse any other database.
const TEST_DATABASE_GUARD = "JSKIT_TEST_DATABASE_GUARD";

const positiveInteger = (value) => (/^[1-9]\d*$/u.test(String(value ?? "").trim()) ? Number(String(value).trim()) : 0);

const withoutTrailingSlash = (url) => String(url || "").trim().replace(/\/+$/u, "");

function managedBaseUrl(env) {
  return withoutTrailingSlash(env.PLAYWRIGHT_BASE_URL);
}

const WORKER_TARGETS_FORM = "PLAYWRIGHT_WORKER_TARGETS is a JSON list of { baseURL, storageState? }: each Playwright " +
  "worker's app server, an HTTP URL, and its signed-in state file";

/**
 * A host's app servers for a managed run, one per Playwright worker, from PLAYWRIGHT_WORKER_TARGETS, or null without it.
 * @param {Record<string, string | undefined>} env
 * @returns {Array<{ baseURL: string, storageState: string }> | null}
 */
function managedWorkerTargets(env) {
  const text = String(env.PLAYWRIGHT_WORKER_TARGETS || "").trim();
  if (!text) return null;
  let list;
  try {
    list = JSON.parse(text);
  } catch {
    throw new Error(`${WORKER_TARGETS_FORM}; it is not JSON.`);
  }
  const valid = Array.isArray(list) && list.length > 0 && list.every((entry) => {
    let protocol = "";
    try {
      protocol = new URL(String(entry?.baseURL)).protocol;
    } catch {
      return false;
    }
    return ["http:", "https:"].includes(protocol) &&
      (entry.storageState === undefined || (typeof entry.storageState === "string" && entry.storageState.trim() !== ""));
  });
  if (!valid) throw new Error(`${WORKER_TARGETS_FORM}.`);
  return list.map(({ baseURL, storageState = "" }) => ({ baseURL: withoutTrailingSlash(baseURL), storageState }));
}

/**
 * The `--workers`/`-j` count given on the Playwright command line, or 0. A percentage is refused: the servers are
 * started before Playwright resolves it.
 * @param {ReadonlyArray<string>} argv
 */
function commandLineWorkers(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const match = /^(?:--workers|-j)(?:=(.*))?$/u.exec(argv[index]);
    if (!match) continue;
    const value = String(match[1] ?? argv[index + 1] ?? "").trim();
    const count = positiveInteger(value);
    if (!count) throw new Error(`Give --workers a whole number of workers, not ${value || "nothing"}.`);
    return count;
  }
  return 0;
}

/** The memory this process may still take: its cgroup's limit where one applies, else the machine's. */
function systemAvailableMemory() {
  return process.availableMemory?.() || os.freemem();
}

/**
 * The peak resident memory, in bytes, the largest app server of the last browser run in `cwd` reached, or 0 when none
 * is recorded. Its launcher records it as its servers stop (on Linux), a local run's and `jskit browser-test-server`'s
 * alike, so a host sizing a managed run by its servers' memory reads it here.
 * @param {{ cwd?: string }} [options]
 * @returns {number}
 */
function browserTestServerPeakBytes({ cwd = process.cwd() } = {}) {
  const file = path.resolve(cwd, WORKER_ENVIRONMENTS, SERVER_MEMORY);
  if (!existsSync(file)) return 0;
  const peak = Number(JSON.parse(readFileSync(file, "utf8")).serverPeakBytes);
  return peak > 0 ? peak : 0;
}

/**
 * The local workers the available memory holds at the peak the last run's largest app server reached, at most
 * `budgeted`, with why when fewer; `budgeted` when no run has recorded its servers' peak yet. Only the app servers are
 * measured, not the browsers or Playwright's own processes, and the reason says so.
 */
function memoryWorkers(budgeted, { cwd, availableMemory }) {
  const peak = browserTestServerPeakBytes({ cwd });
  if (!peak) return { workers: budgeted, memory: "" };
  const available = availableMemory();
  const held = Math.max(1, Math.floor(available / peak));
  if (held >= budgeted) return { workers: budgeted, memory: "" };
  const gib = (bytes) => `${(bytes / GIB).toFixed(1)} GiB`;
  return {
    workers: held,
    memory: `${held} worker${held === 1 ? "" : "s"}, not the ${budgeted} the test budget allows: ${gib(available)} of memory is ` +
      `available, and the largest app server peaked at ${gib(peak)} in the last run (only the app servers are measured, not ` +
      "the browsers or Playwright's own processes)"
  };
}

/** browserTestWorkers()'s count, and for a local run held back by memory, why. */
function workersOf({ env, argv, cwd, availableMemory }) {
  const asked = commandLineWorkers(argv) || positiveInteger(env.PLAYWRIGHT_WORKERS);
  const targets = managedBaseUrl(env) ? managedWorkerTargets(env) : null;
  if (targets && asked && asked !== targets.length) {
    throw new Error(`PLAYWRIGHT_WORKER_TARGETS lists ${targets.length} app servers, one per Playwright worker, so this run ` +
      `cannot use ${asked} workers. Leave the count to the host that serves them.`);
  }
  const chosen = targets?.length || asked || (managedBaseUrl(env) ? 1 : 0);
  if (chosen) return { workers: chosen, memory: "" };
  return memoryWorkers(Math.max(1, Math.floor(testConcurrency({ env }) / 2)), { cwd, availableMemory });
}

/**
 * How many workers a browser run uses: the command line's `--workers`, else PLAYWRIGHT_WORKERS, else half the machine's
 * test budget for a local run and 1 for a managed target (one server). A local worker drives a browser and its own app
 * server, about two threads' work: with a budget of 4, the shell foundation's 9 tests took 11.5 s on 4 workers and
 * 7.9 s on 2. A local run takes no more workers than the memory available holds at the peak its largest app server
 * reached in the last run (the launcher records it, on Linux), never fewer than one. A managed target whose host lists
 * several app servers (PLAYWRIGHT_WORKER_TARGETS) runs one worker per server, and refuses another count: a worker would
 * have no server, or a server no worker.
 * @param {{ env?: Record<string, string | undefined>, argv?: ReadonlyArray<string>, cwd?: string,
 *   availableMemory?: () => number }} [options]
 */
function browserTestWorkers({
  env = process.env,
  argv = process.argv,
  cwd = process.cwd(),
  availableMemory = systemAvailableMemory
} = {}) {
  return workersOf({ env, argv, cwd, availableMemory }).workers;
}

// Finds `count` consecutive ports nothing listens on, at a random place below Linux's ephemeral range, and prints the
// first. A child process, since a Playwright configuration is built synchronously.
const FREE_PORTS = `
const net = require("node:net");
const [host, count] = [process.argv[1], Number(process.argv[2])];
const listen = (port) => new Promise((resolve) => {
  const server = net.createServer();
  server.once("error", () => resolve(null));
  server.listen(port, host, () => resolve(server));
});
(async () => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const base = 20000 + Math.floor(Math.random() * (12000 - count));
    const held = [];
    while (held.length < count) {
      const server = await listen(base + held.length);
      if (!server) break;
      held.push(server);
    }
    await Promise.all(held.map((server) => new Promise((resolve) => server.close(resolve))));
    if (held.length === count) return process.stdout.write(String(base));
  }
  process.exitCode = 1;
})();`;

/** The first of `count` consecutive free ports on host: a local run's default, so two runs on one machine never share. */
function freeConsecutivePorts(host, count) {
  const found = spawnSync(process.execPath, ["-e", FREE_PORTS, host, String(count)], { encoding: "utf8", timeout: 30_000 });
  const port = positiveInteger(found.stdout);
  if (!port) throw new Error(`browserTestConfig() found no ${count} consecutive free port(s) on ${host}; set PLAYWRIGHT_PORT to free ports.`);
  return port;
}

/** The environment the launcher gave worker `index`'s server, from the app's prepare module, or none. */
function preparedWorkerEnvironment(file, index) {
  try {
    return JSON.parse(readFileSync(file, "utf8"))[index] ?? {};
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

/**
 * A Playwright worker's environment: the one prepare gave its server, from the run's worker environments, and the
 * databases its tests may open, that server's own (TEST_DATABASE_GUARD). A managed run's worker reads it when its host
 * names PLAYWRIGHT_PORT, the port it started `jskit browser-test-server` on; otherwise it may open no database, since
 * its environment's DB_NAME is the host's own, such as a development database.
 */
function workerEnvironment({ managed, servedPort, workerEnvironments, workerIndex }) {
  const given = "this Playwright worker was given";
  if (managed && !servedPort) {
    const fix = "A managed run's worker reaches its own server's database when the host names PLAYWRIGHT_PORT, the port it " +
      "started `jskit browser-test-server` on, beside PLAYWRIGHT_BASE_URL and PLAYWRIGHT_WORKER_TARGETS.";
    return { [TEST_DATABASE_GUARD]: JSON.stringify({ databases: [], given, fix }) };
  }
  if (managed && !existsSync(workerEnvironments)) {
    throw new Error(`PLAYWRIGHT_PORT names ${servedPort}, the port this managed run's \`jskit browser-test-server\` was started ` +
      `on, but its servers' environments (${workerEnvironments}) are not here: run the suite in the app those servers ` +
      "serve, while they run.");
  }
  const prepared = preparedWorkerEnvironment(workerEnvironments, workerIndex);
  const databases = [...new Set(DATABASE_VARIABLES.map((name) => String(prepared[name] || "").trim()).filter(Boolean))];
  const fix = databases.length > 0
    ? "Open the database through this worker's environment (process.env), which holds its own server's copy."
    : "This run's servers have no database of their own: browserTestConfig()'s prepare module answers each worker's DB_NAME.";
  return { ...prepared, [TEST_DATABASE_GUARD]: JSON.stringify({ databases, given, fix }) };
}

/**
 * The Playwright configuration of an application's browser tests.
 * @param {object} [options]
 * @param {string} [options.testDir] Where the specs are.
 * @param {number} [options.port] The first worker's port; worker n uses port + n. PLAYWRIGHT_PORT overrides it. By
 *   default a local run takes free ports and gives them to its workers in PLAYWRIGHT_PORT.
 * @param {string} [options.server] The command that starts the app server, reading PORT and HOST.
 * @param {string} [options.build] The command that builds the production frontend into the folder the server serves.
 * @param {string} [options.prepare] An app module, run once before the servers start, whose default export
 *   `({ workers, baseUrls })` returns each worker's server environment, such as its own DB_NAME. The worker's own
 *   process gets it too, so a test that opens the database itself reaches its own server's copy, and none other: the
 *   app's knexfile settings and runtime refuse any other database there. A managed run's worker gets it when its host
 *   names PLAYWRIGHT_PORT, the port it started `jskit browser-test-server` on; without it, it opens no database.
 * @param {string} [options.signIn] An app module whose default export `({ request, baseURL, workerIndex, env })` signs
 *   `request`, a Playwright APIRequestContext on one worker's server (`env` is that server's environment), in once,
 *   such as with `loginRequestAsExistingUser()` from @jskit-ai/auth-web/test/playwright. Each of that worker's tests
 *   starts from the signed-in state, which its process also finds in PLAYWRIGHT_STORAGE_STATE, as on a managed target.
 *   A test that must start signed out uses `test.use({ storageState: { cookies: [], origins: [] } })`; one that signs
 *   out or ends sessions signs in on its own first, so the worker's shared session lives on.
 * @param {Record<string, string>} [options.env] Environment every server gets, such as its test-only drivers.
 * @param {string} [options.health] The path that answers 200 once a server is ready.
 * @param {number} [options.globalTimeout] The whole run's bound in milliseconds (80 worker-minutes, never under 20
 *   minutes); never 0.
 * @param {number} [options.actionTimeout] One click, fill or other action's bound in milliseconds (15 s); never 0.
 * @param {number} [options.navigationTimeout] One navigation's bound in milliseconds (30 s); never 0.
 * @param {Record<string, string | undefined>} [options.environment] Read, and given a worker's prepared environment,
 *   instead of process.env (tests).
 * @param {string} [options.cwd] The directory Playwright runs in (tests).
 */
function browserTestConfig({
  testDir = "./tests/e2e",
  port = 0,
  server = "node ./bin/server.js",
  build = "npm run build",
  prepare = "",
  signIn = "",
  env = {},
  health = "/api/health",
  globalTimeout,
  actionTimeout = ACTION_TIMEOUT_MS,
  navigationTimeout = NAVIGATION_TIMEOUT_MS,
  environment = process.env,
  cwd = process.cwd(),
  availableMemory = systemAvailableMemory
} = {}) {
  if (globalTimeout !== undefined && (!Number.isInteger(globalTimeout) || globalTimeout < 1)) {
    throw new Error("browserTestConfig() needs a globalTimeout of at least 1 ms; a run is always bounded.");
  }
  for (const [name, value] of Object.entries({ actionTimeout, navigationTimeout })) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`browserTestConfig() needs an ${name} of at least 1 ms; a stale locator fails in seconds, not minutes.`);
    }
  }
  const managed = managedBaseUrl(environment);
  const { workers, memory } = workersOf({ env: environment, argv: process.argv, cwd, availableMemory });
  // A host serving the managed target several app servers: this worker's own, and its signed-in state.
  const workerTargets = managed ? managedWorkerTargets(environment) : null;
  const workerIndex = Number.parseInt(String(environment.TEST_PARALLEL_INDEX || "0"), 10) || 0;
  const workerTarget = workerTargets ? workerTargets[workerIndex] : null;
  if (workerTargets && !workerTarget) {
    throw new Error(`PLAYWRIGHT_WORKER_TARGETS has no app server for Playwright worker ${workerIndex}.`);
  }
  const runTimeout = globalTimeout ?? Math.max(MIN_GLOBAL_TIMEOUT_MS, Math.ceil(WORKER_MINUTES_MS / workers));
  let basePort = positiveInteger(environment.PLAYWRIGHT_PORT) || port;
  if (!basePort && !managed) {
    // Playwright's workers load this config again: they take the ports the run took, which only the run finds.
    if (String(environment.TEST_PARALLEL_INDEX ?? "").trim() !== "") {
      throw new Error("A Playwright worker found no PLAYWRIGHT_PORT: the run's own configuration sets it before its workers start.");
    }
    basePort = freeConsecutivePorts(HOST, workers);
    environment.PLAYWRIGHT_PORT = String(basePort);
  }
  // A Playwright worker loads this config again, with its own TEST_PARALLEL_INDEX, and reaches its own server; its
  // process takes the environment prepare gave that server, such as its DB_NAME, before any test file loads. A managed
  // run's servers are `jskit browser-test-server`'s, worker i's on the port its host started it on plus i, which the
  // host names in PLAYWRIGHT_PORT: the targets' URLs may reach them through other ports.
  const servedPort = managed ? positiveInteger(environment.PLAYWRIGHT_PORT) : basePort;
  const workerEnvironments = path.resolve(cwd, WORKER_ENVIRONMENTS, `workers-${servedPort || basePort}.json`);
  // A login state the host supplies is used as it is; the servers sign in only when there is none. A worker of a
  // project that depends on another (a setup project) inherits the environment that project's workers changed,
  // including the state this harness gave them, so one of this harness's own states is never taken for the host's.
  const ownStates = path.resolve(cwd, WORKER_ENVIRONMENTS, `signed-in-${basePort}`);
  const suppliedState = String(environment.PLAYWRIGHT_STORAGE_STATE || "").trim();
  const hostState = suppliedState.startsWith(`${ownStates}-`) ? "" : suppliedState;
  const signedInStates = signIn && !managed && !hostState ? ownStates : "";
  if (environment.TEST_PARALLEL_INDEX !== undefined) {
    Object.assign(environment, workerEnvironment({ managed, servedPort, workerEnvironments, workerIndex }));
    if (signedInStates) environment.PLAYWRIGHT_STORAGE_STATE = `${signedInStates}-${workerIndex}.json`;
  }
  const storageState = workerTarget ? workerTarget.storageState : String(environment.PLAYWRIGHT_STORAGE_STATE || "").trim();
  const settings = {
    workers, host: HOST, basePort, server, build, prepare, env, health, workerEnvironments,
    ...(signedInStates ? { signIn, signedInStates } : {}),
    ...(memory ? { memory } : {})
  };

  return {
    testDir,
    workers,
    globalTimeout: runTimeout,
    timeout: 60_000,
    expect: { timeout: 10_000 },
    // Every run ends with its 10 slowest tests and their times.
    reporter: [["list"], [SLOWEST_TESTS]],
    use: {
      baseURL: workerTarget?.baseURL || managed || `http://${HOST}:${basePort + workerIndex}`,
      headless: true,
      actionTimeout,
      navigationTimeout,
      // A failed test keeps its trace to read; no screencast is recorded while tests run.
      trace: { mode: "retain-on-failure", screenshots: false, snapshots: true, sources: true },
      ...(storageState ? { storageState } : {})
    },
    ...(managed ? {} : {
      webServer: {
        command: `node ${JSON.stringify(SERVERS)}`,
        env: { [SETTINGS_VARIABLE]: JSON.stringify(settings) },
        wait: { stdout: READY },
        timeout: SERVERS_TIMEOUT_MS,
        stdout: "pipe",
        stderr: "pipe",
        gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 }
      }
    })
  };
}

export { SETTINGS_VARIABLE, browserTestConfig, browserTestServerPeakBytes, browserTestWorkers };
