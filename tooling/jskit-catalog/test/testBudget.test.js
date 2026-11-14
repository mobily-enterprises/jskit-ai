import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseArgs, usage } from "../scripts/jskit.mjs";
import { discoverProjectManifests } from "../scripts/project-manifests.mjs";
import { testConcurrency } from "../scripts/test-budget.mjs";
import { planTestRuns, withTimeReporter } from "../scripts/test-command.mjs";
import { checkTestTimes, FILE_TIMES, fileStop } from "../scripts/test-time-report.mjs";
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

    // The alone run writes a reporter's file beside the parallel run's instead of over it, and a shard runs only its
    // own alone files, picked as node --test picks the shard's other files.
    const reporters = ["--test-reporter=spec", "--test-reporter-destination=out/spec.log", "--test-reporter", "junit",
      "--test-reporter-destination", "out/junit.xml", "--test-reporter=dot", "--test-reporter-destination=stdout"];
    const sharded = (shard) => planTestRuns([...reporters, "--test-shard", shard], { cwd: root, concurrency: 4 }).runs;
    assert.deepEqual(sharded("1/2"), [
      ["--test", "--test-concurrency=4", ...reporters, "--test-shard", "1/2", "test/a.test.js", "test/b.test.js"],
      ["--test", "--test-concurrency=1", "--test-reporter=spec", "--test-reporter-destination=out/spec.alone.log",
        "--test-reporter", "junit", "--test-reporter-destination", "out/junit.alone.xml", "--test-reporter=dot",
        "--test-reporter-destination=stdout", "scripts/tool.test.mjs"]
    ]);
    assert.deepEqual(sharded("2/2")[1].slice(-2), ["--test-reporter-destination=stdout", "test/shared.test.js"]);
    // Option values given apart (`--test-reporter junit`) name no files, so the run is still node's default files.
    assert.deepEqual(planTestRuns(["--test-reporter", "junit"], { cwd: root, concurrency: 4 }).runs[1].slice(-2),
      ["scripts/tool.test.mjs", "test/shared.test.js"]);
    assert.deepEqual(planTestRuns(["--test-shard=3/3"], { cwd: root, concurrency: 4 }).runs, [
      ["--test", "--test-concurrency=4", "--test-shard=3/3", "test/a.test.js", "test/b.test.js"]
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

test("given no files, jskit test fails rather than leave out a tests/ file named as a test that node's default misses", async () => {
  await withProject({
    "tests/server/smoke.test.js": "",
    "tests/server/database.integration.test.js": "",
    "tests/server/support/fixtures.js": "",
    "tests/client/smoke.vitest.js": "",
    "tests/client/menu.spec.js": 'import { test } from "vitest";\n',
    "tests/e2e/home.spec.ts": 'import { test } from "./fixtures.js";\n',
    "tests/browser/workers.spec.js": "",
    "test/any.integration.js": "",
    "node_modules/x/tests/ignored.integration.js": ""
  }, async (root) => {
    assert.equal(planTestRuns([], { cwd: root, concurrency: 2 }).files, 3);
    await writeFile(path.join(root, "tests/server/database.integration.js"), "");
    await mkdir(path.join(root, "packages/main/tests"), { recursive: true });
    await writeFile(path.join(root, "packages/main/tests/routes_spec.mjs"), 'import test from "node:test";\n');
    for (const args of [[], ["--test-reporter", "dot"]]) {
      assert.throws(() => planTestRuns(args, { cwd: root, concurrency: 2 }), (error) => {
        assert.match(error.message, /^jskit test: given no files, node --test runs only the files its default pattern/u);
        assert.match(error.message, /\n- packages\/main\/tests\/routes_spec\.mjs\n- tests\/server\/database\.integration\.js\n/u);
        assert.match(error.message, /a database test: <name>\.integration\.test\.js/u);
        assert.doesNotMatch(error.message, /vitest|menu\.spec|home\.spec|workers\.spec|any\.integration|ignored/u);
        return true;
      });
    }
    // Named files are the run the script chose.
    assert.deepEqual(planTestRuns(["tests/server/*.test.js"], { cwd: root, concurrency: 2 }).paths,
      ["tests/server/database.integration.test.js", "tests/server/smoke.test.js"]);
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

test("every run reports its times beside its own reporters, which node pairs with their destinations by position", () => {
  const reporter = new URL("../scripts/test-time-report.mjs", import.meta.url).href;
  const run = (...options) => withTimeReporter(["--test", "--test-concurrency=2", ...options, "test/a.test.js"], "times.json");
  const added = [`--test-reporter=${reporter}`, "--test-reporter-destination=times.json"];
  // No reporter: node's own spec on stdout stays.
  assert.deepEqual(run(), ["--test", "--test-concurrency=2", "--test-reporter=spec", "--test-reporter-destination=stdout",
    ...added, "test/a.test.js"]);
  // A lone reporter without a destination keeps stdout.
  assert.deepEqual(run("--test-reporter", "dot"), ["--test", "--test-concurrency=2", ...added,
    "--test-reporter-destination=stdout", "--test-reporter", "dot", "test/a.test.js"]);
  assert.deepEqual(run("--test-reporter=junit", "--test-reporter-destination=out/junit.xml"), ["--test", "--test-concurrency=2",
    ...added, "--test-reporter=junit", "--test-reporter-destination=out/junit.xml", "test/a.test.js"]);
});

test("the time report lists the slowest files and tests and names each coarse bound a file or the run went past", () => {
  const bounds = { runMs: 45 * 60_000, fileMs: 10 * 60_000, files: { "test/import.test.js": 20 * 60_000 } };
  const files = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`test/f${index}.test.js`, (index + 1) * 1000]));
  const tests = [{ file: "test/f0.test.js", name: "quick", ms: 5 }, { file: "test/f11.test.js", name: "slow", ms: 11_000 }];
  const quiet = checkTestTimes({ bounds, files, tests, wallMs: 30_000 });
  assert.deepEqual(quiet.overruns, []);
  const lines = quiet.report.trimEnd().split("\n");
  assert.equal(lines[0], "jskit test: 12 test file(s) in 30.0 s (bound 45.0 min); the slowest, time / bound:");
  assert.equal(lines[1], "  12.0 s / 10.0 min  test/f11.test.js");
  assert.equal(lines[10], "  3.0 s / 10.0 min  test/f2.test.js");
  assert.deepEqual(lines.slice(11), ["jskit test: the slowest tests:", "  11.0 s  test/f11.test.js: slow", "  0.0 s  test/f0.test.js: quick"]);

  const broken = checkTestTimes({
    bounds,
    files: { "test/hang.test.js": 11 * 60_000, "test/import.test.js": 19 * 60_000 },
    tests: [],
    wallMs: 50 * 60_000
  });
  assert.deepEqual(broken.overruns, [
    "test/hang.test.js took 11.0 min, past its 10.0 min bound.",
    "The run took 50.0 min, past its 45.0 min bound."
  ]);
  assert.match(broken.report, /past a time bound, so something is clearly broken/u);
});

test("jskit test records each file's time and fails a run whose file went past the app's own bound", async () => {
  await withProject({
    "test/one.test.js": "import test from \"node:test\";\ntest(\"one\", () => {});\n",
    "test/two.test.js": "import test from \"node:test\";\ntest(\"two\", () => {});\n"
  }, async (root) => {
    const env = { ...process.env, V64_TEST_CONCURRENCY: "2" };
    delete env.NODE_TEST_CONTEXT;
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_PATH, "test", "--test-reporter", "dot"], { cwd: root, env });
    assert.doesNotMatch(stdout, /jskit test:/u);
    assert.match(stderr, /^jskit test: 2 test file\(s\) in [\d.]+ s \(bound 45\.0 min\); the slowest, time \/ bound:$/mu);
    assert.match(stderr, /^ {2}[\d.]+ s {2}test\/one\.test\.js: one$/mu);
    const recorded = JSON.parse(await readFile(path.join(root, FILE_TIMES), "utf8"));
    assert.deepEqual(Object.keys(recorded).sort(), ["test/one.test.js", "test/two.test.js"]);

    // A bound of 1 ms: no file runs that fast, so the run fails though every test passed.
    await writeFile(path.join(root, "test-time-bounds.json"), JSON.stringify({ files: { "test/two.test.js": 1 } }));
    const failure = await execFileAsync(process.execPath, [CLI_PATH, "test"], { cwd: root, env }).then(() => null, (error) => error);
    assert.equal(failure?.code, 1);
    assert.match(failure.stdout, /pass 2\b/u);
    assert.match(failure.stderr, /^ {2}test\/two\.test\.js took [\d.]+ s, past its 0\.0 s bound\.$/mu);
    assert.doesNotMatch(failure.stderr, /test\/one\.test\.js took/u);
  });
});

test("a file still running is stopped at twice its bound, or sooner at ten times its recorded time, never too soon", () => {
  assert.deepEqual(fileStop({ bound: 10 * 60_000 }), { ms: 20 * 60_000, reason: "past twice its 10.0 min bound" });
  assert.deepEqual(fileStop({ bound: 10 * 60_000, recorded: 30_000 }), { ms: 5 * 60_000, reason: "past ten times its last time of 30.0 s" });
  // A quick file on a loaded machine or with a cold compile cache gets two minutes, and an absurd bound two seconds.
  assert.deepEqual(fileStop({ bound: 10 * 60_000, recorded: 50 }), { ms: 2 * 60_000, reason: "past ten times its last time of 0.1 s" });
  assert.deepEqual(fileStop({ bound: 60_000, recorded: 50_000 }), { ms: 2 * 60_000, reason: "past twice its 1.0 min bound" });
  assert.deepEqual(fileStop({ bound: 1, recorded: 50 }), { ms: 2000, reason: "past twice its 0.0 s bound" });
});

test("jskit test stops a file that never finishes, fails it by name and still runs and reports the other files", async () => {
  await withProject({
    // Its test passes, but the interval it leaves open would keep its process running for ever.
    "test/hang.test.js": "import test from \"node:test\";\ntest(\"leaves an interval open\", () => { setInterval(() => {}, 60_000); });\n",
    "test/quick.test.js": "import test from \"node:test\";\ntest(\"quick\", () => {});\n",
    "test/skips.test.js": "import test from \"node:test\";\ntest(\"needs a database\", { skip: \"no database\" }, () => {});\n",
    "test-time-bounds.json": { files: { "test/hang.test.js": 500 } }
  }, async (root) => {
    const env = { ...process.env, V64_TEST_CONCURRENCY: "3" };
    delete env.NODE_TEST_CONTEXT;
    // Without the stop, the hanging file would hold the command until this timeout killed it.
    const failure = await execFileAsync(process.execPath, [CLI_PATH, "test"], { cwd: root, env, timeout: 60_000 })
      .then(() => null, (error) => error);
    assert.equal(failure?.signal, null);
    assert.equal(failure?.code, 1);
    assert.match(failure.stdout, /pass 2\b/u);
    assert.match(failure.stdout, /fail 1\b/u);
    assert.match(failure.stdout, /^✖ test\/hang\.test\.js \(/mu);
    // The stopped file never reported its own time: the report counts the two that finished.
    assert.match(failure.stderr, /^jskit test: 2 test file\(s\) in [\d.]+ s/mu);
    assert.match(failure.stderr, /^ {2}test\/hang\.test\.js was stopped after 2\.\d s, past twice its 0\.5 s bound: it did not finish\.$/mu);
    // Only a file that finished without skipping a test has its time recorded: the next stop is reckoned from it.
    const recorded = JSON.parse(await readFile(path.join(root, FILE_TIMES), "utf8"));
    assert.deepEqual(Object.keys(recorded), ["test/quick.test.js"]);
  });
});

test("jskit test --databases takes the application's knexfile.js and its installed database runtime", async () => {
  await withProject({ "test/a.test.js": "" }, async (root) => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const missingKnexfile = await execFileAsync(process.execPath, [CLI_PATH, "test", "--databases"], { cwd: root, env })
      .then(() => null, (error) => error);
    assert.equal(missingKnexfile?.code, 1);
    assert.match(missingKnexfile.stderr, /^jskit test --databases reads the application's knexfile\.js, and .+ has none\.$/mu);

    await writeFile(path.join(root, "knexfile.js"), "export default {};\n");
    const missingRuntime = await execFileAsync(process.execPath, [CLI_PATH, "test", "--databases"], { cwd: root, env })
      .then(() => null, (error) => error);
    assert.equal(missingRuntime?.code, 1);
    assert.match(missingRuntime.stderr, /needs @jskit-ai\/database-runtime\/server\/testDatabases; install the application's JSKIT database driver\./u);
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
      "playwright.config.mjs:1 test/playwright-global-timeout",
      "vite.config.mjs:2 test/vitest-workers"
    ]);
    const result = await checkTestRuns({ projectRoot: root, manifests: await discoverProjectManifests(root) });
    const report = formatTestRunsReport(result);
    assert.match(report, /^package\.json:8 {2}test\/node-test {2}scripts\.test runs node --test directly; use `jskit test`/mu);
    assert.match(report, /guide\/framework\/typed-features#test-files-run-in-parallel/u);
    assert.match(report, /JSKIT test runs: 10 error\(s\)\./u);
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
    "playwright.config.mjs": `${BUDGET_IMPORT}export default { workers: testConcurrency(), globalTimeout: 20 * 60_000 };\n`,
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

test("jskit test runs every test file with APP_ENV=test, and refuses where APP_ENV is staging or production", async () => {
  await withProject({
    "package.json": { name: "app-env-fixture", private: true, type: "module" },
    "test/environment.test.js": "import assert from \"node:assert/strict\";\nimport test from \"node:test\";\n" +
      "test(\"runs as APP_ENV=test\", () => assert.equal(process.env.APP_ENV, \"test\"));\n"
  }, async (root) => {
    const env = { ...process.env, V64_TEST_CONCURRENCY: "1" };
    delete env.NODE_TEST_CONTEXT;
    for (const APP_ENV of [undefined, "development", "test"]) {
      const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, "test"], { cwd: root, env: { ...env, APP_ENV } });
      assert.match(stdout, /pass 1\b/u, String(APP_ENV));
    }
    for (const APP_ENV of ["staging", "production"]) {
      const failure = await execFileAsync(process.execPath, [CLI_PATH, "test"], { cwd: root, env: { ...env, APP_ENV } })
        .then(() => null, (error) => error);
      assert.equal(failure?.code, 1, APP_ENV);
      assert.equal(failure.stderr, `jskit test runs tests with APP_ENV=test, and APP_ENV is ${APP_ENV} here: tests never run ` +
        "on a staging or production server. Run them where APP_ENV is unset, development or test.\n");
    }
  });
});
