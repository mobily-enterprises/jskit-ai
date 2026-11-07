import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseArgs, usage } from "../scripts/jskit.mjs";
import { discoverProjectManifests } from "../scripts/project-manifests.mjs";
import { testConcurrency } from "../scripts/test-budget.mjs";
import { planTestRuns } from "../scripts/test-command.mjs";
import { checkTestRuns, formatTestRunsReport } from "../scripts/test-runs.mjs";

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL("../scripts/jskit.mjs", import.meta.url));
const ALONE_LINE = "// jskit-test: alone - it rewrites the shared fixture directory";

async function withProject(files, run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "jskit-test-budget-"));
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
  const result = await checkTestRuns({ projectRoot: root, manifests: await discoverProjectManifests(root) });
  return result.findings.map(({ file, line, rule }) => `${file}:${line} ${rule}`);
}

test("the test budget is V64_TEST_CONCURRENCY when it is a positive whole number, otherwise half the machine", () => {
  assert.equal(testConcurrency({ env: { V64_TEST_CONCURRENCY: "6" }, parallelism: 2 }), 6);
  assert.equal(testConcurrency({ env: { V64_TEST_CONCURRENCY: " 3 " }, parallelism: 2 }), 3);
  for (const value of [undefined, "", "0", "-2", "2.5", "two", "1e2"]) {
    assert.equal(testConcurrency({ env: { V64_TEST_CONCURRENCY: value }, parallelism: 8 }), 4, `V64_TEST_CONCURRENCY=${value}`);
  }
  assert.equal(testConcurrency({ env: {}, parallelism: 7 }), 3);
  assert.equal(testConcurrency({ env: {}, parallelism: 2 }), 1);
  assert.equal(testConcurrency({ env: {}, parallelism: 1 }), 1);
  assert.ok(Number.isInteger(testConcurrency()) && testConcurrency() >= 1);
});

test("jskit test passes its arguments to node --test with the budget, and parses as its own command", async () => {
  assert.deepEqual(parseArgs(["test", "--test-reporter", "spec", "test/a.test.js"]), {
    command: "test",
    args: ["--test-reporter", "spec", "test/a.test.js"]
  });
  assert.match(usage(), /^ {2}jskit test \[node options\] \[files or globs\]$/mu);
  await withProject({ "test/a.test.js": "", "test/b.test.js": "" }, async (root) => {
    assert.deepEqual(planTestRuns([], { cwd: root, concurrency: 3 }).runs, [["--test", "--test-concurrency=3"]]);
    assert.deepEqual(planTestRuns(["--test-reporter", "spec", "test/a.test.js"], { cwd: root, concurrency: 2 }).runs, [
      ["--test", "--test-concurrency=2", "--test-reporter", "spec", "test/a.test.js"]
    ]);
    for (const option of ["--test-concurrency=1", "--test-concurrency"]) {
      assert.throws(() => planTestRuns([option], { cwd: root }), /takes the test concurrency from the machine's budget/u);
    }
  });
});

test("a file that states why it must run alone runs after the others, and a malformed or misplaced marker fails", async () => {
  await withProject({
    "test/a.test.js": "",
    "test/b.test.js": "",
    "test/shared.test.js": `${ALONE_LINE}\n`,
    "scripts/tool.test.mjs": `#!/usr/bin/env node\n${ALONE_LINE}\n`,
    "node_modules/x/test/ignored.test.js": `${ALONE_LINE}\n`
  }, async (root) => {
    const plan = planTestRuns(["--test-reporter=dot"], { cwd: root, concurrency: 4 });
    assert.deepEqual(plan.alone.map(({ file }) => file), ["scripts/tool.test.mjs", "test/shared.test.js"]);
    assert.equal(plan.alone[0].reason, "it rewrites the shared fixture directory");
    assert.deepEqual(plan.runs, [
      ["--test", "--test-concurrency=4", "--test-reporter=dot", "test/a.test.js", "test/b.test.js"],
      ["--test", "--test-concurrency=1", "--test-reporter=dot", "scripts/tool.test.mjs", "test/shared.test.js"]
    ]);
    assert.deepEqual(planTestRuns(["test/shared.test.js"], { cwd: root, concurrency: 4 }).runs, [
      ["--test", "--test-concurrency=1", "test/shared.test.js"]
    ]);
  });
  await withProject({ "test/a.test.js": "// jskit-test: alone\n", "test/b.test.js": `import "node:test";\n${ALONE_LINE}\n` }, async (root) => {
    assert.throws(() => planTestRuns([], { cwd: root }), (error) => {
      assert.match(error.message, /test\/a\.test\.js:1: write it as `\/\/ jskit-test: alone - <why/u);
      assert.match(error.message, /test\/b\.test\.js:2: a jskit-test marker belongs on the file's first line/u);
      return true;
    });
  });
});

// Two files that each wait for the other to start pass only when they run at the same time; the file that runs alone
// checks that both have finished before it starts.
const RENDEZVOUS = (self, other) => `import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import test from "node:test";
test("${self} runs beside ${other}", async () => {
  writeFileSync("${self}.started", "");
  const deadline = Date.now() + 10_000;
  while (!existsSync("${other}.started") && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(existsSync("${other}.started"), "${other} never started beside ${self}");
  writeFileSync("${self}.done", "");
});
`;
const ALONE_CHECK = `${ALONE_LINE}
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
test("runs after the parallel files", () => assert.ok(existsSync("left.done") && existsSync("right.done")));
`;

test("jskit test runs test files in parallel within V64_TEST_CONCURRENCY, then the alone files, and fails with them", async () => {
  await withProject({
    "test/left.test.js": RENDEZVOUS("left", "right"),
    "test/right.test.js": RENDEZVOUS("right", "left"),
    "test/shared.test.js": ALONE_CHECK
  }, async (root) => {
    // Without the outer runner's NODE_TEST_CONTEXT, the inner runs report on stdout instead of to this runner.
    const env = { ...process.env, V64_TEST_CONCURRENCY: "2" };
    delete env.NODE_TEST_CONTEXT;
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_PATH, "test"], { cwd: root, env });
    assert.match(stderr, /^jskit test: 2 test file\(s\) at a time \(V64_TEST_CONCURRENCY\)\.$/mu);
    assert.match(stderr, /^jskit test: test\/shared\.test\.js runs alone: it rewrites the shared fixture directory$/mu);
    assert.match(stdout, /pass 2\b/u);
    assert.match(stdout, /pass 1\b/u);

    await writeFile(path.join(root, "test/failing.test.js"), "import test from \"node:test\";\ntest(\"fails\", () => { throw new Error(\"no\"); });\n");
    const failure = await execFileAsync(process.execPath, [CLI_PATH, "test", "test/failing.test.js"], { cwd: root, env })
      .then(() => null, (error) => error);
    assert.equal(failure?.code, 1);
  });
});

const BUDGET_IMPORT = "import { testConcurrency } from \"@jskit-ai/jskit-catalog/test-budget\";\n";

test("jskit check fails test runs outside the budget: node --test, fixed counts and configs that ignore the budget", async () => {
  await withProject({
    "package.json": {
      name: "drifting",
      workspaces: ["packages/*"],
      scripts: {
        lint: "eslint .",
        test: "node --test --test-concurrency=1",
        "test:one": "node --env-file=.env --test tests/server/one.test.js",
        "test:client": "vitest run tests/client --maxWorkers=1",
        "test:e2e": "PLAYWRIGHT_PORT=4183 npx playwright test tests/e2e --workers=1",
        "test:custom": "jskit test --test-concurrency=2",
        tool: "node ./scripts/tool.js --test",
        setup: "npx playwright install chromium"
      }
    },
    "playwright.config.mjs": "export default { workers: 1 };\n",
    "vite.config.mjs": `${BUDGET_IMPORT}export default { test: { maxWorkers: testConcurrency(), fileParallelism: false } };\n`,
    "packages/main/package.json": { name: "@local/main", scripts: { test: "vitest run" } },
    "packages/main/vite.config.mjs": "export default {};\n"
  }, async (root) => {
    assert.deepEqual(await findings(root), [
      "package.json:8 test/node-test",
      "package.json:8 test/fixed-concurrency",
      "package.json:9 test/node-test",
      "package.json:10 test/vitest-workers",
      "package.json:11 test/playwright-workers",
      "package.json:12 test/fixed-concurrency",
      "packages/main/vite.config.mjs:1 test/vitest-workers",
      "playwright.config.mjs:1 test/playwright-workers",
      "vite.config.mjs:2 test/vitest-workers"
    ]);
    const result = await checkTestRuns({ projectRoot: root, manifests: await discoverProjectManifests(root) });
    const report = formatTestRunsReport(result);
    assert.match(report, /^package\.json:8 {2}test\/node-test {2}scripts\.test runs node --test directly; use `jskit test`/mu);
    assert.match(report, /guide\/framework\/typed-features#test-files-run-in-parallel/u);
    assert.match(report, /JSKIT test runs: 9 error\(s\)\./u);
  });
  await withProject({
    "package.json": { name: "no-config", scripts: { "test:e2e": "playwright test", "test:unit": "vitest run -c config/unit.mjs" } }
  }, async (root) => {
    assert.deepEqual(await findings(root), ["config/unit.mjs:1 test/vitest-workers", "playwright.config.*:1 test/playwright-workers"]);
  });
});

test("jskit check passes an app whose runs use jskit test and whose configs read the budget", async () => {
  const app = {
    "package.json": {
      name: "budgeted",
      scripts: { test: "jskit test", "test:client": "vitest run tests/client", "test:e2e": "playwright test tests/e2e" }
    },
    "package-lock.json": { name: "budgeted", lockfileVersion: 3, packages: { "": { name: "budgeted" } } },
    "playwright.config.mjs": `${BUDGET_IMPORT}export default { workers: testConcurrency() };\n`,
    "vite.config.mjs": `${BUDGET_IMPORT}export default { test: { maxWorkers: testConcurrency() } };\n`
  };
  await withProject(app, async (root) => {
    assert.deepEqual(await findings(root), []);
    const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, "check", "--root", root]);
    assert.match(stdout, /^JSKIT test runs use the machine's test budget in 1 manifest\(s\)\.$/mu);
  });
  await withProject({ ...app, "playwright.config.mjs": "export default {};\n" }, async (root) => {
    const failure = await execFileAsync(process.execPath, [CLI_PATH, "check", "--root", root]).then(() => null, (error) => error);
    assert.equal(failure?.code, 1);
    assert.match(failure.stderr, /^playwright\.config\.mjs:1 {2}test\/playwright-workers {2}playwright runs at a fixed or default worker count; set `workers: testConcurrency\(\)` from @jskit-ai\/jskit-catalog\/test-budget\.$/mu);
  });
});
