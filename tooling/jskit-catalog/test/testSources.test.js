import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { checkTestSources, formatTestSourcesReport } from "../scripts/test-sources.mjs";

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
      "vi.useFakeTimers(), page.clock). A window that proves nothing happens says so on the line before: " +
      "// jskit-test: fixed-wait - <what the window proves>.");
    assert.equal(message("tests/e2e/list.spec.ts", 7),
      "has a jskit-test: fixed-wait marker without a reason; write what the window proves after it " +
      "(// jskit-test: fixed-wait - <what the window proves>), or wait for the condition instead.");
    assert.match(message("tests/server/jobs.test.js", 4), /^waits a fixed time \(new Promise\(\(resolve\) => setTimeout\(resolve, 100\)\)\);/u);
    assert.match(message("tests/server/jobs.test.js", 6), /^waits a fixed time \(await sleep\(250\)\);/u);
  });
});

test("test/fixed-database-name names a test script, Playwright config or test source that names the test database itself", async () => {
  await withProject({
    "package.json": {
      name: "shop",
      private: true,
      scripts: {
        test: "jskit test --databases",
        "test:db": "TEST_DB_NAME=shop_test jskit test --databases tests/server",
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
