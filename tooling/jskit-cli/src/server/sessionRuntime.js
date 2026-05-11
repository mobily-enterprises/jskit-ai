import {
  mkdir,
  readFile,
  readdir
} from "node:fs/promises";
import path from "node:path";
import {
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
  assertIssueArtifacts,
  assertIssueTextExists,
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

function extractIssueText(value = "") {
  const text = normalizeText(value);
  const match = /\[issue_text\]([\s\S]*?)\[\/issue_text\]/u.exec(text);
  return normalizeText(match ? match[1] : text);
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
  await mkdir(initialPaths.worktreesRoot, { recursive: true });
  await writeTextFile(path.join(initialPaths.sessionRoot, "transcript.log"), "");
  await markStatus(initialPaths, SESSION_STATUS.PENDING);
  await writeReceipt(initialPaths, "session_created", `Created JSKIT Studio issue session ${initialPaths.sessionId}.`);

  return buildSessionResponse(initialPaths, {
    ok: true,
    preconditions: preconditions.preconditions
  });
}

async function listSessions({ targetRoot = process.cwd() } = {}) {
  const paths = resolveSessionPaths({ targetRoot });
  const sessions = [];
  const roots = [
    { archive: "active", root: paths.sessionsRoot },
    { archive: "completed", root: paths.completedSessionsRoot },
    { archive: "abandoned", root: paths.abandonedSessionsRoot }
  ];

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
    issueText: "",
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

  const [issueText, receipts, transcriptLog] = await Promise.all([
    readTextIfExists(path.join(paths.sessionRoot, "issue.md")),
    readReceiptSteps(paths),
    readTextIfExists(path.join(paths.sessionRoot, "transcript.log"))
  ]);

  return {
    ...response,
    issueText: issueText.trim(),
    receipts,
    transcriptLog
  };
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

  await mkdir(paths.worktreesRoot, { recursive: true });
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
  await writeTextFile(path.join(paths.sessionRoot, "prompt.md"), prompt);
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
  await writeTextFile(path.join(paths.sessionRoot, "issue.md"), issueText);
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
  const result = await runCommand("gh", [
    "issue",
    "create",
    "--title",
    titleFromIssue(issueText),
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

async function renderImplementationPrompt(paths) {
  const issueText = await readTrimmedFile(path.join(paths.sessionRoot, "issue.md"));
  const issueUrl = await readTrimmedFile(path.join(paths.sessionRoot, "issue_url"));
  const prompt = await renderPrompt(paths, "implement_issue.md", {
    issue_text: issueText,
    issue_url: issueUrl
  });
  await writeTextFile(path.join(paths.sessionRoot, "prompt.md"), prompt);
  await writeReceipt(paths, "implementation_prompt_rendered", "Rendered the implementation prompt.");
  await markStatus(paths, SESSION_STATUS.WAITING_FOR_USER);
  return buildSessionResponse(paths, {
    prompt,
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

async function detectChanges(paths) {
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
      message: "No worktree changes found. Paste the implementation prompt into Codex and retry after changes exist.",
      repairCommand: `jskit session ${paths.sessionId} step`
    });
  }
  await writeReceipt(paths, "implementation_changes_detected", `Detected ${status.changedFiles.length} changed file entries.`);
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

function reviewPromptStepId(passNumber) {
  return passNumber === 1
    ? "initial_review_prompt_rendered"
    : passNumber === 2
      ? "followup_review_prompt_rendered"
      : "final_review_prompt_rendered";
}

async function renderReviewPrompt(paths, passNumber) {
  const prompt = await renderPrompt(paths, "review_changes.md", {
    changed_files: await changedFilesFromLastCommit(paths),
    review_pass: String(passNumber),
    review_pass_note: passNumber >= 3 ? "This is the final review pass before doctor and PR steps." : ""
  });
  await writeTextFile(path.join(paths.sessionRoot, "prompt.md"), prompt);
  await writeReceipt(paths, reviewPromptStepId(passNumber), `Rendered review prompt pass ${passNumber}.`);
  await markStatus(paths, SESSION_STATUS.WAITING_FOR_USER);
  return buildSessionResponse(paths, {
    prompt,
    status: SESSION_STATUS.WAITING_FOR_USER
  });
}

function reviewChangesStepId(passNumber) {
  return passNumber === 1
    ? "initial_review_changes_detected"
    : passNumber === 2
      ? "followup_review_changes_detected"
      : "final_review_changes_detected";
}

async function detectAndCommitReviewChanges(paths, passNumber) {
  const result = await commitWorktree(paths, {
    allowNoChanges: true,
    message: `Apply review pass ${passNumber} for ${paths.sessionId}`
  });
  if (!result.ok) {
    return failSession(paths, {
      code: "review_commit_failed",
      message: result.output || `Failed to commit review pass ${passNumber}.`,
      repairCommand: `git -C ${paths.worktree} status --short`
    });
  }
  const message = result.changedFiles?.length
    ? `Committed review pass ${passNumber} changes.`
    : `No review pass ${passNumber} changes detected.`;
  await writeReceipt(paths, reviewChangesStepId(passNumber), message);
  await markStatus(paths, SESSION_STATUS.RUNNING);
  return buildSessionResponse(paths);
}

function userCheckStepId(passNumber) {
  return passNumber === 1
    ? "initial_user_check_completed"
    : passNumber === 2
      ? "followup_user_check_completed"
      : "final_user_check_completed";
}

async function userCheck(paths, passNumber, options = {}) {
  const result = normalizeText(options.userCheck || options["user-check"]).toLowerCase();
  if (result === "passed" || result === "pass" || result === "ok" || result === "yes") {
    await writeReceipt(paths, userCheckStepId(passNumber), `User confirmed check ${passNumber} passed.`);
    await markStatus(paths, SESSION_STATUS.RUNNING);
    return buildSessionResponse(paths);
  }
  if (result === "failed" || result === "fail" || result === "no") {
    return failSession(paths, {
      code: "user_check_failed",
      message: `User check ${passNumber} was reported as failed. Continue in Codex, then retry this step with --user-check passed.`,
      repairCommand: `jskit session ${paths.sessionId} step --user-check passed`
    });
  }
  const prompt = await renderPrompt(paths, "user_check.md", {
    review_pass: String(passNumber)
  });
  await writeTextFile(path.join(paths.sessionRoot, "prompt.md"), prompt);
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
    await writeTextFile(path.join(paths.sessionRoot, "prompt.md"), prompt);
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

async function pushBranch(paths) {
  const result = await runGitInWorktree(paths.worktree, ["push", "-u", "origin", "HEAD"], {
    timeout: 1000 * 60 * 5
  });
  if (!result.ok) {
    return failSession(paths, {
      code: "branch_push_failed",
      message: result.output || "Failed to push session branch.",
      repairCommand: `git -C ${paths.worktree} push -u origin HEAD`
    });
  }
  await writeReceipt(paths, "branch_pushed", `Pushed branch ${paths.branch}.`);
  await markStatus(paths, SESSION_STATUS.RUNNING);
  return buildSessionResponse(paths);
}

function issueNumberFromUrl(issueUrl) {
  const match = /\/issues\/(\d+)(?:\b|$)/u.exec(String(issueUrl || ""));
  return match ? match[1] : "";
}

async function createPr(paths) {
  const issueUrl = await readTrimmedFile(path.join(paths.sessionRoot, "issue_url"));
  const issueText = await readTrimmedFile(path.join(paths.sessionRoot, "issue.md"));
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
    titleFromIssue(issueText),
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
    await writeTextFile(path.join(paths.sessionRoot, "prompt.md"), prompt);
    return failSession(paths, {
      code: "pr_create_failed",
      message: result.output || "Failed to create PR.",
      repairCommand: "gh pr create",
      prompt
    });
  }
  const prUrl = result.stdout.split(/\r?\n/u).map((line) => line.trim()).find(Boolean) || result.stdout;
  await writeTextFile(path.join(paths.sessionRoot, "pr_url"), prUrl);
  await writeReceipt(paths, "pr_created", `Created PR ${prUrl}.`);
  await markStatus(paths, SESSION_STATUS.RUNNING);
  return buildSessionResponse(paths);
}

async function mergePr(paths) {
  const prUrl = await readTrimmedFile(path.join(paths.sessionRoot, "pr_url"));
  const mergeResult = await runCommand("gh", ["pr", "merge", prUrl, "--merge", "--delete-branch"], {
    cwd: paths.worktree,
    timeout: 1000 * 60 * 5
  });
  if (!mergeResult.ok) {
    const prompt = await renderPrompt(paths, "pr_failure.md", {
      doctor_output: mergeResult.output
    });
    await writeTextFile(path.join(paths.sessionRoot, "prompt.md"), prompt);
    return failSession(paths, {
      code: "pr_merge_failed",
      message: mergeResult.output || "Failed to merge PR.",
      repairCommand: `gh pr merge ${prUrl} --merge --delete-branch`,
      prompt
    });
  }
  const issueUrl = await readTrimmedFile(path.join(paths.sessionRoot, "issue_url"));
  if (issueUrl) {
    await runCommand("gh", ["issue", "close", issueUrl, "--comment", `Merged PR ${prUrl}.`], {
      cwd: paths.worktree,
      timeout: 1000 * 60
    });
  }
  await writeReceipt(paths, "pr_merged", `Merged PR ${prUrl}.`);
  await markStatus(paths, SESSION_STATUS.RUNNING);
  return buildSessionResponse(paths);
}

async function removeWorktree(paths) {
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
  await writeReceipt(paths, "worktree_removed", `Removed worktree ${paths.worktree}.`);
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
  issue_prompt_rendered: renderIssuePrompt,
  issue_drafted: draftIssue,
  issue_created: createIssue,
  implementation_prompt_rendered: renderImplementationPrompt,
  implementation_changes_detected: detectChanges,
  implementation_changes_committed: commitImplementation,
  initial_review_prompt_rendered: (paths) => renderReviewPrompt(paths, 1),
  initial_review_changes_detected: (paths) => detectAndCommitReviewChanges(paths, 1),
  initial_user_check_completed: (paths, options) => userCheck(paths, 1, options),
  followup_review_prompt_rendered: (paths) => renderReviewPrompt(paths, 2),
  followup_review_changes_detected: (paths) => detectAndCommitReviewChanges(paths, 2),
  followup_user_check_completed: (paths, options) => userCheck(paths, 2, options),
  final_review_prompt_rendered: (paths) => renderReviewPrompt(paths, 3),
  final_review_changes_detected: (paths) => detectAndCommitReviewChanges(paths, 3),
  final_user_check_completed: (paths, options) => userCheck(paths, 3, options),
  doctor_run: runDoctor,
  branch_pushed: pushBranch,
  pr_created: createPr,
  pr_merged: mergePr,
  worktree_removed: removeWorktree,
  session_finished: finishSession
});

const PRECONDITION_RUNNERS = Object.freeze({
  git_current_branch: (paths) => assertGitCurrentBranch(paths.targetRoot),
  git_repository: (paths) => assertGitRepository(paths.targetRoot),
  github_auth: (paths) => assertGhAuth(paths.targetRoot),
  github_origin: (paths) => assertGithubOrigin(paths.targetRoot),
  issue_artifacts: assertIssueArtifacts,
  issue_text_exists: assertIssueTextExists,
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
      await runCommand("gh", ["issue", "close", issueUrl, "--comment", `Abandoned JSKIT Studio session ${paths.sessionId}.`], {
        cwd: paths.targetRoot,
        timeout: 1000 * 60
      });
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
  adoptCodexThreadId,
  buildSessionResponse,
  buildSessionErrorResponse,
  createSession,
  createSessionId,
  extractIssueText,
  inspectSession,
  inspectSessionDetails,
  isValidSessionId,
  listSessions,
  renderTemplate,
  resolveSessionPaths,
  runSessionStep
};
