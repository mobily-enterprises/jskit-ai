import { spawn } from "node:child_process";
import { globSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { toPosixPath } from "./files.mjs";
import { BUDGET_VARIABLE, testConcurrency } from "./test-budget.mjs";
import { DATABASES_OPTION, testDatabaseRunFor } from "./test-databases.mjs";

// `jskit test [node options] [files or globs]`: node --test, running test files in parallel within the machine's test
// budget (test-budget.mjs). Its arguments go to node --test unchanged. A file that truly must run alone says why on its
// first line, `// jskit-test: alone - <reason>`, and runs after the others, one such file at a time. That second run
// writes a reporter's file destination beside the first run's (`<name>.alone<ext>`) instead of over it, and with
// --test-shard=<index>/<total> it runs only its shard's alone files, picked the way node --test picks a shard's files.

// node --test's own default (Node 26) when it is given no files.
const DEFAULT_PATTERN = "**/{test,test/**/*,test-*,*[._-]test}.{js,mjs,cjs,ts,mts,cts}";
const MARKER = /^\s*\/\/\s*jskit-test:(.*)$/u;
const ALONE = /^\s*alone\s+-\s+(\S.*)$/u;
const SHARD = "--test-shard";
const DESTINATION = "--test-reporter-destination";
const STREAM_DESTINATIONS = new Set(["stdout", "stderr"]);

function findTestFiles(patterns, cwd) {
  const entries = globSync(patterns, { cwd, withFileTypes: true, exclude: (entry) => entry.name === "node_modules" });
  const files = entries
    .filter((entry) => entry.isFile() || entry.isSymbolicLink())
    .map((entry) => toPosixPath(path.relative(cwd, path.join(entry.parentPath, entry.name))));
  return [...new Set(files)].sort();
}

/**
 * The files of a run that must run alone, from their first line. A marker that is malformed or not on the first line
 * (after a shebang) is an error, so a file never runs in parallel because its marker was missed.
 * @returns {{ alone: Array<{ file: string, reason: string }>, problems: string[] }}
 */
function readAloneFiles(files, cwd) {
  const alone = [];
  const problems = [];
  for (const file of files) {
    const lines = readFileSync(path.resolve(cwd, file), "utf8").split("\n");
    const top = lines[0]?.startsWith("#!") ? 1 : 0;
    lines.forEach((line, index) => {
      const marker = MARKER.exec(line);
      if (!marker) return;
      const reason = ALONE.exec(marker[1])?.[1]?.trim();
      if (index !== top) problems.push(`${file}:${index + 1}: a jskit-test marker belongs on the file's first line.`);
      else if (!reason) problems.push(`${file}:${index + 1}: write it as \`// jskit-test: alone - <why this file cannot run beside others>\`.`);
      else alone.push({ file, reason });
    });
  }
  return { alone, problems };
}

/** A reporter's file destination for the alone run, beside the parallel run's: `<name>.alone<ext>`; streams stay. */
function aloneDestination(destination) {
  if (STREAM_DESTINATIONS.has(destination)) return destination;
  const { dir, name, ext } = path.parse(destination);
  return path.join(dir, `${name}.alone${ext}`);
}

/**
 * The alone run's options: the parallel run's, with each file destination moved beside it and without the shard, which
 * `aloneShard` has already applied to the alone files.
 * @param {string[]} options
 */
function aloneRunOptions(options) {
  const result = [];
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option === SHARD) index += 1;
    else if (option.startsWith(`${SHARD}=`)) continue;
    else if (option === DESTINATION && index + 1 < options.length) {
      result.push(option, aloneDestination(options[index + 1]));
      index += 1;
    } else if (option.startsWith(`${DESTINATION}=`)) result.push(`${DESTINATION}=${aloneDestination(option.slice(DESTINATION.length + 1))}`);
    else result.push(option);
  }
  return result;
}

/** The alone files of this run's shard (`--test-shard=<index>/<total>`), as node --test picks a shard's files. */
function aloneShard(files, options) {
  const at = options.findIndex((option) => option === SHARD || option.startsWith(`${SHARD}=`));
  if (at < 0) return files;
  const [index, total] = (options[at] === SHARD ? options[at + 1] : options[at].slice(SHARD.length + 1)).split("/").map(Number);
  return files.filter((_, position) => position % total === index - 1);
}

/**
 * The node --test runs for these arguments: one in parallel within the budget, then the files that must run alone.
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
  const { alone, problems } = readAloneFiles(files, cwd);
  if (problems.length > 0) throw new Error(`jskit test:\n- ${problems.join("\n- ")}`);
  const parallel = ["--test", `--test-concurrency=${concurrency}`];
  if (alone.length < 1) return { concurrency, files: files.length, alone, runs: [[...parallel, ...args]] };

  const options = args.filter((argument) => !(matched.get(argument)?.length > 0));
  const aloneFiles = new Set(alone.map((entry) => entry.file));
  const others = files.filter((file) => !aloneFiles.has(file));
  const shardAlone = aloneShard([...aloneFiles], options);
  return {
    concurrency,
    files: others.length,
    alone,
    runs: [
      ...(others.length > 0 ? [[...parallel, ...options, ...others]] : []),
      ...(shardAlone.length > 0 ? [["--test", "--test-concurrency=1", ...aloneRunOptions(options), ...shardAlone]] : [])
    ]
  };
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
async function runTests(args) {
  const nodeArgs = args.filter((argument) => argument !== DATABASES_OPTION);
  let plan = planTestRuns(nodeArgs);
  const source = process.env[BUDGET_VARIABLE] ? BUDGET_VARIABLE : "half of this machine";
  // A database for each file that can run at once: a focused run of one file prepares one.
  const databases = nodeArgs.length < args.length
    ? await testDatabaseRunFor(Math.max(1, Math.min(plan.concurrency, plan.files)))
    : null;
  if (databases) {
    process.stderr.write(`jskit test: ${databases.summary}.\n`);
    plan = planTestRuns(nodeArgs, { concurrency: databases.concurrency });
  }
  process.stderr.write(`jskit test: ${plan.concurrency} test file(s) at a time (${databases ? "test databases" : source}).\n`);
  for (const { file, reason } of plan.alone) process.stderr.write(`jskit test: ${file} runs alone: ${reason}\n`);
  const preload = databases?.preload ? ["--import", pathToFileURL(databases.preload).href] : [];
  let exitCode = 0;
  try {
    for (const run of plan.runs) {
      const { code, signal } = await runNode([...preload, ...run], databases?.env);
      if (exitCode === 0) exitCode = code;
      // An interrupted run ends the whole command.
      if (signal) break;
    }
  } finally {
    databases?.cleanup();
  }
  return exitCode;
}

export { planTestRuns, runTests };
