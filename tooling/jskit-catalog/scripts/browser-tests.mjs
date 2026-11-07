import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { testConcurrency } from "./test-budget.mjs";

// An application's Playwright configuration: `defineConfig(browserTestConfig({ ... }))`. A local run builds the
// production frontend once (cached by its sources) and starts one app server per Playwright worker, each on its own port
// and, through the app's `prepare` module, its own database, so workers run in parallel without sharing data
// (browser-test-servers.mjs). With PLAYWRIGHT_BASE_URL set, the tests use that managed target instead, as its host
// serves it, one worker at a time unless the runner sets PLAYWRIGHT_WORKERS.

const SERVERS = fileURLToPath(new URL("./browser-test-servers.mjs", import.meta.url));
const SLOWEST_TESTS = fileURLToPath(new URL("./browser-test-times.mjs", import.meta.url));
const SETTINGS_VARIABLE = "JSKIT_BROWSER_TESTS";
const READY = /^jskit browser tests: \d+ server\(s\) ready/mu;
const HOST = "127.0.0.1";
const DEFAULT_PORT = 4173;
// A whole run's default bound: a suite that would take hours stops instead, and says so. A suite measured to need
// longer passes its own globalTimeout, with the measurement beside it.
const GLOBAL_TIMEOUT_MS = 20 * 60_000;
// Building the frontend when its sources changed, preparing the databases and starting every server.
const SERVERS_TIMEOUT_MS = 180_000;
// Where the servers' launcher leaves each worker's server environment, for that worker's own process.
const WORKER_ENVIRONMENTS = path.join("node_modules", ".cache", "jskit-browser-tests");

const positiveInteger = (value) => (/^[1-9]\d*$/u.test(String(value ?? "").trim()) ? Number(String(value).trim()) : 0);

function managedBaseUrl(env) {
  return String(env.PLAYWRIGHT_BASE_URL || "").trim().replace(/\/+$/u, "");
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
 * 7.9 s on 2.
 * @param {{ env?: Record<string, string | undefined>, argv?: ReadonlyArray<string> }} [options]
 */
function browserTestWorkers({ env = process.env, argv = process.argv } = {}) {
  return commandLineWorkers(argv) || positiveInteger(env.PLAYWRIGHT_WORKERS) ||
    (managedBaseUrl(env) ? 1 : Math.max(1, Math.floor(testConcurrency({ env }) / 2)));
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
 * @param {number} [options.port] The first worker's port; worker n uses port + n. PLAYWRIGHT_PORT overrides it.
 * @param {string} [options.server] The command that starts the app server, reading PORT and HOST.
 * @param {string} [options.build] The command that builds the production frontend into the folder the server serves.
 * @param {string} [options.prepare] An app module, run once before the servers start, whose default export
 *   `({ workers, baseUrls })` returns each worker's server environment, such as its own DB_NAME. The worker's own
 *   process gets it too, so a test that opens the database itself reaches its own server's copy.
 * @param {Record<string, string>} [options.env] Environment every server gets, such as its test-only drivers.
 * @param {string} [options.health] The path that answers 200 once a server is ready.
 * @param {number} [options.globalTimeout] The whole run's bound in milliseconds (20 minutes); never 0.
 * @param {Record<string, string | undefined>} [options.environment] Read, and given a worker's prepared environment,
 *   instead of process.env (tests).
 * @param {string} [options.cwd] The directory Playwright runs in (tests).
 */
function browserTestConfig({
  testDir = "./tests/e2e",
  port = DEFAULT_PORT,
  server = "node ./bin/server.js",
  build = "npm run build",
  prepare = "",
  env = {},
  health = "/api/health",
  globalTimeout = GLOBAL_TIMEOUT_MS,
  environment = process.env,
  cwd = process.cwd()
} = {}) {
  if (!Number.isInteger(globalTimeout) || globalTimeout < 1) {
    throw new Error("browserTestConfig() needs a globalTimeout of at least 1 ms; a run is always bounded.");
  }
  const managed = managedBaseUrl(environment);
  const workers = browserTestWorkers({ env: environment });
  const basePort = positiveInteger(environment.PLAYWRIGHT_PORT) || port;
  // A Playwright worker loads this config again, with its own TEST_PARALLEL_INDEX, and reaches its own server; its
  // process takes the environment prepare gave that server, such as its DB_NAME, before any test file loads.
  const workerIndex = managed ? 0 : Number.parseInt(String(environment.TEST_PARALLEL_INDEX || "0"), 10) || 0;
  const workerEnvironments = path.resolve(cwd, WORKER_ENVIRONMENTS, `workers-${basePort}.json`);
  if (!managed && environment.TEST_PARALLEL_INDEX !== undefined) {
    Object.assign(environment, preparedWorkerEnvironment(workerEnvironments, workerIndex));
  }
  const storageState = String(environment.PLAYWRIGHT_STORAGE_STATE || "").trim();
  const settings = { workers, host: HOST, basePort, server, build, prepare, env, health, workerEnvironments };

  return {
    testDir,
    workers,
    globalTimeout,
    timeout: 60_000,
    expect: { timeout: 10_000 },
    // Every run ends with its 10 slowest tests and their times.
    reporter: [["list"], [SLOWEST_TESTS]],
    use: {
      baseURL: managed || `http://${HOST}:${basePort + workerIndex}`,
      headless: true,
      // A click, fill or navigation waiting on something that never comes fails in seconds, with its own error.
      actionTimeout: 15_000,
      navigationTimeout: 30_000,
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
