import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

/**
 * How many workers a browser run uses: the command line's `--workers`, else PLAYWRIGHT_WORKERS, else half the machine's
 * test budget for a local run and 1 for a managed target (one server). A local worker drives a browser and its own app
 * server, about two threads' work: with a budget of 4, the shell foundation's 9 tests took 11.5 s on 4 workers and
 * 7.9 s on 2. A managed target whose host lists several app servers (PLAYWRIGHT_WORKER_TARGETS) runs one worker per
 * server, and refuses another count: a worker would have no server, or a server no worker.
 * @param {{ env?: Record<string, string | undefined>, argv?: ReadonlyArray<string> }} [options]
 */
function browserTestWorkers({ env = process.env, argv = process.argv } = {}) {
  const asked = commandLineWorkers(argv) || positiveInteger(env.PLAYWRIGHT_WORKERS);
  const targets = managedBaseUrl(env) ? managedWorkerTargets(env) : null;
  if (targets && asked && asked !== targets.length) {
    throw new Error(`PLAYWRIGHT_WORKER_TARGETS lists ${targets.length} app servers, one per Playwright worker, so this run ` +
      `cannot use ${asked} workers. Leave the count to the host that serves them.`);
  }
  return targets?.length || asked || (managedBaseUrl(env) ? 1 : Math.max(1, Math.floor(testConcurrency({ env }) / 2)));
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
 * The Playwright configuration of an application's browser tests.
 * @param {object} [options]
 * @param {string} [options.testDir] Where the specs are.
 * @param {number} [options.port] The first worker's port; worker n uses port + n. PLAYWRIGHT_PORT overrides it. By
 *   default a local run takes free ports and gives them to its workers in PLAYWRIGHT_PORT.
 * @param {string} [options.server] The command that starts the app server, reading PORT and HOST.
 * @param {string} [options.build] The command that builds the production frontend into the folder the server serves.
 * @param {string} [options.prepare] An app module, run once before the servers start, whose default export
 *   `({ workers, baseUrls })` returns each worker's server environment, such as its own DB_NAME. The worker's own
 *   process gets it too, so a test that opens the database itself reaches its own server's copy.
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
  cwd = process.cwd()
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
  const workers = browserTestWorkers({ env: environment });
  // A host serving the managed target several app servers: this worker's own, and its signed-in state.
  const workerTargets = managed ? managedWorkerTargets(environment) : null;
  const managedIndex = Number.parseInt(String(environment.TEST_PARALLEL_INDEX || "0"), 10) || 0;
  const workerTarget = workerTargets ? workerTargets[managedIndex] : null;
  if (workerTargets && !workerTarget) {
    throw new Error(`PLAYWRIGHT_WORKER_TARGETS has no app server for Playwright worker ${managedIndex}.`);
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
  // process takes the environment prepare gave that server, such as its DB_NAME, before any test file loads.
  const workerIndex = managed ? 0 : Number.parseInt(String(environment.TEST_PARALLEL_INDEX || "0"), 10) || 0;
  const workerEnvironments = path.resolve(cwd, WORKER_ENVIRONMENTS, `workers-${basePort}.json`);
  // A login state the host supplies is used as it is; the servers sign in only when there is none. A worker of a
  // project that depends on another (a setup project) inherits the environment that project's workers changed,
  // including the state this harness gave them, so one of this harness's own states is never taken for the host's.
  const ownStates = path.resolve(cwd, WORKER_ENVIRONMENTS, `signed-in-${basePort}`);
  const suppliedState = String(environment.PLAYWRIGHT_STORAGE_STATE || "").trim();
  const hostState = suppliedState.startsWith(`${ownStates}-`) ? "" : suppliedState;
  const signedInStates = signIn && !managed && !hostState ? ownStates : "";
  if (!managed && environment.TEST_PARALLEL_INDEX !== undefined) {
    Object.assign(environment, preparedWorkerEnvironment(workerEnvironments, workerIndex));
    if (signedInStates) environment.PLAYWRIGHT_STORAGE_STATE = `${signedInStates}-${workerIndex}.json`;
  }
  const storageState = workerTarget ? workerTarget.storageState : String(environment.PLAYWRIGHT_STORAGE_STATE || "").trim();
  const settings = {
    workers, host: HOST, basePort, server, build, prepare, env, health, workerEnvironments,
    ...(signedInStates ? { signIn, signedInStates } : {})
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

export { SETTINGS_VARIABLE, browserTestConfig, browserTestWorkers };
