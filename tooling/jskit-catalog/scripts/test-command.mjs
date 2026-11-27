import { spawn } from "node:child_process";
import { globSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { toPosixPath } from "./files.mjs";
import { BUDGET_VARIABLE, testConcurrency } from "./test-budget.mjs";
import { DATABASES_OPTION, testDatabaseRunFor } from "./test-databases.mjs";
import { useTestAppEnvironment } from "./test-environment.mjs";
import { networkGuardEnvironment, withoutNetworkGuard } from "./test-network-guard.mjs";
import { STOPS_VARIABLE } from "./test-file-stop.mjs";
import { reportTestTimes, writeFileStops } from "./test-time-report.mjs";

// `jskit test [node options] [files or globs]`: node --test, running test files in parallel within the machine's test
// budget (test-budget.mjs). Its arguments go to node --test unchanged. A file that truly must run alone says why on its
// first line, `// jskit-test: alone - <reason>`, and runs after the others, one such file at a time. That second run
// writes a reporter's file destination beside the first run's (`<name>.alone<ext>`) instead of over it, and with
// --test-shard=<index>/<total> it runs only its shard's alone files, picked the way node --test picks a shard's files.
// Given no files, it fails instead of leaving out a file under tests/ named as a test that node's default misses.
// Every run also reports to test-time-report.mjs, which times the command's files against coarse bounds, and preloads
// test-file-stop.mjs, which stops a file still running at a generous multiple of its time. With --databases, a run whose
// test databases let fewer files run at once than the budget asked for (no usable TEST_DB_NAME, or copies the database
// user may not create) says so, and why, at its start and its end, and fails once its tests have run: a machine that
// should run files in parallel never silently runs them one at a time. A budget set to what the databases allow
// (V64_TEST_CONCURRENCY) runs that way on purpose. With --list it prints the files that run would take, one per line,
// then `Total: <n> file(s)` (the closing line Playwright's --list prints), and runs nothing: a host checks that a run
// of named files takes exactly those before it sends them anywhere. Every test file, and every process it starts with
// its environment, reaches only this machine and the test database (test-network-guard.mjs); a file that must reach
// an outside service says why on its first line, `// jskit-test: network - <reason>`, and runs without that guard, in
// a parallel run of its own after the others.

// node --test's own default (Node 26) when it is given no files.
const DEFAULT_PATTERN = "**/{test,test/**/*,test-*,*[._-]test}.{js,mjs,cjs,ts,mts,cts}";
// Files under a tests/ folder named as tests that the default leaves out (`x.integration.js`, `x.spec.js`, `x.tests.js`);
// every file under a test/ folder already matches it. Files in Playwright's e2e and browser folders, and files that
// import Vitest or Playwright, belong to those runners.
const TEST_LIKE_PATTERN = "**/tests/**/*[._-]{integration,spec,specs,tests}.{js,mjs,cjs,ts,mts,cts}";
const OTHER_RUNNER_FOLDER = /(?:^|\/)(?:e2e|browser)\//u;
const OTHER_RUNNER_IMPORT = /\b(?:from|import|require)\s*\(?\s*["'](?:vitest|@playwright\/test)["']/u;
const MARKER = /^\s*\/\/\s*jskit-test:(.*)$/u;
// jskit check's marker for the wait on the line after it (test-sources.mjs), wherever that is: not a file marker.
const CHECK_MARKER = /^\s*fixed-wait\b/u;
const MARKED = /^\s*(alone|network)\s+-\s+(\S.*)$/u;
const MARKER_FORMS = Object.freeze({
  alone: "`// jskit-test: alone - <why this file cannot run beside others>`",
  network: "`// jskit-test: network - <why this file must reach an outside service>`"
});
const SHARD = "--test-shard";
// A run of only some of its files' tests, by name or `only`, says nothing about how long a whole file takes.
const TEST_FILTER = /^--test-(?:name-pattern|skip-pattern|only)(?:=|$)/u;
const REPORTER = "--test-reporter";
const DESTINATION = "--test-reporter-destination";
const TIME_REPORTER = new URL("./test-time-report.mjs", import.meta.url).href;
const FILE_STOP = new URL("./test-file-stop.mjs", import.meta.url).href;
// Every test file's process compiles the same modules; Node's compile cache keeps them for the next process and run.
// A cache the environment names, or NODE_DISABLE_COMPILE_CACHE=1, wins.
const COMPILE_CACHE = path.join("node_modules", ".cache", "jskit-node-compile-cache");
const STREAM_DESTINATIONS = new Set(["stdout", "stderr"]);

function findTestFiles(patterns, cwd) {
  const entries = globSync(patterns, { cwd, withFileTypes: true, exclude: (entry) => entry.name === "node_modules" });
  const files = entries
    .filter((entry) => entry.isFile() || entry.isSymbolicLink())
    .map((entry) => toPosixPath(path.relative(cwd, path.join(entry.parentPath, entry.name))));
  return [...new Set(files)].sort();
}

/** The files named as Node tests that a run of node's default files would silently leave out. */
function missedTestFiles(defaultFiles, cwd) {
  const found = new Set(defaultFiles);
  return findTestFiles([TEST_LIKE_PATTERN], cwd).filter((file) => !found.has(file) && !OTHER_RUNNER_FOLDER.test(file) &&
    !OTHER_RUNNER_IMPORT.test(readFileSync(path.resolve(cwd, file), "utf8")));
}

/**
 * The files of a run that must run alone, or reach an outside service, from their first line. A marker that is
 * malformed or not on the first line (after a shebang) is an error, so a file never runs in parallel, or unguarded,
 * because its marker was missed. jskit check's fixed-wait marker is its own, on any line, and left to it.
 * @returns {{ alone: Array<{ file: string, reason: string }>, network: Array<{ file: string, reason: string }>, problems: string[] }}
 */
function readMarkedFiles(files, cwd) {
  const marked = { alone: [], network: [] };
  const problems = [];
  for (const file of files) {
    const lines = readFileSync(path.resolve(cwd, file), "utf8").split("\n");
    const top = lines[0]?.startsWith("#!") ? 1 : 0;
    lines.forEach((line, index) => {
      const marker = MARKER.exec(line);
      if (!marker || CHECK_MARKER.test(marker[1])) return;
      const [, kind, reason] = MARKED.exec(marker[1]) || [];
      const meant = /^\s*network\b/u.test(marker[1]) ? MARKER_FORMS.network : MARKER_FORMS.alone;
      if (index !== top) problems.push(`${file}:${index + 1}: a jskit-test marker belongs on the file's first line.`);
      else if (!reason?.trim()) problems.push(`${file}:${index + 1}: write it as ${meant}.`);
      else marked[kind].push({ file, reason: reason.trim() });
    });
  }
  return { ...marked, problems };
}

/** A reporter's file destination for a run of marked files, beside the parallel run's (`<name>.<kind><ext>`); streams stay. */
function markedDestination(destination, kind) {
  if (STREAM_DESTINATIONS.has(destination)) return destination;
  const { dir, name, ext } = path.parse(destination);
  return path.join(dir, `${name}.${kind}${ext}`);
}

/**
 * A run of marked files' options: the parallel run's, with each file destination moved beside it and without the
 * shard, which `markedShard` has already applied to those files.
 * @param {string[]} options
 * @param {"alone" | "network"} kind
 */
function markedRunOptions(options, kind) {
  const result = [];
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option === SHARD) index += 1;
    else if (option.startsWith(`${SHARD}=`)) continue;
    else if (option === DESTINATION && index + 1 < options.length) {
      result.push(option, markedDestination(options[index + 1], kind));
      index += 1;
    } else if (option.startsWith(`${DESTINATION}=`)) result.push(`${DESTINATION}=${markedDestination(option.slice(DESTINATION.length + 1), kind)}`);
    else result.push(option);
  }
  return result;
}

/**
 * The marked files (alone or network) of this run's shard (`--test-shard=<index>/<total>`), as node --test picks a
 * shard's files.
 */
function markedShard(files, options) {
  const at = options.findIndex((option) => option === SHARD || option.startsWith(`${SHARD}=`));
  if (at < 0) return files;
  const [index, total] = (options[at] === SHARD ? options[at + 1] : options[at].slice(SHARD.length + 1)).split("/").map(Number);
  return files.filter((_, position) => position % total === index - 1);
}

/**
 * The node --test runs for these arguments: one in parallel within the budget, then the files that must reach an
 * outside service, in parallel too, then the files that must run alone. `guarded` says, for each run, whether its
 * processes get the network guard: all but the run of network files.
 * @param {string[]} args the arguments after `jskit test`
 * @param {{ cwd?: string, concurrency?: number }} [options]
 */
function planTestRuns(args, { cwd = process.cwd(), concurrency = testConcurrency() } = {}) {
  if (args.some((argument) => /^--test-concurrency(?:=|$)/u.test(argument))) {
    throw new Error("jskit test takes the test concurrency from the machine's budget; remove --test-concurrency.");
  }
  const candidates = args.filter((argument) => !argument.startsWith("-"));
  // An argument that matches no file is an option's value (--test-reporter spec) or a typo node reports itself; with
  // none that matches, the run is node's default files.
  const matched = new Map(candidates.map((candidate) => [candidate, findTestFiles([candidate], cwd)]));
  const named = [...new Set([...matched.values()].flat())].sort();
  const files = named.length > 0 ? named : findTestFiles([DEFAULT_PATTERN], cwd);
  const missed = named.length > 0 ? [] : missedTestFiles(files, cwd);
  if (missed.length > 0) {
    throw new Error("jskit test: given no files, node --test runs only the files its default pattern matches " +
      "(test.js, test-*.js, *.test.js, *_test.js, *-test.js, or any file under a test/ folder), so these test files " +
      "would never run:\n" +
      `- ${missed.join("\n- ")}\nRename each to end in .test.js (a database test: <name>.integration.test.js), or ` +
      "name the files to run.");
  }
  const { alone, network, problems } = readMarkedFiles(files, cwd);
  if (problems.length > 0) throw new Error(`jskit test:\n- ${problems.join("\n- ")}`);
  const parallel = ["--test", `--test-concurrency=${concurrency}`];
  if (alone.length < 1 && network.length < 1) {
    return { concurrency, files: files.length, paths: files, alone, network, runs: [[...parallel, ...args]], guarded: [true] };
  }

  const options = args.filter((argument) => !(matched.get(argument)?.length > 0));
  const marked = new Set([...alone, ...network].map((entry) => entry.file));
  const others = files.filter((file) => !marked.has(file));
  const shardNetwork = markedShard(network.map((entry) => entry.file), options);
  const shardAlone = markedShard(alone.map((entry) => entry.file), options);
  const runs = [
    ...(others.length > 0 ? [{ run: [...parallel, ...options, ...others], guarded: true }] : []),
    ...(shardNetwork.length > 0 ? [{ run: [...parallel, ...markedRunOptions(options, "network"), ...shardNetwork], guarded: false }] : []),
    ...(shardAlone.length > 0
      ? [{ run: ["--test", "--test-concurrency=1", ...markedRunOptions(options, "alone"), ...shardAlone], guarded: true }]
      : [])
  ];
  return {
    concurrency,
    // The most files running at once: the guarded ones, then the network ones, each run in parallel.
    files: Math.max(others.length, network.length),
    paths: files,
    alone,
    network,
    runs: runs.map(({ run }) => run),
    guarded: runs.map(({ guarded }) => guarded)
  };
}

/**
 * The run with the time reporter added before its own options (node takes the arguments after a file as files), writing
 * to `destination`. Node pairs reporters and destinations by position, and gives a run with no reporter `spec` on
 * stdout, and a lone reporter with no destination stdout; the run keeps those.
 * @param {string[]} run ["--test", "--test-concurrency=<n>", ...its options and files]
 */
function withTimeReporter(run, destination) {
  const count = (option) => run.filter((argument) => argument === option || argument.startsWith(`${option}=`)).length;
  const reporters = count(REPORTER);
  const destinations = count(DESTINATION);
  return [
    ...run.slice(0, 2),
    ...(reporters === 0 && destinations === 0 ? [`${REPORTER}=spec`, `${DESTINATION}=stdout`] : []),
    `${REPORTER}=${TIME_REPORTER}`,
    `${DESTINATION}=${destination}`,
    ...(reporters === 1 && destinations === 0 ? [`${DESTINATION}=stdout`] : []),
    ...run.slice(2)
  ];
}

/**
 * What a run says, at its start and its end, when its test databases let fewer files run at once than it asked for, or
 * "" when they gave all it asked. An installed @jskit-ai/database-runtime from before `shortfall` is read by its summary.
 * @param {{ concurrency: number, shortfall?: string, summary: string }} databases
 * @param {number} asked
 */
function databaseShortfall(databases, asked) {
  if (databases.concurrency >= asked) return "";
  const copies = asked > 2 ? `\`<TEST_DB_NAME>_1\` to \`<TEST_DB_NAME>_${asked - 1}\`` : "`<TEST_DB_NAME>_1`";
  return `test files run ${databases.concurrency} at a time, not the ${asked} this machine's test budget allows: ` +
    `${databases.shortfall || databases.summary}. Each file running at once needs a database of its own: TEST_DB_NAME, ` +
    `then ${copies}, which the database user creates and drops (MySQL and MariaDB: grant it \`<TEST_DB_NAME>\\_%\`; ` +
    `PostgreSQL: CREATEDB). To run this way on purpose, set ${BUDGET_VARIABLE}=${databases.concurrency}.`;
}

function runNode(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: "inherit", env: { ...process.env, ...env } });
    const forward = (signal) => child.kill(signal);
    process.on("SIGINT", forward);
    process.on("SIGTERM", forward);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      process.off("SIGINT", forward);
      process.off("SIGTERM", forward);
      resolve({ code: code ?? 128 + (os.constants.signals[signal] ?? 0), signal });
    });
  });
}

/**
 * Runs `jskit test` and resolves to its exit code: the first failing run's, or 0. With `--databases`, each file running
 * at once has a test database of its own (test-databases.mjs), and the run's concurrency is how many there are.
 * @param {string[]} args
 */
const LIST_OPTION = "--list";

/** The files a run of `args` would take, and their count, without running them or preparing a database. */
function listTestFiles(args) {
  const { paths } = planTestRuns(args.filter((argument) => argument !== LIST_OPTION && argument !== DATABASES_OPTION));
  process.stdout.write(`${[...paths, `Total: ${paths.length} ${paths.length === 1 ? "file" : "files"}`].join("\n")}\n`);
  return 0;
}

async function runTests(args) {
  if (args.includes(LIST_OPTION)) return listTestFiles(args);
  // Every run, and its test databases, is APP_ENV=test.
  useTestAppEnvironment(process.env, "jskit test");
  const nodeArgs = args.filter((argument) => argument !== DATABASES_OPTION);
  let plan = planTestRuns(nodeArgs);
  const source = process.env[BUDGET_VARIABLE] ? BUDGET_VARIABLE : "half of this machine";
  // A database for each file that can run at once: a focused run of one file prepares one.
  const asked = Math.max(1, Math.min(plan.concurrency, plan.files));
  const databases = nodeArgs.length < args.length ? await testDatabaseRunFor(asked) : null;
  const shortfall = databases ? databaseShortfall(databases, asked) : "";
  if (databases) {
    process.stderr.write(`jskit test: ${databases.summary}.\n`);
    if (shortfall) process.stderr.write(`jskit test: ${shortfall}\n`);
    plan = planTestRuns(nodeArgs, { concurrency: databases.concurrency });
  }
  process.stderr.write(`jskit test: ${plan.concurrency} test file(s) at a time (${databases ? "test databases" : source}).\n`);
  for (const { file, reason } of plan.alone) process.stderr.write(`jskit test: ${file} runs alone: ${reason}\n`);
  for (const { file, reason } of plan.network) process.stderr.write(`jskit test: ${file} reaches the network: ${reason}\n`);
  const preload = [...(databases?.preload ? ["--import", pathToFileURL(databases.preload).href] : []), "--import", FILE_STOP];
  const timesDirectory = mkdtempSync(path.join(os.tmpdir(), "jskit-test-times-"));
  const stops = writeFileStops({ cwd: process.cwd(), files: plan.paths, directory: timesDirectory });
  const collected = plan.runs.map((_run, index) => path.join(timesDirectory, `run-${index}.json`));
  const started = performance.now();
  let exitCode = 0;
  let interrupted = false;
  try {
    for (const [index, run] of plan.runs.entries()) {
      const env = {
        NODE_COMPILE_CACHE: process.env.NODE_COMPILE_CACHE || path.resolve(COMPILE_CACHE),
        [STOPS_VARIABLE]: stops,
        ...databases?.env,
        // Its test files, and what they start, reach only this machine and the test database; network files, anywhere.
        ...(plan.guarded[index]
          ? networkGuardEnvironment(process.env, "jskit test")
          : { NODE_OPTIONS: withoutNetworkGuard(process.env.NODE_OPTIONS) })
      };
      const { code, signal } = await runNode([...preload, ...withTimeReporter(run, collected[index])], env);
      if (exitCode === 0) exitCode = code;
      // An interrupted run ends the whole command.
      interrupted = Boolean(signal);
      if (interrupted) break;
    }
    const times = interrupted
      ? null
      : reportTestTimes({ cwd: process.cwd(), collected, directory: timesDirectory, wallMs: performance.now() - started,
        filtered: nodeArgs.some((argument) => TEST_FILTER.test(argument)) });
    if (times) process.stderr.write(times.report);
    if (times?.overruns.length > 0 && exitCode === 0) exitCode = 1;
    if (shortfall && !interrupted) {
      process.stderr.write(`jskit test: ${shortfall}\njskit test: the run fails: its test databases cost it concurrency.\n`);
      if (exitCode === 0) exitCode = 1;
    }
  } finally {
    // However the run ended, its settings go; its test databases stay for the next run, which restores them.
    await databases?.cleanup();
    rmSync(timesDirectory, { recursive: true, force: true });
  }
  return exitCode;
}

export { DEFAULT_PATTERN, findTestFiles, planTestRuns, runTests, withTimeReporter };
