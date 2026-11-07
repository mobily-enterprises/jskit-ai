// The webServer of a local browser run (browser-tests.mjs): builds the production frontend unless its build is current
// (browser-test-build.mjs), runs the app's `prepare` module once for every worker's environment (its own database), then
// starts one app server per Playwright worker, each on its own port, and prints the ready line Playwright waits for.
// Each worker's server environment is also left, readable only by this user, where the worker's own process takes it
// (browser-tests.mjs). Each server's output goes to test-results/browser-test-servers/worker-<n>.log; a server that
// stops ends the run.
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { buildFrontend } from "./browser-test-build.mjs";

const SETTINGS_VARIABLE = "JSKIT_BROWSER_TESTS";
const LOG_DIRECTORY = path.join("test-results", "browser-test-servers");
const READY_TIMEOUT_MS = 60_000;

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
function stopServers() {
  stopping = true;
  for (const server of servers) server.kill("SIGTERM");
}
process.once("SIGINT", () => { stopServers(); process.exit(130); });
process.once("SIGTERM", () => { stopServers(); process.exit(143); });
process.once("exit", stopServers);

const started = performance.now();
const appRoot = process.cwd();
const { workers, host, basePort, server, build, prepare, env, health, workerEnvironments: workerEnvironmentsFile } =
  JSON.parse(process.env[SETTINGS_VARIABLE] || "{}");
const baseEnvironment = { ...process.env };
delete baseEnvironment[SETTINGS_VARIABLE];
const baseUrls = Array.from({ length: workers }, (_, index) => `http://${host}:${basePort + index}`);
try {
  const [, workerEnvironments] = await Promise.all([
    buildFrontend({ appRoot, build }),
    prepareWorkers(appRoot, prepare, workers, baseUrls)
  ]);
  mkdirSync(path.join(appRoot, LOG_DIRECTORY), { recursive: true });
  mkdirSync(path.dirname(workerEnvironmentsFile), { recursive: true });
  writeFileSync(workerEnvironmentsFile, JSON.stringify(workerEnvironments.slice(0, workers)), { mode: 0o600 });
  const [program, ...args] = words(server);
  await Promise.all(workerEnvironments.slice(0, workers).map((workerEnvironment, index) => {
    const port = basePort + index;
    const baseUrl = baseUrls[index];
    const name = `The browser test server of worker ${index} (${baseUrl})`;
    const log = path.join(LOG_DIRECTORY, `worker-${index}.log`);
    const child = spawn(program, args, {
      cwd: appRoot,
      env: {
        ...baseEnvironment,
        ...env,
        ...workerEnvironment,
        HOST: host,
        PORT: String(port),
        TEST_PARALLEL_INDEX: String(index)
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    const output = createWriteStream(path.join(appRoot, log));
    child.stdout.pipe(output);
    child.stderr.pipe(output);
    child.once("exit", (code, signal) => {
      if (stopping) return;
      console.error(`[browser-tests] ${name} stopped (${signal || `exit ${code}`}); log: ${log}`);
      stopServers();
      process.exit(1);
    });
    servers.push(child);
    return waitUntilReady(new URL(health, baseUrl), child, name);
  }));
  console.log(`jskit browser tests: ${workers} server(s) ready in ${seconds(started)}; logs in ${LOG_DIRECTORY}.`);
} catch (error) {
  console.error(`[browser-tests] ${error.message}`);
  stopServers();
  process.exit(1);
}
