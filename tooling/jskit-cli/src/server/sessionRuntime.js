import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rmdir
} from "node:fs/promises";
import path from "node:path";
import {
  BLUEPRINT_CODEX_HANDOFF,
  AUTOMATED_CHECK_REPAIR_CODEX_HANDOFF,
  DEEP_UI_CHECK_CODEX_HANDOFF,
  ISSUE_DETAILS_CODEX_HANDOFF,
  PLAN_EXECUTION_CODEX_HANDOFF,
  REVIEW_PASS_LIMIT,
  REVIEW_EXECUTION_CODEX_HANDOFF,
  SESSION_STATUS,
  SESSION_WORKFLOW_VERSION,
  STEP_DEFINITIONS,
  STEP_IDS,
  STEP_PRECONDITION_NAMES
} from "./sessionRuntime/constants.js";
import {
  fileExists,
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
  normalizeReviewPassNumber,
  readActiveCycle,
  readReceiptSteps,
  readReviewPasses,
  readSessionArtifacts,
  reviewPassRoot,
  writeActiveCycle,
  writeCycleReceipt,
  writeReceipt
} from "./sessionRuntime/responses.js";
import {
  applyPreconditions,
  assertAcceptedChangesCommitted,
  assertActiveCycleExists,
  assertActiveCycleUserCheckPassed,
  assertBlueprintUpdateSatisfied,
  assertDeepUiCheckSatisfied,
  assertDependenciesInstalled,
  assertFinalReportExists,
  assertGhAuth,
  assertGitCurrentBranch,
  assertGitRepository,
  assertGithubOrigin,
  assertIssueMetadataExists,
  assertIssueTextExists,
  assertIssueUrlExists,
  assertAutomatedChecksPassed,
  assertIssueDetailsExists,
  assertPlanTextExists,
  assertPrUrlExists,
  assertReadyJskitApp,
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
  const pattern = new RegExp(`\\[${normalizedMarker}\\]([\\s\\S]*?)\\[/${normalizedMarker}\\]`, "gu");
  const matches = [...text.matchAll(pattern)];
  return normalizeText(matches.length > 0 ? matches[matches.length - 1][1] : "");
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

function extractIssueDetails(value = "") {
  return extractMarkedText(value, "issue_details");
}

function extractIssueCategory(value = "") {
  return extractMarkedText(value, "issue_category");
}

function extractUiImpact(value = "") {
  return extractMarkedText(value, "ui_impact");
}

function extractAgentDecisions(value = "") {
  return extractMarkedText(value, "agent_decisions");
}

function normalizeIssueCategory(value = "") {
  const category = normalizeText(value).toLowerCase();
  return ["client", "server", "client_server", "tooling", "unknown"].includes(category)
    ? category
    : "";
}

function normalizeUiImpact(value = "") {
  const impact = normalizeText(value).toLowerCase();
  return ["none", "possible", "definite", "unknown"].includes(impact)
    ? impact
    : "";
}

async function writePromptArtifact(paths, fileName, prompt) {
  await writeTextFile(path.join(paths.sessionRoot, "prompts", fileName), prompt);
}

function commandText(command, args = []) {
  return [command, ...args].map((part) => {
    const value = String(part || "");
    return /^[A-Za-z0-9_./:=@,+-]+$/u.test(value)
      ? value
      : `'${value.replaceAll("'", "'\\''")}'`;
  }).join(" ");
}

function cycleRootPath(paths, cycle) {
  return path.join(paths.sessionRoot, "cycles", `cycle_${cycle}`);
}

function cyclePlanPath(paths, cycle) {
  return path.join(cycleRootPath(paths, cycle), "plan.md");
}

function cyclePlanPromptFileName(cycle) {
  return `cycle_${cycle}_plan_request.md`;
}

function cyclePlanExecutionPromptFileName(cycle) {
  return `cycle_${cycle}_plan_execution.md`;
}

async function readCurrentPlan(paths) {
  const activeCycle = await readActiveCycle(paths);
  const planPath = cyclePlanPath(paths, activeCycle);
  return {
    activeCycle,
    planPath,
    planText: await readTrimmedFile(planPath)
  };
}

function commandOutputSummary(output = "") {
  const normalized = normalizeText(output);
  if (normalized.length <= 1800) {
    return normalized;
  }
  return normalized.slice(-1800);
}

async function appendCommandLog(paths, {
  args = [],
  command,
  cwd = "",
  kind = "command",
  result
} = {}) {
  if (!paths?.sessionRoot || !command || !result) {
    return;
  }
  const entry = {
    at: timestampForReceipt(),
    command: commandText(command, args),
    cwd,
    exitCode: Number.isInteger(result.exitCode) ? result.exitCode : null,
    kind,
    ok: result.ok === true,
    outputSummary: commandOutputSummary(result.output)
  };
  await appendFile(path.join(paths.sessionRoot, "command_log.jsonl"), `${JSON.stringify(entry)}\n`, "utf8");
}

async function runLoggedCommand(paths, kind, command, args = [], options = {}) {
  const result = await runCommand(command, args, options);
  await appendCommandLog(paths, {
    args,
    command,
    cwd: options.cwd || "",
    kind,
    result
  });
  return result;
}

async function readIssueMetadata(paths) {
  const source = await readTextIfExists(path.join(paths.sessionRoot, "issue_metadata.json"));
  if (!source) {
    return {};
  }
  try {
    const parsed = JSON.parse(source);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function writeIssueMetadata(paths, metadata = {}) {
  const existing = await readIssueMetadata(paths);
  const next = {
    ...existing,
    ...metadata
  };
  await writeTextFile(path.join(paths.sessionRoot, "issue_metadata.json"), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

async function readGithubComments(paths) {
  const source = await readTextIfExists(path.join(paths.sessionRoot, "github_comments.json"));
  if (!source) {
    return {};
  }
  const parsed = parseJsonObject(source);
  return parsed || {};
}

async function writeGithubComments(paths, comments = {}) {
  await writeTextFile(path.join(paths.sessionRoot, "github_comments.json"), `${JSON.stringify(comments, null, 2)}\n`);
}

async function commentOnIssueOnce(paths, {
  bodyFile,
  issueUrl,
  purpose
}) {
  const normalizedPurpose = normalizeText(purpose);
  if (!issueUrl || !normalizedPurpose) {
    return {
      ok: true,
      skipped: true
    };
  }
  const comments = await readGithubComments(paths);
  if (comments[normalizedPurpose]) {
    return {
      ok: true,
      skipped: true
    };
  }
  const result = await runLoggedCommand(paths, "github_issue_comment", "gh", ["issue", "comment", issueUrl, "--body-file", bodyFile], {
    cwd: paths.targetRoot,
    timeout: 1000 * 60
  });
  if (!result.ok) {
    return {
      ok: false,
      output: result.output
    };
  }
  comments[normalizedPurpose] = {
    bodyFile,
    commentedAt: timestampForReceipt(),
    issueUrl,
    purpose: normalizedPurpose
  };
  await writeGithubComments(paths, comments);
  return {
    ok: true,
    skipped: false
  };
}

async function appendAgentDecisions(paths, decisions = "") {
  const normalized = normalizeText(decisions);
  if (!normalized) {
    return;
  }
  const decisionsPath = path.join(paths.sessionRoot, "agent_decisions.md");
  const existing = await readTextIfExists(decisionsPath);
  await writeTextFile(
    decisionsPath,
    `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${normalized}\n`
  );
}

async function appendAgentDecisionsInput(paths, options = {}) {
  const source = normalizeText(options.agentDecisions || options["agent-decisions"]);
  if (!source) {
    return;
  }
  await appendAgentDecisions(paths, extractAgentDecisions(source) || source);
}

async function recordIssueInAgentDecisions(paths, issueUrl = "") {
  const normalizedIssueUrl = normalizeText(issueUrl);
  if (!normalizedIssueUrl) {
    return;
  }
  const decisionsPath = path.join(paths.sessionRoot, "agent_decisions.md");
  const existing = await readTextIfExists(decisionsPath);
  if (existing.includes(`Issue: ${normalizedIssueUrl}`)) {
    return;
  }
  await writeTextFile(
    decisionsPath,
    `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}Issue: ${normalizedIssueUrl}\n\n`
  );
}

function issueMetadataFromUrl(issueUrl = "") {
  const match = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/issues\/(\d+)(?:\b|$)/u.exec(normalizeText(issueUrl));
  if (!match) {
    return {
      issueNumber: "",
      owner: "",
      repository: ""
    };
  }
  return {
    issueNumber: match[3],
    owner: match[1],
    repository: match[2]
  };
}

function nextCycleNumber(cycle = "001") {
  return String(Number.parseInt(String(cycle || "1"), 10) + 1).padStart(3, "0");
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
  await writeTextFile(path.join(initialPaths.sessionRoot, "agent_decisions.md"), `# Agent Decisions\n\nSession: ${initialPaths.sessionId}\nCreated: ${now.toISOString()}\n\n`);
  await writeTextFile(path.join(initialPaths.sessionRoot, "workflow_version"), `${SESSION_WORKFLOW_VERSION}\n`);
  await writeActiveCycle(initialPaths, "001");
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
  const { planText } = await readCurrentPlan(paths);

  const [issueText, issueTitle, receipts, transcriptLog] = await Promise.all([
    readTextIfExists(path.join(paths.sessionRoot, "issue.md")),
    readTrimmedFile(path.join(paths.sessionRoot, "issue_title")),
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
  const [baseBranchResult, baseCommitResult] = await Promise.all([
    runGit(paths.targetRoot, ["branch", "--show-current"], { timeout: 15000 }),
    runGit(paths.targetRoot, ["rev-parse", "--verify", "HEAD"], { timeout: 15000 })
  ]);
  const baseBranch = normalizeText(baseBranchResult.stdout);
  const baseCommit = normalizeText(baseCommitResult.stdout);
  if (await hasWorktree(paths)) {
    if (baseBranch && !await readTrimmedFile(path.join(paths.sessionRoot, "base_branch"))) {
      await writeTextFile(path.join(paths.sessionRoot, "base_branch"), `${baseBranch}\n`);
    }
    if (baseCommit && !await readTrimmedFile(path.join(paths.sessionRoot, "base_commit"))) {
      await writeTextFile(path.join(paths.sessionRoot, "base_commit"), `${baseCommit}\n`);
    }
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
  const result = await runLoggedCommand(paths, "git_worktree_add", "git", ["worktree", "add", "-b", paths.branch, paths.worktree, "HEAD"], {
    cwd: paths.targetRoot,
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
  if (baseBranch) {
    await writeTextFile(path.join(paths.sessionRoot, "base_branch"), `${baseBranch}\n`);
  }
  if (baseCommit) {
    await writeTextFile(path.join(paths.sessionRoot, "base_commit"), `${baseCommit}\n`);
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

function parsePackageManager(value = "") {
  const normalized = normalizeText(value);
  const match = /^([a-z][a-z0-9-]*)(?:@(.+))?$/u.exec(normalized);
  if (!match) {
    return {
      name: "",
      version: ""
    };
  }
  return {
    name: match[1],
    version: match[2] || ""
  };
}

async function hasWorktreeFile(worktree, fileName) {
  return fileExists(path.join(worktree, fileName));
}

async function dependencyInstallCommandForWorktree(worktree) {
  const packageJsonSource = await readTextIfExists(path.join(worktree, "package.json"));
  let packageManager = {
    name: "",
    version: ""
  };
  if (packageJsonSource) {
    try {
      const packageJson = JSON.parse(packageJsonSource);
      packageManager = parsePackageManager(packageJson?.packageManager);
    } catch {
      packageManager = {
        name: "",
        version: ""
      };
    }
  }
  const hasPackageLock = await hasWorktreeFile(worktree, "package-lock.json") ||
    await hasWorktreeFile(worktree, "npm-shrinkwrap.json");
  const hasPnpmLock = await hasWorktreeFile(worktree, "pnpm-lock.yaml");
  const hasYarnLock = await hasWorktreeFile(worktree, "yarn.lock");
  const hasBunLock = await hasWorktreeFile(worktree, "bun.lock") ||
    await hasWorktreeFile(worktree, "bun.lockb");

  if (packageManager.name === "pnpm" || (!packageManager.name && hasPnpmLock)) {
    return ["pnpm", hasPnpmLock ? ["install", "--frozen-lockfile"] : ["install"]];
  }
  if (packageManager.name === "yarn" || (!packageManager.name && hasYarnLock)) {
    const major = Number.parseInt(packageManager.version.split(".")[0] || "1", 10);
    return ["yarn", hasYarnLock && major >= 2 ? ["install", "--immutable"] : hasYarnLock ? ["install", "--frozen-lockfile"] : ["install"]];
  }
  if (packageManager.name === "bun" || (!packageManager.name && hasBunLock)) {
    return ["bun", hasBunLock ? ["install", "--frozen-lockfile"] : ["install"]];
  }
  return ["npm", hasPackageLock ? ["ci"] : ["install"]];
}

async function installDependencies(paths, _options = {}, context = {}) {
  const preconditions = context.preconditions || [];
  const [command, args] = await dependencyInstallCommandForWorktree(paths.worktree);
  const result = await runLoggedCommand(paths, "dependencies_install", command, args, {
    cwd: paths.worktree,
    timeout: 1000 * 60 * 10
  });
  if (!result.ok) {
    return failSession(paths, {
      code: "dependencies_install_failed",
      message: result.output || `${command} ${args.join(" ")} failed in the session worktree.`,
      repairCommand: `cd ${paths.worktree} && ${command} ${args.join(" ")}`,
      preconditions
    });
  }
  return recordDependenciesInstalled(paths, {
    message: result.output || `Installed Node dependencies in the session worktree with ${command} ${args.join(" ")}.`,
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
  const issueTitle = normalizeText(options.issueTitle) || extractIssueTitle(options.issue);
  if (!issueTitle) {
    return failSession(paths, {
      code: "issue_title_required",
      message: "The issue drafting step requires an approved issue title.",
      repairCommand: `jskit session ${paths.sessionId} step --issue-title "<title>" --issue -`
    });
  }
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
  const existingIssueUrl = await readTrimmedFile(path.join(paths.sessionRoot, "issue_url"));
  const issueText = await readTrimmedFile(path.join(paths.sessionRoot, "issue.md"));
  const issueTitle = await readTrimmedFile(path.join(paths.sessionRoot, "issue_title")) || titleFromIssue(issueText);
  if (existingIssueUrl) {
    await writeIssueMetadata(paths, {
      ...issueMetadataFromUrl(existingIssueUrl),
      issueBody: issueText,
      issueBodyPath: path.join(paths.sessionRoot, "issue.md"),
      issueTitle,
      issueUrl: existingIssueUrl
    });
    await recordIssueInAgentDecisions(paths, existingIssueUrl);
    await writeReceipt(paths, "issue_created", `Reused GitHub issue ${existingIssueUrl}.`);
    await markStatus(paths, SESSION_STATUS.RUNNING);
    return buildSessionResponse(paths, {
      preconditions
    });
  }
  const result = await runLoggedCommand(paths, "github_issue_create", "gh", [
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
  await writeIssueMetadata(paths, {
    ...issueMetadataFromUrl(issueUrl),
    issueBody: issueText,
    issueBodyPath: path.join(paths.sessionRoot, "issue.md"),
    issueTitle,
    issueUrl
  });
  await recordIssueInAgentDecisions(paths, issueUrl);
  await writeReceipt(paths, "issue_created", `Created GitHub issue ${issueUrl}.`);
  await markStatus(paths, SESSION_STATUS.RUNNING);
  return buildSessionResponse(paths, {
    preconditions
  });
}

async function renderIssueDetailsPrompt(paths, _options = {}, context = {}) {
  const preconditions = context.preconditions || [];
  const issueText = await readTrimmedFile(path.join(paths.sessionRoot, "issue.md"));
  const issueTitle = await readTrimmedFile(path.join(paths.sessionRoot, "issue_title")) || titleFromIssue(issueText);
  const issueUrl = await readTrimmedFile(path.join(paths.sessionRoot, "issue_url"));
  const issueNumber = issueNumberFromUrl(issueUrl);
  const prompt = await renderPrompt(paths, "issue_details.md", {
    issue_file: path.join(paths.sessionRoot, "issue.md"),
    issue_number: issueNumber,
    issue_text: issueText,
    issue_title: issueTitle,
    issue_url: issueUrl,
    issue_details_file: path.join(paths.sessionRoot, "issue_details.md"),
    worktree: paths.worktree
  });
  await writePromptArtifact(paths, "issue_details.md", prompt);
  await markStatus(paths, SESSION_STATUS.WAITING_FOR_USER);
  return buildSessionResponse(paths, {
    codex: ISSUE_DETAILS_CODEX_HANDOFF,
    ok: true,
    preconditions,
    prompt,
    status: SESSION_STATUS.WAITING_FOR_USER
  });
}

async function saveIssueDetails(paths, options = {}, context = {}) {
  const preconditions = context.preconditions || [];
  const source = normalizeText(options.issueDetails || options["issue-details"]);
  const structuredIssueCategory = normalizeText(options.issueCategory || options["issue-category"]);
  const structuredUiImpact = normalizeText(options.uiImpact || options["ui-impact"]);
  const issueDetails = extractIssueDetails(source) || (
    structuredIssueCategory && structuredUiImpact ? source : ""
  );
  if (!source && !structuredIssueCategory && !structuredUiImpact) {
    return renderIssueDetailsPrompt(paths, options, context);
  }
  if (!issueDetails) {
    return failSession(paths, {
      code: "issue_details_required",
      message: "The details step requires confirmed issue details from Codex or the Studio form.",
      repairCommand: `jskit session ${paths.sessionId} step --issue-details -`,
      preconditions
    });
  }

  const issueCategory = normalizeIssueCategory(structuredIssueCategory || extractIssueCategory(source));
  const uiImpact = normalizeUiImpact(structuredUiImpact || extractUiImpact(source));
  if (!issueCategory) {
    return failSession(paths, {
      code: "issue_category_invalid",
      message: "Issue details must include [issue_category]client, server, client_server, tooling, or unknown[/issue_category].",
      repairCommand: `jskit session ${paths.sessionId} step --issue-details -`,
      preconditions
    });
  }
  if (!uiImpact) {
    return failSession(paths, {
      code: "ui_impact_invalid",
      message: "Issue details must include [ui_impact]none, possible, definite, or unknown[/ui_impact].",
      repairCommand: `jskit session ${paths.sessionId} step --issue-details -`,
      preconditions
    });
  }

  await writeTextFile(path.join(paths.sessionRoot, "issue_details.md"), issueDetails);
  await writeIssueMetadata(paths, {
    issueCategory,
    uiImpact,
    issueDetailsPath: path.join(paths.sessionRoot, "issue_details.md")
  });

  const decisions = extractAgentDecisions(source);
  await appendAgentDecisions(paths, decisions);

  const issueUrl = await readTrimmedFile(path.join(paths.sessionRoot, "issue_url"));
  if (issueUrl) {
    const commentResult = await commentOnIssueOnce(paths, {
      bodyFile: path.join(paths.sessionRoot, "issue_details.md"),
      issueUrl,
      purpose: "issue_details"
    });
    if (!commentResult.ok) {
      return failSession(paths, {
        code: "issue_details_comment_failed",
        message: commentResult.output || "Failed to comment the issue details on the GitHub issue.",
        repairCommand: `gh issue comment ${issueUrl} --body-file ${path.join(paths.sessionRoot, "issue_details.md")}`,
        preconditions
      });
    }
  }

  await writeReceipt(paths, "issue_details_gathered", "Saved confirmed issue details and recorded the GitHub issue comment.");
  await markStatus(paths, SESSION_STATUS.RUNNING);
  return buildSessionResponse(paths, {
    preconditions
  });
}

async function makePlan(paths, options = {}, context = {}) {
  const preconditions = context.preconditions || [];
  const activeCycle = await readActiveCycle(paths);
  const issueText = await readTrimmedFile(path.join(paths.sessionRoot, "issue.md"));
  const issueTitle = await readTrimmedFile(path.join(paths.sessionRoot, "issue_title")) || titleFromIssue(issueText);
  const issueUrl = await readTrimmedFile(path.join(paths.sessionRoot, "issue_url"));
  const issueNumber = issueNumberFromUrl(issueUrl);
  const issueDetails = await readTrimmedFile(path.join(paths.sessionRoot, "issue_details.md"));
  const planText = extractPlanText(options.plan);
  const agentDecisionsPath = path.join(paths.sessionRoot, "agent_decisions.md");
  const agentDecisionsText = await readTextIfExists(agentDecisionsPath);
  const currentCycleRoot = cycleRootPath(paths, activeCycle);
  const planPath = cyclePlanPath(paths, activeCycle);
  const reworkRequestPath = path.join(currentCycleRoot, "rework_request.md");
  const reworkRequest = await readTextIfExists(reworkRequestPath);

  if (!planText) {
    const prompt = await renderPrompt(paths, "plan_issue.md", {
      active_cycle: activeCycle,
      agent_decisions_file: agentDecisionsPath,
      agent_decisions_text: agentDecisionsText,
      app_blueprint_file: path.join(paths.worktree, ".jskit", "APP_BLUEPRINT.md"),
      issue_file: path.join(paths.sessionRoot, "issue.md"),
      issue_number: issueNumber,
      issue_text: issueText,
      issue_title: issueTitle,
      issue_title_file: path.join(paths.sessionRoot, "issue_title"),
      issue_url: issueUrl,
      issue_details_file: path.join(paths.sessionRoot, "issue_details.md"),
      issue_details_text: issueDetails,
      plan_file: planPath,
      plan_source: activeCycle === "001" ? "issue" : "rework",
      rework_request: reworkRequest,
      rework_request_file: reworkRequest ? reworkRequestPath : "",
      worktree: paths.worktree
    });
    await writePromptArtifact(paths, cyclePlanPromptFileName(activeCycle), prompt);
    await markStatus(paths, SESSION_STATUS.WAITING_FOR_USER);
    return buildSessionResponse(paths, {
      ok: true,
      preconditions,
      prompt,
      status: SESSION_STATUS.WAITING_FOR_USER
    });
  }

  await mkdir(currentCycleRoot, { recursive: true });
  await writeTextFile(planPath, planText);
  await appendAgentDecisions(paths, extractAgentDecisions(options.plan));
  await writeReceipt(paths, "plan_made", `Saved cycle ${activeCycle} plan.`);
  await markStatus(paths, SESSION_STATUS.RUNNING);
  return buildSessionResponse(paths, {
    preconditions
  });
}

async function renderPlanExecutionPrompt(paths, _options = {}, context = {}) {
  const preconditions = context.preconditions || [];
  const activeCycle = await readActiveCycle(paths);
  const executionPromptPath = path.join(paths.sessionRoot, "prompts", cyclePlanExecutionPromptFileName(activeCycle));
  if (await fileExists(executionPromptPath)) {
    await writeReceipt(paths, "plan_executed", `Cycle ${activeCycle} plan execution completed by Codex.`);
    await markStatus(paths, SESSION_STATUS.RUNNING);
    return buildSessionResponse(paths, {
      preconditions
    });
  }

  const issueText = await readTrimmedFile(path.join(paths.sessionRoot, "issue.md"));
  const issueTitle = await readTrimmedFile(path.join(paths.sessionRoot, "issue_title")) || titleFromIssue(issueText);
  const issueUrl = await readTrimmedFile(path.join(paths.sessionRoot, "issue_url"));
  const issueNumber = issueNumberFromUrl(issueUrl);
  const { planPath, planText } = await readCurrentPlan(paths);
  const issueDetailsPath = path.join(paths.sessionRoot, "issue_details.md");
  const issueDetails = await readTrimmedFile(issueDetailsPath);
  const executionPrompt = await renderPrompt(paths, "execute_plan.md", {
    active_cycle: activeCycle,
    issue_file: path.join(paths.sessionRoot, "issue.md"),
    issue_number: issueNumber,
    issue_title: issueTitle,
    issue_url: issueUrl,
    issue_details_file: issueDetailsPath,
    issue_details_text: issueDetails,
    plan_file: planPath,
    plan_text: planText,
    worktree: paths.worktree
  });
  await writePromptArtifact(paths, cyclePlanExecutionPromptFileName(activeCycle), executionPrompt);
  await markStatus(paths, SESSION_STATUS.WAITING_FOR_USER);
  return buildSessionResponse(paths, {
    codex: PLAN_EXECUTION_CODEX_HANDOFF,
    preconditions,
    prompt: executionPrompt,
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

function uniqueChangedFileList(entries = []) {
  return [...new Set(entries
    .flatMap((entry) => String(entry || "").split(/\r?\n/u))
    .map((line) => line.trim())
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

async function changedFilesInWorktree(paths) {
  const [trackedResult, untrackedResult] = await Promise.all([
    runGitInWorktree(paths.worktree, ["diff", "--name-only", "HEAD"], {
      timeout: 15000
    }),
    runGitInWorktree(paths.worktree, ["ls-files", "--others", "--exclude-standard"], {
      timeout: 15000
    })
  ]);
  return uniqueChangedFileList([
    trackedResult.ok ? trackedResult.stdout : "",
    untrackedResult.ok ? untrackedResult.stdout : ""
  ]);
}

async function changedFilesSinceBase(paths) {
  const baseCommit = await readTrimmedFile(path.join(paths.sessionRoot, "base_commit"));
  const args = baseCommit
    ? ["diff", "--name-only", `${baseCommit}..HEAD`]
    : ["show", "--name-only", "--format=", "HEAD"];
  const result = await runGitInWorktree(paths.worktree, args, {
    timeout: 15000
  });
  if (!result.ok) {
    return (await changedFilesInWorktree(paths)).join("\n");
  }
  return uniqueChangedFileList([
    result.stdout,
    ...(await changedFilesInWorktree(paths))
  ]).join("\n");
}

function nextReviewPassNumber(pass = "") {
  const current = Number.parseInt(normalizeReviewPassNumber(pass), 10);
  return String(current + 1).padStart(3, "0");
}

async function readCurrentReviewPass(paths) {
  return normalizeReviewPassNumber(await readTrimmedFile(path.join(paths.sessionRoot, "review_passes", "current_pass")));
}

async function writeCurrentReviewPass(paths, pass) {
  await writeTextFile(path.join(paths.sessionRoot, "review_passes", "current_pass"), `${normalizeReviewPassNumber(pass)}\n`);
}

async function resolveReviewPassForPrompt(paths) {
  const passes = await readReviewPasses(paths);
  const latestPass = passes.at(-1);
  if (!latestPass) {
    return "001";
  }
  if (!["accepted", "no_changes"].includes(latestPass.status)) {
    return latestPass.pass;
  }
  return nextReviewPassNumber(latestPass.pass);
}

async function writeReviewPassJson(paths, pass, fileName, payload) {
  const root = reviewPassRoot(paths, pass);
  await mkdir(root, { recursive: true });
  await writeTextFile(path.join(root, fileName), `${JSON.stringify(payload, null, 2)}\n`);
}

async function currentHead(paths) {
  const result = await runGitInWorktree(paths.worktree, ["rev-parse", "HEAD"], {
    timeout: 15000
  });
  return result.ok ? result.stdout.trim() : "";
}

async function renderReviewPrompt(paths) {
  const reviewPass = await resolveReviewPassForPrompt(paths);
  await writeCurrentReviewPass(paths, reviewPass);
  const changedFiles = await changedFilesSinceBase(paths);
  const prompt = await renderPrompt(paths, "review_changes.md", {
    changed_files: changedFiles,
    review_pass_limit: String(REVIEW_PASS_LIMIT),
    review_pass_number: reviewPass
  });
  const passRoot = reviewPassRoot(paths, reviewPass);
  await writePromptArtifact(paths, "review.md", prompt);
  await mkdir(passRoot, { recursive: true });
  await writeTextFile(path.join(passRoot, "prompt.md"), prompt);
  await writeReviewPassJson(paths, reviewPass, "prompt.json", {
    changedFiles: changedFiles.split(/\r?\n/u).filter(Boolean),
    maxPasses: REVIEW_PASS_LIMIT,
    pass: reviewPass,
    promptPath: path.join(passRoot, "prompt.md"),
    status: "prompted",
    startedAt: timestampForReceipt()
  });
  await writeReceipt(paths, "review_prompt_rendered", "Started code review.");
  await markStatus(paths, SESSION_STATUS.WAITING_FOR_USER);
  return buildSessionResponse(paths, {
    codex: REVIEW_EXECUTION_CODEX_HANDOFF,
    prompt,
    status: SESSION_STATUS.WAITING_FOR_USER
  });
}

async function acceptReviewChanges(paths, options = {}) {
  const reviewDecisionProvided = Object.hasOwn(options, "reviewFindingsRemaining") ||
    Object.hasOwn(options, "review-findings-remaining");
  if (!reviewDecisionProvided) {
    return failSession(paths, {
      code: "review_decision_required",
      message: "Review/deslop requires an explicit decision before it can advance. Use reviewFindingsRemaining true to run another pass, or false when the review loop is done.",
      repairCommand: `jskit session ${paths.sessionId} step --review-findings-remaining false`
    });
  }

  const status = await worktreeStatus(paths.worktree);
  if (!status.ok) {
    return failSession(paths, {
      code: "git_status_failed",
      message: status.output || "Failed to inspect review changes.",
      repairCommand: `git -C ${paths.worktree} status --short`
    });
  }
  const message = status.changedFiles.length > 0
    ? `Accepted ${status.changedFiles.length} review changed file entries.`
    : "Accepted review with no file changes.";
  const reviewPass = await readCurrentReviewPass(paths);
  const findingsRemaining = options.reviewFindingsRemaining === true ||
    normalizeText(options["review-findings-remaining"]).toLowerCase() === "true";
  const remainingFindings = normalizeText(options.reviewFindings || options["review-findings"]);
  await writeReviewPassJson(paths, reviewPass, "accepted.json", {
    acceptedAt: timestampForReceipt(),
    changedFiles: status.changedFiles || [],
    findingsRemaining,
    remainingFindings,
    pass: reviewPass,
    status: status.changedFiles?.length ? "accepted" : "no_changes"
  });
  await writeReceipt(paths, "review_changes_accepted", message);
  await markStatus(paths, SESSION_STATUS.RUNNING);
  return buildSessionResponse(paths);
}

async function runAutomatedChecks(paths, {
  stepId,
  label
}) {
  const [command, args] = await doctorCommandForWorktree(paths.worktree);
  const promptFileName = `${stepId}.md`;
  const promptPath = path.join(paths.sessionRoot, "prompts", promptFileName);
  const checksRoot = path.join(paths.sessionRoot, "checks");
  await mkdir(checksRoot, { recursive: true });
  const checkCommand = [command, ...args].join(" ");

  if (await fileExists(promptPath)) {
    await writeTextFile(
      path.join(checksRoot, `${stepId}.json`),
      `${JSON.stringify({
        command: checkCommand,
        ok: true,
        promptPath,
        status: "completed_by_codex",
        stepId
      }, null, 2)}\n`
    );
    await writeReceipt(paths, stepId, `${label} completed by Codex: ${checkCommand}.`);
    await markStatus(paths, SESSION_STATUS.RUNNING);
    return buildSessionResponse(paths);
  }

  const prompt = await renderPrompt(paths, "automated_checks.md", {
    check_command: checkCommand
  });
  await writePromptArtifact(paths, promptFileName, prompt);
  await writeTextFile(
    path.join(checksRoot, `${stepId}.json`),
    `${JSON.stringify({
      command: checkCommand,
      ok: false,
      promptPath,
      status: "prompted",
      stepId
    }, null, 2)}\n`
  );
  await markStatus(paths, SESSION_STATUS.WAITING_FOR_USER);
  return buildSessionResponse(paths, {
    codex: AUTOMATED_CHECK_REPAIR_CODEX_HANDOFF,
    prompt,
    status: SESSION_STATUS.WAITING_FOR_USER
  });
}

async function writeUiCheckJson(paths, fileName, payload) {
  const uiChecksRoot = path.join(paths.sessionRoot, "ui_checks");
  await mkdir(uiChecksRoot, { recursive: true });
  await writeTextFile(path.join(uiChecksRoot, `${fileName}.json`), `${JSON.stringify(payload, null, 2)}\n`);
}

async function runDeepUiCheck(paths, {
  stepId,
  label,
  phase
}, options = {}, context = {}) {
  const preconditions = context.preconditions || [];
  const issueMetadata = await readIssueMetadata(paths);
  const uiImpact = normalizeUiImpact(issueMetadata.uiImpact) || "unknown";
  const skipRequested = options.skipUiCheck === true || normalizeText(options["skip-ui-check"]).toLowerCase() === "true";
  const skipReason = normalizeText(options.skipReason || options["skip-reason"]);
  const shouldSkip = uiImpact === "none" || skipRequested;
  if (shouldSkip) {
    if (skipRequested && uiImpact !== "possible") {
      return failSession(paths, {
        code: "ui_check_skip_not_allowed",
        message: `Deep UI check can only be manually skipped when uiImpact is possible. Current uiImpact is ${uiImpact}.`,
        repairCommand: `jskit session ${paths.sessionId} step`,
        preconditions
      });
    }
    if (skipRequested && !skipReason) {
      return failSession(paths, {
        code: "ui_check_skip_reason_required",
        message: "Skipping a possible Deep UI check requires --skip-reason.",
        repairCommand: `jskit session ${paths.sessionId} step --skip-ui-check --skip-reason "<reason>"`,
        preconditions
      });
    }
    const reason = uiImpact === "none" ? "uiImpact is none." : skipReason;
    await writeUiCheckJson(paths, stepId, {
      ok: true,
      phase,
      reason,
      status: "skipped",
      stepId,
      uiImpact
    });
    await writeReceipt(paths, stepId, `${label} skipped: ${reason}`);
    await markStatus(paths, SESSION_STATUS.RUNNING);
    return buildSessionResponse(paths, {
      preconditions
    });
  }

  const promptFileName = `${stepId}.md`;
  const promptPath = path.join(paths.sessionRoot, "prompts", promptFileName);
  if (await fileExists(promptPath)) {
    await writeReceipt(paths, stepId, `${label} completed by Codex.`);
    await markStatus(paths, SESSION_STATUS.RUNNING);
    return buildSessionResponse(paths, {
      preconditions
    });
  }

  const issueUrl = await readTrimmedFile(path.join(paths.sessionRoot, "issue_url"));
  const issueText = await readTrimmedFile(path.join(paths.sessionRoot, "issue.md"));
  const issueTitle = await readTrimmedFile(path.join(paths.sessionRoot, "issue_title")) || titleFromIssue(issueText);
  const { planPath } = await readCurrentPlan(paths);
  const prompt = await renderPrompt(paths, "deep_ui_check.md", {
    changed_files: await changedFilesSinceBase(paths),
    issue_file: path.join(paths.sessionRoot, "issue.md"),
    issue_number: issueNumberFromUrl(issueUrl),
    issue_title: issueTitle,
    issue_url: issueUrl,
    phase,
    issue_details_file: path.join(paths.sessionRoot, "issue_details.md"),
    plan_file: planPath,
    ui_impact: uiImpact,
    worktree: paths.worktree
  });
  await writePromptArtifact(paths, promptFileName, prompt);
  await writeUiCheckJson(paths, stepId, {
    ok: true,
    phase,
    promptPath,
    status: "prompted",
    stepId,
    uiImpact
  });
  await markStatus(paths, SESSION_STATUS.WAITING_FOR_USER);
  return buildSessionResponse(paths, {
    codex: DEEP_UI_CHECK_CODEX_HANDOFF,
    preconditions,
    prompt,
    status: SESSION_STATUS.WAITING_FOR_USER
  });
}

async function userCheck(paths, options = {}) {
  const result = normalizeText(options.userCheck || options["user-check"]).toLowerCase();
  if (result === "passed" || result === "pass" || result === "ok" || result === "yes") {
    await writeReceipt(paths, "user_check_completed", "User confirmed check passed.");
    await markStatus(paths, SESSION_STATUS.RUNNING);
    return buildSessionResponse(paths);
  }
  if (result === "failed" || result === "fail" || result === "no") {
    const activeCycle = await readActiveCycle(paths);
    await writeCycleReceipt(paths, "user_check_failed", "User reported that manual verification failed.", {
      cycle: activeCycle
    });
    const reworkNotes = normalizeText(options.reworkNotes || options["rework-notes"]);
    if (!reworkNotes) {
      await markStatus(paths, SESSION_STATUS.BLOCKED);
      return buildSessionResponse(paths, {
        ok: false,
        errors: [
          createError({
            code: "user_check_failed",
            message: "User check failed. Provide rework notes to start a new plan cycle.",
            repairCommand: `jskit session ${paths.sessionId} step --user-check failed --rework-notes -`
          })
        ],
        status: SESSION_STATUS.BLOCKED
      });
    }
    const nextCycle = nextCycleNumber(activeCycle);
    await writeTextFile(path.join(paths.sessionRoot, "cycles", `cycle_${nextCycle}`, "rework_request.md"), `${reworkNotes}\n`);
    await writeActiveCycle(paths, nextCycle);
    await writeCycleReceipt(paths, "cycle_started", `Started rework cycle ${nextCycle}.`, {
      cycle: nextCycle
    });
    await markCurrentStep(paths, "plan_made");
    await markStatus(paths, SESSION_STATUS.RUNNING);
    return buildSessionResponse(paths);
  }
  const issueText = await readTrimmedFile(path.join(paths.sessionRoot, "issue.md"));
  const issueUrl = await readTrimmedFile(path.join(paths.sessionRoot, "issue_url"));
  const issueTitle = await readTrimmedFile(path.join(paths.sessionRoot, "issue_title")) || titleFromIssue(issueText);
  const { planPath, planText } = await readCurrentPlan(paths);
  const prompt = await renderPrompt(paths, "user_check.md", {
    issue_file: path.join(paths.sessionRoot, "issue.md"),
    issue_title: issueTitle,
    issue_url: issueUrl,
    issue_details_file: path.join(paths.sessionRoot, "issue_details.md"),
    issue_details_text: await readTrimmedFile(path.join(paths.sessionRoot, "issue_details.md")),
    plan_file: planPath,
    plan_text: planText
  });
  await writePromptArtifact(paths, "user_check.md", prompt);
  await markStatus(paths, SESSION_STATUS.WAITING_FOR_USER);
  return buildSessionResponse(paths, {
    prompt,
    status: SESSION_STATUS.WAITING_FOR_USER
  });
}

async function readAcceptedChangesCommit(paths) {
  const source = await readTextIfExists(path.join(paths.sessionRoot, "changes_committed.json"));
  return parseJsonObject(source) || null;
}

async function commitAcceptedChanges(paths, _options = {}, context = {}) {
  const preconditions = context.preconditions || [];
  let commitInfo = await readAcceptedChangesCommit(paths);

  if (!commitInfo?.commit) {
    const result = await commitWorktree(paths, {
      message: `Implement JSKIT session ${paths.sessionId}`
    });
    if (!result.ok) {
      if (result.output === "No changes found.") {
        return failSession(paths, {
          code: "accepted_changes_missing",
          message: "No accepted worktree changes found to commit.",
          repairCommand: `git -C ${paths.worktree} status --short`,
          preconditions
        });
      }
      return failSession(paths, {
        code: "accepted_changes_commit_failed",
        message: result.output || "Failed to commit accepted changes.",
        repairCommand: `git -C ${paths.worktree} status --short`,
        preconditions
      });
    }
    commitInfo = {
      changedFiles: result.changedFiles || [],
      commit: await currentHead(paths),
      committedAt: timestampForReceipt()
    };
    await writeTextFile(path.join(paths.sessionRoot, "changes_committed.json"), `${JSON.stringify(commitInfo, null, 2)}\n`);
  }

  await writeReceipt(paths, "changes_committed", `Committed accepted changes at ${commitInfo.commit || "unknown"}.`);
  await markStatus(paths, SESSION_STATUS.RUNNING);
  return buildSessionResponse(paths, {
    preconditions
  });
}

async function updateBlueprint(paths, _options = {}, context = {}) {
  const preconditions = context.preconditions || [];
  const issueText = await readTrimmedFile(path.join(paths.sessionRoot, "issue.md"));
  const issueTitle = await readTrimmedFile(path.join(paths.sessionRoot, "issue_title")) || titleFromIssue(issueText);
  const issueUrl = await readTrimmedFile(path.join(paths.sessionRoot, "issue_url"));
  const issueNumber = issueNumberFromUrl(issueUrl);
  const { planPath } = await readCurrentPlan(paths);
  const issueDetailsPath = path.join(paths.sessionRoot, "issue_details.md");
  const agentDecisionsPath = path.join(paths.sessionRoot, "agent_decisions.md");
  const blueprintPath = path.join(paths.worktree, ".jskit", "APP_BLUEPRINT.md");
  const blueprintPromptPath = path.join(paths.sessionRoot, "prompts", "update_blueprint.md");

  if (await fileExists(blueprintPromptPath)) {
    const changedFiles = await changedFilesInWorktree(paths);
    const unexpectedChanges = changedFiles.filter((file) => file !== ".jskit/APP_BLUEPRINT.md");
    if (unexpectedChanges.length > 0) {
      return failSession(paths, {
        code: "blueprint_unexpected_changes",
        message: `The blueprint step changed files outside .jskit/APP_BLUEPRINT.md: ${unexpectedChanges.join(", ")}`,
        repairCommand: `git -C ${paths.worktree} status --short`,
        preconditions
      });
    }

    const blueprintText = await readTrimmedFile(blueprintPath);
    if (!blueprintText) {
      return failSession(paths, {
        code: "app_blueprint_missing_after_update",
        message: "Codex completed the blueprint step without leaving a non-empty .jskit/APP_BLUEPRINT.md file.",
        repairCommand: `jskit session ${paths.sessionId} step`,
        preconditions
      });
    }

    if (changedFiles.includes(".jskit/APP_BLUEPRINT.md")) {
      const addResult = await runGitInWorktree(paths.worktree, ["add", ".jskit/APP_BLUEPRINT.md"], {
        timeout: 15000
      });
      if (!addResult.ok) {
        return failSession(paths, {
          code: "blueprint_stage_failed",
          message: addResult.output || "Failed to stage app blueprint update.",
          repairCommand: `git -C ${paths.worktree} add .jskit/APP_BLUEPRINT.md`,
          preconditions
        });
      }
      const commitResult = await runGitInWorktree(paths.worktree, ["commit", "-m", `Update app blueprint for ${paths.sessionId}`], {
        timeout: 1000 * 60
      });
      if (!commitResult.ok) {
        return failSession(paths, {
          code: "blueprint_commit_failed",
          message: commitResult.output || "Failed to commit app blueprint update.",
          repairCommand: `git -C ${paths.worktree} status --short`,
          preconditions
        });
      }
      await writeReceipt(paths, "blueprint_updated", "Codex updated and JSKIT committed the app blueprint.");
    } else {
      await writeReceipt(paths, "blueprint_updated", "Codex reviewed the app blueprint; no blueprint changes were needed.");
    }
    await markStatus(paths, SESSION_STATUS.RUNNING);
    return buildSessionResponse(paths, {
      preconditions,
      status: SESSION_STATUS.RUNNING
    });
  }

  const prompt = await renderPrompt(paths, "update_blueprint.md", {
    agent_decisions_file: agentDecisionsPath,
    app_blueprint_file: blueprintPath,
    changed_files: await changedFilesSinceBase(paths),
    issue_file: path.join(paths.sessionRoot, "issue.md"),
    issue_number: issueNumber,
    issue_title: issueTitle,
    issue_url: issueUrl,
    issue_details_file: issueDetailsPath,
    plan_file: planPath,
    worktree: paths.worktree
  });
  await writePromptArtifact(paths, "update_blueprint.md", prompt);
  await markStatus(paths, SESSION_STATUS.WAITING_FOR_USER);
  return buildSessionResponse(paths, {
    codex: BLUEPRINT_CODEX_HANDOFF,
    ok: true,
    preconditions,
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
  return ["npx", ["--no-install", "jskit", "app", "verify"]];
}

async function runDoctor(paths) {
  const repairCommitFailure = await maybeCommitDoctorRepair(paths);
  if (repairCommitFailure) {
    return repairCommitFailure;
  }
  const [command, args] = await doctorCommandForWorktree(paths.worktree);
  const result = await runLoggedCommand(paths, "doctor_run", command, args, {
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

async function maybeCommitDoctorRepair(paths) {
  if (!await fileExists(path.join(paths.sessionRoot, "doctor.log")) || await fileExists(path.join(paths.sessionRoot, "steps", "doctor_run"))) {
    return null;
  }
  const status = await worktreeStatus(paths.worktree);
  if (!status.ok) {
    return failSession(paths, {
      code: "git_status_failed",
      message: status.output || "Failed to inspect verification repair changes.",
      repairCommand: `git -C ${paths.worktree} status --short`
    });
  }
  if (status.changedFiles.length < 1) {
    return null;
  }
  const result = await commitWorktree(paths, {
    message: `Verification repairs for ${paths.sessionId}`
  });
  if (!result.ok) {
    return failSession(paths, {
      code: "doctor_repair_commit_failed",
      message: result.output || "Failed to commit verification repair changes.",
      repairCommand: `git -C ${paths.worktree} status --short`
    });
  }
  await writeTextFile(path.join(paths.sessionRoot, "doctor_repair_commit.json"), `${JSON.stringify({
    changedFiles: result.changedFiles || [],
    commit: await currentHead(paths),
    committedAt: timestampForReceipt(),
    ok: true
  }, null, 2)}\n`);
  return null;
}

async function commitLinesSinceBase(paths) {
  const baseCommit = await readTrimmedFile(path.join(paths.sessionRoot, "base_commit"));
  const args = baseCommit
    ? ["log", "--oneline", `${baseCommit}..HEAD`]
    : ["log", "--oneline", "--max-count=10"];
  const result = await runGitInWorktree(paths.worktree, args, {
    timeout: 15000
  });
  return result.ok ? result.stdout.trim() : "";
}

async function readCheckSummaries(paths) {
  const checksRoot = path.join(paths.sessionRoot, "checks");
  try {
    const entries = await readdir(checksRoot, { withFileTypes: true });
    const summaries = [];
    for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".json")).sort((left, right) => left.name.localeCompare(right.name))) {
      const source = await readTextIfExists(path.join(checksRoot, entry.name));
      const parsed = parseJsonObject(source);
      if (parsed) {
        summaries.push(`- ${parsed.stepId}: ${parsed.ok ? "passed" : "failed"} (${parsed.command})`);
      }
    }
    return summaries.join("\n");
  } catch {
    return "";
  }
}

async function readUiCheckSummaries(paths) {
  const uiChecksRoot = path.join(paths.sessionRoot, "ui_checks");
  try {
    const entries = await readdir(uiChecksRoot, { withFileTypes: true });
    const summaries = [];
    for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".json")).sort((left, right) => left.name.localeCompare(right.name))) {
      const source = await readTextIfExists(path.join(uiChecksRoot, entry.name));
      const parsed = parseJsonObject(source);
      if (parsed) {
        summaries.push(`- ${parsed.stepId}: ${parsed.status || (parsed.ok ? "passed" : "failed")}${parsed.reason ? ` (${parsed.reason})` : ""}`);
      }
    }
    return summaries.join("\n");
  } catch {
    return "";
  }
}

async function readReviewPassSummaries(paths) {
  const passes = await readReviewPasses(paths);
  return passes
    .map((entry) => {
      const changedFiles = Array.isArray(entry.changedFiles) && entry.changedFiles.length
        ? `; changed files: ${entry.changedFiles.join(", ")}`
        : "";
      const commit = entry.commit ? `; commit: ${entry.commit}` : "";
      return `- ${entry.label}: ${entry.status}${commit}${changedFiles}`;
    })
    .join("\n");
}

async function createFinalReport(paths, _options = {}, context = {}) {
  const preconditions = context.preconditions || [];
  const issueUrl = await readTrimmedFile(path.join(paths.sessionRoot, "issue_url"));
  const issueTitle = await readTrimmedFile(path.join(paths.sessionRoot, "issue_title"));
  const issueDetails = await readTrimmedFile(path.join(paths.sessionRoot, "issue_details.md"));
  const { planText } = await readCurrentPlan(paths);
  const agentDecisions = await readTextIfExists(path.join(paths.sessionRoot, "agent_decisions.md"));
  const filesChanged = await changedFilesSinceBase(paths);
  const commits = await commitLinesSinceBase(paths);
  const checks = await readCheckSummaries(paths);
  const uiChecks = await readUiCheckSummaries(paths);
  const reviewPasses = await readReviewPassSummaries(paths);
  const commandLogPath = path.join(paths.sessionRoot, "command_log.jsonl");
  const blueprintStatus = await readTextIfExists(path.join(paths.sessionRoot, "steps", "blueprint_updated"));
  const userCheck = await readTextIfExists(path.join(paths.sessionRoot, "steps", `cycle_${await readActiveCycle(paths)}`, "user_check_completed"));
  const report = [
    `# Final Report: ${issueTitle || paths.sessionId}`,
    "",
    `Issue: ${issueUrl || "(missing)"}`,
    `Session: ${paths.sessionId}`,
    "",
    "## Issue Details",
    "",
    issueDetails || "No issue details recorded.",
    "",
    "## Plan",
    "",
    planText || "No plan recorded.",
    "",
    "## Files Changed",
    "",
    filesChanged || "No changed files detected against the session base.",
    "",
    "## Commits",
    "",
    commits || "No commits detected against the session base.",
    "",
    "## Checks",
    "",
    checks || "No structured checks recorded.",
    "",
    "## UI Checks",
    "",
    uiChecks || "No structured UI checks recorded.",
    "",
    "## Review Passes",
    "",
    reviewPasses || "No structured review passes recorded.",
    "",
    "## Command Log",
    "",
    await fileExists(commandLogPath) ? commandLogPath : "No command log recorded.",
    "",
    "## User Check",
    "",
    userCheck.trim() || "No user check receipt recorded.",
    "",
    "## Blueprint",
    "",
    blueprintStatus.trim() || "No blueprint receipt recorded.",
    "",
    "## Remaining Unverified Gaps",
    "",
    "Review the check and UI check sections above; no additional gaps were recorded by JSKIT.",
    "",
    "## Decisions",
    "",
    agentDecisions.trim() || "No decision log recorded.",
    ""
  ].join("\n");
  const reportPath = path.join(paths.sessionRoot, "final_report.md");
  await writeTextFile(reportPath, report);
  if (issueUrl) {
    const commentResult = await commentOnIssueOnce(paths, {
      bodyFile: reportPath,
      issueUrl,
      purpose: "final_report"
    });
    if (!commentResult.ok) {
      return failSession(paths, {
        code: "final_report_comment_failed",
        message: commentResult.output || "Failed to comment final report on the GitHub issue.",
        repairCommand: `gh issue comment ${issueUrl} --body-file ${reportPath}`,
        preconditions
      });
    }
  }
  await writeReceipt(paths, "final_report_created", "Created final report and recorded the GitHub issue comment.");
  await markStatus(paths, SESSION_STATUS.RUNNING);
  return buildSessionResponse(paths, {
    preconditions
  });
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
  const prRef = normalizeText(prUrl);
  const args = prRef
    ? ["pr", "view", prRef, "--json", "state,mergedAt,url,baseRefName"]
    : ["pr", "view", "--json", "state,mergedAt,url,baseRefName"];
  const result = await runLoggedCommand(paths, prRef ? "github_pr_view" : "github_pr_view_current_branch", "gh", args, {
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
    url: payload?.url || prRef
  };
}

async function readCurrentBranchPrState(paths) {
  const result = await runLoggedCommand(paths, "github_pr_view_current_branch", "gh", ["pr", "view", "--json", "state,mergedAt,url,baseRefName"], {
    cwd: paths.worktree,
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
    ok: Boolean(payload?.url),
    output: result.output,
    state: String(payload?.state || "").toUpperCase(),
    url: payload?.url || ""
  };
}

function prStateIsMerged(prState) {
  return Boolean(prState?.ok && prState.state === "MERGED");
}

function prStateIsClosed(prState) {
  return Boolean(prState?.ok && prState.state === "CLOSED");
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

async function removeSessionWorktree(paths) {
  if (await hasWorktree(paths)) {
    const result = await runLoggedCommand(paths, "git_worktree_remove", "git", ["worktree", "remove", paths.worktree], {
      cwd: paths.targetRoot,
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
  return null;
}

async function writePrOutcome(paths, outcome) {
  await writeTextFile(path.join(paths.sessionRoot, "pr_outcome.json"), `${JSON.stringify({
    recordedAt: timestampForReceipt(),
    ...outcome
  }, null, 2)}\n`);
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

  const fetchResult = await runLoggedCommand(paths, "git_fetch_origin", "git", ["fetch", "origin"], {
    cwd: paths.targetRoot,
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

  const pullResult = await runLoggedCommand(paths, "git_pull_base", "git", ["pull", "--ff-only", "origin", branch], {
    cwd: paths.targetRoot,
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

  const pushResult = await runLoggedCommand(paths, "git_push_branch", "git", ["push", "-u", "origin", "HEAD"], {
    cwd: paths.worktree,
    timeout: 1000 * 60 * 5
  });
  if (!pushResult.ok) {
    return failSession(paths, {
      code: "branch_push_failed",
      message: pushResult.output || "Failed to push session branch.",
      repairCommand: `git -C ${paths.worktree} push -u origin HEAD`
    });
  }
  const existingPrState = await readCurrentBranchPrState(paths);
  if (existingPrState.ok && existingPrState.url && !prStateIsClosed(existingPrState)) {
    await writeTextFile(path.join(paths.sessionRoot, "pr_url"), existingPrState.url);
    await writeReceipt(paths, "pr_created", `Pushed branch ${paths.branch} and reused existing PR ${existingPrState.url}. ${helperMapResult.message}`);
    await markStatus(paths, SESSION_STATUS.RUNNING);
    return buildSessionResponse(paths);
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
  const result = await runLoggedCommand(paths, "github_pr_create", "gh", [
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
    const fallbackPrState = await readCurrentBranchPrState(paths);
    if (fallbackPrState.ok && fallbackPrState.url && !prStateIsClosed(fallbackPrState)) {
      await writeTextFile(path.join(paths.sessionRoot, "pr_url"), fallbackPrState.url);
      await writeReceipt(paths, "pr_created", `Pushed branch ${paths.branch} and reused existing PR ${fallbackPrState.url}. ${helperMapResult.message}`);
      await markStatus(paths, SESSION_STATUS.RUNNING);
      return buildSessionResponse(paths);
    }
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

async function closePrWithoutMerge(paths, prUrl, options = {}) {
  const reason = normalizeText(options.closeReason || options["close-reason"]);
  if (!reason) {
    return failSession(paths, {
      code: "close_without_merge_reason_required",
      message: "Finishing without merging requires --close-reason.",
      repairCommand: `jskit session ${paths.sessionId} step --close-without-merge --close-reason "<reason>"`
    });
  }
  const prState = await readPrState(paths, prUrl);
  if (!prState.ok) {
    return failSession(paths, {
      code: "pr_state_failed",
      message: prState.output || "Failed to inspect PR before closing without merge.",
      repairCommand: `gh pr view ${prUrl} --json state,mergedAt,url,baseRefName`
    });
  }
  if (prStateIsMerged(prState)) {
    return failSession(paths, {
      code: "pr_already_merged",
      message: "Cannot finish without merging because the PR is already merged.",
      repairCommand: `jskit session ${paths.sessionId} step`
    });
  }
  if (!prStateIsClosed(prState)) {
    const commentResult = await runLoggedCommand(paths, "github_pr_comment", "gh", ["pr", "comment", prUrl, "--body", `JSKIT session ${paths.sessionId} finished without merging. Reason: ${reason}`], {
      cwd: paths.targetRoot,
      timeout: 1000 * 60
    });
    if (!commentResult.ok) {
      return failSession(paths, {
        code: "pr_comment_failed",
        message: commentResult.output || "Failed to comment on PR before finishing without merge.",
        repairCommand: `gh pr comment ${prUrl} --body "<reason>"`
      });
    }
  }
  const issueUrl = await readTrimmedFile(path.join(paths.sessionRoot, "issue_url"));
  if (issueUrl) {
    await runLoggedCommand(paths, "github_issue_comment", "gh", ["issue", "comment", issueUrl, "--body", `JSKIT session ${paths.sessionId} finished without merging PR ${prUrl}. Reason: ${reason}`], {
      cwd: paths.targetRoot,
      timeout: 1000 * 60
    });
  }
  const removeFailure = await removeSessionWorktree(paths);
  if (removeFailure) {
    return removeFailure;
  }
  await writePrOutcome(paths, {
    issueUrl,
    outcome: "closed_without_merge",
    prUrl,
    prState: prState.state,
    reason
  });
  await writeReceipt(paths, "pr_finalized", `Finished without merging PR ${prUrl}; PR left open and worktree removed ${paths.worktree}. Reason: ${reason}`);
  await markStatus(paths, SESSION_STATUS.RUNNING);
  return buildSessionResponse(paths);
}

async function finalizePr(paths, options = {}) {
  const prUrl = await readTrimmedFile(path.join(paths.sessionRoot, "pr_url"));
  const closeWithoutMerge = options.closeWithoutMerge === true ||
    normalizeText(options["close-without-merge"]).toLowerCase() === "true";
  if (closeWithoutMerge) {
    return closePrWithoutMerge(paths, prUrl, options);
  }
  const mergePr = options.mergePr === true ||
    normalizeText(options["merge-pr"]).toLowerCase() === "true";
  if (!mergePr) {
    return failSession(paths, {
      code: "pr_finalize_decision_required",
      message: "Choose whether to merge the PR or finish without merging.",
      repairCommand: `jskit session ${paths.sessionId} step --merge-pr true`
    });
  }
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
      mergeResult = await runLoggedCommand(paths, "github_pr_merge", "gh", ["pr", "merge", prUrl, "--merge", "--delete-branch"], {
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
      await runLoggedCommand(paths, "github_issue_close", "gh", ["issue", "close", issueUrl, "--comment", `Merged PR ${prUrl}.`], {
        cwd: paths.targetRoot,
        timeout: 1000 * 60
      });
    }
    await writePrOutcome(paths, {
      baseBranch,
      issueUrl,
      outcome: "merged",
      prUrl
    });
    await writeTextFile(mergeMarkerPath, `${prUrl}\n`);
  }
  const updateFailure = await updateLocalBaseBranch(paths, baseBranch);
  if (updateFailure) {
    return updateFailure;
  }
  const removeFailure = await removeSessionWorktree(paths);
  if (removeFailure) {
    return removeFailure;
  }
  await writeReceipt(paths, "pr_finalized", `Merged PR ${prUrl}, updated local ${baseBranch || "base branch"}, and removed worktree ${paths.worktree}.`);
  await markStatus(paths, SESSION_STATUS.RUNNING);
  return buildSessionResponse(paths);
}

async function finishSession(paths) {
  const prUrl = await readTrimmedFile(path.join(paths.sessionRoot, "pr_url"));
  const issueUrl = await readTrimmedFile(path.join(paths.sessionRoot, "issue_url"));
  const codexThreadId = await readTrimmedFile(path.join(paths.sessionRoot, "codex_thread_id"));
  const prOutcome = parseJsonObject(await readTextIfExists(path.join(paths.sessionRoot, "pr_outcome.json")));
  const prompt = await renderPrompt(paths, "final_comment.md", {
    codex_thread_id: codexThreadId,
    issue_url: issueUrl,
    pr_outcome: prOutcome?.outcome || "unknown",
    pr_outcome_reason: prOutcome?.reason || "",
    pr_url: prUrl,
    session_id: paths.sessionId,
    transcript_log: path.join(paths.completedSessionRoot, "transcript.log")
  });
  await writeTextFile(path.join(paths.sessionRoot, "final_comment.md"), prompt);
  if (issueUrl) {
    await runLoggedCommand(paths, "github_issue_comment", "gh", ["issue", "comment", issueUrl, "--body-file", path.join(paths.sessionRoot, "final_comment.md")], {
      cwd: paths.targetRoot,
      timeout: 1000 * 60
    });
  }
  await writeReceipt(paths, "session_finished", `Finished session ${paths.sessionId} with PR outcome ${prOutcome?.outcome || "unknown"}.`);
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
  issue_details_gathered: saveIssueDetails,
  plan_made: makePlan,
  plan_executed: renderPlanExecutionPrompt,
  automated_checks_run: (paths) => runAutomatedChecks(paths, {
    label: "Automated checks",
    stepId: "automated_checks_run"
  }),
  deep_ui_check_run: (paths, options, context) => runDeepUiCheck(paths, {
    label: "Deep UI check",
    phase: "pre_review",
    stepId: "deep_ui_check_run"
  }, options, context),
  review_prompt_rendered: renderReviewPrompt,
  review_changes_accepted: acceptReviewChanges,
  user_check_completed: userCheck,
  changes_committed: commitAcceptedChanges,
  blueprint_updated: updateBlueprint,
  doctor_run: runDoctor,
  final_report_created: createFinalReport,
  pr_created: createPr,
  pr_finalized: finalizePr,
  session_finished: finishSession
});

const PRECONDITION_RUNNERS = Object.freeze({
  accepted_changes_committed: assertAcceptedChangesCommitted,
  active_cycle_exists: assertActiveCycleExists,
  active_cycle_user_check_passed: assertActiveCycleUserCheckPassed,
  blueprint_update_satisfied: assertBlueprintUpdateSatisfied,
  deep_ui_check_satisfied: assertDeepUiCheckSatisfied,
  dependencies_installed: assertDependenciesInstalled,
  final_report_exists: assertFinalReportExists,
  git_current_branch: (paths) => assertGitCurrentBranch(paths.targetRoot),
  git_repository: (paths) => assertGitRepository(paths.targetRoot),
  github_auth: (paths) => assertGhAuth(paths.targetRoot),
  github_origin: (paths) => assertGithubOrigin(paths.targetRoot),
  issue_metadata_exists: assertIssueMetadataExists,
  issue_text_exists: assertIssueTextExists,
  issue_url_exists: assertIssueUrlExists,
  automated_checks_passed: assertAutomatedChecksPassed,
  issue_details_exists: assertIssueDetailsExists,
  plan_text_exists: assertPlanTextExists,
  pr_url_exists: assertPrUrlExists,
  ready_jskit_app: assertReadyJskitApp,
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
    if (artifacts.workflowVersion !== SESSION_WORKFLOW_VERSION) {
      return buildSessionResponse(paths, {
        ok: false,
        errors: [
          createError({
            code: "unsupported_workflow_version",
            message: `Session ${paths.sessionId} uses workflow version ${artifacts.workflowVersion || "unknown"}, but this JSKIT runtime expects ${SESSION_WORKFLOW_VERSION}.`
          })
        ],
        status: SESSION_STATUS.BLOCKED
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
    await appendAgentDecisionsInput(paths, options);
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
      const closeIssueResult = await runLoggedCommand(paths, "github_issue_close", "gh", ["issue", "close", issueUrl, "--comment", `Abandoned JSKIT Studio session ${paths.sessionId}.`], {
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
      await runLoggedCommand(paths, "git_worktree_remove", "git", ["worktree", "remove", "--force", paths.worktree], {
        cwd: paths.targetRoot,
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
  extractIssueDetails,
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
