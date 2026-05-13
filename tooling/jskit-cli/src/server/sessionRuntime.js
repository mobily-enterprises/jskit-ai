import {
  mkdir,
  readFile,
  readdir,
  rmdir
} from "node:fs/promises";
import path from "node:path";
import {
  PLAN_EXECUTION_CODEX_HANDOFF,
  PLAN_FINE_TUNING_CODEX_HANDOFF,
  REVIEW_EXECUTION_CODEX_HANDOFF,
  SESSION_STATUS,
  STEP_DEFINITIONS,
  STEP_IDS,
  STEP_PRECONDITION_NAMES
} from "./sessionRuntime/constants.js";
import {
  normalizeText,
  readTextIfExists,
  readTrimmedFile,
  runCommand,
  runGit,
  runGitInWorktree,
  timestampForReceipt,
  writeTextFile
} from "./sessionRuntime/io.js";
import {
  archiveSession,
  createAvailableSessionId,
  createSessionId,
  isValidSessionId,
  resolveExistingSessionRoot,
  resolveSessionPaths,
  pathsForExistingSession
} from "./sessionRuntime/paths.js";
import {
  buildSessionErrorResponse,
  buildSessionResponse,
  buildStepDefinitions,
  createError,
  failSession,
  markCurrentStep,
  markStatus,
  readReceiptSteps,
  readSessionArtifacts,
  writeReceipt
} from "./sessionRuntime/responses.js";
import {
  applyPreconditions,
  assertGhAuth,
  assertGitCurrentBranch,
  assertGitRepository,
  assertGithubOrigin,
  assertIssueTextExists,
  assertIssueUrlExists,
  assertPlanTextExists,
  assertPrUrlExists,
  assertSessionExists,
  assertTargetRootWritable,
  assertWorktreeExists,
  ensureStudioGitExclude,
  hasWorktree
} from "./sessionRuntime/preconditions.js";
import {
  renderPrompt,
  renderTemplate
} from "./sessionRuntime/promptRenderer.js";
import {
  HELPER_MAP_JSON_RELATIVE_PATH,
  HELPER_MAP_MARKDOWN_RELATIVE_PATH
} from "./helperMapPaths.js";

function invalidSessionIdError(sessionId = "") {
  return createError({
    code: "invalid_session_id",
    message: `Invalid session id "${sessionId}". Expected YYYY-MM-DD_HH-MM-SS.`
  });
}

function invalidSessionIdResponse({
  targetRoot,
  sessionId
}) {
  return buildSessionErrorResponse({
    targetRoot,
    sessionId,
    errors: [invalidSessionIdError(sessionId)]
  });
}

async function existingSessionContext({
  targetRoot = process.cwd(),
  sessionId
} = {}) {
  if (!isValidSessionId(sessionId)) {
    return {
      ok: false,
      response: invalidSessionIdResponse({ targetRoot, sessionId })
    };
  }

  const paths = await pathsForExistingSession(resolveSessionPaths({ targetRoot, sessionId }));
  const preconditions = await applyPreconditions(paths, [
    () => assertSessionExists(paths)
  ]);
  if (!preconditions.ok) {
    return {
      ok: false,
      response: await failSession(paths, {
        ...preconditions.error,
        preconditions: preconditions.preconditions
      })
    };
  }

  return {
    ok: true,
    paths,
    preconditions: preconditions.preconditions
  };
}

async function withExistingSession(input, handler) {
  const context = await existingSessionContext(input);
  if (!context.ok) {
    return context.response;
  }
  return handler(context.paths, {
    preconditions: context.preconditions
  });
}

function extractMarkedText(value = "", marker = "") {
  const text = normalizeText(value);
  const normalizedMarker = normalizeText(marker);
  if (!normalizedMarker) {
    return "";
  }
  const pattern = new RegExp(`\\[${normalizedMarker}\\]([\\s\\S]*?)\\[/${normalizedMarker}\\]`, "u");
  const match = pattern.exec(text);
  return normalizeText(match ? match[1] : "");
}

function extractIssueTitle(value = "") {
  return extractMarkedText(value, "issue_title");
}

function extractIssueText(value = "") {
  return extractMarkedText(value, "issue_text") || normalizeText(value);
}

function extractPlanText(value = "") {
  return extractMarkedText(value, "plan") || normalizeText(value);
}

async function writePromptArtifact(paths, fileName, prompt) {
  await writeTextFile(path.join(paths.sessionRoot, "prompts", fileName), prompt);
}

async function createSession({
  targetRoot = process.cwd(),
  sessionId = "",
  now = new Date()
} = {}) {
  if (sessionId && !isValidSessionId(sessionId)) {
    return invalidSessionIdResponse({ targetRoot, sessionId });
  }
  const initialPaths = resolveSessionPaths({
    targetRoot,
    sessionId: sessionId || await createAvailableSessionId(targetRoot, now)
  });
  const existingSession = await resolveExistingSessionRoot(initialPaths);
  if (existingSession.root) {
    return failSession(initialPaths, {
      code: "session_exists",
      message: `Session already exists: ${initialPaths.sessionId}`,
      status: SESSION_STATUS.BLOCKED
    });
  }

  const preconditions = await applyPreconditions(initialPaths, [
    () => assertTargetRootWritable(initialPaths.targetRoot),
    () => assertGitRepository(initialPaths.targetRoot)
  ]);
  if (!preconditions.ok) {
    return failSession(initialPaths, {
      ...preconditions.error,
      preconditions: preconditions.preconditions
    });
  }

  await ensureStudioGitExclude(initialPaths.targetRoot);
  await mkdir(initialPaths.sessionRoot, { recursive: true });
  await writeTextFile(path.join(initialPaths.sessionRoot, "transcript.log"), "");
  await markStatus(initialPaths, SESSION_STATUS.PENDING);
  await writeReceipt(initialPaths, "session_created", `Created JSKIT Studio issue session ${initialPaths.sessionId}.`);

  return buildSessionResponse(initialPaths, {
    ok: true,
    preconditions: preconditions.preconditions
  });
}

const SESSION_ARCHIVE_ROOTS = Object.freeze([
  "active",
  "completed",
  "abandoned"
]);

function normalizeArchiveFilter(archive = "active") {
  const requestedArchives = Array.isArray(archive) ? archive : [archive];
  const normalized = requestedArchives
    .map((entry) => String(entry || "").trim().toLowerCase())
    .filter(Boolean);
  if (normalized.includes("all")) {
    return SESSION_ARCHIVE_ROOTS;
  }
  const allowed = new Set(SESSION_ARCHIVE_ROOTS);
  const selected = normalized.filter((entry) => allowed.has(entry));
  return selected.length > 0 ? [...new Set(selected)] : ["active"];
}

async function listSessions({ targetRoot = process.cwd(), archive = "active" } = {}) {
  const paths = resolveSessionPaths({ targetRoot });
  const sessions = [];
  const rootsByArchive = {
    abandoned: paths.abandonedSessionsRoot,
    active: paths.sessionsRoot,
    completed: paths.completedSessionsRoot
  };
  const selectedArchives = normalizeArchiveFilter(archive);
  const roots = selectedArchives.map((archiveName) => ({
    archive: archiveName,
    root: rootsByArchive[archiveName]
  }));

  for (const rootInfo of roots) {
    let entries = [];
    try {
      entries = await readdir(rootInfo.root, { withFileTypes: true });
    } catch {
      entries = [];
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || !isValidSessionId(entry.name)) {
        continue;
      }
      const sessionPaths = resolveSessionPaths({
        targetRoot,
        sessionId: entry.name
      });
      const response = await buildSessionResponse({
        ...sessionPaths,
        archive: rootInfo.archive,
        sessionRoot: path.join(rootInfo.root, entry.name)
      });
      sessions.push(response);
    }
  }
  sessions.sort((left, right) => right.sessionId.localeCompare(left.sessionId));
  return {
    archive: selectedArchives.length === 1 ? selectedArchives[0] : "mixed",
    archives: selectedArchives,
    ok: true,
    stepDefinitions: buildStepDefinitions(),
    sessions
  };
}

async function inspectSession({
  targetRoot = process.cwd(),
  sessionId
} = {}) {
  return withExistingSession({ targetRoot, sessionId }, (paths, context) => {
    return buildSessionResponse(paths, {
      preconditions: context.preconditions
    });
  });
}

function emptySessionDetails(response) {
  return {
    ...response,
    issueTitle: "",
    issueText: "",
    planText: "",
    receipts: [],
    transcriptLog: ""
  };
}

async function inspectSessionDetails({
  targetRoot = process.cwd(),
  sessionId
} = {}) {
  const context = await existingSessionContext({ targetRoot, sessionId });
  if (!context.ok) {
    return emptySessionDetails(context.response);
  }
  const { paths, preconditions } = context;
  const response = await buildSessionResponse(paths, { preconditions });

  const [issueText, issueTitle, planText, receipts, transcriptLog] = await Promise.all([
    readTextIfExists(path.join(paths.sessionRoot, "issue.md")),
    readTrimmedFile(path.join(paths.sessionRoot, "issue_title")),
    readTextIfExists(path.join(paths.sessionRoot, "plan.md")),
    readReceiptSteps(paths),
    readTextIfExists(path.join(paths.sessionRoot, "transcript.log"))
  ]);

  return {
    ...response,
    issueTitle,
    issueText: issueText.trim(),
    planText: planText.trim(),
    receipts,
    transcriptLog
  };
}

async function removeEmptyStaleWorktreeDirectory(paths) {
  try {
    const entries = await readdir(paths.worktree);
    if (entries.length > 0) {
      return {
        ok: false,
        message: `Worktree path exists but is not a registered Git worktree: ${paths.worktree}`
      };
    }
    await rmdir(paths.worktree);
    return {
      ok: true
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        ok: true
      };
    }
    return {
      ok: false,
      message: `Cannot prepare worktree path ${paths.worktree}: ${error?.message || error}`
    };
  }
}

async function createWorktree(paths, _options = {}, context = {}) {
  const preconditions = context.preconditions || [];
  if (await hasWorktree(paths)) {
    await writeReceipt(paths, "worktree_created", `Reused existing worktree ${paths.worktree}.`);
    await markStatus(paths, SESSION_STATUS.RUNNING);
    return buildSessionResponse(paths, {
      preconditions
    });
  }

  await mkdir(path.dirname(paths.worktree), { recursive: true });
  const staleWorktree = await removeEmptyStaleWorktreeDirectory(paths);
  if (!staleWorktree.ok) {
    return failSession(paths, {
      code: "worktree_path_blocked",
      message: staleWorktree.message,
      repairCommand: `ls -la ${paths.worktree}`,
      preconditions
    });
  }
  const result = await runGit(paths.targetRoot, ["worktree", "add", "-b", paths.branch, paths.worktree, "HEAD"], {
    timeout: 30000
  });
  if (!result.ok) {
    return failSession(paths, {
      code: "worktree_create_failed",
      message: result.output || `Failed to create worktree ${paths.worktree}.`,
      repairCommand: `git worktree add -b ${paths.branch} ${paths.worktree} HEAD`,
      preconditions
    });
  }
  await writeReceipt(paths, "worktree_created", `Created worktree ${paths.worktree} on branch ${paths.branch}.`);
  await markStatus(paths, SESSION_STATUS.RUNNING);
  return buildSessionResponse(paths, {
    preconditions
  });
}

async function recordDependenciesInstalled(paths, {
  message = "Installed Node dependencies in the session worktree.",
  preconditions = []
} = {}) {
  await writeReceipt(paths, "dependencies_installed", message);
  await markStatus(paths, SESSION_STATUS.RUNNING);
  return buildSessionResponse(paths, {
    preconditions
  });
}

async function installDependencies(paths, _options = {}, context = {}) {
  const preconditions = context.preconditions || [];
  const result = await runCommand("npm", ["install"], {
    cwd: paths.worktree,
    timeout: 1000 * 60 * 10
  });
  if (!result.ok) {
    return failSession(paths, {
      code: "dependencies_install_failed",
      message: result.output || "npm install failed in the session worktree.",
      repairCommand: `cd ${paths.worktree} && npm install`,
      preconditions
    });
  }
  return recordDependenciesInstalled(paths, {
    message: result.output || "Installed Node dependencies in the session worktree.",
    preconditions
  });
}

async function adoptDependenciesInstalled({
  targetRoot = process.cwd(),
  sessionId,
  message = ""
} = {}) {
  return withExistingSession({ targetRoot, sessionId }, async (paths, context = {}) => {
    const artifacts = await readSessionArtifacts(paths);
    if (artifacts.nextStep !== "dependencies_installed") {
      return buildSessionResponse(paths, {
        ok: false,
        errors: [
          createError({
            code: "session_step_mismatch",
            message: `Cannot record dependencies for ${paths.sessionId}; current step is ${artifacts.nextStep || "complete"}.`
          })
        ],
        preconditions: context.preconditions || []
      });
    }
    return recordDependenciesInstalled(paths, {
      message,
      preconditions: context.preconditions || []
    });
  });
}

async function renderIssuePrompt(paths, options = {}) {
  const userInput = normalizeText(options.prompt);
  if (!userInput) {
    return failSession(paths, {
      code: "prompt_required",
      message: "The issue prompt step requires --prompt.",
      repairCommand: `jskit session ${paths.sessionId} step --prompt "<what should change>"`
    });
  }
  const prompt = await renderPrompt(paths, "new_issue.md", {
    user_input: userInput
  });
  await writePromptArtifact(paths, "issue_draft.md", prompt);
  await writeReceipt(paths, "issue_prompt_rendered", "Rendered the issue drafting prompt.");
  await markStatus(paths, SESSION_STATUS.WAITING_FOR_USER);
  return buildSessionResponse(paths, {
    ok: true,
    prompt,
    status: SESSION_STATUS.WAITING_FOR_USER
  });
}

async function draftIssue(paths, options = {}) {
  const issueText = extractIssueText(options.issue);
  if (!issueText) {
    return failSession(paths, {
      code: "issue_required",
      message: "The issue drafting step requires --issue, --issue-file, or --issue -.",
      repairCommand: `jskit session ${paths.sessionId} step --issue -`
    });
  }
  const issueTitle = normalizeText(options.issueTitle) || extractIssueTitle(options.issue) || titleFromIssue(issueText);
  await writeTextFile(path.join(paths.sessionRoot, "issue.md"), issueText);
  await writeTextFile(path.join(paths.sessionRoot, "issue_title"), issueTitle);
  await writeReceipt(paths, "issue_drafted", "Saved approved issue text.");
  await markStatus(paths, SESSION_STATUS.RUNNING);
  return buildSessionResponse(paths);
}

function titleFromIssue(issueText) {
  const firstMeaningfulLine = String(issueText || "")
    .split(/\r?\n/u)
    .map((line) => line.replace(/^#+\s*/u, "").trim())
    .find(Boolean);
  return (firstMeaningfulLine || "JSKIT Studio issue").slice(0, 120);
}

async function createIssue(paths, _options = {}, context = {}) {
  const preconditions = context.preconditions || [];
  const issueText = await readTrimmedFile(path.join(paths.sessionRoot, "issue.md"));
  const issueTitle = await readTrimmedFile(path.join(paths.sessionRoot, "issue_title")) || titleFromIssue(issueText);
  const result = await runCommand("gh", [
    "issue",
    "create",
    "--title",
    issueTitle,
    "--body-file",
    path.join(paths.sessionRoot, "issue.md")
  ], {
    cwd: paths.targetRoot,
    timeout: 30000
  });
  if (!result.ok || !result.stdout) {
    return failSession(paths, {
      code: "issue_create_failed",
      message: result.output || "GitHub issue creation failed.",
      repairCommand: "gh issue create",
      preconditions
    });
  }
  const issueUrl = result.stdout.split(/\r?\n/u).map((line) => line.trim()).find(Boolean) || result.stdout;
  await writeTextFile(path.join(paths.sessionRoot, "issue_url"), issueUrl);
  await writeReceipt(paths, "issue_created", `Created GitHub issue ${issueUrl}.`);
  await markStatus(paths, SESSION_STATUS.RUNNING);
  return buildSessionResponse(paths, {
    preconditions
  });
}

async function makePlan(paths, options = {}, context = {}) {
  const preconditions = context.preconditions || [];
  const issueText = await readTrimmedFile(path.join(paths.sessionRoot, "issue.md"));
  const issueTitle = await readTrimmedFile(path.join(paths.sessionRoot, "issue_title")) || titleFromIssue(issueText);
  const issueUrl = await readTrimmedFile(path.join(paths.sessionRoot, "issue_url"));
  const issueNumber = issueNumberFromUrl(issueUrl);
  const planText = extractPlanText(options.plan);

  if (!planText) {
    const prompt = await renderPrompt(paths, "plan_issue.md", {
      issue_file: path.join(paths.sessionRoot, "issue.md"),
      issue_number: issueNumber,
      issue_text: issueText,
      issue_title: issueTitle,
      issue_title_file: path.join(paths.sessionRoot, "issue_title"),
      issue_url: issueUrl,
      plan_file: path.join(paths.sessionRoot, "plan.md"),
      worktree: paths.worktree
    });
    await writePromptArtifact(paths, "plan_request.md", prompt);
    await markStatus(paths, SESSION_STATUS.WAITING_FOR_USER);
    return buildSessionResponse(paths, {
      ok: true,
      preconditions,
      prompt,
      status: SESSION_STATUS.WAITING_FOR_USER
    });
  }

  const planPath = path.join(paths.sessionRoot, "plan.md");
  await writeTextFile(planPath, planText);
  const commentResult = await runCommand("gh", ["issue", "comment", issueUrl, "--body-file", planPath], {
    cwd: paths.targetRoot,
    timeout: 1000 * 60
  });
  if (!commentResult.ok) {
    return failSession(paths, {
      code: "plan_comment_failed",
      message: commentResult.output || "Failed to comment the implementation plan on the GitHub issue.",
      repairCommand: `gh issue comment ${issueUrl} --body-file ${planPath}`,
      preconditions
    });
  }
  await writeReceipt(paths, "plan_made", `Saved plan and commented on ${issueUrl}.`);
  await markStatus(paths, SESSION_STATUS.RUNNING);
  return buildSessionResponse(paths, {
    preconditions
  });
}

async function renderPlanExecutionPrompt(paths, _options = {}, context = {}) {
  const preconditions = context.preconditions || [];
  const issueText = await readTrimmedFile(path.join(paths.sessionRoot, "issue.md"));
  const issueTitle = await readTrimmedFile(path.join(paths.sessionRoot, "issue_title")) || titleFromIssue(issueText);
  const issueUrl = await readTrimmedFile(path.join(paths.sessionRoot, "issue_url"));
  const issueNumber = issueNumberFromUrl(issueUrl);
  const planPath = path.join(paths.sessionRoot, "plan.md");
  const planText = await readTrimmedFile(planPath);
  const executionPrompt = await renderPrompt(paths, "execute_plan.md", {
    issue_file: path.join(paths.sessionRoot, "issue.md"),
    issue_number: issueNumber,
    issue_title: issueTitle,
    issue_url: issueUrl,
    plan_file: planPath,
    plan_text: planText,
    worktree: paths.worktree
  });
  await writePromptArtifact(paths, "plan_execution.md", executionPrompt);
  await writeReceipt(paths, "plan_executed", "Started plan execution with Codex.");
  await markStatus(paths, SESSION_STATUS.WAITING_FOR_USER);
  return buildSessionResponse(paths, {
    codex: PLAN_EXECUTION_CODEX_HANDOFF,
    preconditions,
    prompt: executionPrompt,
    status: SESSION_STATUS.WAITING_FOR_USER
  });
}

async function renderPlanFineTuningPrompt(paths, _options = {}, context = {}) {
  const preconditions = context.preconditions || [];
  const issueText = await readTrimmedFile(path.join(paths.sessionRoot, "issue.md"));
  const issueTitle = await readTrimmedFile(path.join(paths.sessionRoot, "issue_title")) || titleFromIssue(issueText);
  const issueUrl = await readTrimmedFile(path.join(paths.sessionRoot, "issue_url"));
  const issueNumber = issueNumberFromUrl(issueUrl);
  const planPath = path.join(paths.sessionRoot, "plan.md");
  const planText = await readTrimmedFile(planPath);
  const fineTuningPrompt = await renderPrompt(paths, "fine_tune_plan.md", {
    issue_file: path.join(paths.sessionRoot, "issue.md"),
    issue_number: issueNumber,
    issue_title: issueTitle,
    issue_url: issueUrl,
    plan_file: planPath,
    plan_text: planText,
    worktree: paths.worktree
  });
  await writePromptArtifact(paths, "plan_fine_tuning.md", fineTuningPrompt);
  await writeReceipt(paths, "plan_fine_tuning", "Started plan fine tuning with Codex.");
  await markStatus(paths, SESSION_STATUS.WAITING_FOR_USER);
  return buildSessionResponse(paths, {
    codex: PLAN_FINE_TUNING_CODEX_HANDOFF,
    preconditions,
    prompt: fineTuningPrompt,
    status: SESSION_STATUS.WAITING_FOR_USER
  });
}

async function worktreeStatus(worktree) {
  const result = await runGitInWorktree(worktree, ["status", "--porcelain=v1"]);
  if (!result.ok) {
    return {
      ok: false,
      changedFiles: [],
      output: result.output
    };
  }
  const changedFiles = result.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  return {
    ok: true,
    changedFiles,
    output: result.stdout
  };
}

async function untrackedFiles(worktree) {
  const result = await runGitInWorktree(worktree, ["ls-files", "--others", "--exclude-standard", "-z"], {
    timeout: 15000
  });
  if (!result.ok) {
    return [];
  }
  return result.stdout
    .split("\0")
    .filter((line) => line.length > 0);
}

async function untrackedFileDiff(worktree, filePath) {
  const result = await runGitInWorktree(worktree, [
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--no-index",
    "--",
    "/dev/null",
    filePath
  ], {
    timeout: 15000
  });
  if (result.ok || result.exitCode === 1) {
    return result.stdout;
  }
  return "";
}

async function untrackedFilesDiff(worktree) {
  const diffs = [];
  for (const filePath of await untrackedFiles(worktree)) {
    const diff = await untrackedFileDiff(worktree, filePath);
    if (diff) {
      diffs.push(diff);
    }
  }
  return diffs.join("\n");
}

async function inspectSessionDiff({
  targetRoot = process.cwd(),
  sessionId
} = {}) {
  return withExistingSession({ targetRoot, sessionId }, async (paths) => {
    const session = await buildSessionResponse(paths);
    if (!await hasWorktree(paths)) {
      return {
        ...session,
        ok: false,
        errors: [
          createError({
            code: "worktree_missing",
            message: "Session worktree is not available for diff inspection."
          })
        ],
        gitStatus: "",
        hasChanges: false,
        stagedDiff: "",
        unstagedDiff: "",
        untrackedDiff: ""
      };
    }

    const [status, unstagedDiff, stagedDiff] = await Promise.all([
      runGitInWorktree(paths.worktree, ["status", "--porcelain=v1"], { timeout: 15000 }),
      runGitInWorktree(paths.worktree, ["diff", "--no-color", "--no-ext-diff"], { timeout: 30000 }),
      runGitInWorktree(paths.worktree, ["diff", "--cached", "--no-color", "--no-ext-diff"], { timeout: 30000 })
    ]);

    if (!status.ok || !unstagedDiff.ok || !stagedDiff.ok) {
      return {
        ...session,
        ok: false,
        errors: [
          createError({
            code: "session_diff_failed",
            message: [status, unstagedDiff, stagedDiff].find((result) => !result.ok)?.output ||
              "Failed to inspect session worktree diff."
          })
        ],
        gitStatus: status.stdout || "",
        hasChanges: false,
        stagedDiff: stagedDiff.stdout || "",
        unstagedDiff: unstagedDiff.stdout || "",
        untrackedDiff: ""
      };
    }

    const untrackedDiff = await untrackedFilesDiff(paths.worktree);
    return {
      ...session,
      gitStatus: status.stdout,
      hasChanges: Boolean(status.stdout.trim()),
      stagedDiff: stagedDiff.stdout,
      unstagedDiff: unstagedDiff.stdout,
      untrackedDiff,
      worktree: paths.worktree
    };
  });
}

async function acceptImplementationChanges(paths) {
  const status = await worktreeStatus(paths.worktree);
  if (!status.ok) {
    return failSession(paths, {
      code: "git_status_failed",
      message: status.output || "Failed to inspect worktree changes.",
      repairCommand: `git -C ${paths.worktree} status --short`
    });
  }
  if (status.changedFiles.length < 1) {
    return failSession(paths, {
      code: "changes_missing",
      message: "No worktree changes found. Ask Codex to implement the approved plan, inspect the worktree, then accept changes once ready.",
      repairCommand: `jskit session ${paths.sessionId} step`
    });
  }
  await writeReceipt(paths, "implementation_changes_accepted", `Accepted ${status.changedFiles.length} changed file entries for commit.`);
  await markStatus(paths, SESSION_STATUS.RUNNING);
  return buildSessionResponse(paths);
}

async function commitWorktree(paths, {
  message,
  allowNoChanges = false
} = {}) {
  const status = await worktreeStatus(paths.worktree);
  if (!status.ok) {
    return {
      ok: false,
      output: status.output
    };
  }
  if (status.changedFiles.length < 1) {
    return {
      changedFiles: [],
      ok: allowNoChanges,
      output: allowNoChanges ? "No changes to commit." : "No changes found."
    };
  }
  const addResult = await runGitInWorktree(paths.worktree, ["add", "."]);
  if (!addResult.ok) {
    return {
      ok: false,
      output: addResult.output
    };
  }
  const commitResult = await runGitInWorktree(paths.worktree, ["commit", "-m", message], {
    timeout: 30000
  });
  if (!commitResult.ok) {
    return {
      ok: false,
      output: commitResult.output
    };
  }
  return {
    changedFiles: status.changedFiles,
    ok: true,
    output: commitResult.output
  };
}

async function commitImplementation(paths) {
  const result = await commitWorktree(paths, {
    message: `Implement JSKIT session ${paths.sessionId}`
  });
  if (!result.ok) {
    return failSession(paths, {
      code: "commit_failed",
      message: result.output || "Failed to commit implementation changes.",
      repairCommand: `git -C ${paths.worktree} status --short`
    });
  }
  await writeReceipt(paths, "implementation_changes_committed", `Committed implementation changes for ${paths.sessionId}.`);
  await markStatus(paths, SESSION_STATUS.RUNNING);
  return buildSessionResponse(paths);
}

async function changedFilesFromLastCommit(paths) {
  const result = await runGitInWorktree(paths.worktree, ["show", "--name-only", "--format=", "HEAD"]);
  if (!result.ok) {
    return "";
  }
  return result.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).join("\n");
}

async function renderReviewPrompt(paths) {
  const prompt = await renderPrompt(paths, "review_changes.md", {
    changed_files: await changedFilesFromLastCommit(paths)
  });
  await writePromptArtifact(paths, "review.md", prompt);
  await writeReceipt(paths, "review_prompt_rendered", "Started code review.");
  await markStatus(paths, SESSION_STATUS.WAITING_FOR_USER);
  return buildSessionResponse(paths, {
    codex: REVIEW_EXECUTION_CODEX_HANDOFF,
    prompt,
    status: SESSION_STATUS.WAITING_FOR_USER
  });
}

async function acceptReviewChanges(paths) {
  const status = await worktreeStatus(paths.worktree);
  if (!status.ok) {
    return failSession(paths, {
      code: "git_status_failed",
      message: status.output || "Failed to inspect review changes.",
      repairCommand: `git -C ${paths.worktree} status --short`
    });
  }
  const message = status.changedFiles.length > 0
    ? `Accepted ${status.changedFiles.length} review changed file entries for commit.`
    : "Accepted review with no file changes.";
  await writeReceipt(paths, "review_changes_accepted", message);
  await markStatus(paths, SESSION_STATUS.RUNNING);
  return buildSessionResponse(paths);
}

async function commitReviewChanges(paths) {
  const result = await commitWorktree(paths, {
    allowNoChanges: true,
    message: `Apply review changes for ${paths.sessionId}`
  });
  if (!result.ok) {
    return failSession(paths, {
      code: "review_commit_failed",
      message: result.output || "Failed to commit review changes.",
      repairCommand: `git -C ${paths.worktree} status --short`
    });
  }
  const message = result.changedFiles?.length
    ? "Committed review changes."
    : "No review changes detected.";
  await writeReceipt(paths, "review_changes_committed", message);
  await markStatus(paths, SESSION_STATUS.RUNNING);
  return buildSessionResponse(paths);
}

async function userCheck(paths, options = {}) {
  const result = normalizeText(options.userCheck || options["user-check"]).toLowerCase();
  if (result === "passed" || result === "pass" || result === "ok" || result === "yes") {
    await writeReceipt(paths, "user_check_completed", "User confirmed check passed.");
    await markStatus(paths, SESSION_STATUS.RUNNING);
    return buildSessionResponse(paths);
  }
  if (result === "failed" || result === "fail" || result === "no") {
    return failSession(paths, {
      code: "user_check_failed",
      message: "User check was reported as failed. Continue in Codex, then retry this step with --user-check passed.",
      repairCommand: `jskit session ${paths.sessionId} step --user-check passed`
    });
  }
  const prompt = await renderPrompt(paths, "user_check.md");
  await writePromptArtifact(paths, "user_check.md", prompt);
  await markStatus(paths, SESSION_STATUS.WAITING_FOR_USER);
  return buildSessionResponse(paths, {
    prompt,
    status: SESSION_STATUS.WAITING_FOR_USER
  });
}

async function readPackageJson(root) {
  try {
    return JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  } catch {
    return {};
  }
}

async function doctorCommandForWorktree(worktree) {
  const packageJson = await readPackageJson(worktree);
  const scripts = packageJson && typeof packageJson.scripts === "object" ? packageJson.scripts : {};
  if (scripts["verify:local"]) {
    return ["npm", ["run", "verify:local"]];
  }
  if (scripts.verify) {
    return ["npm", ["run", "verify"]];
  }
  return ["npx", ["jskit", "app", "verify"]];
}

async function runDoctor(paths) {
  const [command, args] = await doctorCommandForWorktree(paths.worktree);
  const result = await runCommand(command, args, {
    cwd: paths.worktree,
    timeout: 1000 * 60 * 15
  });
  await writeTextFile(path.join(paths.sessionRoot, "doctor.log"), result.output);
  if (!result.ok) {
    const prompt = await renderPrompt(paths, "doctor_failure.md", {
      doctor_output: result.output
    });
    await writePromptArtifact(paths, "doctor_failure.md", prompt);
    return failSession(paths, {
      code: "doctor_failed",
      message: "Doctor/verification command failed. Paste the failure prompt into Codex, then rerun this step.",
      repairCommand: `${command} ${args.join(" ")}`,
      prompt
    });
  }
  await writeReceipt(paths, "doctor_run", `Doctor command passed: ${command} ${args.join(" ")}.`);
  await markStatus(paths, SESSION_STATUS.RUNNING);
  return buildSessionResponse(paths);
}

function issueNumberFromUrl(issueUrl) {
  const match = /\/issues\/(\d+)(?:\b|$)/u.exec(String(issueUrl || ""));
  return match ? match[1] : "";
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function readPrState(paths, prUrl) {
  const result = await runCommand("gh", ["pr", "view", prUrl, "--json", "state,mergedAt,url,baseRefName"], {
    cwd: paths.targetRoot,
    timeout: 1000 * 60
  });
  if (!result.ok) {
    return {
      ok: false,
      output: result.output
    };
  }
  const payload = parseJsonObject(result.stdout);
  return {
    baseRefName: normalizeText(payload?.baseRefName),
    mergedAt: payload?.mergedAt || "",
    ok: Boolean(payload),
    output: result.output,
    state: String(payload?.state || "").toUpperCase(),
    url: payload?.url || prUrl
  };
}

function prStateIsMerged(prState) {
  return Boolean(prState?.ok && prState.state === "MERGED");
}

async function currentTargetBranch(targetRoot) {
  const result = await runGit(targetRoot, ["branch", "--show-current"], {
    timeout: 15000
  });
  return result.ok ? normalizeText(result.stdout) : "";
}

async function assertTargetRootCleanForBaseUpdate(paths) {
  const status = await runGit(paths.targetRoot, ["status", "--porcelain=v1"], {
    timeout: 15000
  });
  if (!status.ok) {
    return failSession(paths, {
      code: "target_root_status_failed",
      message: status.output || "Failed to inspect target root git status before updating the local base branch.",
      repairCommand: `git -C ${paths.targetRoot} status --short`
    });
  }
  if (status.stdout.trim()) {
    return failSession(paths, {
      code: "target_root_dirty",
      message: "Target root has uncommitted changes; JSKIT cannot update the local base branch after merging the PR.",
      repairCommand: `git -C ${paths.targetRoot} status --short`
    });
  }
  return null;
}

async function assertTargetRootCanUpdateBase(paths, branch) {
  const cleanFailure = await assertTargetRootCleanForBaseUpdate(paths);
  if (cleanFailure) {
    return cleanFailure;
  }

  const currentBranch = await currentTargetBranch(paths.targetRoot);
  if (currentBranch !== branch) {
    return failSession(paths, {
      code: "target_branch_mismatch",
      message: `Target root is on branch ${currentBranch || "(detached)"}, but the merged PR targets ${branch}. JSKIT will not merge origin/${branch} into the wrong branch.`,
      repairCommand: `git -C ${paths.targetRoot} switch ${branch} && git -C ${paths.targetRoot} pull --ff-only origin ${branch}`
    });
  }

  return null;
}

async function assertTargetBaseCanFastForward(paths, branch) {
  const branchFailure = await assertTargetRootCanUpdateBase(paths, branch);
  if (branchFailure) {
    return branchFailure;
  }

  const fetchResult = await runGit(paths.targetRoot, ["fetch", "origin"], {
    timeout: 1000 * 60 * 5
  });
  if (!fetchResult.ok) {
    return failSession(paths, {
      code: "target_fetch_failed",
      message: fetchResult.output || `Failed to fetch origin before checking local ${branch}.`,
      repairCommand: `git -C ${paths.targetRoot} fetch origin`
    });
  }

  const remoteBranch = `origin/${branch}`;
  const remoteExists = await runGit(paths.targetRoot, ["rev-parse", "--verify", remoteBranch], {
    timeout: 15000
  });
  if (!remoteExists.ok) {
    return failSession(paths, {
      code: "target_remote_branch_missing",
      message: `Remote base branch ${remoteBranch} does not exist; JSKIT cannot safely update local ${branch} after merge.`,
      repairCommand: `git -C ${paths.targetRoot} fetch origin`
    });
  }

  const ancestor = await runGit(paths.targetRoot, ["merge-base", "--is-ancestor", branch, remoteBranch], {
    timeout: 15000
  });
  if (!ancestor.ok) {
    return failSession(paths, {
      code: "target_branch_not_fast_forwardable",
      message: `Local ${branch} is not an ancestor of ${remoteBranch}; JSKIT will not merge the PR while the local base branch has diverged.`,
      repairCommand: `git -C ${paths.targetRoot} pull --ff-only origin ${branch}`
    });
  }

  return null;
}

async function updateLocalBaseBranch(paths, baseBranch = "") {
  const branch = normalizeText(baseBranch) || await currentTargetBranch(paths.targetRoot);
  if (!branch) {
    return failSession(paths, {
      code: "target_branch_missing",
      message: "Target root is not on a named branch; JSKIT cannot update the local base branch after merging the PR.",
      repairCommand: `git -C ${paths.targetRoot} branch --show-current`
    });
  }

  const branchFailure = await assertTargetRootCanUpdateBase(paths, branch);
  if (branchFailure) {
    return branchFailure;
  }

  const fetchResult = await runGit(paths.targetRoot, ["fetch", "origin"], {
    timeout: 1000 * 60 * 5
  });
  if (!fetchResult.ok) {
    return failSession(paths, {
      code: "target_fetch_failed",
      message: fetchResult.output || `Failed to fetch origin before updating local ${branch}.`,
      repairCommand: `git -C ${paths.targetRoot} fetch origin`
    });
  }

  const pullResult = await runGit(paths.targetRoot, ["pull", "--ff-only", "origin", branch], {
    timeout: 1000 * 60 * 5
  });
  if (!pullResult.ok) {
    return failSession(paths, {
      code: "target_pull_failed",
      message: pullResult.output || `Failed to fast-forward local ${branch} after merging the PR.`,
      repairCommand: `git -C ${paths.targetRoot} pull --ff-only origin ${branch}`
    });
  }

  await writeTextFile(path.join(paths.sessionRoot, "local_base_updated"), `${branch}\n${pullResult.output}\n`);
  return null;
}

async function updateHelperMapBeforePr(paths) {
  let helperMapPayload;
  try {
    const { updateHelperMap } = await import("./helperMap.js");
    helperMapPayload = await updateHelperMap({
      targetRoot: paths.worktree
    });
  } catch (error) {
    return {
      ok: false,
      code: "helper_map_update_failed",
      message: String(error?.message || error),
      repairCommand: `git -C ${paths.worktree} status --short`
    };
  }

  const statusResult = await runGitInWorktree(paths.worktree, [
    "status",
    "--porcelain=v1",
    "--",
    HELPER_MAP_JSON_RELATIVE_PATH,
    HELPER_MAP_MARKDOWN_RELATIVE_PATH
  ], {
    timeout: 15000
  });
  if (!statusResult.ok) {
    return {
      ok: false,
      code: "helper_map_status_failed",
      message: statusResult.output || "Failed to inspect helper-map Git status.",
      repairCommand: `git -C ${paths.worktree} status --short -- ${HELPER_MAP_JSON_RELATIVE_PATH} ${HELPER_MAP_MARKDOWN_RELATIVE_PATH}`
    };
  }

  if (!statusResult.stdout.trim()) {
    return {
      ok: true,
      changed: false,
      message: "Helper map already up to date."
    };
  }

  const addResult = await runGitInWorktree(paths.worktree, [
    "add",
    HELPER_MAP_JSON_RELATIVE_PATH,
    HELPER_MAP_MARKDOWN_RELATIVE_PATH
  ], {
    timeout: 15000
  });
  if (!addResult.ok) {
    return {
      ok: false,
      code: "helper_map_add_failed",
      message: addResult.output || "Failed to stage helper-map files.",
      repairCommand: `git -C ${paths.worktree} add ${HELPER_MAP_JSON_RELATIVE_PATH} ${HELPER_MAP_MARKDOWN_RELATIVE_PATH}`
    };
  }

  const commitResult = await runGitInWorktree(paths.worktree, [
    "commit",
    "-m",
    `Update JSKIT helper map for ${paths.sessionId}`
  ], {
    timeout: 1000 * 60
  });
  if (!commitResult.ok) {
    return {
      ok: false,
      code: "helper_map_commit_failed",
      message: commitResult.output || "Failed to commit helper-map update.",
      repairCommand: `git -C ${paths.worktree} commit -m "Update JSKIT helper map for ${paths.sessionId}"`
    };
  }

  return {
    ok: true,
    changed: true,
    message: `Updated helper map at ${path.relative(paths.worktree, helperMapPayload.helperMapMarkdownPath)}.`
  };
}

async function createPr(paths) {
  const helperMapResult = await updateHelperMapBeforePr(paths);
  if (!helperMapResult.ok) {
    return failSession(paths, {
      code: helperMapResult.code,
      message: helperMapResult.message,
      repairCommand: helperMapResult.repairCommand
    });
  }

  const pushResult = await runGitInWorktree(paths.worktree, ["push", "-u", "origin", "HEAD"], {
    timeout: 1000 * 60 * 5
  });
  if (!pushResult.ok) {
    return failSession(paths, {
      code: "branch_push_failed",
      message: pushResult.output || "Failed to push session branch.",
      repairCommand: `git -C ${paths.worktree} push -u origin HEAD`
    });
  }
  const issueUrl = await readTrimmedFile(path.join(paths.sessionRoot, "issue_url"));
  const issueText = await readTrimmedFile(path.join(paths.sessionRoot, "issue.md"));
  const issueTitle = await readTrimmedFile(path.join(paths.sessionRoot, "issue_title")) || titleFromIssue(issueText);
  const issueNumber = issueNumberFromUrl(issueUrl);
  const body = [
    issueNumber ? `Closes #${issueNumber}` : "",
    "",
    issueText
  ].join("\n").trim();
  const bodyPath = path.join(paths.sessionRoot, "pr_body.md");
  await writeTextFile(bodyPath, body);
  const result = await runCommand("gh", [
    "pr",
    "create",
    "--title",
    issueTitle,
    "--body-file",
    bodyPath
  ], {
    cwd: paths.worktree,
    timeout: 1000 * 60
  });
  if (!result.ok || !result.stdout) {
    const prompt = await renderPrompt(paths, "pr_failure.md", {
      doctor_output: result.output
    });
    await writePromptArtifact(paths, "pr_create_failure.md", prompt);
    return failSession(paths, {
      code: "pr_create_failed",
      message: result.output || "Failed to create PR.",
      repairCommand: "gh pr create",
      prompt
    });
  }
  const prUrl = result.stdout.split(/\r?\n/u).map((line) => line.trim()).find(Boolean) || result.stdout;
  await writeTextFile(path.join(paths.sessionRoot, "pr_url"), prUrl);
  await writeReceipt(paths, "pr_created", `Pushed branch ${paths.branch} and created PR ${prUrl}. ${helperMapResult.message}`);
  await markStatus(paths, SESSION_STATUS.RUNNING);
  return buildSessionResponse(paths);
}

async function mergePr(paths) {
  const prUrl = await readTrimmedFile(path.join(paths.sessionRoot, "pr_url"));
  const mergeMarkerPath = path.join(paths.sessionRoot, "pr_merge_completed");
  const baseBranchPath = path.join(paths.sessionRoot, "pr_base_branch");
  const mergeAlreadyCompleted = await readTrimmedFile(mergeMarkerPath);
  let baseBranch = await readTrimmedFile(baseBranchPath);
  if (!mergeAlreadyCompleted) {
    const existingPrState = await readPrState(paths, prUrl);
    baseBranch = existingPrState.baseRefName || baseBranch || await currentTargetBranch(paths.targetRoot);
    if (baseBranch) {
      await writeTextFile(baseBranchPath, `${baseBranch}\n`);
    }
    const baseFailure = await assertTargetBaseCanFastForward(paths, baseBranch);
    if (baseFailure) {
      return baseFailure;
    }
    let prMerged = prStateIsMerged(existingPrState);
    let mergeResult = null;
    if (!prMerged) {
      mergeResult = await runCommand("gh", ["pr", "merge", prUrl, "--merge", "--delete-branch"], {
        cwd: paths.targetRoot,
        timeout: 1000 * 60 * 5
      });
      if (!mergeResult.ok) {
        prMerged = prStateIsMerged(await readPrState(paths, prUrl));
      } else {
        prMerged = true;
      }
    }
    if (!prMerged) {
      const prompt = await renderPrompt(paths, "pr_failure.md", {
        doctor_output: mergeResult?.output || existingPrState.output
      });
      await writePromptArtifact(paths, "pr_merge_failure.md", prompt);
      return failSession(paths, {
        code: "pr_merge_failed",
        message: mergeResult?.output || existingPrState.output || "Failed to merge PR.",
        repairCommand: `gh pr merge ${prUrl} --merge --delete-branch`,
        prompt
      });
    }
    const issueUrl = await readTrimmedFile(path.join(paths.sessionRoot, "issue_url"));
    if (issueUrl) {
      await runCommand("gh", ["issue", "close", issueUrl, "--comment", `Merged PR ${prUrl}.`], {
        cwd: paths.targetRoot,
        timeout: 1000 * 60
      });
    }
    await writeTextFile(mergeMarkerPath, `${prUrl}\n`);
  }
  const updateFailure = await updateLocalBaseBranch(paths, baseBranch);
  if (updateFailure) {
    return updateFailure;
  }
  if (await hasWorktree(paths)) {
    const result = await runGit(paths.targetRoot, ["worktree", "remove", paths.worktree], {
      timeout: 1000 * 60
    });
    if (!result.ok) {
      return failSession(paths, {
        code: "worktree_remove_failed",
        message: result.output || "Failed to remove worktree.",
        repairCommand: `git worktree remove ${paths.worktree}`
      });
    }
  }
  await writeReceipt(paths, "pr_merged", `Merged PR ${prUrl}, updated local ${baseBranch || "base branch"}, and removed worktree ${paths.worktree}.`);
  await markStatus(paths, SESSION_STATUS.RUNNING);
  return buildSessionResponse(paths);
}

async function finishSession(paths) {
  const prUrl = await readTrimmedFile(path.join(paths.sessionRoot, "pr_url"));
  const issueUrl = await readTrimmedFile(path.join(paths.sessionRoot, "issue_url"));
  const codexThreadId = await readTrimmedFile(path.join(paths.sessionRoot, "codex_thread_id"));
  const prompt = await renderPrompt(paths, "final_comment.md", {
    codex_thread_id: codexThreadId,
    issue_url: issueUrl,
    pr_url: prUrl,
    transcript_log: path.join(paths.completedSessionRoot, "transcript.log")
  });
  await writeTextFile(path.join(paths.sessionRoot, "final_comment.md"), prompt);
  if (issueUrl) {
    await runCommand("gh", ["issue", "comment", issueUrl, "--body-file", path.join(paths.sessionRoot, "final_comment.md")], {
      cwd: paths.targetRoot,
      timeout: 1000 * 60
    });
  }
  await writeReceipt(paths, "session_finished", `Finished session ${paths.sessionId}.`);
  await markStatus(paths, SESSION_STATUS.FINISHED);
  await markCurrentStep(paths, "");
  const archivedPaths = await archiveSession(paths, "completed");
  return buildSessionResponse(archivedPaths, {
    status: SESSION_STATUS.FINISHED
  });
}

const STEP_RUNNERS = Object.freeze({
  worktree_created: createWorktree,
  dependencies_installed: installDependencies,
  issue_prompt_rendered: renderIssuePrompt,
  issue_drafted: draftIssue,
  issue_created: createIssue,
  plan_made: makePlan,
  plan_executed: renderPlanExecutionPrompt,
  plan_fine_tuning: renderPlanFineTuningPrompt,
  implementation_changes_accepted: acceptImplementationChanges,
  implementation_changes_committed: commitImplementation,
  review_prompt_rendered: renderReviewPrompt,
  review_changes_accepted: acceptReviewChanges,
  review_changes_committed: commitReviewChanges,
  user_check_completed: userCheck,
  doctor_run: runDoctor,
  pr_created: createPr,
  pr_merged: mergePr,
  session_finished: finishSession
});

const PRECONDITION_RUNNERS = Object.freeze({
  git_current_branch: (paths) => assertGitCurrentBranch(paths.targetRoot),
  git_repository: (paths) => assertGitRepository(paths.targetRoot),
  github_auth: (paths) => assertGhAuth(paths.targetRoot),
  github_origin: (paths) => assertGithubOrigin(paths.targetRoot),
  issue_text_exists: assertIssueTextExists,
  issue_url_exists: assertIssueUrlExists,
  plan_text_exists: assertPlanTextExists,
  pr_url_exists: assertPrUrlExists,
  session_exists: assertSessionExists,
  worktree_exists: assertWorktreeExists
});

async function runNamedPreconditions(paths, names = []) {
  return applyPreconditions(
    paths,
    names.map((name) => {
      return async () => PRECONDITION_RUNNERS[name](paths);
    })
  );
}

async function runSessionStep({
  targetRoot = process.cwd(),
  sessionId,
  options = {}
} = {}) {
  return withExistingSession({ targetRoot, sessionId }, async (paths) => {
    const artifacts = await readSessionArtifacts(paths);
    if (artifacts.status === SESSION_STATUS.FINISHED || artifacts.status === SESSION_STATUS.ABANDONED) {
      return buildSessionResponse(paths, {
        ok: true,
        status: artifacts.status
      });
    }
    const nextStep = artifacts.nextStep;
    if (!nextStep) {
      return finishSession(paths);
    }
    if (nextStep === "session_created") {
      return failSession(paths, {
        code: "session_not_initialized",
        message: "Session exists but is missing its creation receipt.",
        repairCommand: "jskit session create"
      });
    }
    const runner = STEP_RUNNERS[nextStep];
    if (typeof runner !== "function") {
      return failSession(paths, {
        code: "step_not_implemented",
        message: `No runner exists for step ${nextStep}.`,
        status: SESSION_STATUS.FAILED
      });
    }
    const stepPreconditions = await runNamedPreconditions(paths, STEP_PRECONDITION_NAMES[nextStep] || ["session_exists"]);
    if (!stepPreconditions.ok) {
      return failSession(paths, {
        ...stepPreconditions.error,
        preconditions: stepPreconditions.preconditions
      });
    }
    return runner(paths, options, {
      preconditions: stepPreconditions.preconditions
    });
  });
}

async function abandonSession({
  targetRoot = process.cwd(),
  sessionId
} = {}) {
  return withExistingSession({ targetRoot, sessionId }, async (paths) => {
    const artifacts = await readSessionArtifacts(paths);
    if (artifacts.status === SESSION_STATUS.FINISHED || artifacts.status === SESSION_STATUS.ABANDONED) {
      return buildSessionResponse(paths, {
        status: artifacts.status
      });
    }
    const issueUrl = await readTrimmedFile(path.join(paths.sessionRoot, "issue_url"));
    if (issueUrl) {
      const closeIssueResult = await runCommand("gh", ["issue", "close", issueUrl, "--comment", `Abandoned JSKIT Studio session ${paths.sessionId}.`], {
        cwd: paths.targetRoot,
        timeout: 1000 * 60
      });
      if (!closeIssueResult.ok) {
        return failSession(paths, {
          code: "issue_close_failed",
          message: closeIssueResult.output || "Failed to close GitHub issue for abandoned session.",
          repairCommand: `gh issue close ${issueUrl}`,
          status: SESSION_STATUS.FAILED
        });
      }
    }
    if (await hasWorktree(paths)) {
      await runGit(paths.targetRoot, ["worktree", "remove", "--force", paths.worktree], {
        timeout: 1000 * 60
      });
    }
    await writeTextFile(
      path.join(paths.sessionRoot, "steps", "abandoned"),
      `${timestampForReceipt()}\nAbandoned session ${paths.sessionId}.`
    );
    await markStatus(paths, SESSION_STATUS.ABANDONED);
    await markCurrentStep(paths, "");
    const archivedPaths = await archiveSession(paths, "abandoned");
    return buildSessionResponse(archivedPaths, {
      status: SESSION_STATUS.ABANDONED
    });
  });
}

async function adoptCodexThreadId({
  targetRoot = process.cwd(),
  sessionId,
  codexThreadId
} = {}) {
  if (!isValidSessionId(sessionId)) {
    return invalidSessionIdResponse({ targetRoot, sessionId });
  }
  const normalizedThreadId = normalizeText(codexThreadId);
  if (!normalizedThreadId) {
    return failSession(resolveSessionPaths({ targetRoot, sessionId }), {
      code: "codex_thread_id_required",
      message: "Codex thread id is required."
    });
  }
  return withExistingSession({ targetRoot, sessionId }, async (paths) => {
    if (paths.archive && paths.archive !== "active") {
      return buildSessionResponse(paths, {
        ok: false,
        errors: [
          createError({
            code: "session_archived_read_only",
            message: `Session ${paths.sessionId} is archived and cannot be mutated.`
          })
        ]
      });
    }
    await writeTextFile(path.join(paths.sessionRoot, "codex_thread_id"), normalizedThreadId);
    return buildSessionResponse(paths);
  });
}

export {
  SESSION_STATUS,
  STEP_DEFINITIONS,
  STEP_IDS,
  STEP_PRECONDITION_NAMES,
  abandonSession,
  adoptDependenciesInstalled,
  adoptCodexThreadId,
  buildSessionResponse,
  buildSessionErrorResponse,
  createSession,
  createSessionId,
  extractIssueTitle,
  extractIssueText,
  extractPlanText,
  inspectSession,
  inspectSessionDiff,
  inspectSessionDetails,
  isValidSessionId,
  listSessions,
  renderTemplate,
  recordDependenciesInstalled,
  resolveSessionPaths,
  runSessionStep
};
