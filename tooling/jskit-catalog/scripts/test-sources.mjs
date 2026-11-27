import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileExists } from "./files.mjs";
import { DEFAULT_PATTERN, findTestFiles } from "./test-command.mjs";
import { excusedWait, scanSource } from "./test-sources-scan.mjs";

// The test-source part of plain `jskit check`: what an app's tests, test scripts, CI workflows and Vite config hold that
// makes a run slow, fragile or unsafe, each found by its shape:
// - test/fixed-sleep: a test file waits a fixed time instead of for its condition. A timer racing another wait in
//   `Promise.race([...])` bounds that wait, and a wait in a loop that re-reads its condition each round is a poll's
//   interval: neither is reported (test-sources-scan.mjs). The fixed waits a test needs, a window that proves nothing
//   happens (no second read within it) or the latency a stand-in simulates, say so on the line before:
//   `// jskit-test: fixed-wait - <what the window proves, or the latency the stand-in simulates>`; a marker without a
//   reason is a finding itself.
// - test/fixed-database-name: a test script, Playwright or Vitest config, or test source names the test database
//   itself, so two runs (two sessions, two checkouts) share it and wipe each other's rows. The run's test-only env file
//   or its host names it, `jskit test --databases` gives each file its own copy, and browserTestConfig()'s prepare module
//   derives each browser worker's. A name in a thrown error's message text names no database.
// - test/test-database-is-app-database: a CI workflow gives TEST_DB_NAME or BROWSER_TEST_DB_NAME the value of its DB_NAME.
// - test/script-files: a script gives `jskit test` the files node's default pattern selects anyway, so `npm test --
//   <file>` runs every file and that one. A script that runs some of them, or files the pattern leaves out, names them
//   for a reason.
// - test/generated-into-src: the app's Vite config writes a generated file (`dts`) into src, which the browser tests'
//   frontend build reads, so a build is never kept for reuse.
// No other comment excuses them.

const GUIDE = "https://mobily-enterprises.github.io/jskit-ai/guide/framework/typed-features#test-source-rules";
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "coverage", "test-results", "playwright-report", "blob-report"]);
const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/u;
const TEST_NAME = /\.(?:test|spec)\.(?:[cm]?[jt]s|[jt]sx)$/u;
const TEST_DIRECTORY = /^(?:tests?)$/u;
const RUNNER_CONFIG = /^(?:playwright|vitest)(?:\.[\w-]+)*\.config\.[cm]?[jt]s$/u;
const VITE_CONFIG = /^vite\.config\.[cm]?[jt]s$/u;
const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/u;
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/u;

const MARKER = /^\s*\/\/\s*jskit-test:\s*fixed-wait\b(.*)$/u;
const MARKER_REASON = /^\s+-\s+\S/u;
const WAIT_FOR_TIMEOUT = /(?:[\w$]+\.)*waitForTimeout\s*\([^)]*\)/u;
const PROMISE_SLEEP = new RegExp(
  "\\bnew\\s+Promise\\s*\\(\\s*\\(?\\s*([A-Za-z_$][\\w$]*)\\s*\\)?\\s*=>\\s*\\{?\\s*setTimeout\\s*\\(\\s*" +
  "(?:\\1|\\(\\s*\\)\\s*=>\\s*\\{?\\s*\\1\\s*\\(\\s*\\)\\s*;?\\s*\\}?)\\s*,\\s*(\\d[\\d_]*(?:\\.\\d+)?)\\s*\\)\\s*;?\\s*\\}?\\s*\\)?",
  "u"
);
// An awaited setTimeout, sleep, delay or pause, its own or an object's (timers.setTimeout), and wait: its own or node's
// scheduler.wait. Another object's wait is that object's method, such as a fake clock's advance (page.wait(60_000)).
const AWAITED_SLEEP = /\bawait\s+(?:(?:[A-Za-z_$][\w$]*\.)?(?:setTimeout|sleep|delay|pause)|(?:scheduler\.)?wait)\s*\(\s*(\d[\d_]*(?:\.\d+)?)\s*[,)]/u;

// The options of `jskit test` (node's test runner) that take the next argument as their value.
const VALUE_OPTIONS = new Set([
  "--test-name-pattern", "--test-skip-pattern", "--test-reporter", "--test-reporter-destination", "--test-global-setup",
  "--test-timeout", "--test-shard", "--test-coverage-include", "--test-coverage-exclude", "--test-isolation", "--import",
  "--require", "-r", "--env-file", "--watch-path", "--conditions", "-C", "--experimental-loader", "--loader"
]);
const DATABASE_VARIABLE = "(?:BROWSER_TEST_|TEST_)?DB_NAME";
const STRING_LITERAL = "(?:\"[^\"\\n]+\"|'[^'\\n]+'|`[^`$\\n]+`)";
const ENV_READ = `process\\.env(?:\\.(${DATABASE_VARIABLE})\\b|\\[\\s*["'](${DATABASE_VARIABLE})["']\\s*\\])`;
const LITERAL_FALLBACK = new RegExp(`${ENV_READ}\\s*(?:\\|\\||\\?\\?)\\s*${STRING_LITERAL}`, "u");
const LITERAL_ASSIGNMENT = new RegExp(`${ENV_READ}\\s*=(?!=)\\s*${STRING_LITERAL}`, "u");
const LITERAL_PROPERTY = new RegExp(`(?:^|[\\s{,])["']?(${DATABASE_VARIABLE})["']?\\s*:\\s*${STRING_LITERAL}`, "u");
const SCRIPT_PIN = new RegExp(`^(${DATABASE_VARIABLE})=(.+)$`, "u");
const TEST_SCRIPT_NAME = /(?:^|:)(?:test|e2e|verify)(?::|$)/u;
const TEST_COMMAND = /\bjskit\s+(?:test|migration-history)\b|\bplaywright\s+test\b|\bvitest\b|\bnode\b[^&|;]*\s--test\b/u;
const YAML_PAIR = new RegExp(`^\\s*-?\\s*["']?(${DATABASE_VARIABLE})["']?\\s*:\\s*(.*?)\\s*$`, "u");
const SHELL_PAIR = new RegExp(`(?:^|[\\s"'])(${DATABASE_VARIABLE})=([^\\s"';&|]+)`, "gu");
const REFERS_TO_DB_NAME = /^(?:\$\{\{\s*env\.DB_NAME\s*\}\}|\$\{?DB_NAME\}?)$/u;
const GENERATED_INTO_SRC = /\bdts\s*:\s*(["'`])((?:\.\/)?src\/[^"'`]+)\1/gu;

const DATABASE_FIX = "the run's test-only env file or the host names the database, `jskit test --databases` gives each " +
  "test file its own copy of TEST_DB_NAME, and browserTestConfig()'s prepare module derives each worker's from " +
  "BROWSER_TEST_DB_NAME.";
const MARKER_FORM = "// jskit-test: fixed-wait - <what the window proves, or the latency the stand-in simulates>";
const SLEEP_FIX = "wait for the condition instead: a web-first assertion (await expect(locator).toBeVisible()), " +
  "expect.poll(), the event itself, or a fake clock (mock.timers, vi.useFakeTimers(), page.clock). A window that proves " +
  `nothing happens, or the latency a stand-in simulates, says so on the line before: ${MARKER_FORM}.`;
// A database name in a thrown error's message text, `throw new Error(\`DB_NAME (${process.env.DB_NAME || "unset"}) ...\`)`.
const IN_THROWN_MESSAGE = /\bthrow\s+new\s+[A-Za-z_$][\w$.]*\s*\(\s*`(?:[^`\\]|\\.)*\$\{[^`}]*$/u;

/** Every file of the app outside dependencies, builds, test output and dot-directories, relative and POSIX. */
async function listFiles(root, relative = "") {
  const files = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const file = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!entry.name.startsWith(".") && !SKIPPED_DIRECTORIES.has(entry.name)) files.push(...await listFiles(root, file));
    } else if (entry.isFile()) {
      files.push(file);
    }
  }
  return files;
}

async function listWorkflows(root) {
  const directory = path.join(root, ".github", "workflows");
  if (!(await fileExists(directory))) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => `.github/workflows/${entry.name}`)
    .filter((file) => WORKFLOW.test(file));
}

const isTestFile = (file) => SOURCE_FILE.test(file) &&
  (TEST_NAME.test(file) || file.split("/").slice(0, -1).some((part) => TEST_DIRECTORY.test(part)));

const asNumber = (literal) => Number(String(literal).replace(/_/gu, ""));

/** The fixed wait a line makes, as written, and where it starts; null for none (a zero-delay timer waits for no time). */
function fixedWait(line) {
  const waitForTimeout = line.match(WAIT_FOR_TIMEOUT);
  if (waitForTimeout) return { wait: waitForTimeout[0], column: waitForTimeout.index };
  for (const pattern of [PROMISE_SLEEP, AWAITED_SLEEP]) {
    const match = line.match(pattern);
    if (match && asNumber(match[match.length - 1]) > 0) return { wait: match[0].trim(), column: match.index + match[0].search(/\S/u) };
  }
  return null;
}

function checkFixedWaits(file, text, report) {
  const lines = text.split("\n");
  let tokens;
  let offset = 0;
  lines.forEach((line, index) => {
    const lineStart = offset;
    offset += line.length + 1;
    if (COMMENT_LINE.test(line)) return;
    const found = fixedWait(line);
    if (!found) return;
    tokens = tokens === undefined ? scanSource(text) : tokens;
    if (excusedWait(text, lineStart + found.column, tokens)) return;
    const marker = index > 0 ? lines[index - 1].match(MARKER) : null;
    if (!marker) {
      report({ file, line: index + 1, rule: "test/fixed-sleep", message: `waits a fixed time (${found.wait}); ${SLEEP_FIX}` });
    } else if (!MARKER_REASON.test(marker[1])) {
      report({ file, line: index, rule: "test/fixed-sleep",
        message: "has a jskit-test: fixed-wait marker without a reason; write after it what the window proves, or the " +
          `latency the stand-in simulates (${MARKER_FORM}), or wait for the condition instead.` });
    }
  });
}

function checkDatabaseNames(file, lines, { configFile }, report) {
  lines.forEach((line, index) => {
    if (COMMENT_LINE.test(line)) return;
    const match = line.match(LITERAL_FALLBACK) || line.match(LITERAL_ASSIGNMENT) || (configFile && line.match(LITERAL_PROPERTY));
    if (!match || IN_THROWN_MESSAGE.test(line.slice(0, match.index))) return;
    report({ file, line: index + 1, rule: "test/fixed-database-name",
      message: `names the test database itself (${match[0].replace(/^[\s{,]+/u, "")}); drop the name and read the variable ` +
        `as the run gives it: ${DATABASE_FIX}` });
  });
}

function lineOf(contents, needle, after = "") {
  const text = String(contents);
  const offset = text.indexOf(needle, after ? Math.max(0, text.indexOf(after)) : 0);
  return offset < 0 ? 1 : text.slice(0, offset).split("\n").length;
}

/** The files and globs a script's `jskit test` commands name, past their options and the options' values. */
function jskitTestFiles(script) {
  const files = [];
  for (const command of String(script).split(/&&|\|\||[;|\n]/u)) {
    const tokens = command.trim().split(/\s+/u).map((token) => token.replace(/^['"(]+|['")]+$/gu, "")).filter(Boolean);
    const at = tokens.findIndex((token, index) => (token === "jskit" || token.endsWith("/jskit")) && tokens[index + 1] === "test");
    if (at < 0) continue;
    for (let index = at + 2; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (VALUE_OPTIONS.has(token)) index += 1;
      else if (!token.startsWith("-") && !token.startsWith("$") && !/^\d*>/u.test(token)) files.push(token);
    }
  }
  return files;
}

/**
 * Whether the files a script names are the ones `jskit test` runs given none: node's default pattern. A glob or folder
 * that matches no file leaves `jskit test` with the default's files too.
 */
function selectsDefaultFiles(directory, files, defaults) {
  const named = findTestFiles(files, directory);
  const chosen = named.length > 0 ? named : defaults();
  return chosen.length === defaults().length && chosen.every((file, index) => file === defaults()[index]);
}

function checkScripts(root, file, contents, report) {
  let manifest;
  try {
    manifest = JSON.parse(contents);
  } catch {
    return;
  }
  const directory = path.join(root, path.posix.dirname(file));
  let defaultFiles;
  const defaults = () => (defaultFiles ??= findTestFiles([DEFAULT_PATTERN], directory));
  for (const [name, script] of Object.entries(manifest?.scripts || {})) {
    const line = lineOf(contents, `"${name}"`, '"scripts"');
    const files = jskitTestFiles(script);
    if (files.length > 0 && selectsDefaultFiles(directory, files, defaults)) {
      const run = name === "test" ? "npm test" : `npm run ${name}`;
      report({ file, line, rule: "test/script-files",
        message: `${file}'s ${name} script names ${files.join(" ")}: drop ${files.length > 1 ? "them" : "it"}. \`jskit test\` finds ` +
          `test files by node's default pattern, so \`${run} -- <file>\` runs exactly that file.` });
    }
    if (!TEST_SCRIPT_NAME.test(name) && !TEST_COMMAND.test(String(script))) continue;
    for (const token of String(script).split(/\s+/u).map((part) => part.replace(/^['"(]+|['");]+$/gu, ""))) {
      const pin = token.match(SCRIPT_PIN);
      if (!pin) continue;
      report({ file, line, rule: "test/fixed-database-name", message: `scripts.${name} pins ${pin[1]}=${pin[2]}; drop it: ${DATABASE_FIX}` });
    }
  }
}

const unquoted = (value) => value.replace(/\s+#.*$/u, "").trim().replace(/^(["'])(.*)\1$/u, "$2");

function workflowPairs(lines) {
  const pairs = [];
  lines.forEach((line, index) => {
    const yaml = line.match(YAML_PAIR);
    if (yaml) pairs.push({ name: yaml[1], value: unquoted(yaml[2]), line: index + 1 });
    for (const shell of line.matchAll(SHELL_PAIR)) pairs.push({ name: shell[1], value: shell[2], line: index + 1 });
  });
  return pairs.filter(({ value }) => value);
}

function checkWorkflow(file, lines, report) {
  const pairs = workflowPairs(lines);
  const appDatabases = pairs.filter(({ name }) => name === "DB_NAME").map(({ value }) => value);
  for (const { name, value, line } of pairs) {
    if (name === "DB_NAME" || (!appDatabases.includes(value) && !REFERS_TO_DB_NAME.test(value))) continue;
    const appDatabase = appDatabases.find((database) => !REFERS_TO_DB_NAME.test(database)) || "<DB_NAME>";
    const own = `${appDatabase}_${name === "TEST_DB_NAME" ? "test" : "e2e"}`;
    report({ file, line, rule: "test/test-database-is-app-database",
      message: `${name} is ${value}, the app's DB_NAME in this workflow; give it a name of its own, such as ${own}: a test ` +
        "run replaces its test databases from the snapshot, and JSKIT refuses to run one on DB_NAME." });
  }
}

function checkViteConfig(file, contents, report) {
  for (const match of String(contents).matchAll(GENERATED_INTO_SRC)) {
    const generated = match[2].replace(/^\.\//u, "");
    const outside = generated.replace(/^src\//u, "types/");
    report({ file, line: String(contents).slice(0, match.index).split("\n").length, rule: "test/generated-into-src",
      message: `writes ${generated} into src, which the browser tests' frontend build reads, so that build is never kept ` +
        `for reuse ("not kept for reuse, as src changed while it ran"): set dts: "${outside}", move the file there and ` +
        "its .gitignore line with it." });
  }
}

/**
 * @param {{ projectRoot: string }} input
 * @returns {Promise<{ ok: boolean, findings: Array<{ file: string, line: number, rule: string, message: string }>, files: number }>}
 */
async function checkTestSources({ projectRoot }) {
  const root = path.resolve(projectRoot);
  const findings = [];
  const report = (finding) => findings.push(finding);
  let testFiles = 0;
  for (const file of [...await listFiles(root), ...await listWorkflows(root)]) {
    const name = path.posix.basename(file);
    const read = async () => readFile(path.join(root, file), "utf8");
    if (WORKFLOW.test(file)) {
      checkWorkflow(file, (await read()).split("\n"), report);
    } else if (name === "package.json") {
      checkScripts(root, file, await read(), report);
    } else if (VITE_CONFIG.test(file)) {
      checkViteConfig(file, await read(), report);
    } else if (RUNNER_CONFIG.test(name)) {
      checkDatabaseNames(file, (await read()).split("\n"), { configFile: true }, report);
    } else if (isTestFile(file)) {
      testFiles += 1;
      const text = await read();
      checkFixedWaits(file, text, report);
      checkDatabaseNames(file, text.split("\n"), { configFile: false }, report);
    }
  }
  findings.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line);
  return { ok: findings.length < 1, findings, files: testFiles };
}

function formatTestSourcesReport(result) {
  const lines = result.findings.flatMap(({ file, line, rule, message }) => [`${file}:${line}  ${rule}  ${message}`, `  ${GUIDE}`]);
  lines.push(result.ok
    ? "JSKIT test sources: no fixed waits, pinned test database names or generated files in src " +
      `(${result.files} test file(s) read).`
    : `JSKIT test sources: ${result.findings.length} error(s). Tests wait for conditions, never for time, and leave the ` +
      "test databases to the run; the app's generated files stay out of src.");
  return lines.join("\n");
}

export { checkTestSources, formatTestSourcesReport };
