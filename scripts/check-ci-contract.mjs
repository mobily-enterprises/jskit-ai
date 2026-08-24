import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

function collectNodeTestReferences(workflowSource = "") {
  return [...String(workflowSource).matchAll(/\bnode\s+--test\s+([^\s|>&]+)/gu)]
    .map((match) => match[1].replace(/^['"]|['"]$/gu, ""))
    .filter((target) => target && !target.startsWith("-"));
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
  }
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
    for (const relativeTarget of collectNodeTestReferences(workflowSource)) {
      const targetPath = path.resolve(repoRoot, relativeTarget);
      if (!(await pathExists(targetPath))) {
        issues.push(`${workflowName} runs missing test target "${relativeTarget}".`);
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
  collectNodeTestReferences,
  collectNpmScriptReferences,
  main
};
