import { spawn } from "node:child_process";
import { globSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { toPosixPath } from "./files.mjs";
import { BUDGET_VARIABLE, testConcurrency } from "./test-budget.mjs";

// `jskit test [node options] [files or globs]`: node --test, running test files in parallel within the machine's test
// budget (test-budget.mjs). Its arguments go to node --test unchanged. A file that truly must run alone says why on its
// first line, `// jskit-test: alone - <reason>`, and runs after the others, one such file at a time.

// node --test's own default (Node 26) when it is given no files.
const DEFAULT_PATTERN = "**/{test,test/**/*,test-*,*[._-]test}.{js,mjs,cjs,ts,mts,cts}";
const MARKER = /^\s*\/\/\s*jskit-test:(.*)$/u;
const ALONE = /^\s*alone\s+-\s+(\S.*)$/u;

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
  // An argument that matches no file is an option's value (--test-reporter spec) or a typo node reports itself.
  const matched = new Map(candidates.map((candidate) => [candidate, findTestFiles([candidate], cwd)]));
  const files = candidates.length > 0
    ? [...new Set([...matched.values()].flat())].sort()
    : findTestFiles([DEFAULT_PATTERN], cwd);
  const { alone, problems } = readAloneFiles(files, cwd);
  if (problems.length > 0) throw new Error(`jskit test:\n- ${problems.join("\n- ")}`);
  const parallel = ["--test", `--test-concurrency=${concurrency}`];
  if (alone.length < 1) return { concurrency, alone, runs: [[...parallel, ...args]] };

  const options = args.filter((argument) => !(matched.get(argument)?.length > 0));
  const aloneFiles = new Set(alone.map((entry) => entry.file));
  const others = files.filter((file) => !aloneFiles.has(file));
  return {
    concurrency,
    alone,
    runs: [
      ...(others.length > 0 ? [[...parallel, ...options, ...others]] : []),
      ["--test", "--test-concurrency=1", ...options, ...aloneFiles]
    ]
  };
}

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: "inherit" });
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
 * Runs `jskit test` and resolves to its exit code: the first failing run's, or 0.
 * @param {string[]} args
 */
async function runTests(args) {
  const plan = planTestRuns(args);
  const source = process.env[BUDGET_VARIABLE] ? BUDGET_VARIABLE : "half of this machine";
  process.stderr.write(`jskit test: ${plan.concurrency} test file(s) at a time (${source}).\n`);
  for (const { file, reason } of plan.alone) process.stderr.write(`jskit test: ${file} runs alone: ${reason}\n`);
  let exitCode = 0;
  for (const run of plan.runs) {
    const { code, signal } = await runNode(run);
    if (exitCode === 0) exitCode = code;
    // An interrupted run ends the whole command.
    if (signal) break;
  }
  return exitCode;
}

export { planTestRuns, runTests };
