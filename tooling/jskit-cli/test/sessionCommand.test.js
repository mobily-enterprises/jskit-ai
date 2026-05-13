import assert from "node:assert/strict";
import { chmod, mkdir, readFile, writeFile, access } from "node:fs/promises";
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
  extractIssueTitle,
  extractIssueText,
  extractPlanText,
  inspectSessionDetails,
  runSessionStep
} from "../src/server/sessionRuntime.js";
import {
  extractAppBlueprintText
} from "../src/server/appBlueprint.js";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
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
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function parseJsonFailure(result) {
  assert.notEqual(result.status, 0);
  return JSON.parse(result.stdout);
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

function advanceCliSessionToIssuePrompt(cwd, sessionId, { env = undefined } = {}) {
  const worktreePayload = runSessionStepJson(cwd, sessionId, { env });
  assert.equal(worktreePayload.currentStep, "dependencies_installed");
  assert.equal(worktreePayload.worktreeReady, true);
  const promptReadyPayload = runSessionStepJson(cwd, sessionId, { env });
  assert.equal(promptReadyPayload.currentStep, "issue_prompt_rendered");
  assert.equal(promptReadyPayload.currentStepAction.input.name, "prompt");
  return {
    promptReadyPayload,
    worktreePayload
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
  runGit(root, ["init"]);
  runGit(root, ["config", "user.name", "JSKIT Test"]);
  runGit(root, ["config", "user.email", "test@example.com"]);
  runGit(root, ["add", "package.json"]);
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

async function writeStepReceipts(sessionRoot, stepIds) {
  await mkdir(path.join(sessionRoot, "steps"), { recursive: true });
  for (const stepId of stepIds) {
    await writeFile(path.join(sessionRoot, "steps", stepId), `2026-05-11T00:00:00.000Z\n${stepId}\n`, "utf8");
  }
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
  console.log(JSON.stringify({ baseRefName: "main", state: "OPEN", mergedAt: "", url: args[2] }));
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
    assert.equal(payload.currentStep, "worktree_created");
    assert.deepEqual(payload.completedSteps, ["session_created"]);
    assert.deepEqual(payload.stepDefinitions.map((step) => step.id), STEP_IDS);
    assert.equal(payload.currentStepAction.stepId, "worktree_created");
    assert.equal(payload.currentStepAction.buttonLabel, "Create worktree");
    assert.equal(await readFile(path.join(appRoot, ".git", "info", "exclude"), "utf8").then((body) => body.includes(".jskit/sessions/")), true);
    assert.equal(await readFile(path.join(payload.sessionRoot, "steps", "session_created"), "utf8").then((body) => body.includes("Created JSKIT Studio issue session")), true);
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
    assert.deepEqual(created.stepDefinitions.map((step) => step.id), STEP_DEFINITIONS.map((step) => step.id));
    assert.deepEqual(created.stepDefinitions.map((step) => step.index), STEP_DEFINITIONS.map((_step, index) => index));
    assert.equal(created.stepDefinitions.find((step) => step.id === "issue_prompt_rendered").kind, "human_input");
    assert.deepEqual(created.stepDefinitions.find((step) => step.id === "issue_prompt_rendered").input, {
      label: "What should change?",
      multiline: true,
      name: "prompt",
      placeholder: "Describe the feature, bug, or change request.",
      required: true,
      type: "text"
    });
    assert.equal(Object.hasOwn(created.stepDefinitions[0], "preconditions"), false);
    assert.equal(created.codex, null);

    const { promptReadyPayload, worktreePayload } = advanceCliSessionToIssuePrompt(appRoot, created.sessionId);
    assert.equal(worktreePayload.currentStepAction.buttonLabel, "Install dependencies");
    assert.equal(promptReadyPayload.currentStepAction.buttonLabel, "Set initial prompt");
    assert.equal(promptReadyPayload.currentStepAction.index, 3);
    assert.equal(promptReadyPayload.currentStepAction.input.name, "prompt");
    assert.equal(promptReadyPayload.nextCommand, `jskit session ${created.sessionId} step --prompt "<what should change>"`);

    const promptPayload = runSessionStepJson(appRoot, created.sessionId, {
      args: ["--prompt", "Add account recovery"]
    });
    assert.equal(promptPayload.currentStep, "issue_drafted");
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
      expectedOutput: {
        extract: "issue_text",
        field: "issue",
        formatHint: "markdown",
        label: "Issue body",
        multiline: true,
        required: true
      },
      expectedOutputs: [
        {
          extract: "issue_title",
          field: "issueTitle",
          formatHint: "text",
          label: "Issue title",
          required: true
        },
        {
          extract: "issue_text",
          field: "issue",
          formatHint: "markdown",
          label: "Issue body",
          multiline: true,
          required: true
        }
      ],
      mode: "inject_prompt",
      promptField: "prompt"
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

test("app blueprint extraction accepts the codex app_blueprint wrapper", () => {
  assert.equal(
    extractAppBlueprintText("Before\n[app_blueprint]\n# App Blueprint\n\nBuild a field app.\n[/app_blueprint]\nAfter"),
    "# App Blueprint\n\nBuild a field app."
  );
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
});

test("jskit session step creates worktree and issue prompt", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot);

    const created = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "create", "--json"] }));
    const { promptReadyPayload, worktreePayload } = advanceCliSessionToIssuePrompt(appRoot, created.sessionId);
    assert.equal(promptReadyPayload.currentStep, "issue_prompt_rendered");
    await access(worktreePayload.worktree);

    const promptPayload = runSessionStepJson(appRoot, created.sessionId, {
      args: ["--prompt", "Add customer search"]
    });
    assert.equal(promptPayload.status, "waiting_for_user");
    assert.equal(promptPayload.currentStep, "issue_drafted");
    assert.match(promptPayload.prompt, /Add customer search/);
    assert.match(promptPayload.prompt, /This issue-drafting step is read-only/);
    assert.match(promptPayload.prompt, /Do not run `jskit session`/);
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

    assert.equal(promptPayload.prompt, `Project prompt: Add invoices / ${created.sessionId}`);
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
    assert.equal(issueDrafted.issueTitle, "Fix useful filters");
    assert.equal(issueDrafted.issueText, "Make filters useful.");

    const issueCreated = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(issueCreated.issueUrl, "https://github.com/example/repo/issues/123");
    assert.equal(issueCreated.currentStep, "plan_made");
    assert.equal(issueCreated.prompt, "");
    assert.equal(issueCreated.currentStepAction.buttonLabel, "Save plan");
    assert.match(await readFile(logPath, "utf8"), /gh issue create --title Fix useful filters --body-file/);

    const planPrompt = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(planPrompt.currentStep, "plan_made");
    assert.match(planPrompt.prompt, /Create an implementation plan/);
    assert.match(planPrompt.prompt, /\[plan\]/);
    assert.match(planPrompt.prompt, /https:\/\/github\.com\/example\/repo\/issues\/123/);
    assert.match(
      await readFile(path.join(planPrompt.sessionRoot, "prompts", "plan_request.md"), "utf8"),
      /Create an implementation plan/
    );

    const planMade = runSessionStepJson(appRoot, created.sessionId, {
      args: ["--plan", "[plan]\nInspect filters and update the UI.\n[/plan]"],
      env
    });
    assert.equal(planMade.currentStep, "plan_executed");
    assert.equal(planMade.currentStepAction.buttonLabel, "Get Codex to execute plan");
    assert.equal(planMade.planText, "Inspect filters and update the UI.");
    assert.ok(planMade.completedSteps.includes("plan_made"));
    assert.equal(planMade.prompt, "");
    assert.match(await readFile(path.join(planMade.sessionRoot, "plan.md"), "utf8"), /Inspect filters/);

    const executed = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(executed.currentStep, "plan_fine_tuning");
    assert.equal(executed.currentStepAction.buttonLabel, "Get Codex to fine tune plan");
    assert.equal(executed.codex.autoInject, true);
    assert.equal(executed.codex.promptActionLabel, "Get Codex to execute plan");
    assert.ok(executed.completedSteps.includes("plan_executed"));
    assert.match(executed.prompt, /Execute the approved implementation plan/);
    assert.match(
      await readFile(path.join(executed.sessionRoot, "prompts", "plan_execution.md"), "utf8"),
      /Execute the approved implementation plan/
    );

    const fineTuning = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(fineTuning.currentStep, "implementation_changes_accepted");
    assert.equal(fineTuning.currentStepAction.buttonLabel, "Accept changes");
    assert.equal(fineTuning.currentStepAction.utilityActions[0].kind, "diff");
    assert.equal(fineTuning.codex.autoInject, true);
    assert.equal(fineTuning.codex.promptActionLabel, "Get Codex to fine tune plan");
    assert.ok(fineTuning.completedSteps.includes("plan_fine_tuning"));
    assert.match(fineTuning.prompt, /Fine-tune the implementation/);
    assert.match(
      await readFile(path.join(fineTuning.sessionRoot, "prompts", "plan_fine_tuning.md"), "utf8"),
      /Fine-tune the implementation/
    );
    await assert.rejects(access(path.join(fineTuning.sessionRoot, "prompt.md")));
    assert.match(await readFile(logPath, "utf8"), /gh issue comment https:\/\/github\.com\/example\/repo\/issues\/123 --body-file/);
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
      args: ["--issue", "[issue_text]# Fix auth[/issue_text]"],
      env
    });

    const failure = runSessionStepJsonFailure(appRoot, created.sessionId, { env });
    assert.equal(failure.ok, false);
    assert.equal(failure.status, "blocked");
    assert.equal(failure.currentStep, "issue_created");
    assert.equal(failure.errors[0].code, "github_auth_missing");
    assert.deepEqual(
      Object.keys(failure).slice(0, 15),
      ["ok", "sessionId", "status", "currentStep", "completedSteps", "stepDefinitions", "currentStepAction", "codex", "prompt", "nextCommand", "issueUrl", "issueTitle", "issueText", "planText", "prUrl"]
    );
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
      args: ["--issue", "# Fix"],
      env
    });
    const missingOrigin = runSessionStepJsonFailure(appRoot, created.sessionId, { env });
    assert.equal(missingOrigin.errors[0].code, "github_origin_missing");

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

    const changesRoot = path.join(cwd, "changes");
    await createGitApp(changesRoot);
    const changes = await createSession({ targetRoot: changesRoot });
    await runSessionStep({
      targetRoot: changesRoot,
      sessionId: changes.sessionId
    });
    await writeStepReceipts(changes.sessionRoot, STEP_IDS.slice(0, STEP_IDS.indexOf("implementation_changes_accepted")));
    const missingChanges = await runSessionStep({
      targetRoot: changesRoot,
      sessionId: changes.sessionId
    });
    assert.equal(missingChanges.ok, false);
    assert.equal(missingChanges.errors[0].code, "changes_missing");

    const prRoot = path.join(cwd, "pr");
    await createGitApp(prRoot);
    const pr = await createSession({ targetRoot: prRoot });
    await runSessionStep({
      targetRoot: prRoot,
      sessionId: pr.sessionId
    });
    await writeStepReceipts(pr.sessionRoot, STEP_IDS.slice(0, STEP_IDS.indexOf("pr_merged")));
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

test("jskit session can execute review loop, doctor, PR, merge, cleanup, and finish", async () => {
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
      args: ["--issue", "# Add a page"],
      env
    });
    const issueCreated = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(issueCreated.currentStep, "plan_made");
    const planPrompt = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(planPrompt.currentStep, "plan_made");
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
    assert.equal(executed.currentStep, "plan_fine_tuning");
    assert.equal(executed.currentStepAction.buttonLabel, "Get Codex to fine tune plan");
    assert.equal(executed.codex.autoInject, true);
    assert.equal(executed.codex.promptActionLabel, "Get Codex to execute plan");
    assert.match(executed.prompt, /Execute the approved implementation plan/);
    assert.ok(executed.completedSteps.includes("plan_executed"));
    const fineTuning = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(fineTuning.currentStep, "implementation_changes_accepted");
    assert.equal(fineTuning.currentStepAction.buttonLabel, "Accept changes");
    assert.equal(fineTuning.codex.autoInject, true);
    assert.equal(fineTuning.codex.promptActionLabel, "Get Codex to fine tune plan");
    assert.match(fineTuning.prompt, /Fine-tune the implementation/);
    assert.ok(fineTuning.completedSteps.includes("plan_fine_tuning"));

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
    assert.equal(accepted.currentStep, "implementation_changes_committed");
    assert.equal(accepted.prompt, "");
    assert.ok(accepted.completedSteps.includes("implementation_changes_accepted"));
    const committed = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(committed.currentStep, "review_prompt_rendered");
    assert.equal(committed.prompt, "");
    assert.equal(committed.currentStepAction.buttonLabel, "Start review");
    assert.equal(committed.stepDefinitions.find((step) => step.id === "review_prompt_rendered").label, "Review execution");

    const review = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(review.currentStep, "review_changes_accepted");
    assert.equal(review.currentStepAction.buttonLabel, "Accept review changes");
    assert.equal(review.currentStepAction.utilityActions[0].kind, "diff");
    assert.equal(review.codex.autoInject, true);
    assert.equal(review.codex.promptActionLabel, "Start review");
    assert.match(review.prompt, /Review changes/);
    assert.match(
      await readFile(path.join(review.sessionRoot, "prompts", "review.md"), "utf8"),
      /Review changes/
    );
    const reviewAccepted = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(reviewAccepted.currentStep, "review_changes_committed");
    assert.ok(reviewAccepted.completedSteps.includes("review_changes_accepted"));
    const reviewCommitted = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(reviewCommitted.currentStep, "user_check_completed");
    assert.ok(reviewCommitted.completedSteps.includes("review_changes_committed"));
    const check = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(check.currentStep, "user_check_completed");
    assert.match(check.prompt, /User check/);
    runSessionStepJson(appRoot, created.sessionId, {
      args: ["--user-check", "passed"],
      env
    });

    runSessionStepJson(appRoot, created.sessionId, { env });
    const pr = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(pr.prUrl, "https://github.com/example/repo/pull/456");
    const helperMap = JSON.parse(await readFile(path.join(inspect.worktree, ".jskit", "helper-map.json"), "utf8"));
    assert.ok(helperMap.app.files.some((file) => {
      return file.path === "src/lib/formatFeatureTitle.js" &&
        file.exports.some((symbol) => symbol.name === "formatFeatureTitle");
    }));
    assert.match(runGit(inspect.worktree, ["log", "--oneline", "--max-count=3"]), /Update JSKIT helper map/);
    const merged = runSessionStepJson(appRoot, created.sessionId, { env });
    assert.equal(merged.currentStep, "session_finished");
    assert.equal(await readFile(path.join(appRoot, "feature.txt"), "utf8"), "hello\\n");
    assert.match(await readFile(path.join(appRoot, ".jskit", "helper-map.md"), "utf8"), /formatFeatureTitle/);
    await assert.rejects(access(inspect.worktree));
    const finished = runSessionStepJson(appRoot, created.sessionId, { env });

    assert.equal(finished.status, "finished");
    assert.equal(finished.currentStep, "");
    assert.equal(finished.archive, "completed");
    assert.equal(finished.sessionRoot, path.join(appRoot, ".jskit", "sessions", "completed", created.sessionId));
    await access(finished.sessionRoot);
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
    assert.match(log, /npm run verify:local/);
    assert.match(log, /gh pr create/);
    assert.match(log, /gh pr view https:\/\/github\.com\/example\/repo\/pull\/456 --json state,mergedAt,url,baseRefName/);
    assert.match(log, /gh pr merge https:\/\/github\.com\/example\/repo\/pull\/456 --merge --delete-branch/);
    assert.match(log, /gh issue comment https:\/\/github\.com\/example\/repo\/issues\/123 --body-file/);
  });
});

test("jskit session treats an already-merged PR as merged and removes the worktree", async () => {
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
      STEP_IDS.slice(0, STEP_IDS.indexOf("pr_merged"))
    );
    await writeFile(path.join(worktreePayload.sessionRoot, "issue_url"), "https://github.com/example/repo/issues/123\n", "utf8");
    await writeFile(path.join(worktreePayload.sessionRoot, "pr_url"), "https://github.com/example/repo/pull/456\n", "utf8");

    const merged = parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--json"], env }));
    assert.equal(merged.currentStep, "session_finished");
    assert.ok(merged.completedSteps.includes("pr_merged"));
    await assert.rejects(access(worktreePayload.worktree));
    const log = await readFile(logPath, "utf8");
    assert.match(log, /gh pr view https:\/\/github\.com\/example\/repo\/pull\/456 --json state,mergedAt,url,baseRefName/);
    assert.doesNotMatch(log, /gh pr merge/);
    assert.match(log, /gh issue close https:\/\/github\.com\/example\/repo\/issues\/123/);
  });
});

test("jskit session blocks PR merge cleanup when the target root is dirty", async () => {
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
      STEP_IDS.slice(0, STEP_IDS.indexOf("pr_merged"))
    );
    await writeFile(path.join(worktreePayload.sessionRoot, "issue_url"), "https://github.com/example/repo/issues/123\n", "utf8");
    await writeFile(path.join(worktreePayload.sessionRoot, "pr_url"), "https://github.com/example/repo/pull/456\n", "utf8");
    await writeFile(path.join(appRoot, "local-change.txt"), "dirty\n", "utf8");

    const blocked = parseJsonFailure(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--json"], env }));
    assert.equal(blocked.errors[0].code, "target_root_dirty");
    await access(worktreePayload.worktree);
    await assert.rejects(access(path.join(worktreePayload.sessionRoot, "steps", "pr_merged")));
    const log = await readFile(logPath, "utf8");
    assert.match(log, /gh pr view https:\/\/github\.com\/example\/repo\/pull\/456 --json state,mergedAt,url,baseRefName/);
    assert.doesNotMatch(log, /gh pr merge/);
    assert.doesNotMatch(log, /gh issue close/);
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
