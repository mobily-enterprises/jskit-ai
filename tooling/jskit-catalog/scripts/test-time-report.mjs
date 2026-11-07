import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { toPosixPath } from "./files.mjs";

// How long `jskit test` took, file by file. The node --test reporter below runs beside a run's own reporters and writes
// the run's file and top-level test durations to the file `jskit test` names. After its last run, `jskit test` lists the
// ten slowest files and tests, records each file's time in node_modules/.cache/jskit-test/file-times.json, and fails
// when a file or the whole command went past a coarse bound that only a clearly broken suite reaches: a file waiting
// out its timeouts, a suite that would run for hours. An application whose measured suite needs more writes its own
// bounds in test-time-bounds.json, `{ "runMs": ..., "fileMs": ..., "files": { "<path>": ... } }`, with the measurement.
const SHOWN = 10;
const BOUNDS_FILE = "test-time-bounds.json";
const DEFAULT_BOUNDS = Object.freeze({ runMs: 45 * 60_000, fileMs: 10 * 60_000, files: Object.freeze({}) });
const FILE_TIMES = path.join("node_modules", ".cache", "jskit-test", "file-times.json");

const seconds = (ms) => (ms >= 60_000 ? `${(ms / 60_000).toFixed(1)} min` : `${(ms / 1000).toFixed(1)} s`);

/** @param {AsyncIterable<{ type: string, data: any }>} source node --test's events */
export default async function* collectTestTimes(source) {
  const relative = (file) => toPosixPath(path.relative(process.cwd(), file));
  const files = {};
  const tests = [];
  for await (const event of source) {
    if (event.type === "test:summary" && event.data.file) {
      files[relative(event.data.file)] = event.data.duration_ms;
    } else if ((event.type === "test:pass" || event.type === "test:fail") && event.data.nesting === 0 && event.data.file) {
      tests.push({ file: relative(event.data.file), name: event.data.name, ms: event.data.details?.duration_ms ?? 0 });
    }
  }
  yield `${JSON.stringify({ files, tests })}\n`;
}

/** The application's bounds over JSKIT's defaults; each must be a positive number of milliseconds. */
function readTestTimeBounds(cwd) {
  const file = path.join(cwd, BOUNDS_FILE);
  if (!existsSync(file)) return DEFAULT_BOUNDS;
  const own = JSON.parse(readFileSync(file, "utf8"));
  const bounds = { ...DEFAULT_BOUNDS, ...own, files: { ...own.files } };
  for (const [name, ms] of [["runMs", bounds.runMs], ["fileMs", bounds.fileMs], ...Object.entries(bounds.files)]) {
    if (!(Number.isFinite(ms) && ms > 0)) throw new Error(`${BOUNDS_FILE}: ${name} must be a positive number of milliseconds.`);
  }
  return bounds;
}

/**
 * The slowest files and tests of a `jskit test` command against its bounds, and the bounds it went past.
 * @param {{ bounds: { runMs: number, fileMs: number, files: Record<string, number> }, files: Record<string, number>,
 *   tests: Array<{ file: string, name: string, ms: number }>, wallMs: number }} times
 */
function checkTestTimes({ bounds, files, tests, wallMs }) {
  const rows = Object.entries(files).map(([name, ms]) => ({ name, ms, bound: bounds.files[name] ?? bounds.fileMs }));
  const overruns = rows.filter((row) => row.ms > row.bound)
    .map((row) => `${row.name} took ${seconds(row.ms)}, past its ${seconds(row.bound)} bound.`);
  if (wallMs > bounds.runMs) overruns.push(`The run took ${seconds(wallMs)}, past its ${seconds(bounds.runMs)} bound.`);
  const lines = [
    `jskit test: ${rows.length} test file(s) in ${seconds(wallMs)} (bound ${seconds(bounds.runMs)}); the slowest, time / bound:`,
    ...rows.sort((a, b) => b.ms - a.ms).slice(0, SHOWN).map((row) => `  ${seconds(row.ms)} / ${seconds(row.bound)}  ${row.name}`),
    "jskit test: the slowest tests:",
    ...[...tests].sort((a, b) => b.ms - a.ms).slice(0, SHOWN)
      .map((entry) => `  ${seconds(entry.ms)}  ${entry.file}: ${entry.name.slice(0, 120)}`)
  ];
  if (overruns.length > 0) {
    lines.push(
      "jskit test: past a time bound, so something is clearly broken:",
      ...overruns.map((overrun) => `  ${overrun}`),
      `Find what got slow and fix it; raise a bound in ${BOUNDS_FILE} only when the work itself grew, with the measurement.`
    );
  }
  return { overruns, report: `${lines.join("\n")}\n` };
}

/**
 * Reads what the runs' reporters wrote, records each file's time for the next command, and checks the times. A run
 * whose reporters were replaced (inside another node --test run) wrote nothing, and has no report.
 * @param {{ cwd: string, collected: string[], wallMs: number }} options `collected`: the reporters' destination files
 * @returns {{ overruns: string[], report: string } | null}
 */
function reportTestTimes({ cwd, collected, wallMs }) {
  const runs = collected.filter((file) => existsSync(file) && readFileSync(file, "utf8").trim())
    .map((file) => JSON.parse(readFileSync(file, "utf8")));
  const files = Object.assign({}, ...runs.map((run) => run.files));
  if (Object.keys(files).length === 0) return null;
  const record = path.join(cwd, FILE_TIMES);
  const recorded = existsSync(record) ? JSON.parse(readFileSync(record, "utf8")) : {};
  mkdirSync(path.dirname(record), { recursive: true });
  // Written whole, then renamed, so a command beside this one never reads half a file.
  writeFileSync(`${record}.${process.pid}`, `${JSON.stringify({ ...recorded, ...files }, null, 2)}\n`);
  renameSync(`${record}.${process.pid}`, record);
  return checkTestTimes({ bounds: readTestTimeBounds(cwd), files, tests: runs.flatMap((run) => run.tests), wallMs });
}

export { BOUNDS_FILE, FILE_TIMES, checkTestTimes, reportTestTimes };
