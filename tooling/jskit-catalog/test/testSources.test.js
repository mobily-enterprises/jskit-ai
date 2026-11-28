import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { checkTestSources, formatTestSourcesReport } from "../scripts/test-sources.mjs";
import { planTestRuns } from "../scripts/test-command.mjs";

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL("../scripts/jskit.mjs", import.meta.url));
const GUIDE = "https://mobily-enterprises.github.io/jskit-ai/guide/framework/typed-features#test-source-rules";

async function withProject(files, run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "jskit-test-sources-"));
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

async function findings(root) {
  const result = await checkTestSources({ projectRoot: root });
  return result.findings.map(({ file, line, rule }) => `${file}:${line} ${rule}`);
}

// Seven of the projects upgraded on 27 Nov 2026 waited fixed times in their browser specs and server tests, which make
// every run as slow as the longest guess and fail on a loaded machine. A window that proves nothing happens (no second
// read within it) is the one fixed wait a test needs, and it says so on the line before.
const SPEC = [
  "import { expect, test } from \"@playwright/test\";",
  "test(\"lists\", async ({ page }) => {",
  "  await page.goto(\"/\");",
  "  await page.waitForTimeout(500);",
  "  // jskit-test: fixed-wait - the window in which the list must make no second read",
  "  await page.waitForTimeout(2000);",
  "  // jskit-test: fixed-wait",
  "  await page.waitForTimeout(1000);",
  "  // jskit-test: fixed-wait -   ",
  "  await page.waitForTimeout(1000);",
  "  // a comment naming page.waitForTimeout(100) waits for nothing",
  "  await expect(page.getByRole(\"heading\")).toBeVisible();",
  "});",
  ""
].join("\n");

const SERVER_TEST = [
  "import { setTimeout as sleep } from \"node:timers/promises\";",
  "import test from \"node:test\";",
  "test(\"jobs\", async () => {",
  "  await new Promise((resolve) => setTimeout(resolve, 100));",
  "  await new Promise((resolve) => setTimeout(resolve, 0));",
  "  await sleep(250);",
  "  await setTimeout(1_000);",
  "  await new Promise((resolve) => setTimeout(() => resolve(), 50));",
  "  await Promise.race([work(), new Promise((_, reject) => setTimeout(() => reject(new Error(\"hung\")), 5000))]);",
  "  await new Promise((r) => { setTimeout(r, 20); });",
  "  await scheduler.wait(30);",
  "  await setTimeout(40, \"value\");",
  "});",
  ""
].join("\n");

test("test/fixed-sleep names each fixed wait in an app's test files, and a fixed-wait marker excuses one only with its reason", async () => {
  await withProject({
    "package.json": { name: "waits", private: true },
    "tests/e2e/list.spec.ts": SPEC,
    "tests/server/jobs.test.js": SERVER_TEST,
    "packages/billing/test/retry.test.js": "await sleep(10);\n",
    "src/lib/backoff.js": "await sleep(100);\nawait page.waitForTimeout(100);\n",
    "node_modules/some-lib/test/a.test.js": "await page.waitForTimeout(100);\n"
  }, async (root) => {
    assert.deepEqual(await findings(root), [
      "packages/billing/test/retry.test.js:1 test/fixed-sleep",
      "tests/e2e/list.spec.ts:4 test/fixed-sleep",
      "tests/e2e/list.spec.ts:7 test/fixed-sleep",
      "tests/e2e/list.spec.ts:9 test/fixed-sleep",
      "tests/server/jobs.test.js:4 test/fixed-sleep",
      "tests/server/jobs.test.js:6 test/fixed-sleep",
      "tests/server/jobs.test.js:7 test/fixed-sleep",
      "tests/server/jobs.test.js:8 test/fixed-sleep",
      "tests/server/jobs.test.js:10 test/fixed-sleep",
      "tests/server/jobs.test.js:11 test/fixed-sleep",
      "tests/server/jobs.test.js:12 test/fixed-sleep"
    ]);
    const result = await checkTestSources({ projectRoot: root });
    const message = (file, line) => result.findings.find((finding) => finding.file === file && finding.line === line)?.message;
    assert.equal(message("tests/e2e/list.spec.ts", 4),
      "waits a fixed time (page.waitForTimeout(500)); wait for the condition instead: a web-first assertion " +
      "(await expect(locator).toBeVisible()), expect.poll(), the event itself, or a fake clock (mock.timers, " +
      "vi.useFakeTimers(), page.clock). A window that proves nothing happens, or the latency a stand-in simulates, " +
      "says so on the line before: // jskit-test: fixed-wait - <what the window proves, or the latency the stand-in simulates>.");
    assert.equal(message("tests/e2e/list.spec.ts", 7),
      "has a jskit-test: fixed-wait marker without a reason; write after it what the window proves, or the latency " +
      "the stand-in simulates (// jskit-test: fixed-wait - <what the window proves, or the latency the stand-in " +
      "simulates>), or wait for the condition instead.");
    assert.match(message("tests/server/jobs.test.js", 4), /^waits a fixed time \(new Promise\(\(resolve\) => setTimeout\(resolve, 100\)\)\);/u);
    assert.match(message("tests/server/jobs.test.js", 6), /^waits a fixed time \(await sleep\(250\)\);/u);
  });
});

// The dependents' runs of 0.2.117 (27 Nov 2026) named 308 poll-loop intervals and 4 timers racing another wait as fixed
// waits: a wait that re-reads its condition each round, or bounds a wait for something else, waits for that condition.
const POLLS = [
  "import { setTimeout as sleep } from \"node:timers/promises\";",
  "// Vibe64 Online's projectActionDispatch: the timer bounds the wait for another start.",
  "await Promise.race([started, new Promise((resolve) => setTimeout(resolve, 500))]);",
  "// public Vibe64's serverShutdown: the handler's stop, at most 3.5 s.",
  "await Promise.race([",
  "  handler(\"SIGTERM\"),",
  "  new Promise((resolve) => setTimeout(resolve, 3500))",
  "]);",
  "while (processState(pid) !== state && Date.now() < deadline) {",
  "  await new Promise((resolve) => setTimeout(resolve, 20));",
  "}",
  "while (running(run) && Date.now() < deadline) await sleep(50);",
  "while (!activeQueries.get(\"slow\")?.cancel) await new Promise((resolve) => setTimeout(resolve, 10));",
  "while (modelRequests < count) await sleep(10);",
  "for (let attempt = 0; attempt < 100 && log.length < 2; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));",
  "async function rows() {",
  "  for (;;) {",
  "    const found = await read();",
  "    if (found.length > 0) return found;",
  "    await sleep(20);",
  "  }",
  "}",
  "for (let attempt = 0; attempt < 100; attempt++) {",
  "  if (delivered.length === 2) break;",
  "  await sleep(10);",
  "}",
  "for (let i = 0; i < 50; i += 1) {",
  "  try { await fetch(base); break; } catch { await new Promise((r) => setTimeout(r, 100)); }",
  "}",
  "do {",
  "  await sleep(10);",
  "} while (!(await ready()));",
  "const program = `while (existsSync(${JSON.stringify(gate)})) await new Promise(resolve => setTimeout(resolve, 10));`;",
  "// mobilynet's hostdLockedApps: a function named of, and the in operator, in a loop's condition.",
  "for (let tries = 0; tries < 150 && of().length === 0; tries += 1) await sleep(20);",
  "while (\"slow\" in pending) await sleep(10);",
  ""
].join("\n");

// What stays a fixed wait: a one-shot sleep before an assertion, a fixed-count settle loop, a loop that only counts or
// watches the clock, a wait in a function of its own inside a poll loop, Promise.all, and a loop that breaks on no
// condition.
const KEPT = [
  "import { setTimeout as sleep } from \"node:timers/promises\";",
  "await sleep(100);",
  "assert.equal(list.length, 1);",
  "for (let i = 0; i < 20; i += 1) {",
  "  await new Promise((resolve) => setTimeout(resolve, 5));",
  "  await nextTick();",
  "}",
  "for (const name of names) {",
  "  await new Promise((resolve) => setTimeout(resolve, 50));",
  "  assert.ok(items.some((item) => { return item.name === name; }));",
  "}",
  "while (Date.now() < end) await sleep(10);",
  "let rounds = 0;",
  "while (rounds < 3) {",
  "  rounds += 1;",
  "  await sleep(5);",
  "}",
  "while (!done) {",
  "  schedule(async () => {",
  "    await sleep(5);",
  "  });",
  "}",
  "await Promise.all([work(), new Promise((resolve) => setTimeout(resolve, 100))]);",
  "for (let i = 0; i < 3; i++) {",
  "  await sleep(10);",
  "  break;",
  "}",
  ""
].join("\n");

test("test/fixed-sleep leaves out a poll loop's interval and a timer racing another wait, and keeps every other fixed wait", async () => {
  await withProject({
    "package.json": { name: "polls", private: true },
    "tests/server/polls.test.js": POLLS,
    "tests/server/kept.test.js": KEPT,
    "tests/e2e/toast.spec.ts": [
      "import { expect, test } from \"@playwright/test\";",
      "test(\"the toast\", async ({ page }) => {",
      "  while (!(await page.getByRole(\"status\").isVisible())) await page.waitForTimeout(100);",
      "  const rows: Array<{ id: string }> = await page.evaluate(() => []);",
      "  await page.waitForTimeout(500);",
      "});",
      ""
    ].join("\n")
  }, async (root) => {
    assert.deepEqual(await findings(root), [
      "tests/e2e/toast.spec.ts:5 test/fixed-sleep",
      ...[2, 5, 9, 12, 16, 20, 23, 25].map((line) => `tests/server/kept.test.js:${line} test/fixed-sleep`)
    ]);
  });
});

// The loops are read from the file's brackets, past what only looks like one: a regular expression, a division,
// template literals inside template literals, strings and comments. A file whose brackets do not match is read a line
// at a time, as before.
test("test/fixed-sleep reads a loop past regular expressions, divisions, templates, strings and comments, and line by line when it cannot", async () => {
  await withProject({
    "package.json": { name: "edges", private: true },
    "tests/server/edges.test.js": [
      "const closers = (text) => { return /[)\\]}]+/u.test(text); };",
      "assert.ok(/\\(+\\[/u.test(output));",
      "const half = ((total / 2) + 1) / 3;",
      "const nested = `a ${`b ${value} )`} ]`;",
      "const quoted = \"({[\" + '}' + \"\\\")\";",
      "// a comment holding ) } ]",
      "/* and ( { [ */",
      "while (!done()) await sleep(10);",
      ""
    ].join("\n"),
    "tests/client/notice.test.jsx": [
      "const view = <p>Don't panic (yet)</p>;",
      "while (!rendered()) await sleep(10);",
      ""
    ].join("\n")
  }, async (root) => {
    assert.deepEqual(await findings(root), ["tests/client/notice.test.jsx:2 test/fixed-sleep"]);
  });
});

// The marker excuses a stand-in's latency for jskit check, and jskit test runs the file that carries it: the marker is
// jskit check's, on whatever line the wait is, never one of jskit test's first-line file markers.
test("a stand-in's latency marker on a later line excuses its wait in jskit check, and jskit test runs its file", async () => {
  await withProject({
    "package.json": { name: "stand-ins", private: true },
    "test/a.test.js": "",
    "test/mail.test.js": [
      "import test from \"node:test\";",
      "import { setTimeout as sleep } from \"node:timers/promises\";",
      "export async function send() {",
      "  // jskit-test: fixed-wait - the latency of the mail provider this stand-in simulates",
      "  await sleep(200);",
      "}",
      ""
    ].join("\n")
  }, async (root) => {
    assert.deepEqual(await findings(root), []);
    const plan = planTestRuns([], { cwd: root, concurrency: 4 });
    assert.deepEqual(plan.alone, []);
    assert.deepEqual(plan.runs, [["--test", "--test-concurrency=4"]]);
  });
});

// Mercbot's offlinePage test advances its page's fake clock with `await page.wait(60_000)`: a member call named wait is
// some object's own method, while node's timers stay timers.
test("test/fixed-sleep reads a member call named wait as the object's own method, but node's timers and named sleeps as waits", async () => {
  await withProject({
    "package.json": { name: "clocks", private: true },
    "tests/server/clock.test.js": [
      "await page.wait(60_000);",
      "await clock.wait(1000);",
      "await timers.setTimeout(100);",
      "await scheduler.wait(30);",
      "await helpers.sleep(50);",
      "await utils.delay(20);",
      "await runner.pause(10);",
      "await wait(100);",
      ""
    ].join("\n")
  }, async (root) => {
    assert.deepEqual(await findings(root), [3, 4, 5, 6, 7, 8].map((line) => `tests/server/clock.test.js:${line} test/fixed-sleep`));
  });
});

test("test/fixed-database-name names a test script, Playwright config or test source that names the test database itself", async () => {
  await withProject({
    "package.json": {
      name: "shop",
      private: true,
      scripts: {
        test: "jskit test --databases",
        "test:db": "TEST_DB_NAME=shop_test jskit test --databases",
        "test:e2e": "BROWSER_TEST_DB_NAME=shop_e2e playwright test",
        dev: "DB_NAME=shop_dev node ./bin/develop.js"
      }
    },
    "playwright.config.mjs": [
      "import { defineConfig } from \"@playwright/test\";",
      "import { browserTestConfig } from \"@jskit-ai/jskit-catalog/browser-tests\";",
      "const base = process.env.BROWSER_TEST_DB_NAME;",
      "export default defineConfig(browserTestConfig({",
      "  env: { DB_NAME: \"shop_e2e\", BROWSER_TEST_DB_NAME: `${base}_e2e` }",
      "}));",
      ""
    ].join("\n"),
    "tests/helpers/database.js": [
      "const name = process.env.TEST_DB_NAME || \"shop_test\";",
      "process.env.DB_NAME = \"shop_test\";",
      "const scratch = process.env.TEST_DB_NAME ?? `shop_${process.pid}`;",
      "if (process.env.DB_NAME === \"shop\") throw new Error(\"refused\");",
      "const other = process.env[\"BROWSER_TEST_DB_NAME\"] ?? 'shop_e2e';",
      "const empty = process.env.DB_NAME || \"\";",
      ""
    ].join("\n"),
    "tests/unit/environment.test.js": "const env = { DB_NAME: \"shop\", TEST_DB_NAME: \"shop_test\" };\n"
  }, async (root) => {
    assert.deepEqual(await findings(root), [
      "package.json:6 test/fixed-database-name",
      "package.json:7 test/fixed-database-name",
      "playwright.config.mjs:5 test/fixed-database-name",
      "tests/helpers/database.js:1 test/fixed-database-name",
      "tests/helpers/database.js:2 test/fixed-database-name",
      "tests/helpers/database.js:5 test/fixed-database-name"
    ]);
    const result = await checkTestSources({ projectRoot: root });
    const tail = "the run's test-only env file or the host names the database, `jskit test --databases` gives each test " +
      "file its own copy of TEST_DB_NAME, and browserTestConfig()'s prepare module derives each worker's from " +
      "BROWSER_TEST_DB_NAME.";
    assert.equal(result.findings.find(({ line, file }) => file === "package.json" && line === 7).message,
      `scripts.test:e2e pins BROWSER_TEST_DB_NAME=shop_e2e; drop it: ${tail}`);
    assert.equal(result.findings.find(({ line, file }) => file === "tests/helpers/database.js" && line === 1).message,
      `names the test database itself (process.env.TEST_DB_NAME || "shop_test"); drop the name and read the variable as the run gives it: ${tail}`);
  });
});

// Mercbot's testDatabase.mjs refuses to run on any database but TEST_DB_NAME, and its refusal says what DB_NAME was,
// "unset" when there is none: a name in a thrown message's text names no database.
test("test/fixed-database-name leaves out a name in a thrown message's text, and keeps one a log line or a connection uses", async () => {
  await withProject({
    "package.json": { name: "refusals", private: true },
    "tests/support/testDatabase.mjs": [
      "export function testDatabaseConfig(testDatabase) {",
      "  if (process.env.DB_NAME !== testDatabase) {",
      "    throw new Error(`DB_NAME (${process.env.DB_NAME || \"unset\"}) must be TEST_DB_NAME (${testDatabase}), a disposable test database.`);",
      "  }",
      "  console.log(`migrating ${process.env.DB_NAME || \"shop\"}`);",
      "  return connect(process.env.TEST_DB_NAME ?? \"shop_test\");",
      "}",
      ""
    ].join("\n")
  }, async (root) => {
    assert.deepEqual(await findings(root), [5, 6].map((line) => `tests/support/testDatabase.mjs:${line} test/fixed-database-name`));
  });
});

test("test/test-database-is-app-database names a CI workflow whose test database is the app's DB_NAME", async () => {
  await withProject({
    "package.json": { name: "shop", private: true },
    ".github/workflows/ci.yml": [
      "name: ci",
      "env:",
      "  DB_NAME: shop",
      "  TEST_DB_NAME: shop # the same database",
      "jobs:",
      "  e2e:",
      "    env:",
      "      BROWSER_TEST_DB_NAME: \"${{ env.DB_NAME }}\"",
      "    steps:",
      "      - run: echo \"TEST_DB_NAME=shop\" >> \"$GITHUB_ENV\"",
      ""
    ].join("\n"),
    ".github/workflows/separate.yaml": [
      "env:",
      "  DB_NAME: shop",
      "  TEST_DB_NAME: shop_test",
      "  BROWSER_TEST_DB_NAME: 'shop_e2e'",
      ""
    ].join("\n")
  }, async (root) => {
    assert.deepEqual(await findings(root), [
      ".github/workflows/ci.yml:4 test/test-database-is-app-database",
      ".github/workflows/ci.yml:8 test/test-database-is-app-database",
      ".github/workflows/ci.yml:10 test/test-database-is-app-database"
    ]);
    const result = await checkTestSources({ projectRoot: root });
    assert.equal(result.findings[0].message,
      "TEST_DB_NAME is shop, the app's DB_NAME in this workflow; give it a name of its own, such as shop_test: " +
      "a test run replaces its test databases from the snapshot, and JSKIT refuses to run one on DB_NAME.");
  });
});

test("test/generated-into-src names a Vite config that writes a generated file into src, which the browser build reads", async () => {
  await withProject({
    "package.json": { name: "shop", private: true },
    "vite.config.mjs": [
      "export default {",
      "  plugins: [",
      "    VueRouter({ routesFolder: \"src/pages\", dts: \"src/typed-router.d.ts\" }),",
      "    Components({ dts: './src/components.d.ts' })",
      "  ]",
      "};",
      ""
    ].join("\n"),
    "packages/widgets/vite.config.mjs": "export default { plugins: [VueRouter({ dts: \"src/typed-router.d.ts\" })] };\n"
  }, async (root) => {
    assert.deepEqual(await findings(root), ["vite.config.mjs:3 test/generated-into-src", "vite.config.mjs:4 test/generated-into-src"]);
    const result = await checkTestSources({ projectRoot: root });
    assert.equal(result.findings[0].message,
      "writes src/typed-router.d.ts into src, which the browser tests' frontend build reads, so that build is never kept " +
      "for reuse (\"not kept for reuse, as src changed while it ran\"): set dts: \"types/typed-router.d.ts\", move the " +
      "file there and its .gitignore line with it.");
  });
  await withProject({
    "package.json": { name: "shop", private: true },
    "vite.config.mjs": "export default { plugins: [VueRouter({ dts: \"types/typed-router.d.ts\" })] };\n"
  }, async (root) => assert.deepEqual(await findings(root), []));
});

// vibe64-control's test script was `jskit test --databases tests/*.test.js`: `npm test -- tests/x.test.js` then ran every
// file and x again, where the guidance says it runs exactly that file.
test("test/script-files names a script that gives jskit test its files, so npm test -- <file> would run every file and that one", async () => {
  await withProject({
    "package.json": {
      name: "control",
      private: true,
      scripts: {
        test: "jskit test --databases tests/*.test.js",
        "test:server": "npx jskit test --test-global-setup tests/helpers/globalSetup.js tests/server && echo done",
        "test:setup": "jskit test --test-global-setup=tests/helpers/globalSetup.js --databases",
        "test:named": "jskit test --test-name-pattern smoke --test-reporter dot",
        "test:client": "vitest run tests/client"
      }
    }
  }, async (root) => {
    assert.deepEqual(await findings(root), ["package.json:5 test/script-files", "package.json:6 test/script-files"]);
    const result = await checkTestSources({ projectRoot: root });
    assert.equal(result.findings[0].message,
      "package.json's test script names tests/*.test.js: drop it. `jskit test` finds test files by node's default pattern, " +
      "so `npm test -- <file>` runs exactly that file.");
    assert.equal(result.findings[1].message,
      "package.json's test:server script names tests/server: drop it. `jskit test` finds test files by node's default " +
      "pattern, so `npm run test:server -- <file>` runs exactly that file.");
  });
});

// Vibe64 Online's test:full and test:composition each run one folder's files, its test:deploy-smoke two named files,
// and Mercbot's test:database and bench files node's default pattern leaves out (x.integration.js, x.bench.js): none of
// those runs is node's default one, so each names its files for a reason.
test("test/script-files names only a script whose files are the ones node's default pattern selects anyway", async () => {
  const testFile = "import test from \"node:test\";\ntest(\"runs\", () => {});\n";
  await withProject({
    "package.json": {
      name: "suites",
      private: true,
      scripts: {
        test: "jskit test tests/**/*.test.js",
        "test:dir": "jskit test --databases tests",
        "test:server": "jskit test --test-global-setup=tests/helpers/setup.js tests/server/*.test.js",
        "test:database": "jskit test tests/server/*.integration.js",
        "test:smoke": "jskit test tests/server/a.test.js",
        bench: "jskit test tests/bench/*.bench.js"
      }
    },
    "tests/server/a.test.js": testFile,
    "tests/server/b.test.js": testFile,
    "tests/composition/c.test.js": testFile,
    "tests/server/d.integration.js": testFile,
    "tests/bench/e.bench.js": testFile,
    "tests/helpers/setup.js": "export async function globalSetup() {}\n"
  }, async (root) => {
    assert.deepEqual(await findings(root), ["package.json:5 test/script-files", "package.json:6 test/script-files"]);
  });
});

// CompAS Next keeps an unmodified, read-only mirror of its legacy app under V1/, which its ESLint config ignores and the
// data rules already skip; the test-source rules read it and failed `jskit check` on a fixed wait the app may not change
// (jskit-ai#496).
test("the test-source rules skip what the app's ESLint config ignores outside server code, and list it; what it lints, or has no config for, is read", async () => {
  await withProject({
    "package.json": { name: "vendored", private: true, type: "module" },
    "eslint.config.mjs": "export default [{ ignores: [\"V1/**\", \"mothballed/\", \"src/legacy/\"] }];\n",
    // A legacy app's mirror and retired code kept for reference, which no lint reads and the app may not change.
    "V1/package.json": { name: "legacy", scripts: { test: "TEST_DB_NAME=legacy_test mocha server/test" } },
    "V1/server/test/transaction-gst-browser.spec.js": "test(\"gst\", async () => {\n  await page.waitForTimeout(500);\n});\n",
    "mothballed/tests/old.test.js": "await sleep(100);\n",
    // Server code the config ignores is still the app's own, and read.
    "src/legacy/test/report.test.js": "await sleep(100);\n",
    // A folder the config lints is read, and so is a file type it has no config for (TypeScript here) but does not ignore.
    "vendor/test/retry.test.js": "await sleep(10);\n",
    "tests/e2e/list.spec.ts": "await page.waitForTimeout(500);\n"
  }, async (root) => {
    assert.deepEqual(await findings(root), [
      "src/legacy/test/report.test.js:1 test/fixed-sleep",
      "tests/e2e/list.spec.ts:1 test/fixed-sleep",
      "vendor/test/retry.test.js:1 test/fixed-sleep"
    ]);
    const result = await checkTestSources({ projectRoot: root });
    assert.deepEqual(result.skipped, ["V1/", "mothballed/"]);
    assert.equal(result.files, 3);
    assert.match(formatTestSourcesReport(result),
      /^Skipped, as the app's ESLint config ignores them and they hold no server code \(2\):\n {2}V1\/\n {2}mothballed\/\nJSKIT test sources: 3 error\(s\)\./mu);
  });
});

test("jskit check passes an app whose one fixed wait is in a folder its ESLint config ignores, and says it skipped that folder", async () => {
  const dataAccess = JSON.stringify(new URL("../../config-eslint/dataAccess.js", import.meta.url).href);
  await withProject({
    "package.json": { name: "vendored", private: true, type: "module", scripts: { test: "jskit test" } },
    "package-lock.json": { name: "vendored", lockfileVersion: 3, packages: { "": { name: "vendored" } } },
    "eslint.config.mjs": `import { dataAccessConfig } from ${dataAccess};\nexport default [{ ignores: ["V1/**"] }, ...dataAccessConfig(["**"])];\n`,
    "tests/server/a.test.js": "import test from \"node:test\";\ntest(\"a\", async () => {});\n",
    "V1/server/test/transaction-gst-browser.spec.js": "test(\"gst\", async () => {\n  await page.waitForTimeout(500);\n});\n"
  }, async (root) => {
    const run = await execFileAsync(process.execPath, [CLI_PATH, "check", "--root", root]).then(
      ({ stdout }) => ({ code: 0, output: stdout }), (error) => ({ code: error.code, output: `${error.stdout}${error.stderr}` }));
    assert.equal(run.code, 0, run.output);
    assert.match(run.output,
      /^Skipped, as the app's ESLint config ignores them and they hold no server code \(1\):\n {2}V1\/\nJSKIT test sources: no fixed waits, pinned test database names or generated files in src \(1 test file\(s\) read\)\.$/mu);
  });
});

test("jskit check fails on a test-source finding and names its rule, line and guide section", async () => {
  const app = {
    "package.json": { name: "sources", private: true, scripts: { test: "jskit test" } },
    "package-lock.json": { name: "sources", lockfileVersion: 3, packages: { "": { name: "sources" } } },
    "tests/server/a.test.js": "import test from \"node:test\";\ntest(\"a\", async () => {});\n"
  };
  await withProject(app, async (root) => {
    const result = await checkTestSources({ projectRoot: root });
    assert.equal(result.ok, true);
    assert.equal(formatTestSourcesReport(result),
      "JSKIT test sources: no fixed waits, pinned test database names or generated files in src (1 test file(s) read).");
    const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, "check", "--root", root]);
    assert.match(stdout, /^JSKIT test sources: no fixed waits/mu);
  });
  await withProject({ ...app, "tests/server/a.test.js": "test(\"a\", async () => {\n  await sleep(100);\n});\n" }, async (root) => {
    const failure = await execFileAsync(process.execPath, [CLI_PATH, "check", "--root", root]).then(() => null, (error) => error);
    assert.equal(failure?.code, 1);
    assert.match(failure.stderr, /^tests\/server\/a\.test\.js:2 {2}test\/fixed-sleep {2}waits a fixed time \(await sleep\(100\)\);/mu);
    assert.ok(failure.stderr.includes(`  ${GUIDE}`));
    assert.match(failure.stderr, /^JSKIT test sources: 1 error\(s\)\./mu);
  });
});
