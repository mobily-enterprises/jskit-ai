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
  extractIssueText,
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
  if (withRemote) {
    const remoteRoot = path.join(path.dirname(root), "github.com", "example", "repo.git");
    runGit(path.dirname(root), ["init", "--bare", remoteRoot]);
    runGit(root, ["remote", "add", "origin", remoteRoot]);
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
if (args[0] === "pr" && args[1] === "merge") process.exit(0);
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
    assert.equal(payload.worktree, path.join(appRoot, ".jskit", "sessions", "worktrees", payload.sessionId));
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

    const worktreePayload = parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--json"] }));
    assert.equal(worktreePayload.currentStep, "issue_prompt_rendered");
    assert.equal(worktreePayload.currentStepAction.buttonLabel, "Render issue prompt");
    assert.equal(worktreePayload.currentStepAction.index, 2);
    assert.equal(worktreePayload.currentStepAction.input.name, "prompt");
    assert.equal(worktreePayload.nextCommand, `jskit session ${created.sessionId} step --prompt "<what should change>"`);

    const promptPayload = parseJsonResult(
      runCli({
        cwd: appRoot,
        args: ["session", created.sessionId, "step", "--prompt", "Add account recovery", "--json"]
      })
    );
    assert.equal(promptPayload.currentStep, "issue_drafted");
    assert.deepEqual(promptPayload.currentStepAction.input, {
      extract: "issue_text",
      formatHint: "markdown",
      label: "Approved issue text",
      multiline: true,
      name: "issue",
      required: true,
      type: "text"
    });
    assert.deepEqual(promptPayload.codex, {
      expectedOutput: {
        extract: "issue_text",
        field: "issue",
        formatHint: "markdown"
      },
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
    parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--json"] }));
    parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--prompt", "Fix missing state", "--json"] }));
    const payload = parseJsonFailure(runCli({
      cwd: appRoot,
      args: ["session", created.sessionId, "step", "--issue-file", "does-not-exist.md", "--json"]
    }));

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

test("issue text extraction accepts the codex issue_text wrapper", () => {
  assert.equal(
    extractIssueText("Before\n[issue_text]\n# Fix navigation\n\nMake it adaptive.\n[/issue_text]\nAfter"),
    "# Fix navigation\n\nMake it adaptive."
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
    const worktreePayload = parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--json"] }));
    assert.equal(worktreePayload.currentStep, "issue_prompt_rendered");
    await access(worktreePayload.worktree);

    const promptPayload = parseJsonResult(
      runCli({
        cwd: appRoot,
        args: ["session", created.sessionId, "step", "--prompt", "Add customer search", "--json"]
      })
    );
    assert.equal(promptPayload.status, "waiting_for_user");
    assert.equal(promptPayload.currentStep, "issue_drafted");
    assert.match(promptPayload.prompt, /Add customer search/);
    assert.match(promptPayload.prompt, /\[issue_text\]/);

    const failure = parseJsonFailure(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--json"] }));
    assert.equal(failure.ok, false);
    assert.equal(failure.errors[0].code, "issue_required");
  });
});

test("jskit session prompt rendering prefers project overrides", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot);

    const created = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "create", "--json"] }));
    parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--json"] }));
    await mkdir(path.join(appRoot, ".jskit", "sessions", "prompts"), { recursive: true });
    await writeFile(path.join(appRoot, ".jskit", "sessions", "prompts", "new_issue.md"), "Project prompt: {{user_input}} / {{session_id}}", "utf8");

    const promptPayload = parseJsonResult(
      runCli({
        cwd: appRoot,
        args: ["session", created.sessionId, "step", "--prompt", "Add invoices", "--json"]
      })
    );

    assert.equal(promptPayload.prompt, `Project prompt: Add invoices / ${created.sessionId}`);
  });
});

test("session details expose issue text, receipts, and passive transcript log for Studio", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    await createGitApp(appRoot);

    const created = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "create", "--json"] }));
    parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--json"] }));
    parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--prompt", "Fix details", "--json"] }));
    parseJsonResult(
      runCli({
        cwd: appRoot,
        args: ["session", created.sessionId, "step", "--issue", "[issue_text]# Fix details[/issue_text]", "--json"]
      })
    );
    await writeFile(path.join(created.sessionRoot, "transcript.log"), "manual transcript\n", "utf8");

    const details = await inspectSessionDetails({
      targetRoot: appRoot,
      sessionId: created.sessionId
    });

    assert.equal(details.ok, true);
    assert.equal(details.issueText, "# Fix details");
    assert.equal(details.transcriptLog, "manual transcript\n");
    assert.deepEqual(details.receipts.map((receipt) => receipt.stepId), [
      "session_created",
      "worktree_created",
      "issue_prompt_rendered",
      "issue_drafted"
    ]);

    const cliDetails = parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "--json"] }));
    assert.equal(cliDetails.issueText, "# Fix details");
    assert.equal(cliDetails.receipts.length, 4);
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
    parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--json"], env }));
    parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--prompt", "Fix filters", "--json"], env }));
    const issueDrafted = parseJsonResult(
      runCli({
        cwd: appRoot,
        args: ["session", created.sessionId, "step", "--issue", "-", "--json"],
        env,
        input: "# Fix filters\n\nMake filters useful."
      })
    );
    assert.equal(issueDrafted.currentStep, "issue_created");

    const issueCreated = parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--json"], env }));
    assert.equal(issueCreated.issueUrl, "https://github.com/example/repo/issues/123");
    assert.equal(issueCreated.currentStep, "implementation_prompt_rendered");
    assert.match(await readFile(logPath, "utf8"), /gh issue create --title Fix filters --body-file/);
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
    parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--json"], env }));
    parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--prompt", "Fix auth", "--json"], env }));
    parseJsonResult(
      runCli({
        cwd: appRoot,
        args: ["session", created.sessionId, "step", "--issue", "[issue_text]# Fix auth[/issue_text]", "--json"],
        env
      })
    );

    const failure = parseJsonFailure(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--json"], env }));
    assert.equal(failure.ok, false);
    assert.equal(failure.status, "blocked");
    assert.equal(failure.currentStep, "issue_created");
    assert.equal(failure.errors[0].code, "github_auth_missing");
    assert.deepEqual(
      Object.keys(failure).slice(0, 12),
      ["ok", "sessionId", "status", "currentStep", "completedSteps", "stepDefinitions", "currentStepAction", "codex", "prompt", "nextCommand", "issueUrl", "prUrl"]
    );
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
    parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--json"], env }));
    parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--prompt", "Fix", "--json"], env }));
    parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--issue", "# Fix", "--json"], env }));
    const missingOrigin = parseJsonFailure(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--json"], env }));
    assert.equal(missingOrigin.errors[0].code, "github_origin_missing");

    const manualRoot = path.join(cwd, "manual");
    await createGitApp(manualRoot);
    const manual = await createSession({ targetRoot: manualRoot });
    await writeStepReceipts(manual.sessionRoot, STEP_IDS.slice(0, 6));
    const missingWorktree = await runSessionStep({
      targetRoot: manualRoot,
      sessionId: manual.sessionId
    });
    assert.equal(missingWorktree.ok, false);
    assert.equal(missingWorktree.errors[0].code, "worktree_missing");

    const artifactsRoot = path.join(cwd, "artifacts");
    await createGitApp(artifactsRoot);
    const artifacts = await createSession({ targetRoot: artifactsRoot });
    await writeStepReceipts(artifacts.sessionRoot, STEP_IDS.slice(0, 5));
    const missingArtifacts = await runSessionStep({
      targetRoot: artifactsRoot,
      sessionId: artifacts.sessionId
    });
    assert.equal(missingArtifacts.ok, false);
    assert.equal(missingArtifacts.errors[0].code, "issue_artifacts_missing");

    const prRoot = path.join(cwd, "pr");
    await createGitApp(prRoot);
    const pr = await createSession({ targetRoot: prRoot });
    await writeStepReceipts(pr.sessionRoot, STEP_IDS.slice(0, 20));
    const missingPr = await runSessionStep({
      targetRoot: prRoot,
      sessionId: pr.sessionId
    });
    assert.equal(missingPr.ok, false);
    assert.equal(missingPr.errors[0].code, "pr_url_missing");
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
    parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--json"], env }));
    parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--prompt", "Add a page", "--json"], env }));
    parseJsonResult(
      runCli({
        cwd: appRoot,
        args: ["session", created.sessionId, "step", "--issue", "# Add a page", "--json"],
        env
      })
    );
    parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--json"], env }));
    parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--json"], env }));

    const inspect = parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "--json"], env }));
    await writeFile(path.join(inspect.worktree, "feature.txt"), "hello\\n", "utf8");
    parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--json"], env }));
    parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--json"], env }));

    for (const pass of [1, 2, 3]) {
      const review = parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--json"], env }));
      assert.match(review.prompt, new RegExp(`Review pass ${pass}`));
      parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--json"], env }));
      const check = parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--json"], env }));
      assert.match(check.prompt, new RegExp(`User check ${pass}`));
      parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--user-check", "passed", "--json"], env }));
    }

    parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--json"], env }));
    parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--json"], env }));
    const pr = parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--json"], env }));
    assert.equal(pr.prUrl, "https://github.com/example/repo/pull/456");
    parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--json"], env }));
    parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--json"], env }));
    const finished = parseJsonResult(runCli({ cwd: appRoot, args: ["session", created.sessionId, "step", "--json"], env }));

    assert.equal(finished.status, "finished");
    assert.equal(finished.currentStep, "");
    assert.equal(finished.archive, "completed");
    assert.equal(finished.sessionRoot, path.join(appRoot, ".jskit", "sessions", "completed", created.sessionId));
    await access(finished.sessionRoot);
    await assert.rejects(access(path.join(appRoot, ".jskit", "sessions", "active", created.sessionId)));
    const listed = parseJsonResult(runCli({ cwd: appRoot, args: ["session", "--json"], env }));
    assert.equal(listed.sessions.find((session) => session.sessionId === created.sessionId)?.archive, "completed");
    const log = await readFile(logPath, "utf8");
    assert.match(log, /npm run verify:local/);
    assert.match(log, /gh pr create/);
    assert.match(log, /gh pr merge https:\/\/github\.com\/example\/repo\/pull\/456 --merge --delete-branch/);
    assert.match(log, /gh issue comment https:\/\/github\.com\/example\/repo\/issues\/123 --body-file/);
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
    assert.match(await readFile(logPath, "utf8"), /gh issue close https:\/\/github\.com\/example\/repo\/issues\/999/);
  });
});
