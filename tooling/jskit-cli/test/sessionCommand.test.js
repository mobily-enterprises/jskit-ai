import assert from "node:assert/strict";
import { access, chmod, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createCliRunner } from "../../testUtils/runCli.js";
import { withTempDir } from "../../testUtils/tempDir.mjs";
import {
  STEP_DEFINITIONS,
  STEP_IDS,
  STEP_PRECONDITION_NAMES,
  createSession,
  extractIssueDetails,
  extractIssueTitle,
  extractIssueText,
  extractPlanText,
  inspectSessionDetails,
  rewindSession,
  runSessionStep
} from "../src/server/sessionRuntime.js";
import {
  extractAppBlueprintText
} from "../src/server/appBlueprint.js";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const PROMPT_ROOT = fileURLToPath(new URL("../src/server/sessionRuntime/prompts/", import.meta.url));
const runCli = createCliRunner(CLI_PATH);

async function writeExecutable(filePath, source) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, source, "utf8");
  await chmod(filePath, 0o755);
}

async function installFakeCommand(binDir, commandName, source) {
  const filePath = path.join(binDir, commandName);
  await writeExecutable(filePath, source);
  return filePath;
}

function parseJsonResult(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function parseJsonFailure(result) {
  assert.notEqual(result.status, 0);
  return JSON.parse(result.stdout);
}

const SESSION_CONTRACT_FIELDS = Object.freeze([
  "activeCycle",
  "agentDecisionsLatest",
  "agentDecisionsPath",
  "appReady",
  "baseBranch",
  "baseCommit",
  "blueprintExists",
  "blueprintPath",
  "checks",
  "codexThreadId",
  "commandLogExists",
  "commandLogPath",
  "completedSteps",
  "currentStepAction",
  "currentReviewPass",
  "cycles",
  "dependencyInstall",
  "finalReportPath",
  "finalReportText",
  "githubComments",
  "helperMapExists",
  "helperMapPath",
  "issueCategory",
  "issueMetadata",
  "issueDetails",
  "issueDetailsPath",
  "planExecution",
  "prOutcome",
  "reviewPasses",
  "stepDefinitions",
  "uiChecks",
  "uiImpact",
  "workflowVersion",
  "worktreeStatus"
]);

function assertSessionContractFields(payload) {
  for (const field of SESSION_CONTRACT_FIELDS) {
    assert.ok(Object.hasOwn(payload, field), `session JSON is missing ${field}`);
  }
}

function runSessionStepJson(cwd, sessionId, {
  args = [],
  env = undefined,
  input = undefined
} = {}) {
  return parseJsonResult(runCli({
    cwd,
    args: ["session", sessionId, "step", ...args, "--json"],
    env,
    input
  }));
}

function runSessionStepJsonFailure(cwd, sessionId, {
  args = [],
  env = undefined,
  input = undefined
} = {}) {
  return parseJsonFailure(runCli({
    cwd,
    args: ["session", sessionId, "step", ...args, "--json"],
    env,
    input
  }));
}

function rewindSessionJson(cwd, sessionId, stepId, {
  env = undefined
} = {}) {
  return parseJsonResult(runCli({
    cwd,
    args: ["session", sessionId, "rewind", "--step", stepId, "--json"],
    env
  }));
}

function rewindSessionJsonFailure(cwd, sessionId, stepId, {
  env = undefined
} = {}) {
  return parseJsonFailure(runCli({
    cwd,
    args: ["session", sessionId, "rewind", "--step", stepId, "--json"],
    env
  }));
}

function codexStepResult(step = "step") {
  return `[jskit_step_result]\nstatus: complete\nstep: ${step}\nsummary: ${step} completed.\n[/jskit_step_result]`;
}

function codexResultArgs() {
  return ["--codex-result", "-"];
}

function cyclePlanPath(sessionRoot, cycle = "001") {
  return path.join(sessionRoot, "cycles", `cycle_${cycle}`, "plan.md");
}

async function writeCyclePlan(sessionRoot, text, cycle = "001") {
  const planPath = cyclePlanPath(sessionRoot, cycle);
  await mkdir(path.dirname(planPath), { recursive: true });
  await writeFile(planPath, text, "utf8");
}

function advanceCliSessionToIssuePrompt(cwd, sessionId, { env = undefined } = {}) {
  const worktreePayload = runSessionStepJson(cwd, sessionId, { env });
  assert.equal(worktreePayload.currentStep, "dependencies_installed");
  assert.equal(worktreePayload.worktreeReady, true);
  assert.equal(worktreePayload.dependencyInstall.status, "pending");
  const promptReadyPayload = runSessionStepJson(cwd, sessionId, { env });
  assert.equal(promptReadyPayload.currentStep, "issue_prompt_rendered");
  assert.equal(promptReadyPayload.currentStepAction.input.name, "prompt");
  assert.equal(promptReadyPayload.dependencyInstall.status, "installed");
  return {
    promptReadyPayload,
    worktreePayload
  };
}

function saveCliSessionIssueDetails(cwd, sessionId, { env = undefined } = {}) {
  const detailsPrompt = runSessionStepJson(cwd, sessionId, { env });
  assert.equal(detailsPrompt.currentStep, "issue_details_gathered");
  assert.match(detailsPrompt.prompt, /Gather exact issue details/);
  assert.doesNotMatch(detailsPrompt.prompt, /\[issue_details_conversation_ready\]/);
  assert.equal(detailsPrompt.currentStepAction.buttonLabel, "Save issue details");
  assert.equal(detailsPrompt.codex.autoInject, true);
  assert.equal(detailsPrompt.codex.promptActionLabel, "Start details conversation");
  const reloadedDetailsPrompt = parseJsonResult(runCli({
    cwd,
    args: ["session", sessionId, "--json"],
    env
  }));
  assert.equal(reloadedDetailsPrompt.currentStep, "issue_details_gathered");
  assert.match(reloadedDetailsPrompt.prompt, /Gather exact issue details/);
  assert.doesNotMatch(reloadedDetailsPrompt.prompt, /\[issue_details_conversation_ready\]/);
  const detailsSaved = runSessionStepJson(cwd, sessionId, {
    args: ["--issue-details", "-"],
    env,
    input: issueDetailsOutput()
  });
  assert.equal(detailsSaved.currentStep, "plan_made");
  assert.equal(detailsSaved.issueDetails, "Confirmed details are sufficient to plan the requested change.");
  assert.equal(detailsSaved.issueMetadata.issueCategory, "client");
  assert.equal(detailsSaved.issueMetadata.uiImpact, "possible");
  assert.equal(detailsSaved.issueCategory, "client");
  assert.equal(detailsSaved.uiImpact, "possible");
  return {
    detailsPrompt,
    detailsSaved
  };
}

function runGit(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

async function createGitApp(root, { withRemote = false } = {}) {
  await mkdir(root, { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify(
      {
        name: "session-test-app",
        version: "0.1.0",
        private: true,
        type: "module",
        scripts: {
          "verify:local": "node -e \"process.exit(0)\""
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await mkdir(path.join(root, ".jskit"), { recursive: true });
  await mkdir(path.join(root, "config"), { recursive: true });
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "packages"), { recursive: true });
  await writeFile(path.join(root, ".jskit", "lock.json"), "{\n  \"lockVersion\": 1,\n  \"installedPackages\": {}\n}\n", "utf8");
  await writeFile(path.join(root, "config", "public.js"), "export default { tenancyMode: \"none\", surfaces: [] };\n", "utf8");
  await writeFile(path.join(root, "src", ".gitkeep"), "", "utf8");
  await writeFile(path.join(root, "packages", ".gitkeep"), "", "utf8");
  runGit(root, ["init"]);
  runGit(root, ["config", "user.name", "JSKIT Test"]);
  runGit(root, ["config", "user.email", "test@example.com"]);
  runGit(root, ["add", "."]);
  runGit(root, ["commit", "-m", "Initial commit"]);
  runGit(root, ["branch", "-M", "main"]);
  if (withRemote) {
    const remoteRoot = path.join(path.dirname(root), "github.com", "example", "repo.git");
    runGit(path.dirname(root), ["init", "--bare", remoteRoot]);
    runGit(root, ["remote", "add", "origin", remoteRoot]);
    runGit(root, ["push", "-u", "origin", "main"]);
  }
}

async function createUncommittedGitApp(root) {
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "package.json"), "{\"name\":\"uncommitted-git-app\"}\n", "utf8");
  runGit(root, ["init"]);
  runGit(root, ["config", "user.name", "JSKIT Test"]);
  runGit(root, ["config", "user.email", "test@example.com"]);
}

async function createPackageOnlyGitApp(root) {
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "package.json"), "{\"name\":\"package-only-app\",\"scripts\":{\"verify:local\":\"node -e \\\"process.exit(0)\\\"\"}}\n", "utf8");
  runGit(root, ["init"]);
  runGit(root, ["config", "user.name", "JSKIT Test"]);
  runGit(root, ["config", "user.email", "test@example.com"]);
  runGit(root, ["add", "package.json"]);
  runGit(root, ["commit", "-m", "Initial commit"]);
}

async function addPackageScripts(root, scripts) {
  const packageJsonPath = path.join(root, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  packageJson.scripts = {
    ...(packageJson.scripts || {}),
    ...scripts
  };
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
  runGit(root, ["add", "package.json"]);
}

async function writeStepReceipts(sessionRoot, stepIds) {
  await mkdir(path.join(sessionRoot, "steps"), { recursive: true });
  const steps = new Set(stepIds);
  const cycleStepIds = new Set([
    "plan_made",
    "plan_executed",
    "automated_checks_run",
    "deep_ui_check_run",
    "review_prompt_rendered",
    "review_changes_accepted",
    "user_check_completed"
  ]);
  for (const stepId of stepIds) {
    const root = cycleStepIds.has(stepId)
      ? path.join(sessionRoot, "steps", "cycle_001")
      : path.join(sessionRoot, "steps");
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, stepId), `2026-05-11T00:00:00.000Z\n${stepId}\n`, "utf8");
  }
  if (steps.has("review_prompt_rendered")) {
    const passRoot = path.join(sessionRoot, "review_passes", "pass_001");
    await mkdir(passRoot, { recursive: true });
    await writeFile(path.join(sessionRoot, "review_passes", "current_pass"), "001\n", "utf8");
    await writeFile(path.join(passRoot, "prompt.md"), "Review pass prompt.\n", "utf8");
    await writeFile(
      path.join(passRoot, "prompt.json"),
      `${JSON.stringify({
        changedFiles: [],
        maxPasses: 0,
        pass: "001",
        promptPath: path.join(passRoot, "prompt.md"),
        status: "prompted",
        startedAt: "2026-05-11T00:00:00.000Z"
      }, null, 2)}\n`,
      "utf8"
    );
  }
  if (steps.has("review_changes_accepted")) {
    const passRoot = path.join(sessionRoot, "review_passes", "pass_001");
    await mkdir(passRoot, { recursive: true });
    await writeFile(
      path.join(passRoot, "accepted.json"),
      `${JSON.stringify({
        changedFiles: [],
        acceptedAt: "2026-05-11T00:00:00.000Z",
        findingsRemaining: false,
        pass: "001",
        remainingFindings: "",
        status: "no_changes"
      }, null, 2)}\n`,
      "utf8"
    );
  }
}

function issueDetailsOutput({
  category = "client",
  uiImpact = "possible",
  body = "Confirmed details are sufficient to plan the requested change."
} = {}) {
  return `[issue_category]\n${category}\n[/issue_category]\n\n[ui_impact]\n${uiImpact}\n[/ui_impact]\n\n[issue_details]\n${body}\n[/issue_details]\n\n[agent_decisions]\n- Use the smallest JSKIT-owned implementation path.\n[/agent_decisions]`;
}

async function writeIssueMetadata(sessionRoot, {
  category = "client",
  uiImpact = "possible"
} = {}) {
  await writeFile(
    path.join(sessionRoot, "issue_metadata.json"),
    `${JSON.stringify({
      issueCategory: category,
      issueDetailsPath: path.join(sessionRoot, "issue_details.md"),
      uiImpact
    }, null, 2)}\n`,
    "utf8"
  );
}

async function installFakeGh(binDir, logPath) {
  await installFakeCommand(
    binDir,
    "gh",
    `#!/usr/bin/env node
const childProcess = require("node:child_process");
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(logPath)}, ["gh", ...args].join(" ") + "\\n");
if (args[0] === "auth" && args[1] === "status") process.exit(0);
if (args[0] === "issue" && args[1] === "create") {
  console.log("https://github.com/example/repo/issues/123");
  process.exit(0);
}
if (args[0] === "issue" && (args[1] === "close" || args[1] === "comment")) process.exit(0);
if (args[0] === "pr" && args[1] === "create") {
  console.log("https://github.com/example/repo/pull/456");
  process.exit(0);
}
if (args[0] === "pr" && args[1] === "view") {
  const explicitUrl = args[2] && !args[2].startsWith("--") ? args[2] : "";
  const existingUrl = process.env.FAKE_GH_EXISTING_PR_URL || "";
  const url = explicitUrl || existingUrl;
  if (!url) {
    console.error("no pull request found for current branch");
    process.exit(1);
  }
  console.log(JSON.stringify({ baseRefName: "main", state: process.env.FAKE_GH_PR_STATE || "OPEN", mergedAt: "", url }));
  process.exit(0);
}
if (args[0] === "pr" && args[1] === "comment") process.exit(0);
if (args[0] === "pr" && args[1] === "merge") {
  const git = (gitArgs) => childProcess.spawnSync("git", gitArgs, {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  git(["fetch", "origin"]);
  const branches = git(["branch", "-r", "--format=%(refname:short)"]).stdout
    .split(/\\r?\\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const sessionBranch = branches.find((branch) => branch.startsWith("origin/jskit-studio/"));
  if (sessionBranch) {
    const rev = git(["rev-parse", sessionBranch]).stdout.trim();
    const push = git(["push", "origin", rev + ":refs/heads/main"]);
    if (push.status !== 0) {
      console.error(push.stderr || push.stdout);
      process.exit(push.status || 1);
    }
  }
  process.exit(0);
}
console.error("unexpected gh args", args.join(" "));
process.exit(1);
`
  );
}

async function installFakeNpm(binDir, logPath) {
  await installFakeCommand(
    binDir,
    "npm",
    `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(${JSON.stringify(logPath)}, ["npm", ...process.argv.slice(2)].join(" ") + "\\n");
process.exit(0);
`
  );
}

async function installFakePnpm(binDir, logPath) {
  await installFakeCommand(
    binDir,
    "pnpm",
    `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(${JSON.stringify(logPath)}, ["pnpm", ...process.argv.slice(2)].join(" ") + "\\n");
process.exit(0);
`
  );
}

test("jskit session create writes file-backed state, receipt, and local git exclude", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot);

    const result = runCli({
      cwd: appRoot,
      args: ["session", "create", "--json"]
    });
    const payload = parseJsonResult(result);

    assert.equal(payload.ok, true);
    assert.match(payload.sessionId, /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/);
    assert.equal(payload.sessionRoot, path.join(appRoot, ".jskit", "sessions", "active", payload.sessionId));
    assert.equal(payload.worktree, path.join(payload.sessionRoot, "worktree"));
    assert.equal(payload.worktreeReady, false);
    assert.equal(payload.worktreeStatus.status, "missing");
    assert.equal(payload.worktreeStatus.dirty, false);
    assert.equal(payload.workflowVersion, "6");
    assert.equal(payload.appReady.ok, true);
    assert.deepEqual(payload.appReady.missing, []);
    assert.equal(payload.dependencyInstall.status, "waiting_for_worktree");
    assert.equal(payload.dependencyInstall.installed, false);
    assert.equal(payload.activeCycle, "001");
    assert.equal(payload.cycles[0].cycle, "001");
    assert.equal(payload.currentStep, "worktree_created");
    assert.deepEqual(payload.completedSteps, ["session_created"]);
    assert.deepEqual(payload.stepDefinitions.map((step) => step.id), STEP_IDS);
    assert.equal(payload.currentStepAction.stepId, "worktree_created");
    assert.equal(payload.currentStepAction.buttonLabel, "Create worktree");
    assert.equal(await readFile(path.join(appRoot, ".git", "info", "exclude"), "utf8").then((body) => body.includes(".jskit/sessions/")), true);
    assert.equal(await readFile(path.join(payload.sessionRoot, "steps", "session_created"), "utf8").then((body) => body.includes("Created JSKIT Studio issue session")), true);
    assert.equal(await readFile(path.join(payload.sessionRoot, "workflow_version"), "utf8"), "6\n");
    assert.equal(await readFile(path.join(payload.sessionRoot, "active_cycle"), "utf8"), "001\n");
  });
});

test("jskit session list is read-only before any session exists", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot);

    const payload = parseJsonResult(runCli({
      cwd: appRoot,
      args: ["session", "--json"]
    }));

    assert.equal(payload.ok, true);
    assert.deepEqual(payload.stepDefinitions.map((step) => step.id), STEP_IDS);
    assert.deepEqual(payload.sessions, []);
    await assert.rejects(access(path.join(appRoot, ".jskit", "sessions")));
  });
});

test("jskit session JSON exposes JSKIT-owned step UI and Codex handoff contract", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot);

    const created = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "create", "--json"] }));
    assertSessionContractFields(created);
    assert.deepEqual(created.stepDefinitions.map((step) => step.id), STEP_DEFINITIONS.map((step) => step.id));
    assert.deepEqual(created.stepDefinitions.map((step) => step.index), STEP_DEFINITIONS.map((_step, index) => index));
    assert.equal(created.stepDefinitions.find((step) => step.id === "issue_prompt_rendered").kind, "human_input");
    assert.deepEqual(
      {
        repeatable: created.stepDefinitions.find((step) => step.id === "issue_created").repeatable,
        repeatableGroupId: created.stepDefinitions.find((step) => step.id === "issue_created").repeatableGroupId,
        repeatableGroupLabel: created.stepDefinitions.find((step) => step.id === "issue_created").repeatableGroupLabel,
        repeatableLabel: created.stepDefinitions.find((step) => step.id === "issue_created").repeatableLabel
      },
      {
        repeatable: false,
        repeatableGroupId: "",
        repeatableGroupLabel: "",
        repeatableLabel: ""
      }
    );
    assert.deepEqual(
      {
        repeatable: created.stepDefinitions.find((step) => step.id === "plan_made").repeatable,
        repeatableGroupId: created.stepDefinitions.find((step) => step.id === "plan_made").repeatableGroupId,
        repeatableGroupLabel: created.stepDefinitions.find((step) => step.id === "plan_made").repeatableGroupLabel,
        repeatableLabel: created.stepDefinitions.find((step) => step.id === "plan_made").repeatableLabel
      },
      {
        repeatable: true,
        repeatableGroupId: "rework_cycle",
        repeatableGroupLabel: "Rework cycle",
        repeatableLabel: "Cycle step"
      }
    );
    assert.deepEqual(created.stepDefinitions.find((step) => step.id === "issue_prompt_rendered").input, {
      label: "What should change?",
      multiline: true,
      name: "prompt",
      placeholder: "Describe the feature, bug, or change request.",
      required: true,
      type: "text"
    });
    assert.equal(Object.hasOwn(created.stepDefinitions[0], "preconditions"), false);
    assert.equal(created.stepDefinitions.find((step) => step.id === "issue_drafted").requiresExplicitRun, false);
    assert.equal(created.stepDefinitions.find((step) => step.id === "issue_created").requiresExplicitRun, false);
    assert.equal(created.stepDefinitions.find((step) => step.id === "final_report_created").requiresExplicitRun, false);
    assert.equal(created.stepDefinitions.find((step) => step.id === "pr_created").requiresExplicitRun, false);
    assert.equal(created.stepDefinitions.find((step) => step.id === "pr_merge_prepared").requiresExplicitRun, true);
    assert.equal(created.stepDefinitions.find((step) => step.id === "pr_merge_prepared").label, "PR merge prepared");
    assert.equal(created.stepDefinitions.find((step) => step.id === "pr_merge_prepared").kind, "automatic");
    assert.equal(created.stepDefinitions.find((step) => step.id === "pr_finalized").requiresExplicitRun, true);
    assert.equal(created.stepDefinitions.find((step) => step.id === "pr_finalized").label, "PR finalized");
    assert.equal(created.stepDefinitions.find((step) => step.id === "pr_finalized").kind, "automatic");
    assert.equal(created.stepDefinitions.find((step) => step.id === "main_checkout_synced").requiresExplicitRun, true);
    assert.equal(created.stepDefinitions.find((step) => step.id === "main_checkout_synced").label, "Main checkout synced");
    assert.equal(created.stepDefinitions.find((step) => step.id === "main_checkout_synced").kind, "automatic");
    assert.equal(created.stepDefinitions.find((step) => step.id === "issue_details_gathered").label, "Issue details gathered");
    assert.equal(created.stepDefinitions.find((step) => step.id === "issue_details_gathered").input.label, "Confirmed issue details");
    assert.deepEqual(created.stepDefinitions.find((step) => step.id === "dependencies_installed").automation, { mode: "terminal" });
    assert.deepEqual(created.stepDefinitions.find((step) => step.id === "issue_created").automation, { mode: "immediate" });
    assert.deepEqual(created.stepDefinitions.find((step) => step.id === "issue_drafted").automation, { mode: "codex_output_prompt" });
    assert.deepEqual(created.stepDefinitions.find((step) => step.id === "plan_executed").automation, { mode: "codex_prompt" });
    assert.deepEqual(created.stepDefinitions.find((step) => step.id === "pr_merge_prepared").automation, { mode: "manual" });
    assert.deepEqual(created.stepDefinitions.find((step) => step.id === "pr_finalized").automation, { mode: "manual" });
    assert.deepEqual(created.stepDefinitions.find((step) => step.id === "main_checkout_synced").automation, { mode: "manual" });
    assert.equal(created.stepDefinitions.find((step) => step.id === "review_prompt_rendered").codex.responseContract.resolvePrompt.templateFile, "resolve_deslop_findings.md");
    assert.equal(Object.hasOwn(created.stepDefinitions.find((step) => step.id === "pr_merge_prepared").codex, "responseContract"), false);
    assert.equal(created.stepDefinitions.find((step) => step.id === "pr_merge_prepared").utilityActions[0].label, "Get Codex ready to merge PR");
    assert.deepEqual(created.stepDefinitions.find((step) => step.id === "pr_merge_prepared").utilityActions[0].submitOptions, { prepareMerge: true });
    assert.deepEqual(created.stepDefinitions.find((step) => step.id === "review_changes_accepted").submitOptions, { reviewFindingsRemaining: false });
    assert.deepEqual(created.stepDefinitions.find((step) => step.id === "pr_merge_prepared").submitOptions, { continueToMerge: true });
    assert.deepEqual(created.stepDefinitions.find((step) => step.id === "pr_finalized").submitOptions, { mergePr: true });
    assert.deepEqual(created.stepDefinitions.find((step) => step.id === "main_checkout_synced").submitOptions, {});
    assert.equal(created.codex, null);

    const { promptReadyPayload, worktreePayload } = advanceCliSessionToIssuePrompt(appRoot, created.sessionId);
    assert.equal(worktreePayload.currentStepAction.buttonLabel, "Install dependencies");
    assert.equal(promptReadyPayload.currentStepAction.buttonLabel, "Set initial prompt");
    assert.equal(promptReadyPayload.currentStepAction.index, 3);
    assert.equal(promptReadyPayload.currentStepAction.input.name, "prompt");
    assert.equal(promptReadyPayload.nextCommand, `npx --no-install jskit session ${created.sessionId} step --prompt "<what should change>"`);

    const promptPayload = runSessionStepJson(appRoot, created.sessionId, {
      args: ["--prompt", "Add account recovery"]
    });
    assert.equal(promptPayload.currentStep, "issue_drafted");
    assert.equal(promptPayload.currentStepAction.buttonLabel, "Finalise issue");
    assert.deepEqual(promptPayload.currentStepAction.automation, { mode: "codex_output_prompt" });
    assert.deepEqual(promptPayload.currentStepAction.input, {
      fields: [
        {
          extract: "issue_title",
          formatHint: "text",
          label: "Approved issue title",
          name: "issueTitle",
          required: true,
          type: "text"
        },
        {
          extract: "issue_text",
          formatHint: "markdown",
          label: "Approved issue body",
          multiline: true,
          name: "issue",
          required: true,
          type: "text"
        }
      ],
      type: "object"
    });
    assert.deepEqual(promptPayload.codex, {
      autoInject: true,
      mode: "inject_prompt",
      promptActionLabel: "Get Codex to create issue text",
      promptField: "prompt",
      promptIntroText: "Codex will create a comprehensive issue.",
      responseContract: {
        fields: [
          {
            extract: "issue_title",
            field: "issueTitle",
            formatHint: "text",
            label: "Issue title",
            manualEntry: true,
            required: true
          },
          {
            extract: "issue_text",
            field: "issue",
            formatHint: "markdown",
            label: "Issue body",
            manualEntry: true,
            multiline: true,
            required: true
          }
        ],
        kind: "fields",
        missingMarkerBehavior: "manual_or_resend",
        required: true
      }
    });
  });
});

test("jskit session returns JSON failures for invalid session ids", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot);

    const payload = parseJsonFailure(runCli({
      cwd: appRoot,
      args: ["session", "invalid", "--json"]
    }));

    assert.equal(payload.ok, false);
    assert.equal(payload.sessionId, "invalid");
    assert.equal(payload.errors[0].code, "invalid_session_id");
  });
});

test("jskit session runs the optional provisioning package script after dependency install", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot);
    await mkdir(path.join(appRoot, "scripts"), { recursive: true });
    await writeFile(
      path.join(appRoot, "scripts", "provision-session.mjs"),
      `import { writeFileSync } from "node:fs";
import path from "node:path";

writeFileSync(path.join(process.env.JSKIT_SESSION_ROOT, "provision-env.json"), JSON.stringify({
  cwd: process.cwd(),
  packageScript: process.env.JSKIT_SESSION_PACKAGE_SCRIPT,
  sessionId: process.env.JSKIT_SESSION_ID,
  sessionRoot: process.env.JSKIT_SESSION_ROOT,
  targetRoot: process.env.JSKIT_TARGET_ROOT,
  worktreeRoot: process.env.JSKIT_WORKTREE_ROOT
}, null, 2) + "\\n");
`,
      "utf8"
    );
    await addPackageScripts(appRoot, {
      "jskit:provision-session": "node ./scripts/provision-session.mjs"
    });
    runGit(appRoot, ["add", "scripts/provision-session.mjs"]);
    runGit(appRoot, ["commit", "-m", "Add session provisioning hook"]);

    const created = parseJsonResult(runCli({
      cwd: appRoot,
      args: ["session", "create", "--json"]
    }));
    const worktreePayload = runSessionStepJson(appRoot, created.sessionId);
    assert.equal(worktreePayload.currentStep, "dependencies_installed");
    const installed = runSessionStepJson(appRoot, created.sessionId);

    assert.equal(installed.currentStep, "issue_prompt_rendered");
    assert.ok(installed.completedSteps.includes("dependencies_installed"));
    const provisionEnv = JSON.parse(await readFile(path.join(created.sessionRoot, "provision-env.json"), "utf8"));
    assert.equal(provisionEnv.cwd, installed.worktree);
    assert.equal(provisionEnv.packageScript, "jskit:provision-session");
    assert.equal(provisionEnv.sessionId, created.sessionId);
    assert.equal(provisionEnv.sessionRoot, created.sessionRoot);
    assert.equal(provisionEnv.targetRoot, appRoot);
    assert.equal(provisionEnv.worktreeRoot, installed.worktree);
    await access(path.join(created.sessionRoot, "hooks", "jskit_provision-session"));
    const commandLog = await readFile(path.join(created.sessionRoot, "command_log.jsonl"), "utf8");
    assert.match(commandLog, /"kind":"session_provision"/);
  });
});

test("jskit session blocks PR finalization when the optional finalization guard fails", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot);
    await mkdir(path.join(appRoot, "scripts"), { recursive: true });
    await writeFile(
      path.join(appRoot, "scripts", "finalization-guard.mjs"),
      "process.stderr.write('sibling repo has unpreserved changes\\n'); process.exit(42);\n",
      "utf8"
    );
    await addPackageScripts(appRoot, {
      "jskit:finalization-guard": "node ./scripts/finalization-guard.mjs"
    });
    runGit(appRoot, ["add", "scripts/finalization-guard.mjs"]);
    runGit(appRoot, ["commit", "-m", "Add finalization guard hook"]);

    const created = parseJsonResult(runCli({
      cwd: appRoot,
      args: ["session", "create", "--json"]
    }));
    const worktreePayload = runSessionStepJson(appRoot, created.sessionId);
    await writeStepReceipts(
      worktreePayload.sessionRoot,
      STEP_IDS.slice(0, STEP_IDS.indexOf("pr_finalized"))
    );
    await writeFile(path.join(worktreePayload.sessionRoot, "pr_url"), "https://github.com/example/repo/pull/456\n", "utf8");

    const blocked = runSessionStepJsonFailure(appRoot, created.sessionId, {
      args: ["--merge-pr", "true"]
    });
    assert.equal(blocked.errors[0].code, "session_finalization_guard_failed");
    assert.match(blocked.errors[0].message, /unpreserved changes/);
    await assert.rejects(access(path.join(worktreePayload.sessionRoot, "steps", "pr_finalized")));
    const commandLog = await readFile(path.join(worktreePayload.sessionRoot, "command_log.jsonl"), "utf8");
    assert.match(commandLog, /"kind":"session_finalization_guard"/);
    assert.doesNotMatch(commandLog, /"kind":"github_pr_view"/);
  });
});

test("jskit session rewind deletes target and later normal-step artifacts", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot);

    const created = parseJsonResult(runCli({
      cwd: appRoot,
      args: ["session", "create", "--json"]
    }));
    advanceCliSessionToIssuePrompt(appRoot, created.sessionId);
    const prompted = runSessionStepJson(appRoot, created.sessionId, {
      args: ["--prompt", "Add session rewind"]
    });
    assert.equal(prompted.currentStep, "issue_drafted");

    const rewound = rewindSessionJson(appRoot, created.sessionId, "dependencies_installed");
    assert.equal(rewound.ok, true);
    assert.equal(rewound.status, "pending");
    assert.equal(rewound.currentStep, "dependencies_installed");
    assert.deepEqual(rewound.completedSteps, ["session_created", "worktree_created"]);
    assert.equal(rewound.dependencyInstall.installed, false);
    assert.equal(rewound.dependencyInstall.status, "pending");
    assert.equal(rewound.prompt, "");
    assert.equal(rewound.currentStepAction.stepId, "dependencies_installed");

    await assert.rejects(access(path.join(rewound.sessionRoot, "steps", "dependencies_installed")));
    await assert.rejects(access(path.join(rewound.sessionRoot, "steps", "issue_prompt_rendered")));
    await assert.rejects(access(path.join(rewound.sessionRoot, "prompts", "issue_draft.md")));
  });
});

test("jskit session rewind to plan_made clears cycle and rework state", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot);

    const created = parseJsonResult(runCli({
      cwd: appRoot,
      args: ["session", "create", "--json"]
    }));
    advanceCliSessionToIssuePrompt(appRoot, created.sessionId);
    const sessionRoot = created.sessionRoot;
    await writeFile(path.join(sessionRoot, "issue.md"), "Issue body.\n", "utf8");
    await writeFile(path.join(sessionRoot, "issue_title"), "Issue title\n", "utf8");
    await writeFile(path.join(sessionRoot, "issue_url"), "https://github.com/example/repo/issues/123\n", "utf8");
    await writeFile(path.join(sessionRoot, "issue_details.md"), "Issue details.\n", "utf8");
    await writeIssueMetadata(sessionRoot, {
      category: "client",
      uiImpact: "possible"
    });
    await writeStepReceipts(sessionRoot, [
      "issue_prompt_rendered",
      "issue_drafted",
      "issue_created",
      "issue_details_gathered",
      "plan_made",
      "plan_executed",
      "deep_ui_check_run",
      "review_prompt_rendered",
      "review_changes_accepted",
      "automated_checks_run",
      "user_check_completed",
      "changes_committed",
      "final_report_created"
    ]);
    await writeCyclePlan(sessionRoot, "Cycle 001 plan.\n", "001");
    await writeCyclePlan(sessionRoot, "Cycle 002 plan.\n", "002");
    await mkdir(path.join(sessionRoot, "steps", "cycle_002"), { recursive: true });
    await writeFile(path.join(sessionRoot, "steps", "cycle_002", "plan_made"), "2026-05-11T00:00:00.000Z\nplan_made\n", "utf8");
    await writeFile(path.join(sessionRoot, "steps", "cycle_002", "cycle_started"), "2026-05-11T00:00:00.000Z\ncycle_started\n", "utf8");
    await writeFile(path.join(sessionRoot, "active_cycle"), "002\n", "utf8");
    await mkdir(path.join(sessionRoot, "prompts"), { recursive: true });
    await writeFile(path.join(sessionRoot, "prompts", "cycle_002_plan_request.md"), "Cycle 002 prompt.\n", "utf8");
    await mkdir(path.join(sessionRoot, "checks"), { recursive: true });
    await writeFile(path.join(sessionRoot, "checks", "automated_checks_run.json"), "{\"stepId\":\"automated_checks_run\"}\n", "utf8");
    await mkdir(path.join(sessionRoot, "ui_checks"), { recursive: true });
    await writeFile(path.join(sessionRoot, "ui_checks", "deep_ui_check_run.json"), "{\"stepId\":\"deep_ui_check_run\"}\n", "utf8");
    await mkdir(path.join(sessionRoot, "cycles", "cycle_002"), { recursive: true });
    await writeFile(path.join(sessionRoot, "cycles", "cycle_002", "rework_request.md"), "Fix the result.\n", "utf8");
    await writeFile(path.join(sessionRoot, "changes_committed.json"), "{\"commit\":\"abc123\"}\n", "utf8");
    await writeFile(path.join(sessionRoot, "final_report.md"), "Final report.\n", "utf8");

    const rewound = await rewindSession({
      targetRoot: appRoot,
      sessionId: created.sessionId,
      stepId: "plan_made"
    });
    assert.equal(rewound.ok, true);
    assert.equal(rewound.status, "pending");
    assert.equal(rewound.currentStep, "plan_made");
    assert.equal(rewound.currentStepAction.stepId, "plan_made");
    assert.equal(rewound.activeCycle, "001");
    assert.deepEqual(rewound.cycles.map((cycle) => cycle.cycle), ["001"]);
    assert.deepEqual(rewound.checks, []);
    assert.deepEqual(rewound.uiChecks, []);
    assert.deepEqual(rewound.reviewPasses, []);
    assert.equal(rewound.planText, "");
    assert.equal(rewound.prompt, "");
    assert.deepEqual(rewound.completedSteps, [
      "session_created",
      "worktree_created",
      "dependencies_installed",
      "issue_prompt_rendered",
      "issue_drafted",
      "issue_created",
      "issue_details_gathered"
    ]);

    await assert.rejects(access(path.join(sessionRoot, "steps", "cycle_001")));
    await assert.rejects(access(path.join(sessionRoot, "steps", "cycle_002")));
    await assert.rejects(access(path.join(sessionRoot, "cycles", "cycle_001")));
    await assert.rejects(access(path.join(sessionRoot, "cycles", "cycle_002")));
    await assert.rejects(access(path.join(sessionRoot, "checks")));
    await assert.rejects(access(path.join(sessionRoot, "ui_checks")));
    await assert.rejects(access(path.join(sessionRoot, "review_passes")));
    await assert.rejects(access(path.join(sessionRoot, "changes_committed.json")));
    await assert.rejects(access(path.join(sessionRoot, "final_report.md")));
    assert.equal(await readFile(path.join(sessionRoot, "issue_details.md"), "utf8"), "Issue details.\n");
  });
});

test("jskit session rewind rejects disallowed, incomplete, and closed targets without mutation", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot);

    const created = parseJsonResult(runCli({
      cwd: appRoot,
      args: ["session", "create", "--json"]
    }));
    advanceCliSessionToIssuePrompt(appRoot, created.sessionId);
    const sessionRoot = created.sessionRoot;
    await writeStepReceipts(sessionRoot, ["plan_made", "plan_executed"]);

    const disallowed = rewindSessionJsonFailure(appRoot, created.sessionId, "plan_executed");
    assert.equal(disallowed.errors[0].code, "rewind_step_not_allowed");
    assert.equal(await readFile(path.join(sessionRoot, "steps", "cycle_001", "plan_executed"), "utf8").then((body) => body.includes("plan_executed")), true);

    const incomplete = rewindSessionJsonFailure(appRoot, created.sessionId, "issue_created");
    assert.equal(incomplete.errors[0].code, "rewind_step_not_completed");

    await writeFile(path.join(sessionRoot, "status"), "finished\n", "utf8");
    const closed = rewindSessionJsonFailure(appRoot, created.sessionId, "dependencies_installed");
    assert.equal(closed.errors[0].code, "session_closed_read_only");
    await access(path.join(sessionRoot, "steps", "dependencies_installed"));
  });
});

test("jskit session returns JSON failures for unreadable issue files", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot);

    const created = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "create", "--json"] }));
    advanceCliSessionToIssuePrompt(appRoot, created.sessionId);
    runSessionStepJson(appRoot, created.sessionId, {
      args: ["--prompt", "Fix missing state"]
    });
    const payload = runSessionStepJsonFailure(appRoot, created.sessionId, {
      args: ["--issue-file", "does-not-exist.md"]
    });

    assert.equal(payload.ok, false);
    assert.equal(payload.sessionId, created.sessionId);
    assert.equal(payload.errors[0].code, "issue_file_read_failed");
    assert.equal(payload.currentStep, "");
  });
});

test("jskit session requires an approved issue title before saving the issue draft", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot);

    const created = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "create", "--json"] }));
    advanceCliSessionToIssuePrompt(appRoot, created.sessionId);
    runSessionStepJson(appRoot, created.sessionId, {
      args: ["--prompt", "Fix missing title"]
    });
    const payload = runSessionStepJsonFailure(appRoot, created.sessionId, {
      args: ["--issue", "[issue_text]Fix missing title.[/issue_text]"]
    });

    assert.equal(payload.ok, false);
    assert.equal(payload.errors[0].code, "issue_title_required");
    assert.equal(payload.currentStep, "issue_drafted");
  });
});

test("createSession returns structured failures for invalid explicit session ids", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot);

    const payload = await createSession({
      targetRoot: appRoot,
      sessionId: "invalid"
    });

    assert.equal(payload.ok, false);
    assert.equal(payload.errors[0].code, "invalid_session_id");
  });
});

test("session ids get deterministic suffixes when two sessions start in the same second", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot);
    const now = new Date(2026, 4, 11, 12, 34, 56);

    const first = await createSession({ targetRoot: appRoot, now });
    const second = await createSession({ targetRoot: appRoot, now });

    assert.equal(first.sessionId, "2026-05-11_12-34-56");
    assert.equal(second.sessionId, "2026-05-11_12-34-56-0001");
  });
});

test("unsupported workflow versions hard-block inspection and advancement", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot);

    const created = await createSession({ targetRoot: appRoot });
    await writeFile(path.join(created.sessionRoot, "workflow_version"), "1\n", "utf8");

    const inspected = await inspectSessionDetails({
      targetRoot: appRoot,
      sessionId: created.sessionId
    });
    assert.equal(inspected.ok, false);
    assert.equal(inspected.workflowVersion, "1");
    assert.equal(inspected.errors[0].code, "unsupported_workflow_version");

    const advanced = await runSessionStep({
      targetRoot: appRoot,
      sessionId: created.sessionId
    });
    assert.equal(advanced.ok, false);
    assert.equal(advanced.errors[0].code, "unsupported_workflow_version");
  });
});

test("issue draft extraction accepts separate codex title and body wrappers", () => {
  const output = [
    "Before",
    "[issue_title]",
    "Fix navigation",
    "[/issue_title]",
    "[issue_text]",
    "Make it adaptive.",
    "[/issue_text]",
    "After"
  ].join("\n");
  assert.equal(extractIssueTitle(output), "Fix navigation");
  assert.equal(
    extractIssueText(output),
    "Make it adaptive."
  );
});

test("plan extraction accepts the codex plan wrapper", () => {
  assert.equal(
    extractPlanText("Before\n[plan]\n1. Inspect routes.\n2. Add page.\n[/plan]\nAfter"),
    "1. Inspect routes.\n2. Add page."
  );
});

test("issue details extraction accepts the codex issue_details wrapper", () => {
  assert.equal(
    extractIssueDetails("Before\n[issue_details]\nGathered fields.\n[/issue_details]\nAfter"),
    "Gathered fields."
  );
  assert.equal(extractIssueDetails("Gathered fields."), "");
});

test("tagged extraction uses the latest complete marker pair and ignores terminal chrome", () => {
  const output = [
    "gpt-5.5 default · /workspace Shell mode",
    "[issue_details]",
    "First draft.",
    "[/issue_details]",
    "status: thinking",
    "[issue_details]",
    "Final confirmed details.",
    "[/issue_details]",
    "[issue_details]",
    "Incomplete draft."
  ].join("\n");
  assert.equal(extractIssueDetails(output), "Final confirmed details.");
});

test("app blueprint extraction accepts the codex app_blueprint wrapper", () => {
  assert.equal(
    extractAppBlueprintText("Before\n[app_blueprint]\n# App Blueprint\n\nBuild a field app.\n[/app_blueprint]\nAfter"),
    "# App Blueprint\n\nBuild a field app."
  );
  assert.equal(extractAppBlueprintText("# App Blueprint\n\nBuild a field app."), "");
});

test("jskit blueprint prompt and set manage app-level blueprint outside sessions", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot);

    const promptPayload = parseJsonResult(runCli({
      cwd: appRoot,
      args: ["blueprint", "prompt", "--brief", "A customer management app for field teams.", "--json"]
    }));
    assert.equal(promptPayload.ok, true);
    assert.match(promptPayload.prompt, /customer management app/);
    assert.match(promptPayload.prompt, /\[app_blueprint\]/);
    assert.equal(promptPayload.appBlueprintPath, path.join(appRoot, ".jskit", "APP_BLUEPRINT.md"));

    const setPayload = parseJsonResult(runCli({
      cwd: appRoot,
      args: ["blueprint", "set", "--blueprint", "[app_blueprint]# App Blueprint\n\nField team CRM.[/app_blueprint]", "--json"]
    }));
    assert.equal(setPayload.ok, true);
    assert.equal(setPayload.blueprintText, "# App Blueprint\n\nField team CRM.");
    assert.equal(await readFile(path.join(appRoot, ".jskit", "APP_BLUEPRINT.md"), "utf8"), "# App Blueprint\n\nField team CRM.\n");

    const readPayload = parseJsonResult(runCli({
      cwd: appRoot,
      args: ["blueprint", "--json"]
    }));
    assert.equal(readPayload.exists, true);
    assert.equal(readPayload.blueprintText, "# App Blueprint\n\nField team CRM.");
  });
});

test("every executable session step declares named preconditions", () => {
  const executableStepIds = STEP_IDS.filter((stepId) => stepId !== "session_created");
  assert.equal(new Set(STEP_IDS).size, STEP_IDS.length);
  assert.equal(STEP_IDS.some((stepId) => /^\d+_/u.test(stepId)), false);
  assert.deepEqual(Object.keys(STEP_PRECONDITION_NAMES), executableStepIds);
  for (const stepId of executableStepIds) {
    assert.ok(STEP_PRECONDITION_NAMES[stepId].length > 0, `${stepId} must declare preconditions`);
  }
  assert.equal(STEP_PRECONDITION_NAMES.deep_ui_check_run.includes("automated_checks_passed"), false);
  assert.ok(STEP_PRECONDITION_NAMES.review_prompt_rendered.includes("deep_ui_check_satisfied"));
  assert.ok(STEP_PRECONDITION_NAMES.user_check_completed.includes("automated_checks_passed"));
  assert.ok(STEP_PRECONDITION_NAMES.user_check_completed.includes("deep_ui_check_satisfied"));
  assert.ok(STEP_PRECONDITION_NAMES.pr_created.includes("deep_ui_check_satisfied"));
});

test("session prompts reference canonical session artifacts", async () => {
  const promptEntries = await readdir(PROMPT_ROOT);
  const prompts = Object.fromEntries(await Promise.all(promptEntries
    .filter((entry) => entry.endsWith(".md"))
    .map(async (entry) => [entry, await readFile(path.join(PROMPT_ROOT, entry), "utf8")])));

  for (const body of Object.values(prompts)) {
    assert.doesNotMatch(body, /workflow\/(?:app-state|bootstrap|scoping|workboard|feature-delivery|review)\.md/);
  }
  for (const [name, body] of Object.entries(prompts)) {
    assert.doesNotMatch(body, /`jskit (?:add|app|generate|list|show|session)/u, `${name} must use npx --no-install for shell examples`);
  }

  assert.match(prompts["issue_details.md"], /issue_details\.md/);
  assert.doesNotMatch(prompts["issue_details.md"], /\[issue_details_conversation_ready\]/);
  assert.match(prompts["plan_issue.md"], /issue_details\.md/);
  assert.match(prompts["plan_issue.md"], /agent_decisions\.md/);
  assert.match(prompts["execute_plan.md"], /issue_details\.md/);
  assert.match(prompts["execute_plan.md"], /agent_decisions/);
  assert.match(prompts["execute_plan.md"], /verify-ui` does not start the app server/);
  assert.ok(!Object.hasOwn(prompts, "fine_tune_plan.md"));
  assert.match(prompts["review_changes.md"], /\.jskit\/helper-map\.md/);
  assert.match(prompts["review_changes.md"], /verify-ui` does not start the app server/);
  assert.match(prompts["deep_ui_check.md"], /verify-ui` does not start the app server/);
  assert.match(prompts["resolve_deslop_findings.md"], /\[resolve_deslop_findings\]/);
  assert.match(prompts["update_blueprint.md"], /\.jskit\/APP_BLUEPRINT\.md/);
  assert.match(prompts["update_blueprint.md"], /agent_decisions\.md/);
  assert.match(prompts["prepare_pr_merge.md"], /Do not merge the pull request/);
});

test("jskit session step creates worktree and issue prompt", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot);

    const created = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "create", "--json"] }));
    const { promptReadyPayload, worktreePayload } = advanceCliSessionToIssuePrompt(appRoot, created.sessionId);
    assert.equal(promptReadyPayload.currentStep, "issue_prompt_rendered");
    await access(worktreePayload.worktree);
    assert.equal(worktreePayload.baseBranch, "main");
    assert.match(worktreePayload.baseCommit, /^[0-9a-f]{40}$/u);
    assert.equal(await readFile(path.join(worktreePayload.sessionRoot, "base_branch"), "utf8"), "main\n");

    const promptPayload = runSessionStepJson(appRoot, created.sessionId, {
      args: ["--prompt", "Add customer search"]
    });
    assert.equal(promptPayload.status, "waiting_for_user");
    assert.equal(promptPayload.currentStep, "issue_drafted");
    assert.match(promptPayload.prompt, /Add customer search/);
    assert.match(promptPayload.prompt, /^Shell command rule:/);
    assert.match(promptPayload.prompt, /When running JSKIT CLI commands from the shell, use `npx --no-install jskit \.\.\.`/);
    assert.match(promptPayload.prompt, /This issue-drafting step is read-only/);
    assert.match(promptPayload.prompt, /Do not run `npx --no-install jskit session`/);
    assert.match(promptPayload.prompt, /Do not run `gh`, `git add`, `git commit`, `git push`, `npm install`/);
    assert.match(promptPayload.prompt, /\[issue_title\]/);
    assert.match(promptPayload.prompt, /\[issue_text\]/);
    assert.match(
      await readFile(path.join(promptPayload.sessionRoot, "prompts", "issue_draft.md"), "utf8"),
      /Add customer search/
    );
    await assert.rejects(access(path.join(promptPayload.sessionRoot, "prompt.md")));

    const failure = runSessionStepJsonFailure(appRoot, created.sessionId);
    assert.equal(failure.ok, false);
    assert.equal(failure.errors[0].code, "issue_required");
  });
});

test("jskit session blocks issue work until app setup markers exist", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "package-only");
    await createPackageOnlyGitApp(appRoot);

    const created = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "create", "--json"] }));
    runSessionStepJson(appRoot, created.sessionId);
    runSessionStepJson(appRoot, created.sessionId);
    const blocked = runSessionStepJsonFailure(appRoot, created.sessionId, {
      args: ["--prompt", "Add an about page"]
    });

    assert.equal(blocked.errors[0].code, "app_setup_required");
    assert.equal(blocked.preconditions.at(-1).id, "ready_jskit_app");
    assert.equal(blocked.preconditions.at(-1).ok, false);
    assert.equal(blocked.appReady.ok, false);
    assert.deepEqual(blocked.appReady.missing, [".jskit/lock.json", "config/public.js", "src/", "packages/"]);
  });
});

test("issue drafting prompt assumes app setup passed and mentions canonical app context", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot);

    const created = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "create", "--json"] }));
    advanceCliSessionToIssuePrompt(appRoot, created.sessionId);
    const promptPayload = runSessionStepJson(appRoot, created.sessionId, {
      args: ["--prompt", "Add an about page"]
    });

    assert.match(promptPayload.prompt, /App setup has already passed/);
    assert.match(promptPayload.prompt, /\.jskit\/APP_BLUEPRINT\.md/);
    assert.match(promptPayload.prompt, /\.jskit\/helper-map\.md/);
    assert.doesNotMatch(promptPayload.prompt, /Classify the current app state as empty/);
    assert.doesNotMatch(promptPayload.prompt, /partial JSKIT app/);
  });
});

test("jskit session does not treat a stale empty directory as a worktree", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot);

    const created = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "create", "--json"] }));
    await mkdir(created.worktree, { recursive: true });
    await writeFile(
      path.join(created.sessionRoot, "steps", "worktree_created"),
      "2026-05-12T00:00:00.000Z\nFalse stale receipt.\n",
      "utf8"
    );
    await writeFile(path.join(created.sessionRoot, "current_step"), "issue_prompt_rendered\n", "utf8");

    const stale = parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "--json"] }));
    assert.equal(stale.worktreeReady, false);
    assert.equal(stale.currentStep, "worktree_created");
    assert.deepEqual(stale.completedSteps, ["session_created"]);

    const repaired = runSessionStepJson(appRoot, created.sessionId);
    assert.equal(repaired.worktreeReady, true);
    assert.equal(repaired.currentStep, "dependencies_installed");
    assert.match(await readFile(path.join(created.worktree, ".git"), "utf8"), /gitdir:/);
    const dependenciesInstalled = runSessionStepJson(appRoot, created.sessionId);
    assert.equal(dependenciesInstalled.currentStep, "issue_prompt_rendered");
  });
});

test("dependency installation step is safe to retry before completion receipt is final", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");
    await createGitApp(appRoot);
    await installFakeNpm(binDir, logPath);
    const env = {
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`
    };

    const created = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "create", "--json"], env }));
    const worktreePayload = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(worktreePayload.currentStep, "dependencies_installed");
    const firstInstall = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(firstInstall.currentStep, "issue_prompt_rendered");
    assert.equal(firstInstall.dependencyInstall.status, "installed");

    await rm(path.join(created.sessionRoot, "steps", "dependencies_installed"));
    await writeFile(path.join(created.sessionRoot, "current_step"), "dependencies_installed\n", "utf8");
    const rerunInstall = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(rerunInstall.currentStep, "issue_prompt_rendered");
    assert.equal(rerunInstall.dependencyInstall.status, "installed");
    assert.equal((await readFile(logPath, "utf8")).match(/npm install/g)?.length, 2);

    const lockedRoot = path.join(cwd, "locked");
    const lockedLogPath = path.join(cwd, "locked-commands.log");
    await createGitApp(lockedRoot);
    await writeFile(path.join(lockedRoot, "package-lock.json"), JSON.stringify({
      lockfileVersion: 3,
      name: "session-test-app",
      packages: {}
    }), "utf8");
    runGit(lockedRoot, ["add", "package-lock.json"]);
    runGit(lockedRoot, ["commit", "-m", "Add npm lockfile"]);
    await installFakeNpm(binDir, lockedLogPath);
    const lockedSession = parseJsonResult(runCli({ cwd: lockedRoot, args: ["session", "create", "--json"], env }));
    runSessionStepJson(lockedRoot, lockedSession.sessionId, { env });
    runSessionStepJson(lockedRoot, lockedSession.sessionId, { env });
    assert.match(await readFile(lockedLogPath, "utf8"), /npm ci/);

    const pnpmRoot = path.join(cwd, "pnpm");
    const pnpmLogPath = path.join(cwd, "pnpm-commands.log");
    await createGitApp(pnpmRoot);
    const packageJson = JSON.parse(await readFile(path.join(pnpmRoot, "package.json"), "utf8"));
    packageJson.packageManager = "pnpm@9.12.0";
    await writeFile(path.join(pnpmRoot, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
    await writeFile(path.join(pnpmRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
    runGit(pnpmRoot, ["add", "package.json", "pnpm-lock.yaml"]);
    runGit(pnpmRoot, ["commit", "-m", "Use pnpm"]);
    await installFakePnpm(binDir, pnpmLogPath);
    const pnpmSession = parseJsonResult(runCli({ cwd: pnpmRoot, args: ["session", "create", "--json"], env }));
    runSessionStepJson(pnpmRoot, pnpmSession.sessionId, { env });
    runSessionStepJson(pnpmRoot, pnpmSession.sessionId, { env });
    assert.match(await readFile(pnpmLogPath, "utf8"), /pnpm install --frozen-lockfile/);
  });
});

test("jskit session prompt rendering prefers project overrides", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot);

    const created = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "create", "--json"] }));
    advanceCliSessionToIssuePrompt(appRoot, created.sessionId);
    await mkdir(path.join(appRoot, ".jskit", "sessions", "prompts"), { recursive: true });
    await writeFile(path.join(appRoot, ".jskit", "sessions", "prompts", "new_issue.md"), "Project prompt: {{user_input}} / {{session_id}}", "utf8");

    const promptPayload = runSessionStepJson(appRoot, created.sessionId, {
      args: ["--prompt", "Add invoices"]
    });

    assert.match(promptPayload.prompt, /^Shell command rule:/);
    assert.match(promptPayload.prompt, new RegExp(`Project prompt: Add invoices / ${created.sessionId}$`, "u"));
  });
});

test("session details expose issue text, receipts, and passive transcript log for Studio", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot);

    const created = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "create", "--json"] }));
    advanceCliSessionToIssuePrompt(appRoot, created.sessionId);
    runSessionStepJson(appRoot, created.sessionId, {
      args: ["--prompt", "Fix details"]
    });
    runSessionStepJson(appRoot, created.sessionId, {
      args: ["--issue-title", "Fix details", "--issue", "[issue_text]Make details clearer.[/issue_text]"]
    });
    await writeFile(path.join(created.sessionRoot, "transcript.log"), "manual transcript\n", "utf8");

    const details = await inspectSessionDetails({
      targetRoot: appRoot,
      sessionId: created.sessionId
    });

    assert.equal(details.ok, true);
    assert.equal(details.issueTitle, "Fix details");
    assert.equal(details.issueText, "Make details clearer.");
    assert.equal(details.transcriptLog, "manual transcript\n");
    assert.deepEqual(details.receipts.map((receipt) => receipt.stepId), [
      "session_created",
      "worktree_created",
      "dependencies_installed",
      "issue_prompt_rendered",
      "issue_drafted"
    ]);

    const cliDetails = parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "--json"] }));
    assert.equal(cliDetails.issueTitle, "Fix details");
    assert.equal(cliDetails.issueText, "Make details clearer.");
    assert.equal(cliDetails.receipts.length, 5);
  });
});

test("jskit session accepts issue text from stdin and creates a GitHub issue with JSON output", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");
    await createGitApp(appRoot);
    runGit(appRoot, ["remote", "add", "origin", "https://github.com/example/repo.git"]);
    await installFakeGh(binDir, logPath);

    const env = {
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`
    };
    const created = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "create", "--json"], env }));
    advanceCliSessionToIssuePrompt(appRoot, created.sessionId, { env });
    runSessionStepJson(appRoot, created.sessionId, {
      args: ["--prompt", "Fix filters"],
      env
    });
    const issueDrafted = runSessionStepJson(appRoot, created.sessionId, {
      args: ["--issue-title", "Fix useful filters", "--issue", "-"],
      env,
      input: "Make filters useful."
    });
    assert.equal(issueDrafted.currentStep, "issue_created");
    assert.equal(issueDrafted.currentStepAction.buttonLabel, "Create issue");
    assert.equal(issueDrafted.currentStepAction.requiresExplicitRun, false);
    assert.equal(issueDrafted.issueTitle, "Fix useful filters");
    assert.equal(issueDrafted.issueText, "Make filters useful.");

    const issueCreated = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(issueCreated.issueUrl, "https://github.com/example/repo/issues/123");
    assert.equal(issueCreated.currentStep, "issue_details_gathered");
    assert.equal(issueCreated.issueMetadata.issueNumber, "123");
    assert.equal(issueCreated.issueMetadata.owner, "example");
    assert.equal(issueCreated.issueMetadata.repository, "repo");
    assert.equal(issueCreated.issueMetadata.issueTitle, "Fix useful filters");
    assert.equal(issueCreated.issueMetadata.issueBody, "Make filters useful.");
    assert.equal(issueCreated.prompt, "");
    assert.equal(issueCreated.currentStepAction.buttonLabel, "Start details conversation");
    assert.equal(issueCreated.codex.promptActionLabel, "Start details conversation");
    assert.deepEqual(
      issueCreated.codex.responseContract.fields.find((output) => output.field === "issueCategory").options,
      [
        { label: "Client", value: "client" },
        { label: "Server", value: "server" },
        { label: "Client and server", value: "client_server" },
        { label: "Tooling", value: "tooling" },
        { label: "Unknown", value: "unknown" }
      ]
    );
    assert.deepEqual(
      issueCreated.codex.responseContract.fields.find((output) => output.field === "uiImpact").options,
      [
        { label: "No UI impact", value: "none" },
        { label: "Possible UI impact", value: "possible" },
        { label: "Definite UI impact", value: "definite" },
        { label: "Unknown", value: "unknown" }
      ]
    );
    assert.match(await readFile(logPath, "utf8"), /gh issue create --title Fix useful filters --body-file/);
    const { detailsSaved } = saveCliSessionIssueDetails(appRoot, created.sessionId, { env });
    const decisionLog = await readFile(path.join(detailsSaved.sessionRoot, "agent_decisions.md"), "utf8");
    assert.match(decisionLog, /Issue: https:\/\/github\.com\/example\/repo\/issues\/123/);
    assert.match(decisionLog, /Use the smallest JSKIT-owned implementation path/);
    assert.equal(detailsSaved.githubComments.issue_details.purpose, "issue_details");

    const planPrompt = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(planPrompt.currentStep, "plan_made");
    assert.equal(planPrompt.codex.autoInject, true);
    assert.match(planPrompt.prompt, /Create an implementation plan/);
    assert.match(planPrompt.prompt, /\[plan\]/);
    assert.match(planPrompt.prompt, /https:\/\/github\.com\/example\/repo\/issues\/123/);
    assert.match(planPrompt.prompt, /Agent decisions file .*agent_decisions\.md/);
    assert.match(planPrompt.prompt, /Make generator decisions concrete/);
    assert.match(
      await readFile(path.join(planPrompt.sessionRoot, "prompts", "cycle_001_plan_request.md"), "utf8"),
      /Create an implementation plan/
    );

    const planMade = runSessionStepJson(appRoot, created.sessionId, {
      args: ["--plan", "[plan]\nInspect filters and update the UI.\n[/plan]\n[agent_decisions]\n- Use the list UI generator only if placements match.\n[/agent_decisions]"],
      env
    });
    assert.equal(planMade.currentStep, "plan_executed");
    assert.equal(planMade.currentStepAction.buttonLabel, "Get Codex to execute plan");
    assert.equal(planMade.planText, "Inspect filters and update the UI.");
    assert.ok(planMade.completedSteps.includes("plan_made"));
    assert.equal(planMade.prompt, "");
    assert.equal(planMade.planExecution.submitted, false);
    assert.ok(!Object.hasOwn(planMade.githubComments, "plan"));
    assert.match(await readFile(cyclePlanPath(planMade.sessionRoot), "utf8"), /Inspect filters/);
    assert.match(await readFile(path.join(planMade.sessionRoot, "agent_decisions.md"), "utf8"), /Use the list UI generator only if placements match/);

    const executionPrompt = runSessionStepJson(appRoot, created.sessionId, {
      args: ["--agent-decisions", "-"],
      env,
      input: "[agent_decisions]\n- Implementation can reuse the existing filter route without adding a package.\n[/agent_decisions]"
    });
    assert.equal(executionPrompt.currentStep, "plan_executed");
    assert.equal(executionPrompt.currentStepAction.buttonLabel, "Go to next step");
    assert.deepEqual(executionPrompt.currentStepAction.utilityActions, []);
    assert.equal(executionPrompt.codex.autoInject, true);
    assert.equal(executionPrompt.codex.promptActionLabel, "Get Codex to execute plan");
    assert.deepEqual(executionPrompt.codex.responseContract, {
      completionBehavior: "auto_advance",
      kind: "completion_marker",
      marker: "jskit_step_result",
      missingMarkerBehavior: "resend",
      required: true,
      stepField: "step"
    });
    assert.equal(executionPrompt.planExecution.prompted, true);
    assert.equal(executionPrompt.planExecution.submitted, false);
    assert.match(executionPrompt.planExecution.promptPath, /cycle_001_plan_execution\.md$/);
    assert.match(executionPrompt.prompt, /Execute the approved implementation plan/);
    assert.ok(!executionPrompt.completedSteps.includes("plan_executed"));
    assert.match(
      await readFile(path.join(executionPrompt.sessionRoot, "agent_decisions.md"), "utf8"),
      /Use the smallest JSKIT-owned implementation path[\s\S]*Use the list UI generator only if placements match[\s\S]*Implementation can reuse the existing filter route/
    );
    assert.match(
      await readFile(path.join(executionPrompt.sessionRoot, "prompts", "cycle_001_plan_execution.md"), "utf8"),
      /Execute the approved implementation plan/
    );

    const missingCodexMarker = runSessionStepJsonFailure(appRoot, created.sessionId, {
      args: codexResultArgs(),
      env,
      input: "Codex says it is done, but forgot the final marker."
    });
    assert.equal(missingCodexMarker.currentStep, "plan_executed");
    assert.equal(missingCodexMarker.errors[0].code, "codex_result_marker_missing");

    const wrongCodexStep = runSessionStepJsonFailure(appRoot, created.sessionId, {
      args: codexResultArgs(),
      env,
      input: codexStepResult("automated_checks_run")
    });
    assert.equal(wrongCodexStep.currentStep, "plan_executed");
    assert.equal(wrongCodexStep.errors[0].code, "codex_result_step_mismatch");

    const executed = runSessionStepJson(appRoot, created.sessionId, {
      args: codexResultArgs(),
      env,
      input: [
        "[jskit_step_result]",
        "  status: complete",
        "  step: plan_executed",
        "  summary: plan_executed completed.",
        "[/jskit_step_result]"
      ].join("\n")
    });
    assert.equal(executed.currentStep, "deep_ui_check_run");
    assert.equal(executed.currentStepAction.buttonLabel, "Run Deep UI check");
    assert.equal(executed.currentStepAction.conditional, true);
    assert.equal(executed.currentStepAction.skipReason, "");
    assert.deepEqual(executed.currentStepAction.alternateActions, []);
    assert.equal(executed.codex.promptActionLabel, "Run Deep UI check");
    assert.ok(executed.completedSteps.includes("plan_executed"));
    assert.equal(executed.planExecution.submitted, true);
    assert.match(executed.planExecution.promptPath, /cycle_001_plan_execution\.md$/);
    assert.match(
      await readFile(path.join(executed.sessionRoot, "cycles", "cycle_001", "codex_results", "plan_executed.md"), "utf8"),
      /\[jskit_step_result\]/
    );
    await assert.rejects(access(path.join(executed.sessionRoot, "prompt.md")));
    assert.doesNotMatch(await readFile(logPath, "utf8"), /gh issue comment https:\/\/github\.com\/example\/repo\/issues\/123 --body-file .*plan/);
  });
});

test("issue creation reuses an existing issue URL without creating duplicates", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");
    await createGitApp(appRoot);
    runGit(appRoot, ["remote", "add", "origin", "https://github.com/example/repo.git"]);
    await installFakeGh(binDir, logPath);
    const env = {
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`
    };

    const created = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "create", "--json"], env }));
    advanceCliSessionToIssuePrompt(appRoot, created.sessionId, { env });
    runSessionStepJson(appRoot, created.sessionId, {
      args: ["--prompt", "Fix issue duplication"],
      env
    });
    runSessionStepJson(appRoot, created.sessionId, {
      args: ["--issue-title", "Fix issue duplication", "--issue", "[issue_text]Avoid duplicate issue creation.[/issue_text]"],
      env
    });
    const firstIssue = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(firstIssue.issueUrl, "https://github.com/example/repo/issues/123");

    await rm(path.join(created.sessionRoot, "steps", "issue_created"));
    await writeFile(path.join(created.sessionRoot, "current_step"), "issue_created\n", "utf8");
    const reusedIssue = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(reusedIssue.issueUrl, "https://github.com/example/repo/issues/123");
    assert.equal(reusedIssue.currentStep, "issue_details_gathered");
    assert.equal((await readFile(logPath, "utf8")).match(/gh issue create/g)?.length, 1);
  });
});

test("issue details output rejects missing required tags and invalid classifications", async () => {
  await withTempDir(async (cwd) => {
    const cases = [
      {
        code: "issue_details_required",
        input: "[issue_category]\nclient\n[/issue_category]\n\n[ui_impact]\npossible\n[/ui_impact]"
      },
      {
        code: "issue_category_invalid",
        input: issueDetailsOutput({ category: "feature" })
      },
      {
        code: "ui_impact_invalid",
        input: issueDetailsOutput({ uiImpact: "maybe" })
      }
    ];

    for (const [index, testCase] of cases.entries()) {
      const appRoot = path.join(cwd, `app-${index}`);
      const binDir = path.join(cwd, `bin-${index}`);
      const logPath = path.join(cwd, `commands-${index}.log`);
      await createGitApp(appRoot);
      runGit(appRoot, ["remote", "add", "origin", "https://github.com/example/repo.git"]);
      await installFakeGh(binDir, logPath);
      const env = {
        PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`
      };

      const created = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "create", "--json"], env }));
      advanceCliSessionToIssuePrompt(appRoot, created.sessionId, { env });
      runSessionStepJson(appRoot, created.sessionId, {
        args: ["--prompt", "Fix details"],
        env
      });
      runSessionStepJson(appRoot, created.sessionId, {
        args: ["--issue-title", "Fix details", "--issue", "[issue_text]Make details clearer.[/issue_text]"],
        env
      });
      runSessionStepJson(appRoot, created.sessionId, { env });
      runSessionStepJson(appRoot, created.sessionId, { env });

      const failure = runSessionStepJsonFailure(appRoot, created.sessionId, {
        args: ["--issue-details", "-"],
        env,
        input: testCase.input
      });

      assert.equal(failure.errors[0].code, testCase.code);
      assert.equal(failure.currentStep, "issue_details_gathered");
      assert.equal(failure.ok, false);
    }
  });
});

test("issue details accepts structured Studio fields without wrapper tags", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");
    await createGitApp(appRoot);
    runGit(appRoot, ["remote", "add", "origin", "https://github.com/example/repo.git"]);
    await installFakeGh(binDir, logPath);
    const env = {
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`
    };

    const created = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "create", "--json"], env }));
    advanceCliSessionToIssuePrompt(appRoot, created.sessionId, { env });
    runSessionStepJson(appRoot, created.sessionId, {
      args: ["--prompt", "Fix details"],
      env
    });
    runSessionStepJson(appRoot, created.sessionId, {
      args: ["--issue-title", "Fix details", "--issue", "[issue_text]Make details clearer.[/issue_text]"],
      env
    });
    runSessionStepJson(appRoot, created.sessionId, { env });
    runSessionStepJson(appRoot, created.sessionId, { env });

    const previousPath = process.env.PATH;
    process.env.PATH = env.PATH;
    try {
      const detailsSaved = await runSessionStep({
        targetRoot: appRoot,
        sessionId: created.sessionId,
        options: {
          issueCategory: "client",
          issueDetails: "Confirmed details are sufficient to plan the requested change.",
          uiImpact: "possible"
        }
      });

      assert.equal(detailsSaved.ok, true);
      assert.equal(detailsSaved.currentStep, "plan_made");
      assert.equal(detailsSaved.issueDetails, "Confirmed details are sufficient to plan the requested change.");
      assert.equal(detailsSaved.issueCategory, "client");
      assert.equal(detailsSaved.uiImpact, "possible");
      assert.equal(detailsSaved.githubComments.issue_details.purpose, "issue_details");
    } finally {
      process.env.PATH = previousPath;
    }
  });
});

test("GitHub issue comments are skipped when purpose metadata already exists", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");
    await createGitApp(appRoot);
    await installFakeGh(binDir, logPath);
    const env = {
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`
    };

    const created = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "create", "--json"], env }));
    runSessionStepJson(appRoot, created.sessionId, { env });
    await writeFile(path.join(created.sessionRoot, "issue_url"), "https://github.com/example/repo/issues/123\n", "utf8");
    await writeFile(path.join(created.sessionRoot, "issue_title"), "Fix duplicate comments\n", "utf8");
    await writeFile(path.join(created.sessionRoot, "issue.md"), "Fix duplicate comments.\n", "utf8");
    await writeStepReceipts(created.sessionRoot, STEP_IDS.slice(0, STEP_IDS.indexOf("issue_details_gathered")));
    await writeFile(
      path.join(created.sessionRoot, "github_comments.json"),
      `${JSON.stringify({
        issue_details: {
          bodyFile: path.join(created.sessionRoot, "issue_details.md"),
          commentedAt: "2026-05-11T00:00:00.000Z",
          issueUrl: "https://github.com/example/repo/issues/123",
          purpose: "issue_details"
        }
      }, null, 2)}\n`,
      "utf8"
    );

    const detailsSaved = runSessionStepJson(appRoot, created.sessionId, {
      args: ["--issue-details", "-"],
      env,
      input: issueDetailsOutput()
    });
    assert.equal(detailsSaved.githubComments.issue_details.purpose, "issue_details");

    const planSaved = runSessionStepJson(appRoot, created.sessionId, {
      args: ["--plan", "[plan]\nFix the comments.\n[/plan]"],
      env
    });
    assert.ok(!Object.hasOwn(planSaved.githubComments, "plan"));

    const finalRoot = path.join(cwd, "final-app");
    const finalLogPath = path.join(cwd, "final-commands.log");
    await createGitApp(finalRoot);
    await installFakeGh(binDir, finalLogPath);
    const finalCreated = parseJsonResult(runCli({ cwd: finalRoot, args: ["session", "create", "--json"], env }));
    runSessionStepJson(finalRoot, finalCreated.sessionId, { env });
    await writeFile(path.join(finalCreated.sessionRoot, "issue_url"), "https://github.com/example/repo/issues/123\n", "utf8");
    await writeFile(path.join(finalCreated.sessionRoot, "issue_title"), "Fix duplicate final report comments\n", "utf8");
    await writeFile(path.join(finalCreated.sessionRoot, "issue.md"), "Fix duplicate final report comments.\n", "utf8");
    await writeFile(path.join(finalCreated.sessionRoot, "issue_details.md"), "Confirmed details.\n", "utf8");
    await writeIssueMetadata(finalCreated.sessionRoot);
    await writeCyclePlan(finalCreated.sessionRoot, "Confirmed plan.\n");
    await writeFile(
      path.join(finalCreated.sessionRoot, "github_comments.json"),
      `${JSON.stringify({
        final_report: {
          bodyFile: path.join(finalCreated.sessionRoot, "final_report.md"),
          commentedAt: "2026-05-11T00:00:00.000Z",
          issueUrl: "https://github.com/example/repo/issues/123",
          purpose: "final_report"
        }
      }, null, 2)}\n`,
      "utf8"
    );
    await writeStepReceipts(finalCreated.sessionRoot, STEP_IDS.slice(0, STEP_IDS.indexOf("final_report_created")));

    const finalReport = runSessionStepJson(finalRoot, finalCreated.sessionId, { env });
    assert.equal(finalReport.githubComments.final_report.purpose, "final_report");

    const log = await readFile(logPath, "utf8").catch(() => "");
    const finalLog = await readFile(finalLogPath, "utf8").catch(() => "");
    assert.doesNotMatch(log, /gh issue comment/);
    assert.doesNotMatch(finalLog, /gh issue comment/);
  });
});

test("jskit session returns stable JSON for failed GitHub preconditions", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    await createGitApp(appRoot);
    runGit(appRoot, ["remote", "add", "origin", "https://github.com/example/repo.git"]);
    await installFakeCommand(
      binDir,
      "gh",
      `#!/usr/bin/env node
if (process.argv[2] === "auth" && process.argv[3] === "status") {
  console.error("not logged in");
  process.exit(1);
}
process.exit(1);
`
    );
    const env = {
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`
    };

    const created = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "create", "--json"], env }));
    advanceCliSessionToIssuePrompt(appRoot, created.sessionId, { env });
    runSessionStepJson(appRoot, created.sessionId, {
      args: ["--prompt", "Fix auth"],
      env
    });
    runSessionStepJson(appRoot, created.sessionId, {
      args: ["--issue-title", "Fix auth", "--issue", "[issue_text]# Fix auth[/issue_text]"],
      env
    });

    const failure = runSessionStepJsonFailure(appRoot, created.sessionId, { env });
    assertSessionContractFields(failure);
    assert.equal(failure.ok, false);
    assert.equal(failure.status, "blocked");
    assert.equal(failure.currentStep, "issue_created");
    assert.equal(failure.errors[0].code, "github_auth_missing");
    assert.ok(Object.hasOwn(failure, "workflowVersion"));
    assert.ok(Object.hasOwn(failure, "activeCycle"));
    assert.ok(Object.hasOwn(failure, "cycles"));
    assert.ok(Object.hasOwn(failure, "stepDefinitions"));
    assert.ok(Object.hasOwn(failure, "issueMetadata"));
    assert.equal(await readFile(path.join(failure.sessionRoot, "issue_title"), "utf8"), "Fix auth\n");
    assert.equal(await readFile(path.join(failure.sessionRoot, "issue.md"), "utf8"), "# Fix auth\n");
  });
});

test("jskit session reports stable failure codes for named preconditions", async () => {
  await withTempDir(async (cwd) => {
    const notGitRoot = path.join(cwd, "not-git");
    await mkdir(notGitRoot);
    const notGit = parseJsonFailure(runCli({ cwd: notGitRoot, args: ["session", "create", "--json"] }));
    assert.equal(notGit.errors[0].code, "git_repository_missing");

    const uncommittedRoot = path.join(cwd, "uncommitted");
    await createUncommittedGitApp(uncommittedRoot);
    const uncommitted = await createSession({ targetRoot: uncommittedRoot });
    const missingBranch = await runSessionStep({
      targetRoot: uncommittedRoot,
      sessionId: uncommitted.sessionId
    });
    assert.equal(missingBranch.ok, false);
    assert.equal(missingBranch.errors[0].code, "git_current_branch_missing");

    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    await createGitApp(appRoot);
    await installFakeCommand(
      binDir,
      "gh",
      `#!/usr/bin/env node
if (process.argv[2] === "auth" && process.argv[3] === "status") process.exit(0);
process.exit(1);
`
    );
    const env = {
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`
    };

    const created = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "create", "--json"], env }));
    advanceCliSessionToIssuePrompt(appRoot, created.sessionId, { env });
    runSessionStepJson(appRoot, created.sessionId, {
      args: ["--prompt", "Fix"],
      env
    });
    runSessionStepJson(appRoot, created.sessionId, {
      args: ["--issue-title", "Fix", "--issue", "# Fix"],
      env
    });
    const missingOrigin = runSessionStepJsonFailure(appRoot, created.sessionId, { env });
    assert.equal(missingOrigin.errors[0].code, "github_origin_missing");

    const metadataRoot = path.join(cwd, "metadata");
    await createGitApp(metadataRoot);
    const metadataSession = await createSession({ targetRoot: metadataRoot });
    await runSessionStep({
      targetRoot: metadataRoot,
      sessionId: metadataSession.sessionId
    });
    await writeFile(path.join(metadataSession.sessionRoot, "issue.md"), "Fix metadata.\n", "utf8");
    await writeFile(path.join(metadataSession.sessionRoot, "issue_title"), "Fix metadata\n", "utf8");
    await writeFile(path.join(metadataSession.sessionRoot, "issue_url"), "https://github.com/example/repo/issues/123\n", "utf8");
    await writeFile(path.join(metadataSession.sessionRoot, "issue_details.md"), "Confirmed details.\n", "utf8");
    await writeStepReceipts(metadataSession.sessionRoot, STEP_IDS.slice(0, STEP_IDS.indexOf("plan_made")));
    const missingMetadata = await runSessionStep({
      targetRoot: metadataRoot,
      sessionId: metadataSession.sessionId,
      options: {
        plan: "[plan]\nUse metadata.\n[/plan]"
      }
    });
    assert.equal(missingMetadata.ok, false);
    assert.equal(missingMetadata.errors[0].code, "issue_metadata_missing");

    const cycleRoot = path.join(cwd, "cycle");
    await createGitApp(cycleRoot);
    const cycleSession = await createSession({ targetRoot: cycleRoot });
    await runSessionStep({
      targetRoot: cycleRoot,
      sessionId: cycleSession.sessionId
    });
    await writeFile(path.join(cycleSession.sessionRoot, "issue.md"), "Fix cycle.\n", "utf8");
    await writeFile(path.join(cycleSession.sessionRoot, "issue_title"), "Fix cycle\n", "utf8");
    await writeFile(path.join(cycleSession.sessionRoot, "issue_url"), "https://github.com/example/repo/issues/123\n", "utf8");
    await writeFile(path.join(cycleSession.sessionRoot, "issue_details.md"), "Confirmed details.\n", "utf8");
    await writeIssueMetadata(cycleSession.sessionRoot);
    await writeCyclePlan(cycleSession.sessionRoot, "Confirmed plan.\n");
    await writeStepReceipts(cycleSession.sessionRoot, STEP_IDS.slice(0, STEP_IDS.indexOf("plan_executed")));
    await rm(path.join(cycleSession.sessionRoot, "active_cycle"));
    const missingActiveCycle = await runSessionStep({
      targetRoot: cycleRoot,
      sessionId: cycleSession.sessionId
    });
    assert.equal(missingActiveCycle.ok, false);
    assert.equal(missingActiveCycle.errors[0].code, "active_cycle_missing");

    const manualRoot = path.join(cwd, "manual");
    await createGitApp(manualRoot);
    const manual = await createSession({ targetRoot: manualRoot });
    await writeStepReceipts(manual.sessionRoot, STEP_IDS.slice(0, 6));
    const repairedWorktree = await runSessionStep({
      targetRoot: manualRoot,
      sessionId: manual.sessionId
    });
    assert.equal(repairedWorktree.ok, true);
    assert.equal(repairedWorktree.worktreeReady, true);

    const prRoot = path.join(cwd, "pr");
    await createGitApp(prRoot);
    const pr = await createSession({ targetRoot: prRoot });
    await runSessionStep({
      targetRoot: prRoot,
      sessionId: pr.sessionId
    });
    await writeIssueMetadata(pr.sessionRoot);
    await writeStepReceipts(pr.sessionRoot, STEP_IDS.slice(0, STEP_IDS.indexOf("pr_finalized")));
    const missingPr = await runSessionStep({
      targetRoot: prRoot,
      sessionId: pr.sessionId
    });
    assert.equal(missingPr.ok, false);
    assert.equal(missingPr.errors[0].code, "pr_url_missing");
  });
});

test("jskit session diff inspects worktree changes without advancing the session", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot);

    const created = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "create", "--json"] }));
    const worktreePayload = runSessionStepJson(appRoot, created.sessionId);
    await writeFile(path.join(worktreePayload.worktree, "package.json"), "{\"name\":\"changed-app\"}\n", "utf8");
    await writeFile(path.join(worktreePayload.worktree, "feature.txt"), "new file\n", "utf8");

    const inspectedBeforeDiff = parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "--json"] }));
    assert.equal(inspectedBeforeDiff.worktreeStatus.status, "dirty");
    assert.equal(inspectedBeforeDiff.worktreeStatus.dirty, true);
    assert.ok(inspectedBeforeDiff.worktreeStatus.changedFiles.some((line) => line.includes("package.json")));
    assert.ok(inspectedBeforeDiff.worktreeStatus.changedFiles.some((line) => line.includes("feature.txt")));

    const diffPayload = parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "diff", "--json"] }));
    assert.equal(diffPayload.ok, true);
    assert.equal(diffPayload.currentStep, "dependencies_installed");
    assert.equal(diffPayload.hasChanges, true);
    assert.match(diffPayload.gitStatus, /M package\.json/);
    assert.match(diffPayload.gitStatus, /\?\? feature\.txt/);
    assert.match(diffPayload.unstagedDiff, /changed-app/);
    assert.match(diffPayload.untrackedDiff, /feature\.txt/);

    const inspected = parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "--json"] }));
    assert.equal(inspected.currentStep, "dependencies_installed");
    assert.deepEqual(inspected.completedSteps, ["session_created", "worktree_created"]);
  });
});

test("failed user check can start a new plan cycle without deleting receipts", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot);

    const created = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "create", "--json"] }));
    runSessionStepJson(appRoot, created.sessionId);
    await writeFile(path.join(created.sessionRoot, "issue.md"), "Fix the button.\n", "utf8");
    await writeFile(path.join(created.sessionRoot, "issue_title"), "Fix button\n", "utf8");
    await writeFile(path.join(created.sessionRoot, "issue_url"), "https://github.com/example/repo/issues/123\n", "utf8");
    await writeFile(path.join(created.sessionRoot, "issue_details.md"), "Button should submit the form.\n", "utf8");
    await writeIssueMetadata(created.sessionRoot);
    await writeCyclePlan(created.sessionRoot, "Update the button handler.\n");
    await writeStepReceipts(created.sessionRoot, STEP_IDS.slice(0, STEP_IDS.indexOf("user_check_completed")));

    const failed = runSessionStepJson(appRoot, created.sessionId, {
      args: ["--user-check", "failed", "--rework-notes", "-"],
      input: "The button still does not submit."
    });
    assert.equal(failed.activeCycle, "002");
    assert.equal(failed.currentStep, "plan_made");
    assert.equal(failed.currentStepAction.buttonLabel, "Get Codex to create revised plan");
    assert.equal(failed.planText, "");
    assert.equal(failed.cycles.find((cycle) => cycle.cycle === "001").userCheckResult, "failed");
    assert.equal(failed.cycles.find((cycle) => cycle.cycle === "002").status, "active");
    assert.equal(failed.cycles.find((cycle) => cycle.cycle === "002").reworkRequest, "The button still does not submit.");
    assert.match(
      await readFile(path.join(created.sessionRoot, "steps", "cycle_001", "user_check_failed"), "utf8"),
      /User reported/
    );
    assert.equal(
      await readFile(path.join(created.sessionRoot, "cycles", "cycle_002", "rework_request.md"), "utf8"),
      "The button still does not submit.\n"
    );

    const prompt = runSessionStepJson(appRoot, created.sessionId);
    assert.equal(prompt.currentStep, "plan_made");
    assert.equal(prompt.currentStepAction.buttonLabel, "Save plan");
    assert.equal(prompt.codex.autoInject, true);
    assert.match(prompt.prompt, /The button still does not submit/);
    assert.match(prompt.prompt, /Active cycle: 002/);
    assert.match(prompt.prompt, /Plan source: rework/);
    const planSaved = runSessionStepJson(appRoot, created.sessionId, {
      args: ["--plan", "[plan]\nFix the submit handler in the new cycle.\n[/plan]"]
    });
    assert.equal(planSaved.currentStep, "plan_executed");
    assert.match(await readFile(cyclePlanPath(created.sessionRoot, "002"), "utf8"), /submit handler/);
  });
});

test("finalization cannot advance while active-cycle user check is missing or failed", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot);

    const created = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "create", "--json"] }));
    runSessionStepJson(appRoot, created.sessionId);
    await writeFile(path.join(created.sessionRoot, "issue.md"), "Fix the missing check.\n", "utf8");
    await writeFile(path.join(created.sessionRoot, "issue_title"), "Fix missing check\n", "utf8");
    await writeFile(path.join(created.sessionRoot, "issue_url"), "https://github.com/example/repo/issues/123\n", "utf8");
    await writeFile(path.join(created.sessionRoot, "issue_details.md"), "Confirmed details.\n", "utf8");
    await writeIssueMetadata(created.sessionRoot);
    await writeCyclePlan(created.sessionRoot, "Confirmed plan.\n");
    await writeStepReceipts(created.sessionRoot, STEP_IDS.slice(0, STEP_IDS.indexOf("user_check_completed")));

    const missingCheck = runSessionStepJson(appRoot, created.sessionId);
    assert.equal(missingCheck.currentStep, "user_check_completed");
    assert.match(missingCheck.prompt, /User check/);
    await assert.rejects(access(path.join(created.sessionRoot, "steps", "blueprint_updated")));

    const failedCheck = runSessionStepJsonFailure(appRoot, created.sessionId, {
      args: ["--user-check", "failed"]
    });
    assert.equal(failedCheck.status, "blocked");
    assert.equal(failedCheck.currentStep, "user_check_completed");
    assert.equal(failedCheck.errors[0].code, "user_check_failed");
    await assert.rejects(access(path.join(created.sessionRoot, "steps", "blueprint_updated")));
  });
});

test("automated checks render a Codex repair loop prompt before recording the receipt", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot);

    const created = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "create", "--json"] }));
    runSessionStepJson(appRoot, created.sessionId);
    await writeFile(path.join(created.sessionRoot, "issue_url"), "https://github.com/example/repo/issues/123\n", "utf8");
    await writeFile(path.join(created.sessionRoot, "issue_title"), "Run checks\n", "utf8");
    await writeFile(path.join(created.sessionRoot, "issue.md"), "Run checks.\n", "utf8");
    await writeFile(path.join(created.sessionRoot, "issue_details.md"), "Confirmed details.\n", "utf8");
    await writeIssueMetadata(created.sessionRoot);
    await writeCyclePlan(created.sessionRoot, "Confirmed plan.\n");
    await writeStepReceipts(created.sessionRoot, STEP_IDS.slice(0, STEP_IDS.indexOf("automated_checks_run")));

    const prompted = runSessionStepJson(appRoot, created.sessionId);
    assert.equal(prompted.currentStep, "automated_checks_run");
    assert.equal(prompted.currentStepAction.buttonLabel, "Go to next step");
    assert.equal(prompted.codex.promptActionLabel, "Run automated checks");
    assert.match(prompted.prompt, /Run automated checks/);
    assert.match(prompted.prompt, /npm run verify/);
    assert.ok(!prompted.completedSteps.includes("automated_checks_run"));
    const promptedCheck = JSON.parse(await readFile(path.join(created.sessionRoot, "checks", "automated_checks_run.json"), "utf8"));
    assert.equal(promptedCheck.status, "prompted");

    const completed = runSessionStepJson(appRoot, created.sessionId, {
      args: codexResultArgs(),
      input: codexStepResult("automated_checks_run")
    });
    assert.equal(completed.currentStep, "user_check_completed");
    assert.ok(completed.completedSteps.includes("automated_checks_run"));
    const completedCheck = JSON.parse(await readFile(path.join(created.sessionRoot, "checks", "automated_checks_run.json"), "utf8"));
    assert.equal(completedCheck.status, "completed_by_codex");
  });
});

test("server-only sessions skip Deep UI check with structured receipts", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");
    await createGitApp(appRoot);
    runGit(appRoot, ["remote", "add", "origin", "https://github.com/example/repo.git"]);
    await installFakeGh(binDir, logPath);
    await installFakeNpm(binDir, logPath);
    const env = {
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`
    };

    const created = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "create", "--json"], env }));
    advanceCliSessionToIssuePrompt(appRoot, created.sessionId, { env });
    runSessionStepJson(appRoot, created.sessionId, {
      args: ["--prompt", "Add a server health endpoint"],
      env
    });
    runSessionStepJson(appRoot, created.sessionId, {
      args: ["--issue-title", "Add health endpoint", "--issue", "[issue_text]Add a server-only health endpoint.[/issue_text]"],
      env
    });
    runSessionStepJson(appRoot, created.sessionId, { env });
    runSessionStepJson(appRoot, created.sessionId, { env });
    runSessionStepJson(appRoot, created.sessionId, {
      args: ["--issue-details", "-"],
      env,
      input: issueDetailsOutput({
        body: "Add a server-only health endpoint with no user interface changes.",
        category: "server",
        uiImpact: "none"
      })
    });
    runSessionStepJson(appRoot, created.sessionId, { env });
    runSessionStepJson(appRoot, created.sessionId, {
      args: ["--plan", "[plan]\nAdd a server health endpoint.\n[/plan]"],
      env
    });
    runSessionStepJson(appRoot, created.sessionId, { env });
    runSessionStepJson(appRoot, created.sessionId, {
      args: codexResultArgs(),
      env,
      input: codexStepResult("plan_executed")
    });

    const inspect = parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "--json"], env }));
    await writeFile(path.join(inspect.worktree, "server-health.txt"), "ok\n", "utf8");
    const committed = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(committed.currentStep, "review_prompt_rendered");
    assert.equal(committed.prompt, "");
    assert.equal(committed.uiChecks.find((entry) => entry.stepId === "deep_ui_check_run")?.status, "skipped");

    const reviewPrompt = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(reviewPrompt.currentStep, "review_changes_accepted");
    const reviewAccepted = runSessionStepJson(appRoot, created.sessionId, {
      args: ["--review-findings-remaining", "false"],
      env
    });
    assert.equal(reviewAccepted.currentStep, "automated_checks_run");
    const checkPrompt = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(checkPrompt.currentStep, "automated_checks_run");
    assert.match(checkPrompt.prompt, /Run automated checks/);
    const afterReview = runSessionStepJson(appRoot, created.sessionId, {
      args: codexResultArgs(),
      env,
      input: codexStepResult("automated_checks_run")
    });

    assert.equal(afterReview.currentStep, "user_check_completed");
    assert.equal(afterReview.uiChecks.length, 1);
    assert.match(
      await readFile(path.join(created.sessionRoot, "steps", "cycle_001", "deep_ui_check_run"), "utf8"),
      /skipped: uiImpact is none/
    );
  });
});

test("possible UI-impact sessions can explicitly skip Deep UI check with a reason", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");
    await createGitApp(appRoot);
    runGit(appRoot, ["remote", "add", "origin", "https://github.com/example/repo.git"]);
    await installFakeGh(binDir, logPath);
    await installFakeNpm(binDir, logPath);
    const env = {
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`
    };

    const created = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "create", "--json"], env }));
    advanceCliSessionToIssuePrompt(appRoot, created.sessionId, { env });
    runSessionStepJson(appRoot, created.sessionId, {
      args: ["--prompt", "Adjust a server route"],
      env
    });
    runSessionStepJson(appRoot, created.sessionId, {
      args: ["--issue-title", "Adjust route", "--issue", "[issue_text]Adjust a server route that might affect UI callers.[/issue_text]"],
      env
    });
    runSessionStepJson(appRoot, created.sessionId, { env });
    runSessionStepJson(appRoot, created.sessionId, { env });
    runSessionStepJson(appRoot, created.sessionId, {
      args: ["--issue-details", "-"],
      env,
      input: issueDetailsOutput({
        body: "The route response shape remains unchanged, so no rendered UI path changes.",
        category: "server",
        uiImpact: "possible"
      })
    });
    runSessionStepJson(appRoot, created.sessionId, { env });
    runSessionStepJson(appRoot, created.sessionId, {
      args: ["--plan", "[plan]\nAdjust the server route without changing UI contract.\n[/plan]"],
      env
    });
    runSessionStepJson(appRoot, created.sessionId, { env });
    runSessionStepJson(appRoot, created.sessionId, {
      args: codexResultArgs(),
      env,
      input: codexStepResult("plan_executed")
    });

    const inspect = parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "--json"], env }));
    await writeFile(path.join(inspect.worktree, "server-route.txt"), "route\n", "utf8");
    const committed = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(committed.currentStep, "deep_ui_check_run");

    const missingReason = runSessionStepJsonFailure(appRoot, created.sessionId, {
      args: ["--skip-ui-check"],
      env
    });
    assert.equal(missingReason.errors[0].code, "ui_check_skip_reason_required");

    const skipped = runSessionStepJson(appRoot, created.sessionId, {
      args: ["--skip-ui-check", "--skip-reason", "Route response shape is unchanged."],
      env
    });
    assert.equal(skipped.currentStep, "review_prompt_rendered");
    const check = skipped.uiChecks.find((entry) => entry.stepId === "deep_ui_check_run");
    assert.equal(check?.status, "skipped");
    assert.equal(check?.reason, "Route response shape is unchanged.");
    assert.match(
      await readFile(path.join(created.sessionRoot, "steps", "cycle_001", "deep_ui_check_run"), "utf8"),
      /Route response shape is unchanged/
    );
  });
});

test("definite UI-impact sessions render the deep UI check prompt", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");
    await createGitApp(appRoot);
    runGit(appRoot, ["remote", "add", "origin", "https://github.com/example/repo.git"]);
    await installFakeGh(binDir, logPath);
    await installFakeNpm(binDir, logPath);
    const env = {
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`
    };

    const created = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "create", "--json"], env }));
    advanceCliSessionToIssuePrompt(appRoot, created.sessionId, { env });
    runSessionStepJson(appRoot, created.sessionId, {
      args: ["--prompt", "Improve the home page UI"],
      env
    });
    runSessionStepJson(appRoot, created.sessionId, {
      args: ["--issue-title", "Improve home page UI", "--issue", "[issue_text]Improve the home page UI.[/issue_text]"],
      env
    });
    runSessionStepJson(appRoot, created.sessionId, { env });
    runSessionStepJson(appRoot, created.sessionId, { env });
    runSessionStepJson(appRoot, created.sessionId, {
      args: ["--issue-details", "-"],
      env,
      input: issueDetailsOutput({
        body: "Improve visual hierarchy and responsive layout on the home page.",
        category: "client",
        uiImpact: "definite"
      })
    });
    runSessionStepJson(appRoot, created.sessionId, { env });
    runSessionStepJson(appRoot, created.sessionId, {
      args: ["--plan", "[plan]\nImprove home page visual hierarchy.\n[/plan]"],
      env
    });
    runSessionStepJson(appRoot, created.sessionId, { env });
    runSessionStepJson(appRoot, created.sessionId, {
      args: codexResultArgs(),
      env,
      input: codexStepResult("plan_executed")
    });

    const inspect = parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "--json"], env }));
    await writeFile(path.join(inspect.worktree, "src", "home-ui.txt"), "ui\n", "utf8");
    const committed = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(committed.currentStep, "deep_ui_check_run");
    assert.equal(committed.currentStepAction.conditional, true);
    assert.equal(committed.currentStepAction.skipReason, "");
    assert.match(committed.prompt, /Deep UI quality check/);
    assert.match(committed.prompt, /UI impact: definite/);
    assert.equal(committed.currentStepAction.buttonLabel, "Go to next step");
    assert.ok(!committed.completedSteps.includes("deep_ui_check_run"));
    assert.equal(committed.uiChecks.find((entry) => entry.stepId === "deep_ui_check_run")?.status, "prompted");
    const promptedInspect = parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "--json"], env }));
    assert.equal(promptedInspect.codex.promptActionLabel, "Run Deep UI check");
    assert.equal(promptedInspect.codex.mode, "inject_prompt");
    const deepUi = runSessionStepJson(appRoot, created.sessionId, {
      args: codexResultArgs(),
      env,
      input: codexStepResult("deep_ui_check_run")
    });
    assert.equal(deepUi.currentStep, "review_prompt_rendered");
    assert.ok(deepUi.completedSteps.includes("deep_ui_check_run"));
  });
});

test("review passes can repeat and finish with a no-change pass", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");
    await createGitApp(appRoot);
    await installFakeNpm(binDir, logPath);
    const env = {
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`
    };

    const created = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "create", "--json"], env }));
    runSessionStepJson(appRoot, created.sessionId, { env });
    const session = parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "--json"], env }));
    await writeFile(path.join(session.sessionRoot, "issue_url"), "https://github.com/example/repo/issues/123\n", "utf8");
    await writeFile(path.join(session.sessionRoot, "issue_title"), "Repeat review\n", "utf8");
    await writeFile(path.join(session.sessionRoot, "issue.md"), "Repeat review passes.\n", "utf8");
    await writeFile(path.join(session.sessionRoot, "issue_details.md"), "Confirmed details.\n", "utf8");
    await writeCyclePlan(session.sessionRoot, "Confirmed plan.\n");
    await writeIssueMetadata(session.sessionRoot);
    await writeStepReceipts(session.sessionRoot, STEP_IDS.slice(0, STEP_IDS.indexOf("review_prompt_rendered")));

    const firstPrompt = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(firstPrompt.currentStep, "review_changes_accepted");
    assert.equal(firstPrompt.currentReviewPass, "001");
    assert.deepEqual(firstPrompt.currentStepAction.submitOptions, { reviewFindingsRemaining: false });
    const firstPromptInspect = parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "--json"], env }));
    assert.equal(firstPromptInspect.currentStep, "review_changes_accepted");
    assert.equal(firstPromptInspect.codex.promptActionLabel, "Run deslop");
    assert.equal(firstPromptInspect.codex.responseContract.marker, "deslop_result");
    assert.match(firstPromptInspect.prompt, /Review changes/);
    const missingDecision = runSessionStepJsonFailure(appRoot, created.sessionId, { env });
    assert.equal(missingDecision.currentStep, "review_changes_accepted");
    assert.equal(missingDecision.errors[0].code, "review_decision_required");
    await writeFile(path.join(firstPrompt.worktree, "review-pass-one.txt"), "one\n", "utf8");
    const firstAccepted = runSessionStepJson(appRoot, created.sessionId, {
      args: ["--review-findings-remaining", "true", "--review-findings", "A helper duplication fix needs another pass."],
      env
    });
    assert.equal(firstAccepted.currentStep, "review_prompt_rendered");
    assert.equal(firstAccepted.prompt, "");
    assert.equal(firstAccepted.currentStepAction.automation.mode, "codex_prompt");
    assert.equal(firstAccepted.reviewPasses[0].findingsRemaining, true);
    assert.equal(firstAccepted.reviewPasses[0].status, "accepted");
    assert.equal(firstAccepted.reviewPasses[0].commit, "");

    const secondPrompt = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(secondPrompt.currentStep, "review_changes_accepted");
    assert.equal(secondPrompt.currentReviewPass, "002");
    assert.equal(secondPrompt.reviewPasses.length, 2);
    const secondAccepted = runSessionStepJson(appRoot, created.sessionId, {
      args: ["--review-findings-remaining", "false"],
      env
    });
    assert.equal(secondAccepted.currentStep, "automated_checks_run");
    assert.equal(secondAccepted.reviewPasses[1].status, "accepted");
    assert.equal(secondAccepted.reviewPasses[1].commit, "");
    const checkPrompt = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(checkPrompt.currentStep, "automated_checks_run");
    assert.match(checkPrompt.prompt, /Run automated checks/);
    const checked = runSessionStepJson(appRoot, created.sessionId, {
      args: codexResultArgs(),
      env,
      input: codexStepResult("automated_checks_run")
    });
    assert.equal(checked.currentStep, "user_check_completed");
    assert.ok(checked.completedSteps.includes("automated_checks_run"));
  });
});

test("review pass repetition can continue until findings are resolved", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");
    await createGitApp(appRoot);
    await installFakeNpm(binDir, logPath);
    const env = {
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`
    };

    const created = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "create", "--json"], env }));
    runSessionStepJson(appRoot, created.sessionId, { env });
    const session = parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "--json"], env }));
    await writeFile(path.join(session.sessionRoot, "issue_url"), "https://github.com/example/repo/issues/123\n", "utf8");
    await writeFile(path.join(session.sessionRoot, "issue_title"), "Max review\n", "utf8");
    await writeFile(path.join(session.sessionRoot, "issue.md"), "Max review passes.\n", "utf8");
    await writeFile(path.join(session.sessionRoot, "issue_details.md"), "Confirmed details.\n", "utf8");
    await writeCyclePlan(session.sessionRoot, "Confirmed plan.\n");
    await writeIssueMetadata(session.sessionRoot);
    await writeStepReceipts(session.sessionRoot, STEP_IDS.slice(0, STEP_IDS.indexOf("review_prompt_rendered")));

    let payload = null;
    for (const pass of ["001", "002", "003", "004"]) {
      const prompted = runSessionStepJson(appRoot, created.sessionId, { env });
      assert.equal(prompted.currentStep, "review_changes_accepted");
      assert.equal(prompted.currentReviewPass, pass);
      await writeFile(path.join(prompted.worktree, `review-pass-${pass}.txt`), `${pass}\n`, "utf8");
      payload = runSessionStepJson(appRoot, created.sessionId, {
        args: ["--review-findings-remaining", "true", "--review-findings", `Important findings remain after pass ${pass}.`],
        env
      });
    }
    assert.equal(payload.currentStep, "review_prompt_rendered");
    assert.equal(payload.reviewPasses.length, 4);
    assert.equal(payload.reviewPasses[3].findingsRemaining, true);
    const nextPrompt = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(nextPrompt.currentStep, "review_changes_accepted");
    assert.equal(nextPrompt.currentReviewPass, "005");
  });
});

test("blueprint update step renders a Codex prompt then records the edited blueprint", async () => {
  await withTempDir(async (cwd) => {
    const changedRoot = path.join(cwd, "changed");
    await createGitApp(changedRoot);
    const changedSession = parseJsonResult(runCli({ cwd: changedRoot, args: ["session", "create", "--json"] }));
    const changedWorktree = runSessionStepJson(changedRoot, changedSession.sessionId);
    await writeFile(path.join(changedSession.sessionRoot, "issue_url"), "https://github.com/example/repo/issues/123\n", "utf8");
    await writeFile(path.join(changedSession.sessionRoot, "issue_title"), "Update blueprint\n", "utf8");
    await writeFile(path.join(changedSession.sessionRoot, "issue.md"), "Update blueprint.\n", "utf8");
    await writeFile(path.join(changedSession.sessionRoot, "issue_details.md"), "Confirmed details.\n", "utf8");
    await writeIssueMetadata(changedSession.sessionRoot);
    await writeCyclePlan(changedSession.sessionRoot, "Confirmed plan.\n");
    await writeStepReceipts(changedSession.sessionRoot, STEP_IDS.slice(0, STEP_IDS.indexOf("blueprint_updated")));

    const prompt = runSessionStepJson(changedRoot, changedSession.sessionId);
    assert.equal(prompt.currentStep, "blueprint_updated");
    assert.equal(prompt.currentStepAction.kind, "codex_prompt");
    assert.equal(prompt.currentStepAction.input.type, "none");
    assert.match(prompt.prompt, /Edit `.jskit\/APP_BLUEPRINT\.md` directly/);

    await writeFile(path.join(changedWorktree.worktree, ".jskit", "APP_BLUEPRINT.md"), "# Updated Blueprint\n\nThe app now tracks field work.\n", "utf8");
    const changed = runSessionStepJson(changedRoot, changedSession.sessionId, {
      args: codexResultArgs(),
      input: codexStepResult("blueprint_updated")
    });
    assert.equal(changed.currentStep, "final_report_created");
    assert.match(runGit(changedWorktree.worktree, ["log", "--oneline", "--max-count=1"]), /Update app blueprint/);
    assert.match(await readFile(path.join(changedSession.sessionRoot, "steps", "blueprint_updated"), "utf8"), /committed the app blueprint/);

    const unchangedRoot = path.join(cwd, "unchanged");
    await createGitApp(unchangedRoot);
    await writeFile(path.join(unchangedRoot, ".jskit", "APP_BLUEPRINT.md"), "# Existing Blueprint\n\nAlready current.\n", "utf8");
    runGit(unchangedRoot, ["add", ".jskit/APP_BLUEPRINT.md"]);
    runGit(unchangedRoot, ["commit", "-m", "Add existing blueprint"]);
    const unchangedSession = parseJsonResult(runCli({ cwd: unchangedRoot, args: ["session", "create", "--json"] }));
    const unchangedWorktree = runSessionStepJson(unchangedRoot, unchangedSession.sessionId);
    await writeFile(path.join(unchangedSession.sessionRoot, "issue_url"), "https://github.com/example/repo/issues/123\n", "utf8");
    await writeFile(path.join(unchangedSession.sessionRoot, "issue_title"), "Keep blueprint\n", "utf8");
    await writeFile(path.join(unchangedSession.sessionRoot, "issue.md"), "Keep blueprint.\n", "utf8");
    await writeFile(path.join(unchangedSession.sessionRoot, "issue_details.md"), "Confirmed details.\n", "utf8");
    await writeIssueMetadata(unchangedSession.sessionRoot);
    await writeCyclePlan(unchangedSession.sessionRoot, "Confirmed plan.\n");
    await writeStepReceipts(unchangedSession.sessionRoot, STEP_IDS.slice(0, STEP_IDS.indexOf("blueprint_updated")));

    const unchangedPrompt = runSessionStepJson(unchangedRoot, unchangedSession.sessionId);
    assert.equal(unchangedPrompt.currentStep, "blueprint_updated");
    const unchanged = runSessionStepJson(unchangedRoot, unchangedSession.sessionId, {
      args: codexResultArgs(),
      input: codexStepResult("blueprint_updated")
    });
    assert.equal(unchanged.currentStep, "final_report_created");
    assert.equal(runGit(unchangedWorktree.worktree, ["status", "--porcelain=v1"]), "");
    assert.match(
      await readFile(path.join(unchangedSession.sessionRoot, "steps", "blueprint_updated"), "utf8"),
      /no blueprint changes were needed/
    );

    const unexpectedRoot = path.join(cwd, "unexpected");
    await createGitApp(unexpectedRoot);
    const unexpectedSession = parseJsonResult(runCli({ cwd: unexpectedRoot, args: ["session", "create", "--json"] }));
    const unexpectedWorktree = runSessionStepJson(unexpectedRoot, unexpectedSession.sessionId);
    await writeFile(path.join(unexpectedSession.sessionRoot, "issue_url"), "https://github.com/example/repo/issues/123\n", "utf8");
    await writeFile(path.join(unexpectedSession.sessionRoot, "issue_title"), "Unexpected blueprint\n", "utf8");
    await writeFile(path.join(unexpectedSession.sessionRoot, "issue.md"), "Unexpected blueprint.\n", "utf8");
    await writeFile(path.join(unexpectedSession.sessionRoot, "issue_details.md"), "Confirmed details.\n", "utf8");
    await writeIssueMetadata(unexpectedSession.sessionRoot);
    await writeCyclePlan(unexpectedSession.sessionRoot, "Confirmed plan.\n");
    await writeStepReceipts(unexpectedSession.sessionRoot, STEP_IDS.slice(0, STEP_IDS.indexOf("blueprint_updated")));

    const removedInput = runSessionStepJsonFailure(unexpectedRoot, unexpectedSession.sessionId, {
      args: ["--blueprint", "[app_blueprint]\n# Should Not Save\n[/app_blueprint]"]
    });
    assert.equal(removedInput.errors[0].code, "session_blueprint_input_removed");

    runSessionStepJson(unexpectedRoot, unexpectedSession.sessionId);
    await writeFile(path.join(unexpectedWorktree.worktree, "README.md"), "Unexpected change.\n", "utf8");
    await writeFile(path.join(unexpectedWorktree.worktree, ".jskit", "APP_BLUEPRINT.md"), "# Updated Blueprint\n", "utf8");
    const unexpected = runSessionStepJsonFailure(unexpectedRoot, unexpectedSession.sessionId, {
      args: codexResultArgs(),
      input: codexStepResult("blueprint_updated")
    });
    assert.equal(unexpected.errors[0].code, "blueprint_unexpected_changes");
    assert.equal(unexpected.currentStep, "blueprint_updated");
  });
});

test("jskit session can execute review loop, PR, merge, cleanup, and finish", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");
    await createGitApp(appRoot, { withRemote: true });
    await installFakeGh(binDir, logPath);
    await installFakeNpm(binDir, logPath);
    const env = {
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`
    };

    const created = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "create", "--json"], env }));
    advanceCliSessionToIssuePrompt(appRoot, created.sessionId, { env });
    runSessionStepJson(appRoot, created.sessionId, {
      args: ["--prompt", "Add a page"],
      env
    });
    runSessionStepJson(appRoot, created.sessionId, {
      args: ["--issue-title", "Add a page", "--issue", "# Add a page"],
      env
    });
    const issueCreated = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(issueCreated.currentStep, "issue_details_gathered");
    saveCliSessionIssueDetails(appRoot, created.sessionId, { env });
    const planPrompt = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(planPrompt.currentStep, "plan_made");
    assert.equal(planPrompt.codex.autoInject, true);
    assert.match(planPrompt.prompt, /Create an implementation plan/);
    const planMade = runSessionStepJson(appRoot, created.sessionId, {
      args: ["--plan", "[plan]\nImplement the page.\n[/plan]"],
      env
    });
    assert.equal(planMade.currentStep, "plan_executed");
    assert.equal(planMade.currentStepAction.buttonLabel, "Get Codex to execute plan");
    assert.equal(planMade.prompt, "");
    assert.ok(planMade.completedSteps.includes("plan_made"));
    const executed = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(executed.currentStep, "plan_executed");
    assert.equal(executed.currentStepAction.buttonLabel, "Go to next step");
    assert.deepEqual(executed.currentStepAction.utilityActions, []);
    assert.equal(executed.codex.autoInject, true);
    assert.equal(executed.codex.promptActionLabel, "Get Codex to execute plan");
    assert.match(executed.prompt, /Execute the approved implementation plan/);
    assert.ok(!executed.completedSteps.includes("plan_executed"));
    const advancedPastExecution = runSessionStepJson(appRoot, created.sessionId, {
      args: codexResultArgs(),
      env,
      input: codexStepResult("plan_executed")
    });
    assert.equal(advancedPastExecution.currentStep, "deep_ui_check_run");
    assert.equal(advancedPastExecution.currentStepAction.buttonLabel, "Run Deep UI check");
    assert.equal(advancedPastExecution.currentStepAction.conditional, true);
    assert.equal(advancedPastExecution.currentStepAction.skipReason, "");
    assert.equal(advancedPastExecution.codex.promptActionLabel, "Run Deep UI check");
    assert.equal(advancedPastExecution.prompt, "");
    assert.ok(advancedPastExecution.completedSteps.includes("plan_executed"));

    const inspect = parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "--json"], env }));
    await writeFile(path.join(inspect.worktree, "feature.txt"), "hello\\n", "utf8");
    await mkdir(path.join(inspect.worktree, "src", "lib"), {
      recursive: true
    });
    await writeFile(
      path.join(inspect.worktree, "src", "lib", "formatFeatureTitle.js"),
      "export function formatFeatureTitle(value) {\n  return String(value).trim();\n}\n",
      "utf8"
    );
    const accepted = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(accepted.currentStep, "deep_ui_check_run");
    assert.ok(!accepted.completedSteps.includes("deep_ui_check_run"));
    assert.match(accepted.prompt, /Deep UI quality check/);
    assert.equal(accepted.codex.promptActionLabel, "Run Deep UI check");
    assert.equal(accepted.currentStepAction.buttonLabel, "Go to next step");
    assert.deepEqual(accepted.currentStepAction.utilityActions, []);
    const deepUi = runSessionStepJson(appRoot, created.sessionId, {
      args: codexResultArgs(),
      env,
      input: codexStepResult("deep_ui_check_run")
    });
    assert.equal(deepUi.currentStep, "review_prompt_rendered");
    assert.ok(deepUi.completedSteps.includes("deep_ui_check_run"));
    assert.equal(deepUi.codex.promptActionLabel, "Run deslop");
    assert.equal(accepted.stepDefinitions.find((step) => step.id === "review_prompt_rendered").label, "Review/deslop");

    const review = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(review.currentStep, "review_changes_accepted");
    assert.equal(review.currentStepAction.buttonLabel, "I am done");
    assert.deepEqual(review.currentStepAction.utilityActions, []);
    assert.equal(review.codex.autoInject, true);
    assert.equal(review.codex.promptActionLabel, "Run deslop");
    assert.deepEqual(review.codex.responseContract, {
      autoResolvePriorities: ["high", "medium"],
      completionBehavior: "deslop_loop",
      kind: "deslop_result",
      marker: "deslop_result",
      missingMarkerBehavior: "resend",
      required: true,
      resolvePrompt: {
        findingsPlaceholder: "{{findings}}",
        marker: "resolve_deslop_findings",
        template: await readFile(path.join(PROMPT_ROOT, "resolve_deslop_findings.md"), "utf8"),
        templateFile: "resolve_deslop_findings.md"
      }
    });
    assert.match(review.prompt, /Review changes/);
    assert.match(review.prompt, /Review pass: 001\./);
    assert.equal(review.currentReviewPass, "001");
    assert.equal(review.reviewPasses.length, 1);
    assert.equal(review.reviewPasses[0].status, "prompted");
    assert.equal(review.reviewPasses[0].promptPath, path.join(review.sessionRoot, "review_passes", "pass_001", "prompt.md"));
    assert.match(
      await readFile(path.join(review.sessionRoot, "prompts", "review.md"), "utf8"),
      /Review changes/
    );
    assert.match(
      await readFile(path.join(review.sessionRoot, "review_passes", "pass_001", "prompt.md"), "utf8"),
      /Review pass: 001\./
    );
    await writeFile(path.join(inspect.worktree, "review-fix.txt"), "reviewed\\n", "utf8");
    const reviewAccepted = runSessionStepJson(appRoot, created.sessionId, {
      args: ["--review-findings-remaining", "false"],
      env
    });
    assert.equal(reviewAccepted.currentStep, "automated_checks_run");
    assert.ok(reviewAccepted.completedSteps.includes("review_changes_accepted"));
    assert.equal(reviewAccepted.reviewPasses[0].status, "accepted");
    assert.ok(reviewAccepted.reviewPasses[0].changedFiles.includes("?? review-fix.txt"));
    assert.equal(reviewAccepted.reviewPasses[0].commit, "");
    const automatedPrompt = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(automatedPrompt.currentStep, "automated_checks_run");
    assert.match(automatedPrompt.prompt, /Run automated checks/);
    assert.match(automatedPrompt.prompt, /npm run verify:local/);
    assert.equal(automatedPrompt.codex.autoInject, true);
    assert.ok(!automatedPrompt.completedSteps.includes("automated_checks_run"));
    const automatedPassed = runSessionStepJson(appRoot, created.sessionId, {
      args: codexResultArgs(),
      env,
      input: codexStepResult("automated_checks_run")
    });
    assert.equal(automatedPassed.currentStep, "user_check_completed");
    assert.deepEqual(automatedPassed.currentStepAction.utilityActions, [
      {
        id: "session_app_test",
        kind: "app_test",
        label: "Test app"
      }
    ]);
    assert.ok(automatedPassed.completedSteps.includes("automated_checks_run"));
    const check = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(check.currentStep, "user_check_completed");
    assert.match(check.prompt, /User check/);
    const userChecked = runSessionStepJson(appRoot, created.sessionId, {
      args: ["--user-check", "passed"],
      env
    });
    assert.equal(userChecked.currentStep, "changes_committed");

    const committed = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(committed.currentStep, "blueprint_updated");
    assert.ok(committed.completedSteps.includes("changes_committed"));
    assert.equal(committed.githubComments.accepted_changes_committed, undefined);
    assert.match(await readFile(path.join(committed.sessionRoot, "changes_committed.json"), "utf8"), /"commit":/u);
    await assert.rejects(access(path.join(committed.sessionRoot, "changes_committed.md")));

    const blueprintPrompt = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(blueprintPrompt.currentStep, "blueprint_updated");
    assert.match(blueprintPrompt.prompt, /Update the durable JSKIT app blueprint/);
    await writeFile(path.join(inspect.worktree, ".jskit", "APP_BLUEPRINT.md"), "# Session Test App\n\nAdds a simple feature page.\n", "utf8");
    const blueprintUpdated = runSessionStepJson(appRoot, created.sessionId, {
      args: codexResultArgs(),
      env,
      input: codexStepResult("blueprint_updated")
    });
    assert.equal(blueprintUpdated.currentStep, "final_report_created");
    assert.match(await readFile(path.join(inspect.worktree, ".jskit", "APP_BLUEPRINT.md"), "utf8"), /Session Test App/);

    const finalReport = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(finalReport.currentStep, "pr_created");
    assert.match(finalReport.finalReportText, /Final Report/);
    assert.match(finalReport.finalReportText, /## Checks/);
    assert.match(finalReport.finalReportText, /## UI Checks/);
    assert.match(finalReport.finalReportText, /## Review Passes/);
    assert.match(finalReport.finalReportText, /## Command Log/);
    assert.match(finalReport.finalReportText, /## Remaining Unverified Gaps/);
    assert.match(finalReport.finalReportText, /## Decisions/);
    assert.match(finalReport.finalReportText, /Codex updated and JSKIT committed the app blueprint/);
    assert.equal(finalReport.githubComments.final_report.purpose, "final_report");
    const pr = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(pr.prUrl, "https://github.com/example/repo/pull/456");
    assert.equal(pr.currentStep, "pr_merge_prepared");
    assert.equal(pr.currentStepAction.buttonLabel, "Continue to merge");
    assert.equal(pr.currentStepAction.requiresExplicitRun, true);
    assert.equal(pr.currentStepAction.utilityActions[0].id, "prepare_pr_merge");
    assert.equal(pr.currentStepAction.utilityActions[0].label, "Get Codex ready to merge PR");
    const helperMap = JSON.parse(await readFile(path.join(inspect.worktree, ".jskit", "helper-map.json"), "utf8"));
    assert.ok(helperMap.app.files.some((file) => {
      return file.path === "src/lib/formatFeatureTitle.js" &&
        file.exports.some((symbol) => symbol.name === "formatFeatureTitle");
    }));
    assert.match(runGit(inspect.worktree, ["log", "--oneline", "--max-count=3"]), /Update JSKIT helper map/);
    assert.match(runGit(inspect.worktree, ["show", `origin/${pr.branch}:.jskit/helper-map.md`]), /formatFeatureTitle/);
    const prepareDecisionRequired = runSessionStepJsonFailure(appRoot, created.sessionId, { env });
    assert.equal(prepareDecisionRequired.errors[0].code, "pr_merge_prepare_decision_required");
    const mergePrepPrompt = runSessionStepJson(appRoot, created.sessionId, {
      args: ["--prepare-merge", "true"],
      env
    });
    assert.equal(mergePrepPrompt.currentStep, "pr_merge_prepared");
    assert.equal(mergePrepPrompt.status, "waiting_for_user");
    assert.match(mergePrepPrompt.prompt, /Prepare the JSKIT session pull request for merge/);
    assert.doesNotMatch(mergePrepPrompt.prompt, /\[jskit_step_result\]/);
    assert.equal(Object.hasOwn(mergePrepPrompt.codex, "responseContract"), false);
    await access(inspect.worktree);
    await assert.rejects(access(path.join(pr.sessionRoot, "steps", "pr_merge_prepared")));
    const mergeDecision = runSessionStepJson(appRoot, created.sessionId, {
      args: ["--continue-to-merge", "true"],
      env
    });
    assert.equal(mergeDecision.currentStep, "pr_finalized");
    assert.equal(mergeDecision.currentStepAction.buttonLabel, "Merge PR");
    assert.equal(mergeDecision.currentStepAction.alternateActions[0].id, "skip_merge");
    assert.equal(mergeDecision.currentStepAction.alternateActions[0].label, "Skip merge");
    assert.deepEqual(mergeDecision.currentStepAction.alternateActions[0].input, { type: "none" });
    await access(path.join(pr.sessionRoot, "steps", "pr_merge_prepared"));
    const mergeDecisionRequired = runSessionStepJsonFailure(appRoot, created.sessionId, { env });
    assert.equal(mergeDecisionRequired.errors[0].code, "pr_finalize_decision_required");
    const merged = runSessionStepJson(appRoot, created.sessionId, {
      args: ["--merge-pr", "true"],
      env
    });
    assert.equal(merged.currentStep, "main_checkout_synced");
    assert.equal(merged.prOutcome.outcome, "merged");
    assert.equal(merged.currentStepAction.buttonLabel, "Sync main checkout");
    assert.equal(merged.currentStepAction.requiresExplicitRun, true);
    assert.equal(merged.currentStepAction.alternateActions[0].id, "skip_main_checkout_sync");
    assert.deepEqual(merged.currentStepAction.alternateActions[0].submitOptions, { skipMainSync: true });
    await access(inspect.worktree);
    const synced = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(synced.currentStep, "session_finished");
    assert.equal(synced.mainCheckoutSync.status, "synced");
    assert.equal(synced.mainCheckoutSync.branch, "main");
    assert.ok(synced.completedSteps.includes("main_checkout_synced"));
    await access(inspect.worktree);
    const finished = runSessionStepJson(appRoot, created.sessionId, { env });
    assertSessionContractFields(finished);
    assert.equal(await readFile(path.join(appRoot, "feature.txt"), "utf8"), "hello\\n");
    assert.match(await readFile(path.join(appRoot, ".jskit", "helper-map.md"), "utf8"), /formatFeatureTitle/);
    await assert.rejects(access(inspect.worktree));

    assert.equal(finished.status, "finished");
    assert.equal(finished.currentStep, "");
    assert.equal(finished.archive, "completed");
    assert.equal(finished.prOutcome.outcome, "merged");
    assert.equal(finished.sessionRoot, path.join(appRoot, ".jskit", "sessions", "completed", created.sessionId));
    await access(finished.sessionRoot);
    await access(path.join(finished.sessionRoot, "workflow_version"));
    await access(path.join(finished.sessionRoot, "active_cycle"));
    await access(path.join(finished.sessionRoot, "steps", "cycle_001"));
    await access(path.join(finished.sessionRoot, "issue_metadata.json"));
    await access(path.join(finished.sessionRoot, "base_branch"));
    await access(path.join(finished.sessionRoot, "base_commit"));
    await access(path.join(finished.sessionRoot, "final_report.md"));
    await access(path.join(finished.sessionRoot, "agent_decisions.md"));
    await access(path.join(finished.sessionRoot, "issue_details.md"));
    await access(path.join(finished.sessionRoot, "github_comments.json"));
    await access(path.join(finished.sessionRoot, "pr_outcome.json"));
    await access(path.join(finished.sessionRoot, "main_checkout_sync.json"));
    await access(path.join(finished.sessionRoot, "local_base_updated"));
    await access(path.join(finished.sessionRoot, "command_log.jsonl"));
    await access(path.join(finished.sessionRoot, "checks", "automated_checks_run.json"));
    await access(path.join(finished.sessionRoot, "ui_checks", "deep_ui_check_run.json"));
    await access(path.join(finished.sessionRoot, "review_passes", "pass_001", "prompt.md"));
    await access(path.join(finished.sessionRoot, "review_passes", "pass_001", "accepted.json"));
    await access(path.join(finished.sessionRoot, "changes_committed.json"));
    await access(path.join(finished.sessionRoot, "prompts", "issue_draft.md"));
    const commandLog = await readFile(path.join(finished.sessionRoot, "command_log.jsonl"), "utf8");
    assert.match(commandLog, /"kind":"dependencies_install"/);
    assert.match(commandLog, /"kind":"github_pr_create"/);
    assert.match(commandLog, /"kind":"github_pr_view"/);
    assert.match(commandLog, /"kind":"github_pr_merge"/);
    assert.match(commandLog, /"kind":"git_pull_base"/);
    await assert.rejects(access(path.join(appRoot, ".jskit", "sessions", "active", created.sessionId)));
    const listed = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "--json"], env }));
    assert.equal(listed.archive, "active");
    assert.equal(listed.sessions.find((session) => session.sessionId === created.sessionId), undefined);
    const completedList = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "--completed", "--json"], env }));
    assert.equal(completedList.archive, "completed");
    assert.equal(completedList.sessions.find((session) => session.sessionId === created.sessionId)?.archive, "completed");
    const allList = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "--all", "--json"], env }));
    assert.equal(allList.archive, "mixed");
    assert.equal(allList.sessions.find((session) => session.sessionId === created.sessionId)?.archive, "completed");
    const log = await readFile(logPath, "utf8");
    assert.match(log, /gh pr create/);
    assert.match(log, /gh pr view https:\/\/github\.com\/example\/repo\/pull\/456 --json state,mergedAt,url,baseRefName/);
    assert.match(log, /gh pr merge https:\/\/github\.com\/example\/repo\/pull\/456 --merge --delete-branch/);
    assert.match(log, /gh issue close https:\/\/github\.com\/example\/repo\/issues\/123/);
    assert.match(log, /gh issue comment https:\/\/github\.com\/example\/repo\/issues\/123 --body-file/);
  });
});

test("jskit session reuses an existing current-branch PR during PR creation", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");
    await createGitApp(appRoot, { withRemote: true });
    await installFakeGh(binDir, logPath);
    await installFakeNpm(binDir, logPath);
    const existingPrUrl = "https://github.com/example/repo/pull/789";
    const env = {
      FAKE_GH_EXISTING_PR_URL: existingPrUrl,
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`
    };

    const created = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "create", "--json"], env }));
    advanceCliSessionToIssuePrompt(appRoot, created.sessionId, { env });
    const session = parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "--json"], env }));

    await writeFile(path.join(session.sessionRoot, "issue_url"), "https://github.com/example/repo/issues/123\n", "utf8");
    await writeFile(path.join(session.sessionRoot, "issue_title"), "Reuse existing PR\n", "utf8");
    await writeFile(path.join(session.sessionRoot, "issue.md"), "Reuse an existing branch PR.\n", "utf8");
    await writeFile(path.join(session.sessionRoot, "issue_details.md"), "Details are complete.\n", "utf8");
    await writeCyclePlan(session.sessionRoot, "Plan is approved.\n");
    await writeFile(path.join(session.sessionRoot, "final_report.md"), "# Final Report\n", "utf8");
    await writeIssueMetadata(session.sessionRoot);
    await writeStepReceipts(session.sessionRoot, STEP_IDS.slice(0, STEP_IDS.indexOf("pr_created")));

    const pr = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(pr.currentStep, "pr_merge_prepared");
    assert.equal(pr.prUrl, existingPrUrl);
    assert.match(await readFile(path.join(session.sessionRoot, "steps", "pr_created"), "utf8"), /reused existing PR/);
    const log = await readFile(logPath, "utf8");
    assert.match(log, /gh pr view --json state,mergedAt,url,baseRefName/);
    assert.doesNotMatch(log, /gh pr create/);
    const commandLog = await readFile(path.join(session.sessionRoot, "command_log.jsonl"), "utf8");
    assert.match(commandLog, /"kind":"github_pr_view_current_branch"/);
  });
});

test("jskit session treats an already-merged PR as merged before final cleanup", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");
    await createGitApp(appRoot, { withRemote: true });
    await installFakeCommand(
      binDir,
      "gh",
      `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(logPath)}, ["gh", ...args].join(" ") + "\\n");
if (args[0] === "auth" && args[1] === "status") process.exit(0);
if (args[0] === "issue" && args[1] === "close") process.exit(0);
if (args[0] === "pr" && args[1] === "view") {
  console.log(JSON.stringify({ baseRefName: "main", state: "MERGED", mergedAt: "2026-05-12T16:22:32Z", url: args[2] }));
  process.exit(0);
}
if (args[0] === "pr" && args[1] === "merge") {
  console.error("merge should not run for an already-merged PR");
  process.exit(1);
}
console.error("unexpected gh args", args.join(" "));
process.exit(1);
`
    );
    const env = {
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`
    };

    const created = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "create", "--json"], env }));
    const worktreePayload = parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--json"], env }));
    await writeStepReceipts(
      worktreePayload.sessionRoot,
      STEP_IDS.slice(0, STEP_IDS.indexOf("pr_finalized"))
    );
    await writeFile(path.join(worktreePayload.sessionRoot, "issue_url"), "https://github.com/example/repo/issues/123\n", "utf8");
    await writeFile(path.join(worktreePayload.sessionRoot, "pr_url"), "https://github.com/example/repo/pull/456\n", "utf8");
    await writeIssueMetadata(worktreePayload.sessionRoot);

    const decisionRequired = parseJsonFailure(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--json"], env }));
    assert.equal(decisionRequired.errors[0].code, "pr_finalize_decision_required");
    const merged = parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--merge-pr", "true", "--json"], env }));
    assert.equal(merged.currentStep, "main_checkout_synced");
    assert.ok(merged.completedSteps.includes("pr_finalized"));
    assert.equal(merged.prOutcome.outcome, "merged");
    await access(worktreePayload.worktree);
    const log = await readFile(logPath, "utf8");
    assert.match(log, /gh pr view https:\/\/github\.com\/example\/repo\/pull\/456 --json state,mergedAt,url,baseRefName/);
    assert.doesNotMatch(log, /gh pr merge/);
    assert.match(log, /gh issue close https:\/\/github\.com\/example\/repo\/issues\/123/);
  });
});

test("jskit session blocks main checkout sync when the target root is dirty", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");
    await createGitApp(appRoot, { withRemote: true });
    await installFakeCommand(
      binDir,
      "gh",
      `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(logPath)}, ["gh", ...args].join(" ") + "\\n");
if (args[0] === "auth" && args[1] === "status") process.exit(0);
if (args[0] === "pr" && args[1] === "view") {
  console.log(JSON.stringify({ baseRefName: "main", state: "MERGED", mergedAt: "2026-05-12T16:22:32Z", url: args[2] }));
  process.exit(0);
}
console.error("unexpected gh args", args.join(" "));
process.exit(1);
`
    );
    const env = {
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`
    };

    const created = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "create", "--json"], env }));
    const worktreePayload = parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--json"], env }));
    await writeStepReceipts(
      worktreePayload.sessionRoot,
      STEP_IDS.slice(0, STEP_IDS.indexOf("pr_finalized"))
    );
    await writeFile(path.join(worktreePayload.sessionRoot, "issue_url"), "https://github.com/example/repo/issues/123\n", "utf8");
    await writeFile(path.join(worktreePayload.sessionRoot, "pr_url"), "https://github.com/example/repo/pull/456\n", "utf8");
    await writeIssueMetadata(worktreePayload.sessionRoot);
    await writeFile(path.join(appRoot, "local-change.txt"), "dirty\n", "utf8");

    const merged = parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--merge-pr", "true", "--json"], env }));
    assert.equal(merged.currentStep, "main_checkout_synced");
    assert.ok(merged.completedSteps.includes("pr_finalized"));

    const blocked = parseJsonFailure(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--json"], env }));
    assert.equal(blocked.errors[0].code, "target_root_dirty");
    assert.equal(blocked.currentStep, "main_checkout_synced");
    await access(worktreePayload.worktree);
    await access(path.join(worktreePayload.sessionRoot, "steps", "pr_finalized"));
    await assert.rejects(access(path.join(worktreePayload.sessionRoot, "steps", "main_checkout_synced")));
    await assert.rejects(access(path.join(worktreePayload.sessionRoot, "steps", "session_finished")));

    const skipped = parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--skip-main-sync", "--json"], env }));
    assert.equal(skipped.currentStep, "session_finished");
    assert.equal(skipped.mainCheckoutSync.status, "skipped");
    assert.match(skipped.mainCheckoutSync.reason, /User skipped/);
    await access(path.join(worktreePayload.sessionRoot, "steps", "main_checkout_synced"));

    const finished = parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--json"], env }));
    assert.equal(finished.status, "finished");
    await assert.rejects(access(worktreePayload.worktree));

    const log = await readFile(logPath, "utf8");
    assert.match(log, /gh pr view https:\/\/github\.com\/example\/repo\/pull\/456 --json state,mergedAt,url,baseRefName/);
    assert.doesNotMatch(log, /gh pr merge/);
    assert.match(log, /gh issue close https:\/\/github\.com\/example\/repo\/issues\/123/);
  });
});

test("jskit session can finish successfully without merging the PR", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");
    await createGitApp(appRoot);
    await installFakeGh(binDir, logPath);
    const env = {
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`
    };

    const created = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "create", "--json"], env }));
    const worktreePayload = parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--json"], env }));
    await writeStepReceipts(
      worktreePayload.sessionRoot,
      STEP_IDS.slice(0, STEP_IDS.indexOf("pr_finalized"))
    );
    await writeFile(path.join(worktreePayload.sessionRoot, "issue_url"), "https://github.com/example/repo/issues/123\n", "utf8");
    await writeFile(path.join(worktreePayload.sessionRoot, "pr_url"), "https://github.com/example/repo/pull/456\n", "utf8");
    await writeIssueMetadata(worktreePayload.sessionRoot);

    const closed = parseJsonResult(runCli({
      cwd: appRoot,
      args: ["session", created.sessionId, "step", "--skip-merge", "--json"],
      env
    }));
    assert.equal(closed.currentStep, "main_checkout_synced");
    assert.equal(closed.prOutcome.outcome, "closed_without_merge");
    assert.equal(closed.prOutcome.reason, "User skipped merge in JSKIT Studio.");
    assert.equal(closed.currentStepAction.buttonLabel, "Record no sync needed");
    await access(worktreePayload.worktree);

    const skippedSync = parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--json"], env }));
    assert.equal(skippedSync.currentStep, "session_finished");
    assert.equal(skippedSync.mainCheckoutSync.status, "skipped");
    assert.equal(skippedSync.mainCheckoutSync.outcome, "closed_without_merge");
    await access(path.join(worktreePayload.sessionRoot, "steps", "main_checkout_synced"));

    const finished = parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--json"], env }));
    assertSessionContractFields(finished);
    assert.equal(finished.status, "finished");
    assert.equal(finished.archive, "completed");
    assert.equal(finished.prOutcome.outcome, "closed_without_merge");
    await assert.rejects(access(worktreePayload.worktree));

    const log = await readFile(logPath, "utf8");
    assert.match(log, /gh pr comment https:\/\/github\.com\/example\/repo\/pull\/456 --body JSKIT session/);
    assert.match(log, /gh issue comment https:\/\/github\.com\/example\/repo\/issues\/123 --body JSKIT session/);
    assert.doesNotMatch(log, /gh pr close/);
    assert.doesNotMatch(log, /gh issue close/);
    assert.doesNotMatch(log, /gh pr merge/);
  });
});

test("jskit session abandon closes issue, removes worktree, and marks state abandoned", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");
    await createGitApp(appRoot);
    await installFakeGh(binDir, logPath);
    const env = {
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`
    };

    const created = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "create", "--json"], env }));
    const worktreePayload = parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--json"], env }));
    await writeFile(path.join(worktreePayload.sessionRoot, "issue_url"), "https://github.com/example/repo/issues/999\\n", "utf8");

    const abandoned = parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "abandon", "--json"], env }));
    assertSessionContractFields(abandoned);
    assert.equal(abandoned.status, "abandoned");
    assert.equal(abandoned.archive, "abandoned");
    assert.equal(abandoned.sessionRoot, path.join(appRoot, ".jskit", "sessions", "abandoned", created.sessionId));
    await access(abandoned.sessionRoot);
    await assert.rejects(access(path.join(appRoot, ".jskit", "sessions", "active", created.sessionId)));
    await assert.rejects(access(worktreePayload.worktree));
    const listed = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "--json"], env }));
    assert.equal(listed.archive, "active");
    assert.equal(listed.sessions.find((session) => session.sessionId === created.sessionId), undefined);
    const abandonedList = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "--abandoned", "--json"], env }));
    assert.equal(abandonedList.archive, "abandoned");
    assert.equal(abandonedList.sessions.find((session) => session.sessionId === created.sessionId)?.archive, "abandoned");
    assert.match(await readFile(logPath, "utf8"), /gh issue close https:\/\/github\.com\/example\/repo\/issues\/999/);
  });
});

test("jskit session abandon fails if the related GitHub issue cannot be closed", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const binDir = path.join(cwd, "bin");
    const logPath = path.join(cwd, "commands.log");
    await createGitApp(appRoot);
    await installFakeCommand(
      binDir,
      "gh",
      `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(logPath)}, ["gh", ...args].join(" ") + "\\n");
if (args[0] === "auth" && args[1] === "status") process.exit(0);
if (args[0] === "issue" && args[1] === "close") {
  console.error("close failed");
  process.exit(1);
}
console.error("unexpected gh args", args.join(" "));
process.exit(1);
`
    );
    const env = {
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`
    };

    const created = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "create", "--json"], env }));
    const worktreePayload = parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--json"], env }));
    await writeFile(path.join(worktreePayload.sessionRoot, "issue_url"), "https://github.com/example/repo/issues/999\\n", "utf8");

    const abandoned = parseJsonFailure(runCli({ cwd: appRoot, args: ["session", created.sessionId, "abandon", "--json"], env }));
    assert.equal(abandoned.errors[0].code, "issue_close_failed");
    await access(path.join(appRoot, ".jskit", "sessions", "active", created.sessionId));
    await access(worktreePayload.worktree);
    await assert.rejects(access(path.join(appRoot, ".jskit", "sessions", "abandoned", created.sessionId)));
    assert.match(await readFile(logPath, "utf8"), /gh issue close https:\/\/github\.com\/example\/repo\/issues\/999/);
  });
});
