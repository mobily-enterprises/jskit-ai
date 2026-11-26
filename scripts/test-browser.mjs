// The package browser tests a run's switches turn on. Each *.browser.test.js file skips unless its own JSKIT_*
// switch is "1" (process.env.JSKIT_X === "1", or !== "1" in its skip); this runs every package browser test file whose
// switches the environment sets, so a CI step names its switches and never a list of files, and a new browser test
// file joins the step that sets its switch. check:ci refuses a browser test file whose switch no CI step sets.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { packageTestFiles } from "./test-sqlite.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT_DIR = fileURLToPath(new URL("..", import.meta.url));
const JSKIT_CLI = path.join(ROOT_DIR, "tooling", "jskit-catalog", "scripts", "jskit.mjs");
const BROWSER_RUN = /\.browser\.test\.js$/u;
const SWITCH = /process\.env\.(JSKIT_[A-Z0-9_]+)\s*[!=]==\s*"1"/gu;

/** Every package browser test file, relative to the repository and sorted, with the JSKIT_* switches it compares with "1". */
function browserTestFiles(rootDir = ROOT_DIR) {
  return packageTestFiles((entry) => BROWSER_RUN.test(entry), rootDir).map((file) => ({
    file,
    switches: [...new Set([...readFileSync(path.join(rootDir, file), "utf8").matchAll(SWITCH)].map((match) => match[1]))].sort()
  }));
}

/** The browser test files whose switches are all "1" in environment. */
function switchedBrowserTestFiles(environment, rootDir = ROOT_DIR) {
  return browserTestFiles(rootDir)
    .filter(({ switches }) => switches.length > 0 && switches.every((name) => environment[name] === "1"))
    .map(({ file }) => file);
}

function main() {
  const files = switchedBrowserTestFiles(process.env);
  if (files.length < 1) {
    const switches = [...new Set(browserTestFiles().flatMap(({ switches }) => switches))].sort();
    throw new Error(`test:browser found no browser test file whose switch is set: set one of ${switches.join(", ")} to "1".`);
  }
  process.stderr.write(`test:browser: ${files.length} package browser test file(s).\n`);
  const run = spawnSync(process.execPath, [JSKIT_CLI, "test", ...files], { cwd: ROOT_DIR, stdio: "inherit" });
  process.exitCode = run.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main();
}

export { browserTestFiles, switchedBrowserTestFiles };
