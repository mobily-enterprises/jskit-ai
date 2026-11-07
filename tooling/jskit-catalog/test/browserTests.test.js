import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildFrontend } from "../scripts/browser-test-build.mjs";
import { SETTINGS_VARIABLE, browserTestConfig, browserTestWorkers } from "../scripts/browser-tests.mjs";
import { discoverProjectManifests } from "../scripts/project-manifests.mjs";
import { checkTestRuns } from "../scripts/test-runs.mjs";

const SERVERS = fileURLToPath(new URL("../scripts/browser-test-servers.mjs", import.meta.url));
const TIMES_REPORTER = fileURLToPath(new URL("../scripts/browser-test-times.mjs", import.meta.url));

async function withProject(files, run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "jskit-browser-tests-"));
  try {
    for (const [file, content] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`);
    }
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("each local worker reaches its own server's port, and the run is bounded and reports its slowest tests", () => {
  const environment = { V64_TEST_CONCURRENCY: "4" };
  const config = browserTestConfig({ environment });
  // Half the budget: each worker drives a browser and its own server.
  assert.equal(config.workers, 2);
  assert.equal(config.testDir, "./tests/e2e");
  assert.equal(config.globalTimeout, 20 * 60_000);
  assert.equal(config.timeout, 60_000);
  assert.deepEqual(config.reporter, [["list"], [TIMES_REPORTER]]);
  assert.match(config.webServer.command, /browser-test-servers\.mjs"$/u);
  assert.equal(config.webServer.timeout, 180_000);
  assert.match("jskit browser tests: 4 server(s) ready in 3.1s; logs in test-results/browser-test-servers.", config.webServer.wait.stdout);
  assert.deepEqual(JSON.parse(config.webServer.env[SETTINGS_VARIABLE]), {
    workers: 2,
    host: "127.0.0.1",
    basePort: 4173,
    server: "node ./bin/server.js",
    build: "npm run build",
    prepare: "",
    env: {},
    health: "/api/health",
    workerEnvironments: path.resolve("node_modules", ".cache", "jskit-browser-tests", "workers-4173.json")
  });

  const baseURLs = ["0", "1", "2", "3"].map((index) =>
    browserTestConfig({ environment: { ...environment, TEST_PARALLEL_INDEX: index } }).use.baseURL);
  assert.deepEqual(baseURLs, ["http://127.0.0.1:4173", "http://127.0.0.1:4174", "http://127.0.0.1:4175", "http://127.0.0.1:4176"]);
  assert.equal(new Set(baseURLs).size, 4);
  assert.equal(browserTestConfig({ environment: { PLAYWRIGHT_PORT: "4183", TEST_PARALLEL_INDEX: "1" } }).use.baseURL,
    "http://127.0.0.1:4184");
  assert.equal(browserTestConfig({ port: 4300, environment: {} }).use.baseURL, "http://127.0.0.1:4300");
  // A failed test keeps a trace without a screencast; a suite measured to need longer sets its own bound, never none.
  assert.deepEqual(config.use.trace, { mode: "retain-on-failure", screenshots: false, snapshots: true, sources: true });
  assert.equal(browserTestConfig({ globalTimeout: 45 * 60_000, environment }).globalTimeout, 45 * 60_000);
  for (const globalTimeout of [0, -1, 1.5, "600000"]) {
    assert.throws(() => browserTestConfig({ globalTimeout, environment }), /globalTimeout of at least 1 ms/u, String(globalTimeout));
  }
});

test("a managed target starts no server and runs one worker unless the runner sets PLAYWRIGHT_WORKERS", () => {
  const environment = { PLAYWRIGHT_BASE_URL: "https://preview.example.test/", V64_TEST_CONCURRENCY: "4", TEST_PARALLEL_INDEX: "2" };
  const config = browserTestConfig({ environment });
  assert.equal(config.webServer, undefined);
  assert.equal(config.workers, 1);
  assert.equal(config.use.baseURL, "https://preview.example.test");
  assert.equal(config.globalTimeout, 20 * 60_000);
  assert.equal(browserTestConfig({ environment: { ...environment, PLAYWRIGHT_WORKERS: "3" } }).workers, 3);
  assert.equal(browserTestConfig({ environment: { ...environment, PLAYWRIGHT_STORAGE_STATE: "/tmp/state.json" } }).use.storageState,
    "/tmp/state.json");
});

test("the command line's --workers starts that many servers, and a percentage is refused", () => {
  assert.equal(browserTestWorkers({ env: { V64_TEST_CONCURRENCY: "4" }, argv: ["node", "playwright", "test", "--workers=2"] }), 2);
  assert.equal(browserTestWorkers({ env: {}, argv: ["node", "playwright", "test", "-j", "3"] }), 3);
  assert.equal(browserTestWorkers({ env: { PLAYWRIGHT_WORKERS: "5" }, argv: [] }), 5);
  assert.equal(browserTestWorkers({ env: { V64_TEST_CONCURRENCY: "6" }, argv: [] }), 3);
  assert.equal(browserTestWorkers({ env: { V64_TEST_CONCURRENCY: "1" }, argv: [] }), 1);
  assert.throws(() => browserTestWorkers({ env: {}, argv: ["--workers=50%"] }), /whole number of workers/u);
});

test("the frontend is built once, and rebuilt only when an input's contents change or its served build is gone", async () => {
  await withProject({ "package.json": { name: "app" }, "index.html": "<div id=app></div>", "src/main.js": "export {};\n" }, async (root) => {
    let builds = 0;
    const run = async () => {
      builds += 1;
      // As vue-router's plugin does, the build rewrites a file it generates among its inputs, with the same contents.
      await writeFile(path.join(root, "src", "typed-router.d.ts"), "export {};\n");
      await mkdir(path.join(root, "dist"), { recursive: true });
      await writeFile(path.join(root, "dist", "index.html"), `<!-- build ${builds} -->`);
    };
    assert.deepEqual(await buildFrontend({ appRoot: root, run }), { built: true });
    // The first build added typed-router.d.ts, an input the next run sees.
    assert.deepEqual(await buildFrontend({ appRoot: root, run }), { built: true });
    assert.deepEqual(await buildFrontend({ appRoot: root, run }), { built: false });
    assert.deepEqual(await buildFrontend({ appRoot: root, run }), { built: false });
    assert.equal(builds, 2);

    await writeFile(path.join(root, "src", "main.js"), "export const changed = true;\n");
    assert.deepEqual(await buildFrontend({ appRoot: root, run }), { built: true });
    // A touched file whose contents are unchanged builds the same frontend.
    const later = new Date(Date.now() + 5_000);
    await utimes(path.join(root, "src", "main.js"), later, later);
    assert.deepEqual(await buildFrontend({ appRoot: root, run }), { built: false });
    // Another build (a plain `npm run build` after a source edit and revert) replaced the served one.
    await writeFile(path.join(root, "dist", "index.html"), "<!-- someone else's build -->");
    assert.deepEqual(await buildFrontend({ appRoot: root, run }), { built: true });
    assert.deepEqual(await buildFrontend({ appRoot: root, run, build: "npm run build:all" }), { built: true });
    assert.equal(builds, 5);

    await assert.rejects(buildFrontend({ appRoot: root, run: async () => rm(path.join(root, "dist"), { recursive: true }) }),
      /made no dist\/index\.html/u);
  });
});

test("every file at the app's root is a build input except other dotfiles and notes, and runs in one tree build once", async () => {
  await withProject({ "package.json": { name: "app" }, "index.html": "<link rel=icon href=/favicon.svg>", "favicon.svg": "<svg/>" }, async (root) => {
    let builds = 0;
    const run = async () => {
      builds += 1;
      // Long enough for the other run to find the lock held.
      await new Promise((resolve) => setTimeout(resolve, 300));
      await mkdir(path.join(root, "dist"), { recursive: true });
      await writeFile(path.join(root, "dist", "index.html"), `<!-- build ${builds} -->`);
    };
    // Two runs at once: the second waits for the first one's build and reuses it.
    const both = await Promise.all([buildFrontend({ appRoot: root, run }), buildFrontend({ appRoot: root, run })]);
    assert.deepEqual(both.map(({ built }) => built).sort(), [false, true]);
    assert.equal(builds, 1);

    for (const [file, content, rebuilt] of [
      ["favicon.svg", "<svg viewBox='0 0 1 1'/>", true],
      [".env", "VITE_TITLE=changed\n", true],
      [".env.production.local", "VITE_TITLE=local\n", true],
      [".eslintcache", "[]", false],
      ["NOTES.md", "# notes\n", false]
    ]) {
      await writeFile(path.join(root, file), content);
      assert.equal((await buildFrontend({ appRoot: root, run })).built, rebuilt, file);
    }
    assert.equal(builds, 4);
  });
});

const APP_SERVER = `import http from "node:http";
http.createServer((request, response) => {
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ port: process.env.PORT, database: process.env.DB_NAME, index: process.env.TEST_PARALLEL_INDEX,
    publicUrl: process.env.PUBLIC_APP_URL, driver: process.env.EMAIL_DRIVER }));
}).listen(Number(process.env.PORT), process.env.HOST);
`;
const PREPARE = "export default async ({ workers, baseUrls }) => Array.from({ length: workers }, (_, index) => " +
  "({ DB_NAME: `app_browser_${index}`, PUBLIC_APP_URL: baseUrls[index] }));\n";
const BUILD = "import { mkdirSync, writeFileSync } from \"node:fs\";\nmkdirSync(\"dist\", { recursive: true });\nwriteFileSync(\"dist/index.html\", \"built\");\n";

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    let errors = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (/^jskit browser tests: \d+ server\(s\) ready/mu.test(output)) resolve(output);
    });
    child.stderr.on("data", (chunk) => { errors += chunk; });
    child.once("exit", (code) => reject(new Error(`the launcher stopped (${code}): ${errors}`)));
  });
}

test("a local run starts one server per worker, each on its own port and with its own database", async () => {
  await withProject({
    "package.json": { name: "app", type: "module" },
    "server.mjs": APP_SERVER,
    "build.mjs": BUILD,
    "tests/e2e/databases.mjs": PREPARE
  }, async (root) => {
    // Ports a busy machine is unlikely to be using.
    const basePort = 40_000 + (process.pid % 10_000);
    const settings = {
      workers: 3, host: "127.0.0.1", basePort, server: "node ./server.mjs", build: "node ./build.mjs",
      prepare: "tests/e2e/databases.mjs", env: { EMAIL_DRIVER: "simulate" }, health: "/api/health",
      workerEnvironments: path.join(root, "node_modules", ".cache", "jskit-browser-tests", `workers-${basePort}.json`)
    };
    const child = spawn(process.execPath, [SERVERS], {
      cwd: root,
      env: { ...process.env, [SETTINGS_VARIABLE]: JSON.stringify(settings) },
      stdio: ["ignore", "pipe", "pipe"]
    });
    try {
      const output = await waitForReady(child);
      assert.match(output, /Frontend built in/u);
      assert.equal(await readFile(path.join(root, "dist", "index.html"), "utf8"), "built");
      const servers = await Promise.all([0, 1, 2].map(async (index) =>
        (await fetch(`http://127.0.0.1:${basePort + index}/api/health`)).json()));
      assert.deepEqual(servers, [0, 1, 2].map((index) => ({
        port: String(basePort + index),
        database: `app_browser_${index}`,
        index: String(index),
        publicUrl: `http://127.0.0.1:${basePort + index}`,
        driver: "simulate"
      })));
      // A worker's own process gets its server's prepared environment, so a test that opens the database itself
      // reaches its server's copy; only this user may read it.
      assert.equal((await stat(settings.workerEnvironments)).mode & 0o777, 0o600);
      const worker = { PLAYWRIGHT_PORT: String(basePort), TEST_PARALLEL_INDEX: "1", DB_NAME: "app_development" };
      assert.equal(browserTestConfig({ environment: worker, cwd: root }).use.baseURL, `http://127.0.0.1:${basePort + 1}`);
      assert.equal(worker.DB_NAME, "app_browser_1");
      assert.equal(worker.PUBLIC_APP_URL, `http://127.0.0.1:${basePort + 1}`);
      const runner = { PLAYWRIGHT_PORT: String(basePort), DB_NAME: "app_development" };
      browserTestConfig({ environment: runner, cwd: root });
      assert.equal(runner.DB_NAME, "app_development");
    } finally {
      child.kill("SIGTERM");
    }
  });
});

async function findings(root) {
  const result = await checkTestRuns({ projectRoot: root, manifests: await discoverProjectManifests(root) });
  return result.findings.map(({ file, line, rule }) => `${file}:${line} ${rule}`);
}

const HARNESS_CONFIG = `import { defineConfig } from "@playwright/test";
import { browserTestConfig } from "@jskit-ai/jskit-catalog/browser-tests";

export default defineConfig(browserTestConfig({ testDir: "./tests/e2e" }));
`;

test("jskit check passes a Playwright config built by browserTestConfig() and fails one that drops its isolation", async () => {
  const app = (config, scripts = {}) => ({
    "package.json": { name: "browser-app", scripts: { "test:e2e": "playwright test tests/e2e", ...scripts } },
    "playwright.config.mjs": config
  });
  await withProject(app(HARNESS_CONFIG), async (root) => assert.deepEqual(await findings(root), []));
  const overridden = HARNESS_CONFIG.replace("(browserTestConfig({ testDir: \"./tests/e2e\" }))",
    "({ ...browserTestConfig({ testDir: \"./tests/e2e\" }), workers: 1, globalTimeout: 0 })");
  assert.notEqual(overridden, HARNESS_CONFIG);
  await withProject(app(overridden),
    async (root) => assert.deepEqual(await findings(root), [
      "playwright.config.mjs:4 test/playwright-workers",
      "playwright.config.mjs:4 test/playwright-global-timeout"
    ]));
  await withProject(app(HARNESS_CONFIG, { "test:e2e": "PLAYWRIGHT_WORKERS=1 playwright test", "test:all": "V64_TEST_CONCURRENCY=8 jskit test" }),
    async (root) => assert.deepEqual(await findings(root), [
      "package.json:4 test/fixed-concurrency",
      "package.json:5 test/fixed-concurrency"
    ]));
});

const BUDGET_IMPORT = "import { testConcurrency } from \"@jskit-ai/jskit-catalog/test-budget\";\n";

test("jskit check fails a Playwright webServer on the development server, shared by every worker, or an unbounded run", async () => {
  const configs = {
    "develop.config.mjs": `${BUDGET_IMPORT}export default {\n  workers: testConcurrency(),\n  globalTimeout: 600_000,\n  webServer: { command: "npm run develop" }\n};\n`,
    "vite-dev.config.mjs": `${BUDGET_IMPORT}export default {\n  workers: testConcurrency(),\n  globalTimeout: 600_000,\n  webServer: { command: 'npx vite --port 4173' }\n};\n`,
    "built.config.mjs": `${BUDGET_IMPORT}export default {\n  workers: testConcurrency(),\n  globalTimeout: 600_000,\n  webServer: { command: "npm run build && node ./bin/server.js" }\n};\n`,
    "unbounded.config.mjs": `${BUDGET_IMPORT}export default {\n  workers: testConcurrency()\n};\n`,
    "bounded.config.mjs": `${BUDGET_IMPORT}export default {\n  workers: testConcurrency(),\n  globalTimeout: 600_000\n};\n`
  };
  await withProject({
    "package.json": {
      name: "shared-server",
      scripts: Object.fromEntries(Object.keys(configs).map((file) => [`test:${file.split(".")[0]}`, `playwright test -c ${file}`]))
    },
    ...configs
  }, async (root) => {
    assert.deepEqual(await findings(root), [
      "built.config.mjs:5 test/playwright-isolation",
      "develop.config.mjs:5 test/playwright-dev-server",
      "develop.config.mjs:5 test/playwright-isolation",
      "unbounded.config.mjs:1 test/playwright-global-timeout",
      "vite-dev.config.mjs:5 test/playwright-dev-server",
      "vite-dev.config.mjs:5 test/playwright-isolation"
    ]);
  });
});
