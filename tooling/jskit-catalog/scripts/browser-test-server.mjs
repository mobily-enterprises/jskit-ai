// `jskit browser-test-server [host] [port] [workers]`: the app as a host serves it for a browser test run, such as a
// Vibe64 Outputs target with `Data: test`. It is the servers of a local run's workers (browser-tests.mjs,
// browser-test-servers.mjs), read from the app's own playwright.config.mjs: the production build, built once, and for
// each worker i on port+i the database the app's `prepare` module gives it (its own copy of BROWSER_TEST_DB_NAME in the
// database patterns, prepared once for every worker), the test-only `env` and APP_ENV=test, on the host's address in
// place of the run's own ports. The host's suite then runs against them as a managed target (PLAYWRIGHT_BASE_URL, and
// PLAYWRIGHT_WORKER_TARGETS for several), signed in with the login state its host supplies, so these servers sign
// nothing in; with the port in PLAYWRIGHT_PORT, each of its workers takes its own server's prepared environment, its
// DB_NAME among them, from the worker environments these servers leave in the app (browserTestConfig()). The host and port come from the arguments, else HOST and PORT; workers, from 1 to 64, from the third
// argument, else 1. The servers' output also reaches this command's own; stopping the command stops them.
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { SETTINGS_VARIABLE } from "./browser-tests.mjs";

const CONFIG_FILES = Object.freeze(["playwright.config.mjs", "playwright.config.js"]);
// As many app servers as one host run asks for (Vibe64 admits a run of at most 64 workers).
const MAX_WORKERS = 64;

/**
 * Serves the app in `appRoot` as browser test servers, until it is stopped.
 * @param {string[]} args `[host, port, workers]`: host and port may be left to HOST and PORT, workers to 1.
 * @param {Record<string, string | undefined>} [environment] This process's environment, given the run's settings.
 * @param {string} [appRoot]
 */
async function serveBrowserTestTarget(args = [], environment = process.env, appRoot = process.cwd()) {
  if (args.length > 3) throw new Error("Usage: jskit browser-test-server [host] [port] [workers]");
  const host = String(args[0] || environment.HOST || "").trim() || "127.0.0.1";
  const port = String(args[1] || environment.PORT || "").trim();
  if (!/^[1-9]\d{0,4}$/u.test(port) || Number(port) > 65_535) {
    throw new Error(`jskit browser-test-server needs the port to serve on, as its second argument or PORT, not ${port || "nothing"}.`);
  }
  const workers = String(args[2] ?? "1").trim();
  if (!/^[1-9]\d?$/u.test(workers) || Number(workers) > MAX_WORKERS) {
    throw new Error(`jskit browser-test-server serves 1 to ${MAX_WORKERS} app servers, not ${workers || "nothing"}.`);
  }
  // What a local run's config reads for its workers from this port. A suite runner's settings left in a host's
  // environment (its managed target and servers, login state, worker count or index) are not these servers'.
  for (const name of ["PLAYWRIGHT_BASE_URL", "PLAYWRIGHT_STORAGE_STATE", "PLAYWRIGHT_WORKER_TARGETS", "TEST_PARALLEL_INDEX"]) {
    delete environment[name];
  }
  Object.assign(environment, { PLAYWRIGHT_PORT: port, PLAYWRIGHT_WORKERS: workers });
  const config = CONFIG_FILES.map((name) => path.join(appRoot, name)).find((file) => existsSync(file));
  const loaded = config ? (await import(pathToFileURL(config).href)).default : null;
  const settings = loaded?.webServer?.env?.[SETTINGS_VARIABLE];
  if (!settings) {
    throw new Error(`jskit browser-test-server serves the app as its Playwright config's browserTestConfig() describes, and ` +
      `${config ? path.basename(config) : "playwright.config.mjs"} ${config ? "does not use it" : "is missing"}: export ` +
      "defineConfig(browserTestConfig({ ... })) from @jskit-ai/jskit-catalog/browser-tests there.");
  }
  const served = { ...JSON.parse(settings), host, terminal: true };
  delete served.signIn;
  delete served.signedInStates;
  environment[SETTINGS_VARIABLE] = JSON.stringify(served);
  await import("./browser-test-servers.mjs");
}

export { serveBrowserTestTarget };
