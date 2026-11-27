import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseArgs, usage } from "../scripts/jskit.mjs";
import { discoverProjectManifests } from "../scripts/project-manifests.mjs";
import * as testBudget from "../scripts/test-budget.mjs";
import { testConcurrency } from "../scripts/test-budget.mjs";
import { browserTestWorkers } from "../scripts/browser-tests.mjs";
import { planTestRuns, withTimeReporter } from "../scripts/test-command.mjs";
import { checkTestTimes, FILE_TIMES, fileStop } from "../scripts/test-time-report.mjs";
import { checkTestRuns, formatTestRunsReport } from "../scripts/test-runs.mjs";
import { useTestAppEnvironment } from "../scripts/test-environment.mjs";

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

// A cgroup v2 hierarchy as /proc/self/cgroup and /sys/fs/cgroup show it, for availableCpus()'s readFile.
function cgroupFiles(files) {
  return (file) => {
    if (Object.hasOwn(files, file)) return files[file];
    throw Object.assign(new Error(`ENOENT: ${file}`), { code: "ENOENT" });
  };
}

test("without a runner's budget, the test budget is half the CPUs the process may use: a cgroup cpu.max quota caps the machine's", () => {
  const scope = "/user.slice/user-1000.slice/run-7.scope";
  const limited = cgroupFiles({
    "/proc/self/cgroup": `0::${scope}\n`,
    [`/sys/fs/cgroup${scope}/cpu.max`]: "max 100000\n",
    "/sys/fs/cgroup/user.slice/user-1000.slice/cpu.max": "300000 100000\n",
    "/sys/fs/cgroup/user.slice/cpu.max": "max 100000\n"
  });
  // A 16-thread machine whose cgroup gives the run 3 CPUs: the budget is half of 3, never half of 16.
  assert.equal(testBudget.availableCpus({ parallelism: 16, readFile: limited }), 3);
  assert.equal(testConcurrency({ env: {}, parallelism: testBudget.availableCpus({ parallelism: 16, readFile: limited }) }), 1);
  // The tightest quota on the way to the root counts; a fraction of a CPU rounds down, never below 1.
  const nested = (quotas) => cgroupFiles({
    "/proc/self/cgroup": "0::/a/b\n",
    "/sys/fs/cgroup/a/b/cpu.max": quotas[0],
    "/sys/fs/cgroup/a/cpu.max": quotas[1]
  });
  assert.equal(testBudget.availableCpus({ parallelism: 16, readFile: nested(["250000 100000", "600000 100000"]) }), 2);
  assert.equal(testBudget.availableCpus({ parallelism: 16, readFile: nested(["max 100000", "50000 100000"]) }), 1);
  // A quota above the machine's CPUs, or none at all, leaves the machine's.
  assert.equal(testBudget.availableCpus({ parallelism: 4, readFile: nested(["800000 100000", "max 100000"]) }), 4);
  // A container's own namespace shows its cgroup as the root.
  assert.equal(testBudget.availableCpus({ parallelism: 28, readFile: cgroupFiles({
    "/proc/self/cgroup": "0::/\n", "/sys/fs/cgroup/cpu.max": "1200000 100000\n"
  }) }), 12);
  // No cgroup v2 (another system, or cgroup v1 only): the machine's CPUs.
  assert.equal(testBudget.availableCpus({ parallelism: 8, readFile: cgroupFiles({}) }), 8);
  assert.equal(testBudget.availableCpus({ parallelism: 8, readFile: cgroupFiles({
    "/proc/self/cgroup": "12:cpu,cpuacct:/user.slice\n"
  }) }), 8);
  // A runner's budget still wins over the machine's.
  assert.equal(testConcurrency({ env: { V64_TEST_CONCURRENCY: "6" }, parallelism: 1 }), 6);
  const cpus = testBudget.availableCpus();
  assert.ok(Number.isInteger(cpus) && cpus >= 1 && cpus <= os.availableParallelism());
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

// jskit check's fixed-wait marker excuses the wait on the line after it, wherever that is (test-sources.mjs); jskit
// test's own markers, alone and network, are a file's first line. mobilynet's FINAL3 run (mn-final3-sr-1a2, 27 Nov 2026)
// had four files refused before they ran, each for a fixed-wait marker on a later line.
test("a file with jskit check's fixed-wait marker runs, and an alone, network or misspelt marker off its first line still fails", async () => {
  await withProject({
    "test/a.test.js": "",
    "test/latency.test.js": "import test from \"node:test\";\n" +
      "// jskit-test: fixed-wait - the latency of the mail provider this stand-in simulates\nawait sleep(200);\n",
    "test/window.test.js": "// jskit-test: fixed-wait - the window in which the list must make no second read\n" +
      "await page.waitForTimeout(2000);\n"
  }, async (root) => {
    // No file is marked, so the one parallel run takes node's default files, all three.
    const plan = planTestRuns([], { cwd: root, concurrency: 4 });
    assert.deepEqual(plan.alone, []);
    assert.deepEqual(plan.runs, [["--test", "--test-concurrency=4"]]);
  });
  await withProject({
    "test/a.test.js": `import "node:test";\n${ALONE_LINE}\n`,
    "test/b.test.js": "import \"node:test\";\n// jskit-test: network - it reads the provider's sandbox\n",
    "test/c.test.js": "// jskit-test: alnoe - a misspelt marker\n"
  }, async (root) => {
    assert.throws(() => planTestRuns([], { cwd: root }), (error) => {
      assert.match(error.message, /test\/a\.test\.js:2: a jskit-test marker belongs on the file's first line/u);
      assert.match(error.message, /test\/b\.test\.js:2: a jskit-test marker belongs on the file's first line/u);
      assert.match(error.message, /test\/c\.test\.js:1: write it as `\/\/ jskit-test: alone - <why/u);
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

// A test file that leaves a mark when it runs.
const MARKS = (name) => `import { writeFileSync } from "node:fs";
import test from "node:test";
test("${name}", () => writeFileSync("${name}.ran", ""));
`;

test("jskit test --list prints the files a run would take and their count, runs none and prepares no database", async () => {
  await withProject({
    "test/a.test.js": MARKS("a"),
    "test/b.test.js": `${ALONE_LINE}\n${MARKS("b")}`,
    "tests/server/c.integration.test.js": MARKS("c")
  }, async (root) => {
    const env = { ...process.env, V64_TEST_CONCURRENCY: "2" };
    delete env.NODE_TEST_CONTEXT;
    // No database settings at all: --databases with --list prepares nothing.
    for (const name of ["DB_CLIENT", "DB_HOST", "DB_NAME", "TEST_DB_NAME", "DATABASE_URL"]) delete env[name];
    const list = async (...args) => (await execFileAsync(process.execPath, [CLI_PATH, "test", ...args], { cwd: root, env })).stdout;
    assert.equal(await list("--list"),
      "test/a.test.js\ntest/b.test.js\ntests/server/c.integration.test.js\nTotal: 3 files\n");
    // Named files and options are the run the script chose, as a run takes them.
    assert.equal(await list("--databases", "--list", "test/a.test.js"), "test/a.test.js\nTotal: 1 file\n");
    assert.equal(await list("--list", "--test-reporter", "dot", "tests/**/*.test.js"),
      "tests/server/c.integration.test.js\nTotal: 1 file\n");
    // A name that matches no file is no file of the run.
    assert.equal(await list("--list", "test/a.test.js", "test/missing.test.js"), "test/a.test.js\nTotal: 1 file\n");
    for (const name of ["a", "b", "c"]) assert.equal(existsSync(path.join(root, `${name}.ran`)), false, `${name} ran`);
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

    // A run of only the tests a name picks says nothing about how long a whole file takes, so every file keeps the
    // time its last whole run took: otherwise the next whole run is stopped at ten times a single test's time.
    const whole = { ...recorded, "test/one.test.js": 123_456 };
    await writeFile(path.join(root, FILE_TIMES), JSON.stringify(whole));
    for (const filter of [["--test-name-pattern", "one"], ["--test-skip-pattern=two"]]) {
      await execFileAsync(process.execPath, [CLI_PATH, "test", ...filter], { cwd: root, env });
      assert.deepEqual(JSON.parse(await readFile(path.join(root, FILE_TIMES), "utf8")), whole, filter.join(" "));
    }

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

const BROWSER_WORKERS_IMPORT = "import { browserTestWorkers } from \"@jskit-ai/jskit-catalog/browser-tests\";\n";

// An application's own Playwright config (not browserTestConfig()) that starts its own server per worker in a
// globalSetup, as one did, with its workers from the whole test budget, as this check required: on a test host whose
// runner gave the run 3 slots (V64_TEST_CONCURRENCY 6, two threads a slot), it started 6 workers, and 8 once the runner
// lent it idle slots, each a browser and an app server: about two threads each, so twice what the runner gave.
const WHOLE_BUDGET_CONFIG = `import { defineConfig } from "@playwright/test";
${BUDGET_IMPORT}
const managedBaseUrl = String(process.env.PLAYWRIGHT_BASE_URL || "").trim();

export default defineConfig({
  testDir: "./tests/e2e",
  ...(managedBaseUrl ? { workers: 1 } : { workers: testConcurrency() }),
  globalTimeout: 600_000,
  ...(managedBaseUrl ? {} : { globalSetup: "./tests/e2e/globalSetup.mjs" })
});
`;

test("jskit check refuses a Playwright config whose workers are the whole test budget, twice the browsers the runner gives", async () => {
  // The runner's 3 slots: the config started one worker per budget thread, where a worker drives a browser and a server.
  const runner = { V64_TEST_CONCURRENCY: "6" };
  assert.equal(testConcurrency({ env: runner }), 6);
  assert.equal(browserTestWorkers({ env: runner, argv: [] }), 3);
  const app = (config) => ({
    "package.json": { name: "own-browser-setup", scripts: { "test:e2e": "playwright test tests/e2e" } },
    "playwright.config.mjs": config
  });
  await withProject(app(WHOLE_BUDGET_CONFIG), async (root) => {
    assert.deepEqual(await findings(root), ["playwright.config.mjs:8 test/playwright-workers"]);
    const report = formatTestRunsReport(await checkTestRuns({ projectRoot: root, manifests: await discoverProjectManifests(root) }));
    assert.match(report, /^playwright\.config\.mjs:8 {2}test\/playwright-workers {2}playwright's workers are not browserTestWorkers\(\): each worker drives a browser, and its own app server where it starts one, about two threads, so it takes half the test budget \(1 on a managed target\); set `workers: browserTestWorkers\(\)` from @jskit-ai\/jskit-catalog\/browser-tests\.$/mu);
  });
  const fixed = WHOLE_BUDGET_CONFIG.replace(BUDGET_IMPORT, BROWSER_WORKERS_IMPORT)
    .replace("...(managedBaseUrl ? { workers: 1 } : { workers: testConcurrency() }),", "workers: browserTestWorkers(),");
  assert.notEqual(fixed, WHOLE_BUDGET_CONFIG);
  await withProject(app(fixed), async (root) => assert.deepEqual(await findings(root), []));
});

test("jskit check passes an app whose runs use jskit test and whose configs read the budget", async () => {
  const app = {
    "package.json": {
      name: "budgeted",
      scripts: { test: "jskit test", "test:client": "vitest run tests/client", "test:e2e": "playwright test tests/e2e" }
    },
    "package-lock.json": { name: "budgeted", lockfileVersion: 3, packages: { "": { name: "budgeted" } } },
    "playwright.config.mjs": `${BROWSER_WORKERS_IMPORT}export default { workers: browserTestWorkers(), globalTimeout: 20 * 60_000 };\n`,
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
    assert.match(failure.stderr, /^playwright\.config\.mjs:1 {2}test\/playwright-workers {2}playwright's workers are not browserTestWorkers\(\): each worker drives a browser, and its own app server where it starts one, about two threads, so it takes half the test budget \(1 on a managed target\); set `workers: browserTestWorkers\(\)` from @jskit-ai\/jskit-catalog\/browser-tests\.$/mu);
  });
});

test("tests run as APP_ENV=test and log at warn unless LOG_LEVEL asks for more, so a failure stays readable", () => {
  const quiet = {};
  useTestAppEnvironment(quiet, "jskit test");
  assert.deepEqual(quiet, { APP_ENV: "test", LOG_LEVEL: "warn" });
  const asked = { APP_ENV: "development", LOG_LEVEL: "debug" };
  useTestAppEnvironment(asked, "jskit browser tests");
  assert.deepEqual(asked, { APP_ENV: "test", LOG_LEVEL: "debug" });
});

test("jskit test gives every test file LOG_LEVEL=warn unless the shell names a level", async () => {
  await withProject({
    "package.json": { name: "log-level-fixture", private: true, type: "module" },
    "test/level.test.js": "import assert from \"node:assert/strict\";\nimport test from \"node:test\";\n" +
      "test(\"logs at the level asked\", () => assert.equal(process.env.LOG_LEVEL, process.env.EXPECTED_LOG_LEVEL));\n"
  }, async (root) => {
    const env = { ...process.env, V64_TEST_CONCURRENCY: "1" };
    for (const variable of ["NODE_TEST_CONTEXT", "LOG_LEVEL"]) delete env[variable];
    for (const [LOG_LEVEL, EXPECTED_LOG_LEVEL] of [[undefined, "warn"], ["debug", "debug"]]) {
      const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, "test"], { cwd: root, env: { ...env, LOG_LEVEL, EXPECTED_LOG_LEVEL } });
      assert.match(stdout, /pass 1\b/u, String(LOG_LEVEL));
    }
  });
});

test("jskit check names an app whose logger options take no level from LOG_LEVEL, so its test servers log every request", async () => {
  const app = {
    "package.json": { name: "logged", scripts: { test: "jskit test" } },
    "package-lock.json": { name: "logged", lockfileVersion: 3, packages: { "": { name: "logged" } } },
    "server/lib/loggerOptions.js": "import pino from \"pino\";\n\nfunction buildLoggerOptions() {\n  return { serializers: { error: pino.stdSerializers.err } };\n}\n\n" +
      "export { buildLoggerOptions };\n"
  };
  await withProject(app, async (root) => {
    assert.deepEqual(await findings(root), ["server/lib/loggerOptions.js:3 test/log-level"]);
    const failure = await execFileAsync(process.execPath, [CLI_PATH, "check", "--root", root]).then(() => null, (error) => error);
    assert.equal(failure?.code, 1);
    assert.match(failure.stderr, /^server\/lib\/loggerOptions\.js:3 {2}test\/log-level {2}buildLoggerOptions\(\) takes no level from LOG_LEVEL, so a test server logs every request at info: give its options `level: String\(runtimeEnv\.LOG_LEVEL \|\| ""\)\.trim\(\) \|\| "info"`/mu);
  });
  const levelled = "function buildLoggerOptions(runtimeEnv) {\n  return { level: String(runtimeEnv.LOG_LEVEL || \"\").trim() || \"info\" };\n}\n";
  await withProject({ ...app, "server/lib/loggerOptions.js": levelled }, async (root) => {
    assert.deepEqual(await findings(root), []);
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
