import assert from "node:assert/strict";
import { access, chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createCliRunner } from "../../testUtils/runCli.js";
import { withTempDir } from "../../testUtils/tempDir.mjs";
import {
  SESSION_STATUS,
  STEP_DEFINITIONS,
  STEP_IDS,
  STEP_PRECONDITION_NAMES,
  adoptDependenciesInstalled,
  createSession,
  extractIssueText,
  extractIssueTitle,
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

function parseJsonResult(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function parseJsonFailure(result) {
  assert.notEqual(result.status, 0);
  return JSON.parse(result.stdout);
}

function runSessionStepJson(cwd, sessionId, {
  args = [],
  env = {},
  input = undefined
} = {}) {
  return parseJsonResult(runCli({
    cwd,
    args: ["session", sessionId, "step", ...args, "--json"],
    env,
    input
  }));
}

function runSessionCommandJson(cwd, sessionId, subcommand, {
  args = [],
  env = {},
  input = undefined
} = {}) {
  return parseJsonResult(runCli({
    cwd,
    args: ["session", sessionId, subcommand, ...args, "--json"],
    env,
    input
  }));
}

function runSessionStepJsonFailure(cwd, sessionId, {
  args = [],
  env = {},
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
  env = {}
} = {}) {
  return parseJsonResult(runCli({
    cwd,
    args: ["session", sessionId, "rewind", "--step", stepId, "--json"],
    env
  }));
}

function rewindSessionJsonFailure(cwd, sessionId, stepId, {
  env = {}
} = {}) {
  return parseJsonFailure(runCli({
    cwd,
    args: ["session", sessionId, "rewind", "--step", stepId, "--json"],
    env
  }));
}

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

async function installFakeNpm(binDir, logPath) {
  await installFakeCommand(
    binDir,
    "npm",
    `#!/usr/bin/env node
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(logPath)}, ["npm", ...args].join(" ") + "\\n");
if (args[0] === "run") {
  const scriptName = args.slice(1).find((arg) => !arg.startsWith("-"));
  if (!scriptName) process.exit(1);
  const packageJsonPath = path.join(process.cwd(), "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const script = packageJson.scripts && packageJson.scripts[scriptName];
  if (!script) process.exit(1);
  const result = childProcess.spawnSync(script, {
    cwd: process.cwd(),
    env: process.env,
    shell: true,
    stdio: "inherit"
  });
  process.exit(result.status || 0);
}
process.exit(0);
`
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
if (args[0] === "pr" && args[1] === "comment") process.exit(0);
if (args[0] === "pr" && args[1] === "view") {
  const explicitUrl = args[2] && !args[2].startsWith("--") ? args[2] : "";
  const existingUrl = process.env.FAKE_GH_EXISTING_PR_URL || "";
  const url = explicitUrl || existingUrl;
  if (!url) {
    console.error("no pull request found for current branch");
    process.exit(1);
  }
  console.log(JSON.stringify({
    baseRefName: "main",
    mergedAt: "",
    state: process.env.FAKE_GH_PR_STATE || "OPEN",
    url
  }));
  process.exit(0);
}
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

async function installFakeTooling(root) {
  const binDir = path.join(root, "bin");
  const logPath = path.join(root, "commands.log");
  await mkdir(binDir, { recursive: true });
  await installFakeNpm(binDir, logPath);
  await installFakeGh(binDir, logPath);
  return {
    env: {
      PATH: `${binDir}:${process.env.PATH}`
    },
    logPath
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
  for (const stepId of stepIds) {
    await writeFile(path.join(sessionRoot, "steps", stepId), `2026-05-11T00:00:00.000Z\n${stepId}\n`, "utf8");
  }
}

async function advanceToIssuePrompt(appRoot, sessionId, env = {}) {
  const worktreePayload = runSessionStepJson(appRoot, sessionId, { env });
  assert.equal(worktreePayload.currentStep, "dependencies_installed");
  assert.equal(worktreePayload.worktreeReady, true);
  const dependenciesPayload = runSessionStepJson(appRoot, sessionId, { env });
  assert.equal(dependenciesPayload.currentStep, "issue_prompt_rendered");
  assert.equal(dependenciesPayload.dependencyInstall.status, "installed");
  return dependenciesPayload;
}

async function advanceToIssueDraft(appRoot, sessionId, env = {}) {
  await advanceToIssuePrompt(appRoot, sessionId, env);
  const issuePrompt = runSessionStepJson(appRoot, sessionId, {
    args: ["--prompt", "Add account recovery"],
    env
  });
  assert.equal(issuePrompt.currentStep, "issue_drafted");
  assert.match(issuePrompt.prompt, /issue\.md/);
  assert.doesNotMatch(issuePrompt.prompt, /agent_decisions|issue_details|plan\.md/u);
  return issuePrompt;
}

async function writeIssueDraft(sessionRoot, {
  body = "# Add account recovery\n\nUsers need password reset.",
  title = "Add account recovery"
} = {}) {
  await writeFile(path.join(sessionRoot, "issue.md"), `${body}\n`, "utf8");
  await writeFile(path.join(sessionRoot, "issue_title"), `${title}\n`, "utf8");
}

async function advanceToPlanMade(appRoot, sessionId, env = {}) {
  const issueDraft = await advanceToIssueDraft(appRoot, sessionId, env);
  await writeIssueDraft(issueDraft.sessionRoot);
  const drafted = runSessionCommandJson(appRoot, sessionId, "next", { env });
  assert.equal(drafted.currentStep, "issue_created");
  const issueCreated = runSessionCommandJson(appRoot, sessionId, "next", { env });
  assert.equal(issueCreated.currentStep, "plan_made");
  return issueCreated;
}

async function advanceToStepWithSkips(appRoot, sessionId, targetStepId, env = {}) {
  let current = parseJsonResult(runCli({
    cwd: appRoot,
    args: ["session", sessionId, "--json"],
    env
  }));
  if (STEP_IDS.indexOf(targetStepId) > STEP_IDS.indexOf("issue_prompt_rendered") &&
    STEP_IDS.indexOf(current.currentStep) <= STEP_IDS.indexOf("issue_prompt_rendered")) {
    current = await advanceToIssuePrompt(appRoot, sessionId, env);
  }
  while (current.currentStep && current.currentStep !== targetStepId) {
    current = runSessionCommandJson(appRoot, sessionId, "skip", {
      args: ["--skip-reason", `Test skip ${current.currentStep}`],
      env
    });
  }
  assert.equal(current.currentStep, targetStepId);
  return current;
}

function assertNoOldContract(payload) {
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /agentDecisions|agent_decisions|issue_details|issueDetails|planText|plan\.md|responseContract|codex_output|issue_metadata|issueMetadata/u);
}

test("jskit session create writes simple file-backed state", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot);

    const payload = parseJsonResult(runCli({
      cwd: appRoot,
      args: ["session", "create", "--json"]
    }));

    assert.equal(payload.ok, true);
    assert.match(payload.sessionId, /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/u);
    assert.equal(payload.workflowVersion, "7");
    assert.equal(payload.currentStep, "worktree_created");
    assert.deepEqual(payload.completedSteps, ["session_created"]);
    assert.deepEqual(payload.stepDefinitions.map((step) => step.id), STEP_IDS);
    assert.equal(await readFile(path.join(payload.sessionRoot, "workflow_version"), "utf8"), "7\n");
    assert.equal(await readFile(path.join(payload.sessionRoot, "active_cycle"), "utf8"), "001\n");
    assert.equal(await readFile(path.join(appRoot, ".git", "info", "exclude"), "utf8").then((body) => body.includes(".jskit/sessions/")), true);
    assertNoOldContract(payload);
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

test("session step definitions expose manual prompt workflow without output contracts", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot);

    const created = parseJsonResult(runCli({
      cwd: appRoot,
      args: ["session", "create", "--json"]
    }));

    assert.equal(created.stepDefinitions.some((step) => step.id === "issue_details_gathered"), false);
    assert.equal(created.stepDefinitions.some((step) => step.kind === "codex_output"), false);
    assert.deepEqual(created.stepDefinitions.map((step) => step.id), STEP_DEFINITIONS.map((step) => step.id));
    assert.equal(created.stepDefinitions.find((step) => step.id === "issue_drafted").automation.mode, "codex_prompt");
    assert.equal(created.stepDefinitions.find((step) => step.id === "plan_made").automation.mode, "codex_prompt");
    assert.equal(created.stepDefinitions.find((step) => step.id === "plan_executed").automation.mode, "codex_prompt");
    assert.equal(created.stepDefinitions.find((step) => step.id === "review_changes_accepted").kind, "user_check");
    assert.equal(created.stepDefinitions.find((step) => step.id === "blueprint_updated").kind, "codex_prompt");
    assertNoOldContract(created.stepDefinitions);
    assertNoOldContract(created.codex);
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
    const { env } = await installFakeTooling(cwd);
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
    const worktreePayload = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(worktreePayload.currentStep, "dependencies_installed");
    const installed = runSessionStepJson(appRoot, created.sessionId, { env });

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
  });
});

test("jskit session runs the optional provisioning package script when terminal dependencies are adopted", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot);
    const { env } = await installFakeTooling(cwd);
    await mkdir(path.join(appRoot, "scripts"), { recursive: true });
    await writeFile(
      path.join(appRoot, "scripts", "provision-session.mjs"),
      `import { writeFileSync } from "node:fs";
import path from "node:path";

writeFileSync(path.join(process.env.JSKIT_SESSION_ROOT, "adopt-provision-env.json"), JSON.stringify({
  cwd: process.cwd(),
  packageScript: process.env.JSKIT_SESSION_PACKAGE_SCRIPT,
  sessionId: process.env.JSKIT_SESSION_ID,
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
    const worktreePayload = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(worktreePayload.currentStep, "dependencies_installed");

    const adopted = await adoptDependenciesInstalled({
      targetRoot: appRoot,
      sessionId: created.sessionId,
      message: "Adopted terminal install."
    });

    assert.equal(adopted.currentStep, "issue_prompt_rendered");
    assert.ok(adopted.completedSteps.includes("dependencies_installed"));
    const provisionEnv = JSON.parse(await readFile(path.join(created.sessionRoot, "adopt-provision-env.json"), "utf8"));
    assert.equal(provisionEnv.cwd, adopted.worktree);
    assert.equal(provisionEnv.packageScript, "jskit:provision-session");
    assert.equal(provisionEnv.sessionId, created.sessionId);
    assert.equal(provisionEnv.targetRoot, appRoot);
    assert.equal(provisionEnv.worktreeRoot, adopted.worktree);
  });
});

test("issue drafting and planning use issue files and terminal-only plan state", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot, { withRemote: true });
    const { env, logPath } = await installFakeTooling(cwd);

    const created = parseJsonResult(runCli({
      cwd: appRoot,
      args: ["session", "create", "--json"]
    }));
    const issueDraft = await advanceToIssueDraft(appRoot, created.sessionId, env);
    await writeIssueDraft(issueDraft.sessionRoot);

    const drafted = runSessionCommandJson(appRoot, created.sessionId, "next", { env });
    assert.equal(drafted.currentStep, "issue_created");
    assert.equal(drafted.issueTitle, "Add account recovery");
    assert.match(drafted.issueText, /Users need password reset/u);

    const issueCreated = runSessionCommandJson(appRoot, created.sessionId, "next", { env });
    assert.equal(issueCreated.currentStep, "plan_made");
    assert.equal(issueCreated.issueUrl, "https://github.com/example/repo/issues/123");
    await assert.rejects(access(path.join(issueCreated.sessionRoot, "issue_metadata.json")));
    assert.match(await readFile(logPath, "utf8"), /gh issue create/u);

    const planPrompt = runSessionCommandJson(appRoot, created.sessionId, "next", { env });
    assert.equal(planPrompt.currentStep, "plan_made");
    assert.equal(planPrompt.status, SESSION_STATUS.WAITING_FOR_USER);
    assert.match(planPrompt.prompt, /Present the final plan/u);
    assert.doesNotMatch(planPrompt.prompt, /plan\.md|agent_decisions|issue_details/u);

    const planRecorded = runSessionCommandJson(appRoot, created.sessionId, "next", { env });
    assert.equal(planRecorded.currentStep, "plan_executed");
    assert.ok(planRecorded.completedSteps.includes("plan_made"));
    await assert.rejects(access(path.join(planRecorded.sessionRoot, "plan.md")));
    assertNoOldContract(planRecorded);
  });
});

test("plan execution sends one prompt and records completion on the next run", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot, { withRemote: true });
    const { env } = await installFakeTooling(cwd);

    const created = parseJsonResult(runCli({
      cwd: appRoot,
      args: ["session", "create", "--json"]
    }));
    await advanceToPlanMade(appRoot, created.sessionId, env);
    const planPrompt = runSessionCommandJson(appRoot, created.sessionId, "next", { env });
    assert.equal(planPrompt.status, SESSION_STATUS.WAITING_FOR_USER);
    const planRecorded = runSessionCommandJson(appRoot, created.sessionId, "next", { env });
    assert.equal(planRecorded.currentStep, "plan_executed");
    const executionPrompt = runSessionCommandJson(appRoot, created.sessionId, "next", { env });
    assert.equal(executionPrompt.currentStep, "plan_executed");
    assert.equal(executionPrompt.status, SESSION_STATUS.WAITING_FOR_USER);
    assert.match(executionPrompt.prompt, /Execute the approved implementation plan/u);
    assert.doesNotMatch(executionPrompt.prompt, /plan\.md|agent_decisions|issue_details/u);

    const executionRecorded = runSessionCommandJson(appRoot, created.sessionId, "next", { env });
    assert.equal(executionRecorded.currentStep, "deep_ui_check_run");
    assert.ok(executionRecorded.completedSteps.includes("plan_executed"));
  });
});

test("skip and rewind keep the simplified session artifacts deterministic", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot);
    const { env } = await installFakeTooling(cwd);

    const created = parseJsonResult(runCli({
      cwd: appRoot,
      args: ["session", "create", "--json"]
    }));
    await advanceToIssueDraft(appRoot, created.sessionId, env);

    const skippedDraft = runSessionCommandJson(appRoot, created.sessionId, "skip", {
      args: ["--skip-reason", "No issue needed."],
      env
    });
    assert.equal(skippedDraft.currentStep, "issue_created");
    assert.match(await readFile(path.join(skippedDraft.sessionRoot, "issue.md"), "utf8"), /No issue needed/u);

    const skippedIssue = runSessionCommandJson(appRoot, created.sessionId, "skip", {
      args: ["--skip-reason", "Local-only test."],
      env
    });
    assert.equal(skippedIssue.currentStep, "plan_made");
    assert.equal(skippedIssue.issueUrl, `skipped://${created.sessionId}/issue`);
    await assert.rejects(access(path.join(skippedIssue.sessionRoot, "issue_metadata.json")));

    const rewound = rewindSessionJson(appRoot, created.sessionId, "issue_drafted", { env });
    assert.equal(rewound.currentStep, "issue_drafted");
    assert.deepEqual(rewound.completedSteps, [
      "session_created",
      "worktree_created",
      "dependencies_installed",
      "issue_prompt_rendered"
    ]);
    await assert.rejects(access(path.join(rewound.sessionRoot, "issue.md")));
    await assert.rejects(access(path.join(rewound.sessionRoot, "issue_title")));
    await assert.rejects(access(path.join(rewound.sessionRoot, "issue_url")));
  });
});

test("rewind rejects disallowed, incomplete, and closed targets without mutation", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot);
    const { env } = await installFakeTooling(cwd);

    const created = parseJsonResult(runCli({
      cwd: appRoot,
      args: ["session", "create", "--json"]
    }));
    await advanceToIssuePrompt(appRoot, created.sessionId, env);
    await writeStepReceipts(created.sessionRoot, ["plan_made", "plan_executed"]);

    const disallowed = rewindSessionJsonFailure(appRoot, created.sessionId, "worktree_created", { env });
    assert.equal(disallowed.errors[0].code, "rewind_step_not_allowed");
    assert.equal(await readFile(path.join(created.sessionRoot, "steps", "plan_executed"), "utf8").then((body) => body.includes("plan_executed")), true);

    const incomplete = rewindSessionJsonFailure(appRoot, created.sessionId, "issue_created", { env });
    assert.equal(incomplete.errors[0].code, "rewind_step_not_completed");

    await writeFile(path.join(created.sessionRoot, "status"), "finished\n", "utf8");
    const closed = rewindSessionJsonFailure(appRoot, created.sessionId, "dependencies_installed", { env });
    assert.equal(closed.errors[0].code, "session_closed_read_only");
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

test("tagged issue extraction uses the latest complete marker pair", () => {
  assert.equal(
    extractIssueTitle("Before\n[issue_title]\nFirst\n[/issue_title]\n[issue_title]\nSecond\n[/issue_title]"),
    "Second"
  );
  assert.equal(
    extractIssueText("Before\n[issue_text]\nFirst body\n[/issue_text]\n[issue_text]\nSecond body\n[/issue_text]"),
    "Second body"
  );
  assert.equal(extractIssueText("Plain issue body."), "Plain issue body.");
});

test("app blueprint extraction accepts the app_blueprint wrapper", () => {
  assert.equal(
    extractAppBlueprintText("Before\n[app_blueprint]\nDurable facts.\n[/app_blueprint]\nAfter"),
    "Durable facts."
  );
});

test("every executable session step declares named preconditions", () => {
  const missing = STEP_IDS.filter((stepId) => {
    return stepId !== "session_created" && !Array.isArray(STEP_PRECONDITION_NAMES[stepId]);
  });
  assert.deepEqual(missing, []);
  assert.equal(STEP_IDS.some((stepId) => /^\d+_/u.test(stepId)), false);
});

test("session prompts reference canonical artifacts and avoid old output contracts", async () => {
  const entries = await readdir(PROMPT_ROOT);
  const prompts = Object.fromEntries(await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".md"))
      .map(async (entry) => [entry, await readFile(path.join(PROMPT_ROOT, entry), "utf8")])
  ));

  assert.ok(Object.hasOwn(prompts, "issue_drafted.md"));
  assert.ok(Object.hasOwn(prompts, "plan_made.md"));
  assert.ok(Object.hasOwn(prompts, "plan_executed.md"));
  assert.ok(Object.hasOwn(prompts, "review_prompt_rendered.md"));
  assert.ok(Object.hasOwn(prompts, "review_changes_accepted_resolve.md"));
  assert.equal(Object.hasOwn(prompts, "issue_details.md"), false);
  assert.match(prompts["issue_drafted.md"], /Canonical issue file/u);
  assert.match(prompts["issue_drafted.md"], /Canonical issue title file/u);
  assert.match(prompts["plan_made.md"], /terminal/u);
  assert.match(prompts["plan_executed.md"], /Codex conversation/u);
  for (const [fileName, body] of Object.entries(prompts)) {
    assert.doesNotMatch(body, /agent_decisions|issue_details|plan\.md|\[plan\]|\[\/plan\]|response contract/u, fileName);
  }
});

test("session details expose issue text, step records, and passive transcript log", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot);
    const { env } = await installFakeTooling(cwd);

    const created = parseJsonResult(runCli({
      cwd: appRoot,
      args: ["session", "create", "--json"]
    }));
    const issueDraft = await advanceToIssueDraft(appRoot, created.sessionId, env);
    await writeIssueDraft(issueDraft.sessionRoot, {
      body: "# Useful filters\n\nFilter the list.",
      title: "Useful filters"
    });
    await writeFile(path.join(issueDraft.sessionRoot, "transcript.log"), "Terminal output.\n", "utf8");
    runSessionCommandJson(appRoot, created.sessionId, "next", { env });

    const details = await inspectSessionDetails({
      targetRoot: appRoot,
      sessionId: created.sessionId
    });
    assert.equal(details.issueTitle, "Useful filters");
    assert.match(details.issueText, /Filter the list/u);
    assert.match(details.transcriptLog, /Terminal output/u);
    assert.ok(details.stepRecords.some((record) => record.stepId === "issue_drafted"));
    assertNoOldContract(details);
  });
});

test("failed user check stays on user check and passed user check advances", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot);
    const { env } = await installFakeTooling(cwd);

    const created = parseJsonResult(runCli({
      cwd: appRoot,
      args: ["session", "create", "--json"]
    }));
    await advanceToStepWithSkips(appRoot, created.sessionId, "user_check_completed", env);

    const failed = runSessionStepJson(appRoot, created.sessionId, {
      args: ["--user-check", "failed"],
      env
    });
    assert.equal(failed.currentStep, "user_check_completed");
    assert.equal(failed.warnings[0].code, "user_check_failed");

    const passed = runSessionStepJson(appRoot, created.sessionId, {
      args: ["--user-check", "passed"],
      env
    });
    assert.equal(passed.currentStep, "blueprint_updated");
    assert.ok(passed.completedSteps.includes("user_check_completed"));
  });
});

test("automated checks render a Codex prompt and record completion on the next run", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot);
    const { env } = await installFakeTooling(cwd);

    const created = parseJsonResult(runCli({
      cwd: appRoot,
      args: ["session", "create", "--json"]
    }));
    await advanceToStepWithSkips(appRoot, created.sessionId, "automated_checks_run", env);

    const prompt = runSessionCommandJson(appRoot, created.sessionId, "next", { env });
    assert.equal(prompt.currentStep, "automated_checks_run");
    assert.equal(prompt.status, SESSION_STATUS.WAITING_FOR_USER);
    assert.match(prompt.prompt, /Run automated checks/u);

    const completed = runSessionCommandJson(appRoot, created.sessionId, "next", { env });
    assert.equal(completed.currentStep, "user_check_completed");
    assert.equal(completed.checks[0].status, "completed_by_codex");
  });
});

test("blueprint update renders a Codex prompt then records the edited blueprint", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot);
    const { env } = await installFakeTooling(cwd);

    const created = parseJsonResult(runCli({
      cwd: appRoot,
      args: ["session", "create", "--json"]
    }));
    const blueprintStep = await advanceToStepWithSkips(appRoot, created.sessionId, "blueprint_updated", env);

    const prompt = runSessionCommandJson(appRoot, created.sessionId, "next", { env });
    assert.equal(prompt.currentStep, "blueprint_updated");
    assert.equal(prompt.status, SESSION_STATUS.WAITING_FOR_USER);
    assert.match(prompt.prompt, /APP_BLUEPRINT\.md/u);

    await mkdir(path.join(blueprintStep.worktree, ".jskit"), { recursive: true });
    await writeFile(path.join(blueprintStep.worktree, ".jskit", "APP_BLUEPRINT.md"), "Durable memory.\n", "utf8");
    const recorded = runSessionCommandJson(appRoot, created.sessionId, "next", { env });
    assert.equal(recorded.currentStep, "changes_committed");
    assert.ok(recorded.completedSteps.includes("blueprint_updated"));
  });
});

test("no-op accepted changes can continue with a warning instead of a hard block", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot);
    const { env } = await installFakeTooling(cwd);

    const created = parseJsonResult(runCli({
      cwd: appRoot,
      args: ["session", "create", "--json"]
    }));
    await advanceToStepWithSkips(appRoot, created.sessionId, "changes_committed", env);

    const committed = runSessionCommandJson(appRoot, created.sessionId, "next", { env });
    assert.equal(committed.currentStep, "final_report_created");
    assert.equal(committed.warnings[0].code, "accepted_changes_noop");
    const commitInfo = JSON.parse(await readFile(path.join(committed.sessionRoot, "changes_committed.json"), "utf8"));
    assert.equal(commitInfo.noChanges, true);
  });
});

test("final report is deterministic and comments once on the issue", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot, { withRemote: true });
    const { env, logPath } = await installFakeTooling(cwd);

    const created = parseJsonResult(runCli({
      cwd: appRoot,
      args: ["session", "create", "--json"]
    }));
    const finalReportStep = await advanceToStepWithSkips(appRoot, created.sessionId, "final_report_created", env);
    const finalReport = runSessionCommandJson(appRoot, created.sessionId, "next", { env });
    assert.equal(finalReport.currentStep, "pr_created");
    assert.match(finalReport.finalReportText, /# Final Report/u);
    assert.match(finalReport.finalReportText, /## Checks/u);
    assert.equal(finalReport.githubComments.final_report.purpose, "final_report");
    assert.match(await readFile(logPath, "utf8"), /gh issue comment/u);

    const commentCountBefore = ((await readFile(logPath, "utf8")).match(/gh issue comment/gu))?.length || 0;
    await rewindSession({
      targetRoot: appRoot,
      sessionId: created.sessionId,
      stepId: "final_report_created"
    });
    await writeStepReceipts(finalReportStep.sessionRoot, STEP_IDS.slice(0, STEP_IDS.indexOf("final_report_created")));
    const repeated = runSessionCommandJson(appRoot, created.sessionId, "next", { env });
    assert.equal(repeated.githubComments.final_report.purpose, "final_report");
    const commentCountAfter = ((await readFile(logPath, "utf8")).match(/gh issue comment/gu))?.length || 0;
    assert.equal(commentCountAfter, commentCountBefore + 1);
  });
});

test("PR finalization guard blocks protected sibling changes before merge decisions", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot);
    const { env } = await installFakeTooling(cwd);
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
    const prFinalizedStep = await advanceToStepWithSkips(appRoot, created.sessionId, "pr_finalized", env);
    await access(path.join(prFinalizedStep.worktree, "scripts", "finalization-guard.mjs"));
    await writeFile(path.join(prFinalizedStep.sessionRoot, "pr_url"), "https://github.com/example/repo/pull/456\n", "utf8");

    const result = runCli({
      cwd: appRoot,
      args: ["session", created.sessionId, "step", "--merge-pr", "true", "--json"],
      env
    });
    const blocked = JSON.parse(result.stdout);
    assert.equal(blocked.ok, false, JSON.stringify(blocked, null, 2));
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.equal(blocked.errors[0].code, "session_finalization_guard_failed");
    assert.match(blocked.errors[0].message, /unpreserved changes/u);
    await assert.rejects(access(path.join(prFinalizedStep.sessionRoot, "steps", "pr_finalized")));
  });
});
