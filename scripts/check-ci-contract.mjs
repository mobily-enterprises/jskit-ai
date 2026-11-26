import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { postgresTestFiles } from "./test-postgres.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const WORKFLOW_ROOT = path.join(REPO_ROOT, ".github", "workflows");

function collectEngineMajors(engineRange = "") {
  return [...String(engineRange).matchAll(/\^(\d+)(?:\.\d+){0,2}/gu)]
    .map((match) => Number(match[1]))
    .filter(Number.isInteger)
    .sort((left, right) => left - right);
}

function collectMatrixMajors(workflowSource = "") {
  const matrixMatch = String(workflowSource).match(
    /\bmatrix:\s*\n(?:(?: {6}|\t).*(?:\n|$))*?(?: {8}|\t{2})node:\s*\n((?:(?: {10}|\t{3})-\s+\d+\s*(?:\n|$))+)/u
  );
  if (!matrixMatch) {
    return [];
  }
  return [...matrixMatch[1].matchAll(/-\s+(\d+)/gu)]
    .map((match) => Number(match[1]))
    .filter(Number.isInteger)
    .sort((left, right) => left - right);
}

function sameNumbers(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function collectNpmScriptReferences(workflowSource = "") {
  return [...String(workflowSource).matchAll(/\bnpm\s+run(?:\s+--if-present)?\s+([A-Za-z0-9:_-]+)/gu)]
    .map((match) => match[1]);
}

// Each test-runner command of a workflow (`jskit test` or a direct `node --test`) with the files it names.
function collectTestRuns(workflowSource = "") {
  return [...String(workflowSource).matchAll(/\b(node\s+--test|jskit\s+test)(?=\s|$)([^\n|>&;]*)/gu)]
    .map((match) => ({
      direct: match[1].startsWith("node"),
      targets: match[2].trim().split(/\s+/u)
        .map((target) => target.replace(/^['"]|['"]$/gu, ""))
        .filter((target) => target && !target.startsWith("-"))
    }));
}

// A test target the shell expands: `*` in its file name only, as `packages/x/test/*.postgres.test.js`.
const GLOB_CHARACTERS = /[*?[\]{}]/u;

// The issue with one test target, or null when it names a file, or a `*` pattern in the file name that matches one.
async function testTargetIssue(workflowName, relativeTarget, { repoRoot, pathExists, listDirectory }) {
  if (!GLOB_CHARACTERS.test(relativeTarget)) {
    return (await pathExists(path.resolve(repoRoot, relativeTarget))) ? null : `${workflowName} runs missing test target "${relativeTarget}".`;
  }
  const directory = path.posix.dirname(relativeTarget);
  const pattern = path.posix.basename(relativeTarget);
  if (GLOB_CHARACTERS.test(directory) || /[?[\]{}]/u.test(pattern)) {
    return `${workflowName} runs test target "${relativeTarget}", a pattern the CI check cannot read; name the files, or use * in the file name only.`;
  }
  const matcher = fileNameMatcher(pattern);
  const names = await listDirectory(path.resolve(repoRoot, directory));
  return names.some((name) => matcher.test(name)) ? null : `${workflowName} runs test target "${relativeTarget}", which matches no file.`;
}

// A file name pattern with `*` only: the pattern has no ?, [ ] or { }, so only the other regular-expression characters
// need escaping.
function fileNameMatcher(pattern) {
  const parts = pattern.split("*").map((part) => part.replace(/[.+^$()|\\]/gu, "\\$&"));
  return new RegExp(`^${parts.join("[^/]*")}$`, "u");
}

// Whether a readable test target names, or its `*` matches, a file test:postgres picks: a data test named by hand in
// a workflow is a list a new data test file is left out of, as CI's PostgreSQL job once left out six.
async function namesPickedDataTest(relativeTarget, pickedDataTestFiles, { repoRoot, listDirectory }) {
  if (!GLOB_CHARACTERS.test(relativeTarget)) {
    return pickedDataTestFiles.has(path.posix.normalize(relativeTarget));
  }
  const directory = path.posix.normalize(path.posix.dirname(relativeTarget));
  const matcher = fileNameMatcher(path.posix.basename(relativeTarget));
  const names = await listDirectory(path.resolve(repoRoot, directory));
  return names.some((name) => matcher.test(name) && pickedDataTestFiles.has(path.posix.join(directory, name)));
}

async function collectCiContractIssues({
  packageJson,
  workflows,
  repoRoot = REPO_ROOT,
  pathExists = async (targetPath) => {
    try {
      await access(targetPath);
      return true;
    } catch {
      return false;
    }
  },
  listDirectory = async (directoryPath) => readdir(directoryPath).catch(() => []),
  pickedDataTestFiles = new Set(postgresTestFiles(repoRoot))
} = {}) {
  const issues = [];
  const scripts = packageJson?.scripts && typeof packageJson.scripts === "object"
    ? packageJson.scripts
    : {};

  for (const [workflowName, workflowSource] of Object.entries(workflows || {})) {
    for (const scriptName of collectNpmScriptReferences(workflowSource)) {
      if (!Object.hasOwn(scripts, scriptName)) {
        issues.push(`${workflowName} runs missing root package script "${scriptName}".`);
      }
    }
    for (const { direct, targets } of collectTestRuns(workflowSource)) {
      if (direct) {
        issues.push(`${workflowName} runs node --test directly; run \`npx jskit test\`, which keeps test files within the machine's test budget.`);
      }
      for (const relativeTarget of targets) {
        const issue = await testTargetIssue(workflowName, relativeTarget, { repoRoot, pathExists, listDirectory });
        if (issue) {
          issues.push(issue);
        } else if (await namesPickedDataTest(relativeTarget, pickedDataTestFiles, { repoRoot, listDirectory })) {
          issues.push(
            `${workflowName} runs data test target "${relativeTarget}" by hand; run \`npm run verify\`, ` +
            "`npm run test:sqlite` or `npm run test:postgres`, which pick every data test file themselves, so none is left out."
          );
        }
      }
    }
  }

  const verifyWorkflow = workflows?.["verify.yml"] || workflows?.["verify.yaml"] || "";
  const supportedMajors = collectEngineMajors(packageJson?.engines?.node);
  const matrixMajors = collectMatrixMajors(verifyWorkflow);
  if (supportedMajors.length < 1) {
    issues.push("package.json engines.node must declare supported Node major versions.");
  } else if (!sameNumbers(matrixMajors, supportedMajors)) {
    issues.push(
      `verify workflow Node matrix (${matrixMajors.join(", ") || "none"}) must match engines.node ` +
      `(${supportedMajors.join(", ")}).`
    );
  }
  if (!/\bnpm_config_engine_strict:\s*["']?true["']?\s*$/mu.test(verifyWorkflow)) {
    issues.push("verify workflow must enable npm_config_engine_strict.");
  }
  // A new commit on the same pull request supersedes its running verification. A run on main always finishes, so main's
  // history shows a verdict for every pushed commit.
  const concurrency = /^concurrency:[ \t]*\n((?:[ \t]+\S.*(?:\n|$))+)/mu.exec(verifyWorkflow)?.[1] || "";
  if (!/^\s*group:.*\bgithub\.ref\b/mu.test(concurrency) ||
    !/^\s*cancel-in-progress:\s*\$\{\{\s*github\.event_name\s*==\s*'pull_request'\s*\}\}\s*$/mu.test(concurrency)) {
    issues.push("verify workflow must cancel only a pull request's superseded run, so a run on main always finishes: " +
      "a top-level concurrency group on github.ref with cancel-in-progress: ${{ github.event_name == 'pull_request' }}.");
  }

  return issues;
}

async function loadWorkflows() {
  const workflowNames = (await readdir(WORKFLOW_ROOT))
    .filter((fileName) => /\.ya?ml$/u.test(fileName))
    .sort();
  return Object.fromEntries(await Promise.all(workflowNames.map(async (workflowName) => [
    workflowName,
    await readFile(path.join(WORKFLOW_ROOT, workflowName), "utf8")
  ])));
}

async function main() {
  const packageJson = JSON.parse(await readFile(path.join(REPO_ROOT, "package.json"), "utf8"));
  const workflows = await loadWorkflows();
  const issues = await collectCiContractIssues({ packageJson, workflows });
  if (issues.length > 0) {
    throw new Error(`CI contract verification failed:\n- ${issues.join("\n- ")}`);
  }
  process.stdout.write(`Verified ${Object.keys(workflows).length} CI workflows against current package scripts, tests, and runtimes.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  await main();
}

export {
  collectCiContractIssues,
  collectEngineMajors,
  collectMatrixMajors,
  collectTestRuns,
  collectNpmScriptReferences,
  main
};
