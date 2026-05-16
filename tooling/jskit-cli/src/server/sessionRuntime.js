import {
  createHash
} from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rm,
  rmdir
} from "node:fs/promises";
import path from "node:path";
import {
  BLUEPRINT_CODEX_HANDOFF,
  AUTOMATED_CHECK_REPAIR_CODEX_HANDOFF,
  DEPENDENCIES_INSTALL_RESULT_FILE,
  DEEP_UI_CHECK_CODEX_HANDOFF,
  ISSUE_DEFINITION_CODEX_HANDOFF,
  ISSUE_FILE_CODEX_HANDOFF,
  PLAN_CODEX_HANDOFF,
  PLAN_EXECUTION_CODEX_HANDOFF,
  PR_FILE_CODEX_HANDOFF,
  PR_MERGE_PREP_CODEX_HANDOFF,
  REVIEW_PASS_LIMIT,
  REVIEW_EXECUTION_CODEX_HANDOFF,
  RESOLVE_DESLOP_CODEX_HANDOFF,
  SESSION_STATUS,
  SESSION_WORKFLOW_VERSION,
  STEP_DEFINITION_BY_ID,
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
  timestampForStepRecord,
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
  readStepRecords,
  readReviewPasses,
  readSessionArtifacts,
  reviewPassRoot,
  writeStepRecord
} from "./sessionRuntime/responses.js";
import {
  applyPreconditions,
  assertAcceptedChangesCommitted,
  assertActiveCycleExists,
  assertActiveCycleUserCheckPassed,
  assertBlueprintUpdateSatisfied,
  assertDeepUiCheckSatisfied,
  assertDependenciesInstalled,
  assertGhAuth,
  assertGitCurrentBranch,
  assertGitRepository,
  assertGithubOrigin,
  assertIssueTextExists,
  assertIssueUrlExists,
  assertAutomatedChecksPassed,
  assertMainCheckoutSyncSatisfied,
  assertPrUrlExists,
  assertPullRequestFileExists,
  assertReadyJskitApp,
  assertSessionExists,
  assertTargetRootWritable,
  assertUserCheckPassed,
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

const SESSION_PROVISION_PACKAGE_SCRIPT = "jskit:provision-session";
const SESSION_FINALIZATION_GUARD_PACKAGE_SCRIPT = "jskit:finalization-guard";

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
    at: timestampForStepRecord(),
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

async function readWorktreePackageJson(worktree) {
  const source = await readTextIfExists(path.join(worktree, "package.json"));
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

function packageScriptRunArgs(packageManager, scriptName) {
  if (packageManager === "pnpm") {
    return ["pnpm", ["run", scriptName]];
  }
  if (packageManager === "yarn") {
    return ["yarn", ["run", scriptName]];
  }
  if (packageManager === "bun") {
    return ["bun", ["run", scriptName]];
  }
  return ["npm", ["run", "--silent", scriptName]];
}

async function packageScriptCommandForWorktree(worktree, scriptName, {
  preferredPackageManager = ""
} = {}) {
  const packageJson = await readWorktreePackageJson(worktree);
  const script = packageJson?.scripts?.[scriptName];
  if (typeof script !== "string" || !normalizeText(script)) {
    return null;
  }
  const packageManager = preferredPackageManager || (await dependencyInstallCommandForWorktree(worktree))[0];
  const [command, args] = packageScriptRunArgs(packageManager, scriptName);
  return {
    args,
    command
  };
}

function sessionPackageScriptEnv(paths, scriptName) {
  return {
    JSKIT_SESSION_ID: paths.sessionId,
    JSKIT_SESSION_PACKAGE_SCRIPT: scriptName,
    JSKIT_SESSION_ROOT: paths.sessionRoot,
    JSKIT_TARGET_ROOT: paths.targetRoot,
    JSKIT_WORKTREE_ROOT: paths.worktree
  };
}

function packageScriptRepairCommand(paths, command, args) {
  return `cd ${paths.worktree} && ${command} ${args.join(" ")}`;
}

function packageScriptRecordName(scriptName) {
  return normalizeText(scriptName).replace(/[^a-zA-Z0-9._-]+/gu, "_");
}

async function writeSessionHookRecord(paths, scriptName, message) {
  await writeTextFile(
    path.join(paths.sessionRoot, "hooks", packageScriptRecordName(scriptName)),
    `${timestampForStepRecord()}\n${normalizeText(message) || `${scriptName} completed.`}`
  );
}

async function runOptionalSessionPackageScript(paths, {
  failureCode,
  failureMessage,
  kind,
  preferredPackageManager = "",
  preconditions = [],
  scriptName,
  timeout = 1000 * 60 * 10
} = {}) {
  const scriptCommand = await packageScriptCommandForWorktree(paths.worktree, scriptName, {
    preferredPackageManager
  });
  if (!scriptCommand) {
    return {
      ok: true,
      ran: false
    };
  }
  const result = await runLoggedCommand(paths, kind, scriptCommand.command, scriptCommand.args, {
    cwd: paths.worktree,
    env: sessionPackageScriptEnv(paths, scriptName),
    timeout
  });
  if (!result.ok) {
    return {
      ok: false,
      response: await failSession(paths, {
        code: failureCode,
        message: result.output || failureMessage,
        preconditions,
        repairCommand: packageScriptRepairCommand(paths, scriptCommand.command, scriptCommand.args)
      })
    };
  }
  await writeSessionHookRecord(paths, scriptName, result.output || `${scriptName} completed.`);
  return {
    ok: true,
    ran: true,
    result
  };
}

async function runSessionFinalizationGuard(paths, preconditions = []) {
  return runOptionalSessionPackageScript(paths, {
    failureCode: "session_finalization_guard_failed",
    failureMessage: `${SESSION_FINALIZATION_GUARD_PACKAGE_SCRIPT} failed in the session worktree.`,
    kind: "session_finalization_guard",
    preconditions,
    scriptName: SESSION_FINALIZATION_GUARD_PACKAGE_SCRIPT
  });
}

async function runSessionProvisioningHook(paths, {
  preferredPackageManager = "",
  preconditions = []
} = {}) {
  return runOptionalSessionPackageScript(paths, {
    failureCode: "session_provision_failed",
    failureMessage: `${SESSION_PROVISION_PACKAGE_SCRIPT} failed in the session worktree.`,
    kind: "session_provision",
    preferredPackageManager,
    preconditions,
    scriptName: SESSION_PROVISION_PACKAGE_SCRIPT
  });
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
    commentedAt: timestampForStepRecord(),
    issueUrl,
    purpose: normalizedPurpose
  };
  await writeGithubComments(paths, comments);
  return {
    ok: true,
    skipped: false
  };
}

function issueMetadataFromUrl(issueUrl = "") {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)(?:\b|$)/u.exec(String(issueUrl || "").trim());
  if (!match) {
    return {
      issueNumber: "",
      issueUrl: normalizeText(issueUrl),
      owner: "",
      repository: ""
    };
  }
  return {
    issueNumber: match[3],
    issueUrl: normalizeText(issueUrl),
    owner: match[1],
    repository: match[2]
  };
}

async function writeIssueMetadataFiles(paths, {
  issueTitle = "",
  issueUrl = ""
} = {}) {
  const issueMetadata = issueMetadataFromUrl(issueUrl);
  const metadataValues = {
    issue_body_path: path.join(paths.sessionRoot, "issue.md"),
    issue_number: issueMetadata.issueNumber,
    issue_owner: issueMetadata.owner,
    issue_repository: issueMetadata.repository,
    issue_title: normalizeText(issueTitle),
    issue_url: issueMetadata.issueUrl
  };
  await Promise.all(
    Object.entries(metadataValues)
      .filter(([, value]) => normalizeText(value))
      .map(([name, value]) => writeTextFile(path.join(paths.sessionRoot, "metadata", name), value))
  );
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
  await writeTextFile(path.join(initialPaths.sessionRoot, "workflow_version"), `${SESSION_WORKFLOW_VERSION}\n`);
  await markStatus(initialPaths, SESSION_STATUS.PENDING);
  await markCurrentStep(initialPaths, "worktree_created");

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
    stepRecords: [],
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
  const [issueText, issueTitle, stepRecords, transcriptLog] = await Promise.all([
    readTextIfExists(path.join(paths.sessionRoot, "issue.md")),
    readTrimmedFile(path.join(paths.sessionRoot, "issue_title")),
    readStepRecords(paths),
    readTextIfExists(path.join(paths.sessionRoot, "transcript.log"))
  ]);

  return {
    ...response,
    issueTitle,
    issueText: issueText.trim(),
    stepRecords,
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
  const completeStep = context.completeStep !== false;
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
    if (completeStep) {
      await writeStepRecord(paths, "worktree_created", `Reused existing worktree ${paths.worktree}.`);
    }
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
  if (completeStep) {
    await writeStepRecord(paths, "worktree_created", `Created worktree ${paths.worktree} on branch ${paths.branch}.`);
  }
  await markStatus(paths, SESSION_STATUS.RUNNING);
  return buildSessionResponse(paths, {
    preconditions
  });
}

async function recordDependenciesInstalled(paths, {
  message = "Installed Node dependencies in the session worktree.",
  preconditions = []
} = {}) {
  await writeStepRecord(paths, "dependencies_installed", message);
  await markStatus(paths, SESSION_STATUS.RUNNING);
  return buildSessionResponse(paths, {
    preconditions
  });
}

async function recordDependencyInstallResult(paths, {
  message = "Installed Node dependencies in the session worktree.",
  preconditions = []
} = {}) {
  await writeTextFile(
    path.join(paths.sessionRoot, DEPENDENCIES_INSTALL_RESULT_FILE),
    `${timestampForStepRecord()}\n${normalizeText(message) || "Installed Node dependencies in the session worktree."}`
  );
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
  const completeStep = context.completeStep !== false;
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
  const provisionResult = await runSessionProvisioningHook(paths, {
    preferredPackageManager: command,
    preconditions
  });
  if (!provisionResult.ok) {
    return provisionResult.response;
  }
  const installMessage = result.output || `Installed Node dependencies in the session worktree with ${command} ${args.join(" ")}.`;
  const recorder = completeStep ? recordDependenciesInstalled : recordDependencyInstallResult;
  return recorder(paths, {
    message: provisionResult.ran ? `${installMessage}\n${SESSION_PROVISION_PACKAGE_SCRIPT} completed.` : installMessage,
    preconditions
  });
}

async function adoptDependenciesInstalled({
  targetRoot = process.cwd(),
  sessionId,
  message = ""
} = {}) {
  return withExistingSession({ targetRoot, sessionId }, async (paths, context = {}) => {
    const preconditions = context.preconditions || [];
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
        preconditions
      });
    }
    const provisionResult = await runSessionProvisioningHook(paths, {
      preconditions
    });
    if (!provisionResult.ok) {
      return provisionResult.response;
    }
    const hookMessage = provisionResult.ran
      ? `${normalizeText(message) || "Installed Node dependencies in the session worktree."}\n${SESSION_PROVISION_PACKAGE_SCRIPT} completed.`
      : message;
    return recordDependencyInstallResult(paths, {
      message: hookMessage,
      preconditions
    });
  });
}

const STUDIO_CONTEXT_START_MARKER = "[[JSKIT_STUDIO_CONTEXT_START]]";
const STUDIO_CONTEXT_END_MARKER = "[[JSKIT_STUDIO_CONTEXT_END]]";

function issueDefinitionPrompt(userInput, context) {
  return [
    userInput,
    "",
    STUDIO_CONTEXT_START_MARKER,
    "JSKIT Studio context marker: follow the instructions inside this context block normally, but ignore the surrounding JSKIT_STUDIO_CONTEXT markers.",
    "",
    context,
    STUDIO_CONTEXT_END_MARKER
  ].join("\n").trim();
}

async function renderIssuePrompt(paths, options = {}, context = {}) {
  const userInput = normalizeText(options.prompt);
  const issueDefinitionSentinelPath = path.join(paths.sessionRoot, "metadata", "issue_prompt_rendered_requested");
  if (!userInput && context.completeStep !== false && await fileExists(issueDefinitionSentinelPath)) {
    await writeStepRecord(paths, "issue_prompt_rendered", "Issue scoped in Codex terminal.");
    await markStatus(paths, SESSION_STATUS.RUNNING);
    return buildSessionResponse(paths);
  }
  if (!userInput) {
    return failSession(paths, {
      code: "prompt_required",
      message: "The issue prompt step requires --prompt.",
      repairCommand: `jskit session ${paths.sessionId} step --prompt "<what should change>"`
    });
  }
  const promptContext = await renderPrompt(paths, "issue_prompt_rendered.md");
  const prompt = issueDefinitionPrompt(userInput, promptContext);
  await writeTextFile(issueDefinitionSentinelPath, "true\n");
  await markStatus(paths, SESSION_STATUS.WAITING_FOR_USER);
  return buildSessionResponse(paths, {
    codex: ISSUE_DEFINITION_CODEX_HANDOFF,
    ok: true,
    prompt,
    status: SESSION_STATUS.WAITING_FOR_USER
  });
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
  if (!issueText) {
    return renderIssueFilePrompt(paths, context);
  }
  if (context.completeStep === false) {
    return renderIssueFilePrompt(paths, context);
  }
  await writeStepRecord(paths, "issue_created", "Issue files are ready for review and submission.");
  await markStatus(paths, SESSION_STATUS.RUNNING);
  return buildSessionResponse(paths, {
    preconditions
  });
}

async function submitIssue(paths, _options = {}, context = {}) {
  const preconditions = context.preconditions || [];
  const completeStep = context.completeStep !== false;
  const existingIssueUrl = await readTrimmedFile(path.join(paths.sessionRoot, "issue_url"));
  const issueText = await readTrimmedFile(path.join(paths.sessionRoot, "issue.md"));
  const issueTitle = await readTrimmedFile(path.join(paths.sessionRoot, "issue_title")) || titleFromIssue(issueText);
  if (!issueText) {
    return sessionStepError(paths, {
      code: "issue_file_missing",
      message: "Cannot create the GitHub issue until issue.md exists.",
      repairCommand: `jskit session ${paths.sessionId} create_issue_file`
    });
  }
  if (existingIssueUrl) {
    await writeIssueMetadataFiles(paths, {
      issueTitle,
      issueUrl: existingIssueUrl
    });
    if (completeStep) {
      await writeStepRecord(paths, "issue_submitted", `Reused GitHub issue ${existingIssueUrl}.`);
    }
    await markStatus(paths, SESSION_STATUS.RUNNING);
    return buildSessionResponse(paths, {
      preconditions
    });
  }
  const githubPreconditions = await runNamedPreconditions(paths, ["github_auth", "github_origin"]);
  if (!githubPreconditions.ok) {
    return failSession(paths, {
      ...githubPreconditions.error,
      preconditions: [
        ...preconditions,
        ...githubPreconditions.preconditions
      ]
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
  await writeIssueMetadataFiles(paths, {
    issueTitle,
    issueUrl
  });
  if (completeStep) {
    await writeStepRecord(paths, "issue_submitted", `Created GitHub issue ${issueUrl}.`);
  }
  await markStatus(paths, SESSION_STATUS.RUNNING);
  return buildSessionResponse(paths, {
    preconditions
  });
}

async function renderIssueFilePrompt(paths, context = {}) {
  const preconditions = context.preconditions || [];
  const issueFileSentinelPath = path.join(paths.sessionRoot, "metadata", "issue_created_requested");
  const prompt = await renderPrompt(paths, "issue_created.md", {
    issue_file: path.join(paths.sessionRoot, "issue.md"),
    issue_title_file: path.join(paths.sessionRoot, "issue_title")
  });
  await writeTextFile(issueFileSentinelPath, "true\n");
  await markStatus(paths, SESSION_STATUS.WAITING_FOR_USER);
  return buildSessionResponse(paths, {
    codex: ISSUE_FILE_CODEX_HANDOFF,
    ok: true,
    preconditions,
    prompt,
    status: SESSION_STATUS.WAITING_FOR_USER
  });
}

async function makePlan(paths, _options = {}, context = {}) {
  const preconditions = context.preconditions || [];
  const makePlanSentinelPath = path.join(paths.sessionRoot, "metadata", "make_plan_requested");
  const issueText = await readTrimmedFile(path.join(paths.sessionRoot, "issue.md"));
  const issueTitle = await readTrimmedFile(path.join(paths.sessionRoot, "issue_title")) || titleFromIssue(issueText);
  const issueUrl = await readTrimmedFile(path.join(paths.sessionRoot, "issue_url"));
  const issueNumber = issueNumberFromUrl(issueUrl);
  if (context.completeStep !== false && await fileExists(makePlanSentinelPath)) {
    await writeStepRecord(paths, "plan_made", "Plan reviewed in Codex terminal.");
    await markStatus(paths, SESSION_STATUS.RUNNING);
    return buildSessionResponse(paths, {
      preconditions
    });
  }

  const prompt = await renderPrompt(paths, "make_plan.md", {
    app_blueprint_file: path.join(paths.worktree, ".jskit", "APP_BLUEPRINT.md"),
    issue_file: path.join(paths.sessionRoot, "issue.md"),
    issue_number: issueNumber,
    issue_text: issueText,
    issue_title: issueTitle,
    issue_title_file: path.join(paths.sessionRoot, "issue_title"),
    issue_url: issueUrl,
    worktree: paths.worktree
  });
  await writeTextFile(makePlanSentinelPath, "true\n");
  await markStatus(paths, SESSION_STATUS.WAITING_FOR_USER);
  return buildSessionResponse(paths, {
    codex: PLAN_CODEX_HANDOFF,
    ok: true,
    preconditions,
    prompt,
    status: SESSION_STATUS.WAITING_FOR_USER
  });
}

async function renderPlanExecutionPrompt(paths, _options = {}, context = {}) {
  const preconditions = context.preconditions || [];
  const executePlanSentinelPath = path.join(paths.sessionRoot, "metadata", "execute_plan_requested");
  if (context.completeStep !== false && await fileExists(executePlanSentinelPath)) {
    await writeStepRecord(paths, "plan_executed", "Plan execution completed by Codex.");
    await markStatus(paths, SESSION_STATUS.RUNNING);
    return buildSessionResponse(paths, {
      preconditions
    });
  }

  const issueText = await readTrimmedFile(path.join(paths.sessionRoot, "issue.md"));
  const issueTitle = await readTrimmedFile(path.join(paths.sessionRoot, "issue_title")) || titleFromIssue(issueText);
  const issueUrl = await readTrimmedFile(path.join(paths.sessionRoot, "issue_url"));
  const issueNumber = issueNumberFromUrl(issueUrl);
  const executionPrompt = await renderPrompt(paths, "plan_executed.md", {
    issue_file: path.join(paths.sessionRoot, "issue.md"),
    issue_number: issueNumber,
    issue_title: issueTitle,
    issue_url: issueUrl,
    worktree: paths.worktree
  });
  await writeTextFile(executePlanSentinelPath, "true\n");
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

const FIRST_REWINDABLE_STEP_ID = "dependencies_installed";
const REWIND_CLOSED_STATUSES = Object.freeze([
  SESSION_STATUS.ABANDONED,
  SESSION_STATUS.FINISHED
]);

async function removeSessionPath(paths, ...parts) {
  await rm(path.join(paths.sessionRoot, ...parts), {
    force: true,
    recursive: true
  });
}

async function removeSessionRootFile(paths, fileName) {
  await removeSessionPath(paths, fileName);
}

async function removePromptArtifact(paths, fileName) {
  await removeSessionPath(paths, "prompts", fileName);
}

async function removeGlobalCodexResult(paths, stepId) {
  await removeSessionPath(paths, "codex_results", stepId);
}

async function removeCycleCodexResults(paths, stepId) {
  const cyclesRoot = path.join(paths.sessionRoot, "cycles");
  let cycleDirectories = [];
  try {
    cycleDirectories = (await readdir(cyclesRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^cycle_\d+$/u.test(entry.name))
      .map((entry) => entry.name);
  } catch {
    cycleDirectories = [];
  }
  await Promise.all(cycleDirectories.map((cycleDirectory) => {
    return removeSessionPath(paths, "cycles", cycleDirectory, "codex_results", stepId);
  }));
}

async function removeCodexResult(paths, stepId) {
  await Promise.all([
    removeGlobalCodexResult(paths, stepId),
    removeCycleCodexResults(paths, stepId)
  ]);
}

async function removeGithubCommentPurpose(paths, purpose) {
  const comments = await readGithubComments(paths);
  if (!Object.hasOwn(comments, purpose)) {
    return;
  }
  delete comments[purpose];
  if (Object.keys(comments).length === 0) {
    await removeSessionRootFile(paths, "github_comments.json");
    return;
  }
  await writeGithubComments(paths, comments);
}

async function removeCycleDirectories(paths) {
  for (const rootName of ["steps", "cycles"]) {
    const root = path.join(paths.sessionRoot, rootName);
    let entries = [];
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      entries = [];
    }
    await Promise.all(entries
      .filter((entry) => entry.isDirectory() && /^cycle_\d+$/u.test(entry.name))
      .map((entry) => rm(path.join(root, entry.name), {
        force: true,
        recursive: true
      })));
  }
}

async function removePlanArtifacts(paths) {
  await removeSessionPath(paths, "metadata", "make_plan_requested");
}

async function removePlanExecutionArtifacts(paths) {
  await Promise.all([
    removeSessionPath(paths, "metadata", "execute_plan_requested"),
    removeCodexResult(paths, "plan_executed")
  ]);
}

const STEP_CANCELERS = Object.freeze({
  dependencies_installed: async () => {},
  issue_prompt_rendered: async (paths) => {
    await removeSessionPath(paths, "metadata", "issue_prompt_rendered_requested");
  },
  issue_created: async (paths) => {
    await Promise.all([
      removeSessionPath(paths, "metadata", "issue_created_requested"),
      removeSessionRootFile(paths, "issue.md"),
      removeSessionRootFile(paths, "issue_title")
    ]);
  },
  issue_submitted: async (paths) => {
    await Promise.all([
      removeSessionRootFile(paths, "issue_url"),
      removeSessionPath(paths, "metadata", "issue_body_path"),
      removeSessionPath(paths, "metadata", "issue_details_path"),
      removeSessionPath(paths, "metadata", "issue_number"),
      removeSessionPath(paths, "metadata", "issue_owner"),
      removeSessionPath(paths, "metadata", "issue_repository"),
      removeSessionPath(paths, "metadata", "issue_title"),
      removeSessionPath(paths, "metadata", "issue_url")
    ]);
  },
  plan_made: removePlanArtifacts,
  plan_executed: removePlanExecutionArtifacts,
  deep_ui_check_run: async (paths) => {
    await Promise.all([
      removeSessionPath(paths, "ui_checks"),
      removeCodexResult(paths, "deep_ui_check_run")
    ]);
  },
  review_prompt_rendered: async (paths) => {
    await Promise.all([
      removePromptArtifact(paths, "review_prompt_rendered"),
      removeSessionPath(paths, "review_passes"),
      removeCodexResult(paths, "review_prompt_rendered")
    ]);
  },
  review_changes_accepted: async (paths) => {
    await removeSessionPath(paths, "review_passes");
  },
  automated_checks_run: async (paths) => {
    await Promise.all([
      removeSessionPath(paths, "checks"),
      removeCodexResult(paths, "automated_checks_run")
    ]);
  },
  user_check_completed: async (paths) => {
    await Promise.all([
      removePromptArtifact(paths, "user_check_completed"),
      removeSessionPath(paths, "steps", "user_check_failed")
    ]);
  },
  changes_committed: async (paths) => {
    await removeSessionRootFile(paths, "changes_committed.json");
  },
  blueprint_updated: async (paths) => {
    await Promise.all([
      removeSessionPath(paths, "metadata", "blueprint_updated_requested"),
      removeSessionRootFile(paths, BLUEPRINT_BASELINE_FILE),
      removeCodexResult(paths, "blueprint_updated")
    ]);
  },
  final_report_created: async (paths) => {
    await Promise.all([
      removeSessionPath(paths, "metadata", "pull_request_file_requested"),
      removeSessionRootFile(paths, "pull_request.md"),
      removeSessionRootFile(paths, "final_report"),
      removeSessionRootFile(paths, "final_report.md"),
      removeGithubCommentPurpose(paths, "final_report")
    ]);
  },
  pr_created: async (paths) => {
    await Promise.all([
      removePromptArtifact(paths, "pr_create_failure"),
      removeSessionRootFile(paths, "pr_body.md"),
      removeSessionRootFile(paths, "pull_request_body.md"),
      removeSessionRootFile(paths, "pr_url")
    ]);
  },
  pr_merge_prepared: async (paths) => {
    await removePromptArtifact(paths, "pr_merge_prepared");
  },
  pr_finalized: async (paths) => {
    await Promise.all([
      removePromptArtifact(paths, "pr_merge_failure"),
      removeSessionRootFile(paths, "pr_base_branch"),
      removeSessionRootFile(paths, "pr_merge_completed"),
      removeSessionRootFile(paths, "pr_outcome.json")
    ]);
  },
  main_checkout_synced: async (paths) => {
    await Promise.all([
      removeSessionRootFile(paths, "local_base_updated"),
      removeSessionRootFile(paths, "main_checkout_sync.json")
    ]);
  },
  session_finished: async (paths) => {
    await Promise.all([
      removeSessionRootFile(paths, "final_comment")
    ]);
  }
});

function targetIsAllowedRewindStep(stepId) {
  if (!STEP_IDS.includes(stepId)) {
    return false;
  }
  if (stepId === "worktree_created") {
    return false;
  }
  return STEP_IDS.indexOf(stepId) >= STEP_IDS.indexOf(FIRST_REWINDABLE_STEP_ID);
}

function deletedStepIdsForRewindTarget(stepId) {
  const targetIndex = STEP_IDS.indexOf(stepId);
  return targetIndex < 0 ? [] : STEP_IDS.slice(targetIndex);
}

async function removeStepRecordsForDeletedSteps(paths, deletedStepIds) {
  const stepsRoot = path.join(paths.sessionRoot, "steps");
  let cycleDirectories = [];
  try {
    cycleDirectories = (await readdir(stepsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^cycle_\d+$/u.test(entry.name))
      .map((entry) => entry.name);
  } catch {
    cycleDirectories = [];
  }
  await Promise.all(deletedStepIds.flatMap((stepId) => [
    removeSessionPath(paths, "steps", stepId),
    ...cycleDirectories.map((cycleDirectory) => removeSessionPath(paths, "steps", cycleDirectory, stepId))
  ]));
}

async function cancelDeletedStepArtifacts(paths, deletedStepIds) {
  for (const stepId of deletedStepIds) {
    const canceler = STEP_CANCELERS[stepId];
    if (typeof canceler !== "function") {
      continue;
    }
    await canceler(paths);
  }
}

async function rewindSession({
  targetRoot = process.cwd(),
  sessionId,
  stepId
} = {}) {
  return withExistingSession({ targetRoot, sessionId }, async (paths) => {
    const artifacts = await readSessionArtifacts(paths);
    const normalizedStepId = normalizeText(stepId);
    const currentStatus = artifacts.status || SESSION_STATUS.PENDING;

    if (paths.archive && paths.archive !== "active") {
      return buildSessionResponse(paths, {
        ok: false,
        errors: [
          createError({
            code: "session_archived_read_only",
            message: `Session ${paths.sessionId} is archived and cannot be rewound.`
          })
        ],
        status: currentStatus
      });
    }

    if (REWIND_CLOSED_STATUSES.includes(currentStatus)) {
      return buildSessionResponse(paths, {
        ok: false,
        errors: [
          createError({
            code: "session_closed_read_only",
            message: `Session ${paths.sessionId} is ${currentStatus} and cannot be rewound.`
          })
        ],
        status: currentStatus
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

    if (!targetIsAllowedRewindStep(normalizedStepId)) {
      return buildSessionResponse(paths, {
        ok: false,
        errors: [
          createError({
            code: "rewind_step_not_allowed",
            message: `Cannot rewind session ${paths.sessionId} to ${normalizedStepId || "(missing)"}.`
          })
        ],
        status: currentStatus
      });
    }

    if (!artifacts.completedSteps.includes(normalizedStepId)) {
      return buildSessionResponse(paths, {
        ok: false,
        errors: [
          createError({
            code: "rewind_step_not_completed",
            message: `Cannot rewind session ${paths.sessionId} to ${normalizedStepId} because that step is not completed.`
          })
        ],
        status: currentStatus
      });
    }

    const deletedStepIds = deletedStepIdsForRewindTarget(normalizedStepId);
    await removeStepRecordsForDeletedSteps(paths, deletedStepIds);
    await cancelDeletedStepArtifacts(paths, deletedStepIds);
    await markCurrentStep(paths, normalizedStepId);
    await markStatus(paths, SESSION_STATUS.PENDING);
    return buildSessionResponse(paths, {
      status: SESSION_STATUS.PENDING
    });
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

const BLUEPRINT_RELATIVE_PATH = ".jskit/APP_BLUEPRINT.md";
const BLUEPRINT_BASELINE_FILE = "blueprint_update_baseline.json";

function blueprintBaselinePath(paths) {
  return path.join(paths.sessionRoot, BLUEPRINT_BASELINE_FILE);
}

function isBlueprintRelativePath(filePath = "") {
  return normalizeText(filePath) === BLUEPRINT_RELATIVE_PATH;
}

function nonBlueprintChangedFiles(files = []) {
  return files.filter((file) => !isBlueprintRelativePath(file));
}

async function hashWorktreeFile(paths, filePath) {
  try {
    const buffer = await readFile(path.join(paths.worktree, filePath));
    return createHash("sha256").update(buffer).digest("hex");
  } catch {
    return "missing";
  }
}

async function buildDirtyFileSnapshot(paths, files = []) {
  const entries = await Promise.all(nonBlueprintChangedFiles(files).map(async (file) => [
    file,
    await hashWorktreeFile(paths, file)
  ]));
  return Object.fromEntries(entries);
}

async function writeBlueprintBaseline(paths) {
  const changedFiles = await changedFilesInWorktree(paths);
  const snapshot = await buildDirtyFileSnapshot(paths, changedFiles);
  const payload = {
    changedFiles: Object.keys(snapshot).sort((left, right) => left.localeCompare(right)),
    files: snapshot,
    recordedAt: timestampForStepRecord()
  };
  await writeTextFile(blueprintBaselinePath(paths), `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

async function readBlueprintBaseline(paths) {
  return parseJsonObject(await readTextIfExists(blueprintBaselinePath(paths))) || null;
}

async function unexpectedBlueprintStepChanges(paths, changedFiles = []) {
  const baseline = await readBlueprintBaseline(paths);
  if (!baseline?.files || typeof baseline.files !== "object" || Array.isArray(baseline.files)) {
    return nonBlueprintChangedFiles(changedFiles);
  }
  const baselineFiles = baseline.files;
  const currentFiles = new Set(nonBlueprintChangedFiles(changedFiles));
  const candidates = new Set([
    ...Object.keys(baselineFiles),
    ...currentFiles
  ]);
  const unexpected = [];
  for (const file of [...candidates].sort((left, right) => left.localeCompare(right))) {
    if (!Object.prototype.hasOwnProperty.call(baselineFiles, file)) {
      unexpected.push(file);
      continue;
    }
    const currentHash = await hashWorktreeFile(paths, file);
    if (currentHash !== baselineFiles[file]) {
      unexpected.push(file);
    }
  }
  return unexpected;
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
  const prompt = await renderPrompt(paths, "review_prompt_rendered.md", {
    changed_files: changedFiles,
    review_pass_limit: String(REVIEW_PASS_LIMIT),
    review_pass_number: reviewPass
  });
  const passRoot = reviewPassRoot(paths, reviewPass);
  await writePromptArtifact(paths, "review_prompt_rendered", prompt);
  await mkdir(passRoot, { recursive: true });
  await writeTextFile(path.join(passRoot, "review_prompt_rendered"), prompt);
  await writeReviewPassJson(paths, reviewPass, "prompt.json", {
    changedFiles: changedFiles.split(/\r?\n/u).filter(Boolean),
    maxPasses: REVIEW_PASS_LIMIT,
    pass: reviewPass,
    promptPath: path.join(passRoot, "review_prompt_rendered"),
    status: "prompted",
    startedAt: timestampForStepRecord()
  });
  await markStatus(paths, SESSION_STATUS.WAITING_FOR_USER);
  return buildSessionResponse(paths, {
    codex: REVIEW_EXECUTION_CODEX_HANDOFF,
    prompt,
    status: SESSION_STATUS.WAITING_FOR_USER
  });
}

async function renderResolveDeslopPrompt(paths, context = {}) {
  const preconditions = context.preconditions || [];
  const reviewPass = await readCurrentReviewPass(paths);
  const prompt = await renderPrompt(paths, "review_changes_accepted_resolve.md", {});
  await writePromptArtifact(paths, "review_changes_accepted_resolve", prompt);
  if (reviewPass) {
    await writeReviewPassJson(paths, reviewPass, "resolve_prompt.json", {
      pass: reviewPass,
      promptPath: path.join(paths.sessionRoot, "prompts", "review_changes_accepted_resolve"),
      status: "resolve_prompted",
      startedAt: timestampForStepRecord()
    });
  }
  await markStatus(paths, SESSION_STATUS.WAITING_FOR_USER);
  return buildSessionResponse(paths, {
    codex: RESOLVE_DESLOP_CODEX_HANDOFF,
    ok: true,
    preconditions,
    prompt,
    status: SESSION_STATUS.WAITING_FOR_USER
  });
}

async function acceptReviewChanges(paths, options = {}, context = {}) {
  const resolveDeslop = options.resolveDeslop === true ||
    normalizeText(options["resolve-deslop"]).toLowerCase() === "true";
  if (resolveDeslop) {
    return renderResolveDeslopPrompt(paths, context);
  }

  const reviewDecisionProvided = Object.hasOwn(options, "reviewFindingsRemaining") ||
    Object.hasOwn(options, "review-findings-remaining");
  if (!reviewDecisionProvided) {
    return failSession(paths, {
      code: "review_decision_required",
      message: "Accept review/deslop requires an explicit decision: resolve review/deslop, run review/deslop again, or continue.",
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
  await writeReviewPassJson(paths, reviewPass, "accepted.json", {
    acceptedAt: timestampForStepRecord(),
    changedFiles: status.changedFiles || [],
    findingsRemaining,
    remainingFindings: "",
    pass: reviewPass,
    status: status.changedFiles?.length ? "accepted" : "no_changes"
  });
  await writeStepRecord(paths, "review_changes_accepted", message);
  await markStatus(paths, SESSION_STATUS.RUNNING);
  return buildSessionResponse(paths);
}

async function runAutomatedChecks(paths, {
  stepId
}, _options = {}, context = {}) {
  const preconditions = context.preconditions || [];
  const [command, args] = await doctorCommandForWorktree(paths.worktree);
  const checksRoot = path.join(paths.sessionRoot, "checks");
  await mkdir(checksRoot, { recursive: true });
  const checkCommand = [command, ...args].join(" ");

  const prompt = await renderPrompt(paths, "automated_checks_run.md", {
    check_command: checkCommand
  });
  await writeTextFile(
    path.join(checksRoot, `${stepId}.json`),
    `${JSON.stringify({
      command: checkCommand,
      ok: false,
      status: "prompted",
      stepId
    }, null, 2)}\n`
  );
  await markStatus(paths, SESSION_STATUS.WAITING_FOR_USER);
  return buildSessionResponse(paths, {
    codex: AUTOMATED_CHECK_REPAIR_CODEX_HANDOFF,
    preconditions,
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
  phase
}, _options = {}, context = {}) {
  const preconditions = context.preconditions || [];
  const issueUrl = await readTrimmedFile(path.join(paths.sessionRoot, "issue_url"));
  const issueText = await readTrimmedFile(path.join(paths.sessionRoot, "issue.md"));
  const issueTitle = await readTrimmedFile(path.join(paths.sessionRoot, "issue_title")) || titleFromIssue(issueText);
  const prompt = await renderPrompt(paths, "deep_ui_check_run.md", {
    changed_files: await changedFilesSinceBase(paths),
    issue_file: path.join(paths.sessionRoot, "issue.md"),
    issue_number: issueNumberFromUrl(issueUrl),
    issue_title: issueTitle,
    issue_url: issueUrl,
    phase,
    worktree: paths.worktree
  });
  await writeUiCheckJson(paths, stepId, {
    ok: true,
    phase,
    status: "prompted",
    stepId
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
    await writeStepRecord(paths, "user_check_completed", "User confirmed check passed.");
    await markStatus(paths, SESSION_STATUS.RUNNING);
    return buildSessionResponse(paths);
  }
  if (result === "failed" || result === "fail" || result === "no") {
    await markStatus(paths, SESSION_STATUS.RUNNING);
    return buildSessionResponse(paths, {
      warnings: [
        {
          code: "user_check_failed",
          message: "Complete user check failed. Rewind to the step that should be redone."
        }
      ]
    });
  }
  const issueText = await readTrimmedFile(path.join(paths.sessionRoot, "issue.md"));
  const issueUrl = await readTrimmedFile(path.join(paths.sessionRoot, "issue_url"));
  const issueTitle = await readTrimmedFile(path.join(paths.sessionRoot, "issue_title")) || titleFromIssue(issueText);
  const prompt = await renderPrompt(paths, "user_check_completed.md", {
    issue_file: path.join(paths.sessionRoot, "issue.md"),
    issue_title: issueTitle,
    issue_url: issueUrl
  });
  await writePromptArtifact(paths, "user_check_completed", prompt);
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
  const completeStep = context.completeStep !== false;
  let commitInfo = await readAcceptedChangesCommit(paths);

  if (!commitInfo?.commit) {
    const result = await commitWorktree(paths, {
      allowNoChanges: true,
      message: `Implement JSKIT session ${paths.sessionId}`
    });
    if (!result.ok) {
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
      committedAt: timestampForStepRecord(),
      noChanges: (result.changedFiles || []).length < 1
    };
    await writeTextFile(path.join(paths.sessionRoot, "changes_committed.json"), `${JSON.stringify(commitInfo, null, 2)}\n`);
  }

  const warnings = [];
  if (commitInfo.noChanges === true) {
    warnings.push({
      code: "accepted_changes_noop",
      message: "No accepted worktree changes were found; continuing without a new commit."
    });
  }
  if (!completeStep) {
    await markStatus(paths, SESSION_STATUS.RUNNING);
    return buildSessionResponse(paths, {
      preconditions,
      warnings
    });
  }
  await writeStepRecord(
    paths,
    "changes_committed",
    commitInfo.noChanges === true
      ? "No accepted worktree changes were found; continued without a new commit."
      : `Committed accepted changes at ${commitInfo.commit || "unknown"}.`
  );
  await markStatus(paths, SESSION_STATUS.RUNNING);
  return buildSessionResponse(paths, {
    preconditions,
    warnings
  });
}

async function updateBlueprint(paths, _options = {}, context = {}) {
  const preconditions = context.preconditions || [];
  const issueText = await readTrimmedFile(path.join(paths.sessionRoot, "issue.md"));
  const issueTitle = await readTrimmedFile(path.join(paths.sessionRoot, "issue_title")) || titleFromIssue(issueText);
  const issueUrl = await readTrimmedFile(path.join(paths.sessionRoot, "issue_url"));
  const issueNumber = issueNumberFromUrl(issueUrl);
  const blueprintPath = path.join(paths.worktree, BLUEPRINT_RELATIVE_PATH);
  const blueprintSentinelPath = path.join(paths.sessionRoot, "metadata", "blueprint_updated_requested");

  if (context.completeStep !== false && await fileExists(blueprintSentinelPath)) {
    const changedFiles = await changedFilesInWorktree(paths);
    const unexpectedChanges = await unexpectedBlueprintStepChanges(paths, changedFiles);
    if (unexpectedChanges.length > 0) {
      return failSession(paths, {
        code: "blueprint_unexpected_changes",
        message: `The blueprint step changed files outside ${BLUEPRINT_RELATIVE_PATH}: ${unexpectedChanges.join(", ")}`,
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

    if (changedFiles.includes(BLUEPRINT_RELATIVE_PATH)) {
      await writeStepRecord(paths, "blueprint_updated", "Codex updated the app blueprint; JSKIT will include it in the accepted changes commit.");
    } else {
      await writeStepRecord(paths, "blueprint_updated", "Codex reviewed the app blueprint; no blueprint changes were needed.");
    }
    await markStatus(paths, SESSION_STATUS.RUNNING);
    return buildSessionResponse(paths, {
      preconditions,
      status: SESSION_STATUS.RUNNING
    });
  }

  await writeBlueprintBaseline(paths);
  const prompt = await renderPrompt(paths, "blueprint_updated.md", {
    app_blueprint_file: blueprintPath,
    changed_files: await changedFilesSinceBase(paths),
    issue_file: path.join(paths.sessionRoot, "issue.md"),
    issue_number: issueNumber,
    issue_title: issueTitle,
    issue_url: issueUrl,
    worktree: paths.worktree
  });
  await writeTextFile(blueprintSentinelPath, "true\n");
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

async function renderPullRequestFilePrompt(paths, context = {}) {
  const preconditions = context.preconditions || [];
  const issueUrl = await readTrimmedFile(path.join(paths.sessionRoot, "issue_url"));
  const issueTitle = await readTrimmedFile(path.join(paths.sessionRoot, "issue_title"));
  const filesChanged = await changedFilesSinceBase(paths);
  const commits = await commitLinesSinceBase(paths);
  const checks = await readCheckSummaries(paths);
  const uiChecks = await readUiCheckSummaries(paths);
  const reviewPasses = await readReviewPassSummaries(paths);
  const commandLogPath = path.join(paths.sessionRoot, "command_log.jsonl");
  const blueprintStatus = await readTextIfExists(path.join(paths.sessionRoot, "steps", "blueprint_updated"));
  const userCheck = await readTextIfExists(path.join(paths.sessionRoot, "steps", "user_check_completed")) ||
    await readTextIfExists(path.join(paths.sessionRoot, "steps", `cycle_${await readActiveCycle(paths)}`, "user_check_completed"));
  const prompt = await renderPrompt(paths, "final_report_created.md", {
    base_branch: await readTrimmedFile(path.join(paths.sessionRoot, "base_branch")),
    blueprint_status: blueprintStatus.trim() || "No blueprint update recorded.",
    checks: checks || "No structured checks recorded.",
    command_log: await fileExists(commandLogPath) ? commandLogPath : "No command log recorded.",
    commits: commits || "No commits detected against the session base.",
    files_changed: filesChanged || "No changed files detected against the session base.",
    issue_file: path.join(paths.sessionRoot, "issue.md"),
    issue_title: issueTitle || paths.sessionId,
    issue_url: issueUrl || "",
    pull_request_file: path.join(paths.sessionRoot, "pull_request.md"),
    review_passes: reviewPasses || "No structured review passes recorded.",
    session_id: paths.sessionId,
    ui_checks: uiChecks || "No structured UI checks recorded.",
    user_check: userCheck.trim() || "No user check recorded.",
    worktree: paths.worktree
  });
  await writeTextFile(path.join(paths.sessionRoot, "metadata", "pull_request_file_requested"), "true\n");
  await markStatus(paths, SESSION_STATUS.WAITING_FOR_USER);
  return buildSessionResponse(paths, {
    codex: PR_FILE_CODEX_HANDOFF,
    ok: true,
    preconditions,
    prompt,
    status: SESSION_STATUS.WAITING_FOR_USER
  });
}

async function createPullRequestFile(paths, _options = {}, context = {}) {
  const preconditions = context.preconditions || [];
  const pullRequestText = await readTrimmedFile(path.join(paths.sessionRoot, "pull_request.md"));
  if (!pullRequestText || context.completeStep === false) {
    return renderPullRequestFilePrompt(paths, context);
  }
  await writeStepRecord(paths, "final_report_created", "Pull request file is ready for review and submission.");
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

function booleanOption(options = {}, ...names) {
  return names.some((name) => {
    const value = options[name];
    return value === true || normalizeText(value).toLowerCase() === "true";
  });
}

function skipStepRequested(options = {}) {
  return booleanOption(options, "skipStep", "skip-step", "skip");
}

function skipStepReason(options = {}, stepId = "") {
  return normalizeText(options.skipReason || options["skip-reason"]) ||
    `User skipped ${STEP_DEFINITION_BY_ID[stepId]?.label || stepId}.`;
}

async function writeJsonFile(filePath, payload) {
  await writeTextFile(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

async function writeTextIfMissing(filePath, value) {
  if (await fileExists(filePath)) {
    return;
  }
  await writeTextFile(filePath, value);
}

async function writeSkippedIssueDraft(paths, reason) {
  await writeTextIfMissing(path.join(paths.sessionRoot, "issue_title"), `Skipped issue draft for ${paths.sessionId}\n`);
  await writeTextIfMissing(
    path.join(paths.sessionRoot, "issue.md"),
    `# Skipped issue draft\n\n${reason}\n`
  );
}

async function writeSkippedReviewPass(paths, reason) {
  const reviewPass = normalizeReviewPassNumber(await readTrimmedFile(path.join(paths.sessionRoot, "review_passes", "current_pass")) || "001");
  await writeCurrentReviewPass(paths, reviewPass);
  await writeReviewPassJson(paths, reviewPass, "accepted.json", {
    acceptedAt: timestampForStepRecord(),
    changedFiles: [],
    findingsRemaining: false,
    pass: reviewPass,
    reason,
    status: "skipped"
  });
}

async function writeSkippedStepArtifacts(paths, stepId, reason) {
  if (stepId === "issue_created") {
    await writeSkippedIssueDraft(paths, reason);
  }
  if (stepId === "issue_submitted") {
    await writeTextIfMissing(path.join(paths.sessionRoot, "issue_url"), `skipped://${paths.sessionId}/issue\n`);
  }
  if (stepId === "deep_ui_check_run") {
    await writeUiCheckJson(paths, stepId, {
      ok: true,
      reason,
      status: "skipped",
      stepId
    });
  }
  if (stepId === "automated_checks_run") {
    await mkdir(path.join(paths.sessionRoot, "checks"), { recursive: true });
    await writeJsonFile(path.join(paths.sessionRoot, "checks", `${stepId}.json`), {
      ok: true,
      reason,
      status: "skipped",
      stepId
    });
  }
  if (stepId === "review_prompt_rendered") {
    await writeSkippedReviewPass(paths, reason);
  }
  if (stepId === "review_changes_accepted") {
    await writeSkippedReviewPass(paths, reason);
  }
  if (stepId === "changes_committed") {
    await writeJsonFile(path.join(paths.sessionRoot, "changes_committed.json"), {
      changedFiles: [],
      commit: await currentHead(paths),
      committedAt: timestampForStepRecord(),
      noChanges: true,
      reason
    });
  }
  if (stepId === "final_report_created") {
    await writeTextIfMissing(
      path.join(paths.sessionRoot, "pull_request.md"),
      `# Pull Request: ${paths.sessionId}\n\nPull request file step skipped.\n\n${reason}\n`
    );
  }
  if (stepId === "pr_created") {
    await writeTextIfMissing(path.join(paths.sessionRoot, "pr_url"), `skipped://${paths.sessionId}/pr\n`);
  }
  if (stepId === "pr_merge_prepared") {
    await writeTextIfMissing(path.join(paths.sessionRoot, "pr_merge_prepared"), `${reason}\n`);
  }
  if (stepId === "pr_finalized") {
    const prUrl = await readTrimmedFile(path.join(paths.sessionRoot, "pr_url"));
    await writePrOutcome(paths, {
      outcome: "skipped",
      prUrl,
      reason
    });
  }
  if (stepId === "main_checkout_synced") {
    await writeMainCheckoutSync(paths, {
      reason,
      status: "skipped"
    });
  }
}

async function skipCurrentStep(paths, stepId, options = {}) {
  if (["worktree_created", "dependencies_installed", "issue_prompt_rendered", "session_finished"].includes(stepId)) {
    return failSession(paths, {
      code: "session_step_skip_not_allowed",
      message: `Step ${stepId} cannot be skipped.`,
      repairCommand: `jskit session ${paths.sessionId} step`
    });
  }
  const reason = skipStepReason(options, stepId);
  await writeSkippedStepArtifacts(paths, stepId, reason);
  await writeStepRecord(paths, stepId, `Skipped: ${reason}`);
  await markStatus(paths, SESSION_STATUS.RUNNING);
  return buildSessionResponse(paths, {
    warnings: [
      {
        code: "session_step_skipped",
        message: `${STEP_DEFINITION_BY_ID[stepId]?.label || stepId} was skipped.`
      }
    ]
  });
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
    recordedAt: timestampForStepRecord(),
    ...outcome
  }, null, 2)}\n`);
}

function mainCheckoutSyncPath(paths) {
  return path.join(paths.sessionRoot, "main_checkout_sync.json");
}

async function writeMainCheckoutSync(paths, payload = {}) {
  await writeTextFile(mainCheckoutSyncPath(paths), `${JSON.stringify({
    recordedAt: timestampForStepRecord(),
    ...payload
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

async function syncMainCheckout(paths, options = {}, context = {}) {
  const prOutcome = parseJsonObject(await readTextIfExists(path.join(paths.sessionRoot, "pr_outcome.json")));
  const preconditions = context.preconditions || [];
  if (!prOutcome?.outcome) {
    return failSession(paths, {
      code: "pr_outcome_missing",
      message: "Cannot sync the main checkout before PR finalization records an outcome.",
      preconditions,
      repairCommand: `jskit session ${paths.sessionId} step`
    });
  }

  const skipRequested = options.skipMainSync === true ||
    normalizeText(options["skip-main-sync"]).toLowerCase() === "true";
  const skipReason = normalizeText(options.skipReason || options["skip-reason"]) ||
    "User skipped main checkout sync.";
  if (skipRequested || prOutcome.outcome !== "merged") {
    const reason = prOutcome.outcome === "merged"
      ? skipReason
      : `PR outcome is ${prOutcome.outcome}; no main checkout sync is required.`;
    await writeMainCheckoutSync(paths, {
      branch: prOutcome.baseBranch || "",
      outcome: prOutcome.outcome,
      reason,
      status: "skipped"
    });
    await writeStepRecord(paths, "main_checkout_synced", `Main checkout sync skipped: ${reason}`);
    await markStatus(paths, SESSION_STATUS.RUNNING);
    return buildSessionResponse(paths);
  }

  const baseBranch = prOutcome.baseBranch || await readTrimmedFile(path.join(paths.sessionRoot, "pr_base_branch"));
  const syncFailure = await updateLocalBaseBranch(paths, baseBranch);
  if (syncFailure) {
    return syncFailure;
  }

  const branch = normalizeText(baseBranch) || await currentTargetBranch(paths.targetRoot);
  await writeMainCheckoutSync(paths, {
    branch,
    outcome: prOutcome.outcome,
    status: "synced"
  });
  await writeStepRecord(paths, "main_checkout_synced", `Fast-forwarded target checkout branch ${branch}.`);
  await markStatus(paths, SESSION_STATUS.RUNNING);
  return buildSessionResponse(paths);
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

async function createPr(paths, _options = {}, context = {}) {
  const preconditions = context.preconditions || [];
  const completeStep = context.completeStep !== false;
  const existingPrUrl = await readTrimmedFile(path.join(paths.sessionRoot, "pr_url"));
  if (existingPrUrl) {
    if (completeStep) {
      await writeStepRecord(paths, "pr_created", `Reused existing PR ${existingPrUrl}.`);
    }
    await markStatus(paths, SESSION_STATUS.RUNNING);
    return buildSessionResponse(paths, {
      preconditions
    });
  }
  const pullRequestPath = path.join(paths.sessionRoot, "pull_request.md");
  const pullRequestText = await readTrimmedFile(pullRequestPath);
  if (!pullRequestText) {
    return sessionStepError(paths, {
      code: "pull_request_file_missing",
      message: "Cannot create the GitHub pull request until pull_request.md exists.",
      repairCommand: `jskit session ${paths.sessionId} create_pull_request_file`
    });
  }
  const helperMapResult = await updateHelperMapBeforePr(paths);
  if (!helperMapResult.ok) {
    return failSession(paths, {
      code: helperMapResult.code,
      message: helperMapResult.message,
      repairCommand: helperMapResult.repairCommand,
      preconditions
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
      repairCommand: `git -C ${paths.worktree} push -u origin HEAD`,
      preconditions
    });
  }
  const existingPrState = await readCurrentBranchPrState(paths);
  if (existingPrState.ok && existingPrState.url && !prStateIsClosed(existingPrState)) {
    await writeTextFile(path.join(paths.sessionRoot, "pr_url"), existingPrState.url);
    if (completeStep) {
      await writeStepRecord(paths, "pr_created", `Pushed branch ${paths.branch} and reused existing PR ${existingPrState.url}. ${helperMapResult.message}`);
    }
    await markStatus(paths, SESSION_STATUS.RUNNING);
    return buildSessionResponse(paths, {
      preconditions
    });
  }
  const issueText = await readTrimmedFile(path.join(paths.sessionRoot, "issue.md"));
  const issueTitle = await readTrimmedFile(path.join(paths.sessionRoot, "issue_title")) || titleFromIssue(issueText);
  const result = await runLoggedCommand(paths, "github_pr_create", "gh", [
    "pr",
    "create",
    "--title",
    issueTitle,
    "--body-file",
    pullRequestPath
  ], {
    cwd: paths.worktree,
    timeout: 1000 * 60
  });
  if (!result.ok || !result.stdout) {
    const fallbackPrState = await readCurrentBranchPrState(paths);
    if (fallbackPrState.ok && fallbackPrState.url && !prStateIsClosed(fallbackPrState)) {
      await writeTextFile(path.join(paths.sessionRoot, "pr_url"), fallbackPrState.url);
      if (completeStep) {
        await writeStepRecord(paths, "pr_created", `Pushed branch ${paths.branch} and reused existing PR ${fallbackPrState.url}. ${helperMapResult.message}`);
      }
      await markStatus(paths, SESSION_STATUS.RUNNING);
      return buildSessionResponse(paths, {
        preconditions
      });
    }
    const prompt = await renderPrompt(paths, "pr_failure.md", {
      doctor_output: result.output
    });
    await writePromptArtifact(paths, "pr_create_failure", prompt);
    return failSession(paths, {
      code: "pr_create_failed",
      message: result.output || "Failed to create PR.",
      repairCommand: "gh pr create",
      preconditions,
      prompt
    });
  }
  const prUrl = result.stdout.split(/\r?\n/u).map((line) => line.trim()).find(Boolean) || result.stdout;
  await writeTextFile(path.join(paths.sessionRoot, "pr_url"), prUrl);
  if (completeStep) {
    await writeStepRecord(paths, "pr_created", `Pushed branch ${paths.branch} and created PR ${prUrl}. ${helperMapResult.message}`);
  }
  await markStatus(paths, SESSION_STATUS.RUNNING);
  return buildSessionResponse(paths, {
    preconditions
  });
}

async function closePrWithoutMerge(paths, prUrl, options = {}) {
  const reason = normalizeText(options.closeReason || options["close-reason"]) || "User skipped merge in JSKIT Studio.";
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
  await writePrOutcome(paths, {
    issueUrl,
    outcome: "closed_without_merge",
    prUrl,
    prState: prState.state,
    reason
  });
  await writeStepRecord(paths, "pr_finalized", `Finished without merging PR ${prUrl}; PR left open. Reason: ${reason}`);
  await markStatus(paths, SESSION_STATUS.RUNNING);
  return buildSessionResponse(paths);
}

async function preparePrMerge(paths, options = {}, context = {}) {
  const preconditions = context.preconditions || [];
  const prepareMerge = options.prepareMerge === true ||
    normalizeText(options["prepare-merge"]).toLowerCase() === "true";
  const continueToMerge = options.continueToMerge === true ||
    normalizeText(options["continue-to-merge"]).toLowerCase() === "true";

  if (prepareMerge) {
    const prUrl = await readTrimmedFile(path.join(paths.sessionRoot, "pr_url"));
    const baseBranch = await readTrimmedFile(path.join(paths.sessionRoot, "pr_base_branch")) ||
      await readTrimmedFile(path.join(paths.sessionRoot, "base_branch")) ||
      await currentTargetBranch(paths.targetRoot);
    const prompt = await renderPrompt(paths, "pr_merge_prepared.md", {
      base_branch: baseBranch,
      issue_url: await readTrimmedFile(path.join(paths.sessionRoot, "issue_url")),
      pull_request_file: path.join(paths.sessionRoot, "pull_request.md"),
      pr_url: prUrl,
      target_root: paths.targetRoot
    });
    await writePromptArtifact(paths, "pr_merge_prepared", prompt);
    await markStatus(paths, SESSION_STATUS.WAITING_FOR_USER);
    return buildSessionResponse(paths, {
      codex: PR_MERGE_PREP_CODEX_HANDOFF,
      ok: true,
      preconditions,
      prompt,
      status: SESSION_STATUS.WAITING_FOR_USER
    });
  }

  if (!continueToMerge) {
    return failSession(paths, {
      code: "pr_merge_prepare_decision_required",
      message: "Choose whether to ask Codex to prepare the PR for merge or continue to the merge decision.",
      repairCommand: `jskit session ${paths.sessionId} step --continue-to-merge true`,
      preconditions
    });
  }

  await writeStepRecord(paths, "pr_merge_prepared", "User continued from PR merge preparation to the merge decision.");
  await markStatus(paths, SESSION_STATUS.RUNNING);
  return buildSessionResponse(paths, {
    preconditions
  });
}

async function finalizePr(paths, options = {}, context = {}) {
  const preconditions = context.preconditions || [];
  const prUrl = await readTrimmedFile(path.join(paths.sessionRoot, "pr_url"));
  const closeWithoutMerge = options.closeWithoutMerge === true ||
    normalizeText(options["close-without-merge"]).toLowerCase() === "true" ||
    options.skipMerge === true ||
    normalizeText(options["skip-merge"]).toLowerCase() === "true";
  if (closeWithoutMerge) {
    const guardResult = await runSessionFinalizationGuard(paths, preconditions);
    if (!guardResult.ok) {
      return guardResult.response;
    }
    return closePrWithoutMerge(paths, prUrl, options);
  }
  const mergePr = options.mergePr === true ||
    normalizeText(options["merge-pr"]).toLowerCase() === "true";
  if (!mergePr) {
    return failSession(paths, {
      code: "pr_finalize_decision_required",
      message: "Choose whether to merge the PR or skip merge.",
      repairCommand: `jskit session ${paths.sessionId} step --merge-pr true`,
      preconditions
    });
  }
  const guardResult = await runSessionFinalizationGuard(paths, preconditions);
  if (!guardResult.ok) {
    return guardResult.response;
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
      await writePromptArtifact(paths, "pr_merge_failure", prompt);
      return failSession(paths, {
        code: "pr_merge_failed",
        message: mergeResult?.output || existingPrState.output || "Failed to merge PR.",
        repairCommand: `gh pr merge ${prUrl} --merge --delete-branch`,
        preconditions,
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
  await writeStepRecord(paths, "pr_finalized", `Merged PR ${prUrl}.`);
  await markStatus(paths, SESSION_STATUS.RUNNING);
  return buildSessionResponse(paths);
}

async function finishSession(paths) {
  const prUrl = await readTrimmedFile(path.join(paths.sessionRoot, "pr_url"));
  const issueUrl = await readTrimmedFile(path.join(paths.sessionRoot, "issue_url"));
  const codexThreadId = await readTrimmedFile(path.join(paths.sessionRoot, "codex_thread_id"));
  const prOutcome = parseJsonObject(await readTextIfExists(path.join(paths.sessionRoot, "pr_outcome.json")));
  const removeFailure = await removeSessionWorktree(paths);
  if (removeFailure) {
    return removeFailure;
  }
  const prompt = await renderPrompt(paths, "final_comment.md", {
    codex_thread_id: codexThreadId,
    issue_url: issueUrl,
    pr_outcome: prOutcome?.outcome || "unknown",
    pr_outcome_reason: prOutcome?.reason || "",
    pr_url: prUrl,
    session_id: paths.sessionId,
    transcript_log: path.join(paths.completedSessionRoot, "transcript.log")
  });
  const finalCommentPath = path.join(paths.sessionRoot, "final_comment");
  await writeTextFile(finalCommentPath, prompt);
  if (issueUrl) {
    await runLoggedCommand(paths, "github_issue_comment", "gh", ["issue", "comment", issueUrl, "--body-file", finalCommentPath], {
      cwd: paths.targetRoot,
      timeout: 1000 * 60
    });
  }
  await writeStepRecord(paths, "session_finished", `Removed worktree ${paths.worktree} and finished session ${paths.sessionId} with PR outcome ${prOutcome?.outcome || "unknown"}.`);
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
  issue_created: createIssue,
  issue_submitted: submitIssue,
  plan_made: makePlan,
  plan_executed: renderPlanExecutionPrompt,
  automated_checks_run: (paths, options, context) => runAutomatedChecks(paths, {
    stepId: "automated_checks_run"
  }, options, context),
  deep_ui_check_run: (paths, options, context) => runDeepUiCheck(paths, {
    phase: "pre_review",
    stepId: "deep_ui_check_run"
  }, options, context),
  review_prompt_rendered: renderReviewPrompt,
  review_changes_accepted: acceptReviewChanges,
  user_check_completed: userCheck,
  changes_committed: commitAcceptedChanges,
  blueprint_updated: updateBlueprint,
  final_report_created: createPullRequestFile,
  pr_created: createPr,
  pr_merge_prepared: preparePrMerge,
  pr_finalized: finalizePr,
  main_checkout_synced: syncMainCheckout,
  session_finished: finishSession
});

const PRECONDITION_RUNNERS = Object.freeze({
  accepted_changes_committed: assertAcceptedChangesCommitted,
  active_cycle_exists: assertActiveCycleExists,
  active_cycle_user_check_passed: assertActiveCycleUserCheckPassed,
  user_check_passed: assertUserCheckPassed,
  blueprint_update_satisfied: assertBlueprintUpdateSatisfied,
  deep_ui_check_satisfied: assertDeepUiCheckSatisfied,
  dependencies_installed: assertDependenciesInstalled,
  pull_request_file_exists: assertPullRequestFileExists,
  git_current_branch: (paths) => assertGitCurrentBranch(paths.targetRoot),
  git_repository: (paths) => assertGitRepository(paths.targetRoot),
  github_auth: (paths) => assertGhAuth(paths.targetRoot),
  github_origin: (paths) => assertGithubOrigin(paths.targetRoot),
  issue_text_exists: assertIssueTextExists,
  issue_url_exists: assertIssueUrlExists,
  automated_checks_passed: assertAutomatedChecksPassed,
  main_checkout_sync_satisfied: assertMainCheckoutSyncSatisfied,
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

function sessionStepError(paths, {
  code,
  message,
  repairCommand = ""
} = {}) {
  return buildSessionResponse(paths, {
    ok: false,
    errors: [
      createError({
        code,
        message,
        repairCommand
      })
    ]
  });
}

async function createIssueFileAction(paths, options = {}, context = {}) {
  void options;
  const artifacts = await readSessionArtifacts(paths);
  if (artifacts.nextStep === "issue_prompt_rendered") {
    if (!artifacts.issueDefinitionRequested) {
      return sessionStepError(paths, {
        code: "issue_prompt_missing",
        message: "Cannot create the issue-file prompt until the issue-definition prompt has been created.",
        repairCommand: `jskit session ${paths.sessionId} define_issue --prompt "<what should change>"`
      });
    }
    await writeStepRecord(paths, "issue_prompt_rendered", "Issue scoped in Codex terminal.");
    await markStatus(paths, SESSION_STATUS.RUNNING);
  }
  return renderIssueFilePrompt(paths, context);
}

async function createGithubIssueAction(paths, options = {}, context = {}) {
  const issueText = await readTrimmedFile(path.join(paths.sessionRoot, "issue.md"));
  if (!issueText) {
    return sessionStepError(paths, {
      code: "issue_file_missing",
      message: "Cannot create the GitHub issue until issue.md exists.",
      repairCommand: `jskit session ${paths.sessionId} create_issue_file`
    });
  }
  return submitIssue(paths, options, context);
}

const STEP_ACTION_RUNNERS = Object.freeze({
  worktree_created: Object.freeze({
    create_worktree: createWorktree
  }),
  dependencies_installed: Object.freeze({
    run_npm_install: installDependencies
  }),
  issue_prompt_rendered: Object.freeze({
    create_issue_file: createIssueFileAction,
    define_issue: renderIssuePrompt
  }),
  issue_created: Object.freeze({
    create_issue_file: createIssueFileAction
  }),
  issue_submitted: Object.freeze({
    create_issue_on_gh: createGithubIssueAction
  }),
  plan_made: Object.freeze({
    make_plan: makePlan
  }),
  plan_executed: Object.freeze({
    execute_plan: renderPlanExecutionPrompt
  }),
  deep_ui_check_run: Object.freeze({
    run_deep_ui_check: (paths, options, context) => runDeepUiCheck(paths, {
      phase: "pre_review",
      stepId: "deep_ui_check_run"
    }, options, context)
  }),
  review_prompt_rendered: Object.freeze({
    resolve_deslop: (paths, _options, context) => renderResolveDeslopPrompt(paths, context)
  }),
  review_changes_accepted: Object.freeze({
    resolve_deslop: (paths, _options, context) => renderResolveDeslopPrompt(paths, context)
  }),
  automated_checks_run: Object.freeze({
    run_automated_checks: (paths, options, context) => runAutomatedChecks(paths, {
      stepId: "automated_checks_run"
    }, options, context)
  }),
  blueprint_updated: Object.freeze({
    update_blueprint: updateBlueprint
  }),
  changes_committed: Object.freeze({
    commit_changes: commitAcceptedChanges
  }),
  final_report_created: Object.freeze({
    create_pull_request_file: createPullRequestFile
  }),
  pr_created: Object.freeze({
    create_pr_on_gh: createPr
  })
});

async function runSessionStepAction({
  targetRoot = process.cwd(),
  sessionId,
  action,
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
    const runner = STEP_ACTION_RUNNERS[nextStep]?.[normalizeText(action)];
    if (typeof runner !== "function") {
      return sessionStepError(paths, {
        code: "session_action_not_available",
        message: `Action ${normalizeText(action) || "(missing)"} is not available while the current step is ${nextStep || "complete"}.`,
        repairCommand: `jskit session ${paths.sessionId}`
      });
    }
    const stepPreconditions = await runNamedPreconditions(paths, STEP_PRECONDITION_NAMES[nextStep] || ["session_exists"]);
    if (!stepPreconditions.ok) {
      return sessionStepError(paths, {
        ...stepPreconditions.error,
        repairCommand: stepPreconditions.error?.repairCommand || `jskit session ${paths.sessionId}`
      });
    }
    return runner(paths, options, {
      completeStep: false,
      preconditions: stepPreconditions.preconditions
    });
  });
}

async function advanceSessionStep({
  targetRoot = process.cwd(),
  sessionId
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
    if (nextStep === "worktree_created") {
      if (!await hasWorktree(paths)) {
        return sessionStepError(paths, {
          code: "worktree_not_created",
          message: "Cannot move to the next step until the session worktree exists.",
          repairCommand: `jskit session ${paths.sessionId} create_worktree`
        });
      }
      await writeStepRecord(paths, "worktree_created", `Session worktree is ready at ${paths.worktree}.`);
      await markStatus(paths, SESSION_STATUS.RUNNING);
      return buildSessionResponse(paths);
    }
    if (nextStep === "dependencies_installed") {
      const installResult = await readTextIfExists(path.join(paths.sessionRoot, DEPENDENCIES_INSTALL_RESULT_FILE));
      if (!installResult.trim()) {
        return sessionStepError(paths, {
          code: "dependencies_not_installed",
          message: "Cannot move to the next step until dependencies have been installed in the session worktree.",
          repairCommand: `jskit session ${paths.sessionId} run_npm_install`
        });
      }
      return recordDependenciesInstalled(paths, {
        message: installResult.trim()
      });
    }
    if (nextStep === "issue_prompt_rendered") {
      if (!artifacts.issueDefinitionRequested) {
        return sessionStepError(paths, {
          code: "issue_prompt_missing",
          message: "Cannot move to the next step until the issue-definition prompt has been created.",
          repairCommand: `jskit session ${paths.sessionId} define_issue --prompt "<what should change>"`
        });
      }
      if (!artifacts.issueText) {
        return sessionStepError(paths, {
          code: "issue_file_missing",
          message: "Cannot move to the next step until issue.md exists.",
          repairCommand: `jskit session ${paths.sessionId} create_issue_file`
        });
      }
      await writeStepRecord(paths, "issue_prompt_rendered", "Issue scoped in Codex terminal.");
      await writeStepRecord(paths, "issue_created", "Issue files are ready for review and submission.");
      await markStatus(paths, SESSION_STATUS.RUNNING);
      return buildSessionResponse(paths);
    }
    if (nextStep === "issue_created") {
      if (!artifacts.issueText) {
        return sessionStepError(paths, {
          code: "issue_file_missing",
          message: "Cannot move to the next step until issue.md exists.",
          repairCommand: `jskit session ${paths.sessionId} create_issue_file`
        });
      }
      await writeStepRecord(paths, "issue_created", "Issue files are ready for review and submission.");
      await markStatus(paths, SESSION_STATUS.RUNNING);
      return buildSessionResponse(paths);
    }
    if (nextStep === "issue_submitted") {
      if (!artifacts.issueUrl) {
        return sessionStepError(paths, {
          code: "issue_url_missing",
          message: "Cannot move to the next step until the GitHub issue exists.",
          repairCommand: `jskit session ${paths.sessionId} create_issue_on_gh`
        });
      }
      await writeIssueMetadataFiles(paths, {
        issueTitle: artifacts.issueTitle || titleFromIssue(artifacts.issueText),
        issueUrl: artifacts.issueUrl
      });
      await writeStepRecord(paths, "issue_submitted", `Created GitHub issue ${artifacts.issueUrl}.`);
      await markStatus(paths, SESSION_STATUS.RUNNING);
      return buildSessionResponse(paths);
    }
    if (nextStep === "plan_made") {
      if (!artifacts.makePlanRequested) {
        return sessionStepError(paths, {
          code: "session_step_not_ready",
          message: "Current step plan_made is not ready to advance.",
          repairCommand: `jskit session ${paths.sessionId} make_plan`
        });
      }
      const stepPreconditions = await runNamedPreconditions(paths, STEP_PRECONDITION_NAMES[nextStep] || ["session_exists"]);
      if (!stepPreconditions.ok) {
        return sessionStepError(paths, {
          ...stepPreconditions.error,
          repairCommand: stepPreconditions.error?.repairCommand || `jskit session ${paths.sessionId}`
        });
      }
      return makePlan(paths, {}, {
        preconditions: stepPreconditions.preconditions
      });
    }
    if (nextStep === "plan_executed") {
      if (!artifacts.executePlanRequested) {
        return sessionStepError(paths, {
          code: "session_step_not_ready",
          message: "Current step plan_executed is not ready to advance.",
          repairCommand: `jskit session ${paths.sessionId} execute_plan`
        });
      }
      const stepPreconditions = await runNamedPreconditions(paths, STEP_PRECONDITION_NAMES[nextStep] || ["session_exists"]);
      if (!stepPreconditions.ok) {
        return sessionStepError(paths, {
          ...stepPreconditions.error,
          repairCommand: stepPreconditions.error?.repairCommand || `jskit session ${paths.sessionId}`
        });
      }
      return renderPlanExecutionPrompt(paths, {}, {
        preconditions: stepPreconditions.preconditions
      });
    }
    if (nextStep === "deep_ui_check_run") {
      const stepPreconditions = await runNamedPreconditions(paths, STEP_PRECONDITION_NAMES[nextStep] || ["session_exists"]);
      if (!stepPreconditions.ok) {
        return sessionStepError(paths, {
          ...stepPreconditions.error,
          repairCommand: stepPreconditions.error?.repairCommand || `jskit session ${paths.sessionId}`
        });
      }
      const deepUiCheckPrompted = (artifacts.uiChecks || []).some((entry) => {
        return normalizeText(entry?.stepId) === "deep_ui_check_run" &&
          normalizeText(entry?.status) === "prompted";
      });
      await writeStepRecord(
        paths,
        "deep_ui_check_run",
        deepUiCheckPrompted ? "Run deep UI check completed by Codex." : "Deep UI check skipped."
      );
      await markStatus(paths, SESSION_STATUS.RUNNING);
      return buildSessionResponse(paths, {
        preconditions: stepPreconditions.preconditions
      });
    }
    if (nextStep === "review_prompt_rendered") {
      const stepPreconditions = await runNamedPreconditions(paths, STEP_PRECONDITION_NAMES[nextStep] || ["session_exists"]);
      if (!stepPreconditions.ok) {
        return sessionStepError(paths, {
          ...stepPreconditions.error,
          repairCommand: stepPreconditions.error?.repairCommand || `jskit session ${paths.sessionId}`
        });
      }
      const reviewPrompted = (artifacts.reviewPasses || []).some((entry) => {
        return normalizeText(entry?.status) === "prompted";
      });
      await writeStepRecord(
        paths,
        "review_prompt_rendered",
        reviewPrompted ? "Review/deslop completed by Codex." : "Review/deslop skipped."
      );
      await writeStepRecord(
        paths,
        "review_changes_accepted",
        reviewPrompted ? "Review/deslop accepted." : "No review/deslop pass was requested."
      );
      await markStatus(paths, SESSION_STATUS.RUNNING);
      return buildSessionResponse(paths, {
        preconditions: stepPreconditions.preconditions
      });
    }
    if (nextStep === "automated_checks_run") {
      const stepPreconditions = await runNamedPreconditions(paths, STEP_PRECONDITION_NAMES[nextStep] || ["session_exists"]);
      if (!stepPreconditions.ok) {
        return sessionStepError(paths, {
          ...stepPreconditions.error,
          repairCommand: stepPreconditions.error?.repairCommand || `jskit session ${paths.sessionId}`
        });
      }
      const [command, args] = await doctorCommandForWorktree(paths.worktree);
      const checkCommand = [command, ...args].join(" ");
      const automatedChecksPrompted = (artifacts.checks || []).some((entry) => {
        return normalizeText(entry?.stepId) === "automated_checks_run" &&
          normalizeText(entry?.status) === "prompted";
      });
      if (automatedChecksPrompted) {
        const checksRoot = path.join(paths.sessionRoot, "checks");
        await mkdir(checksRoot, { recursive: true });
        await writeTextFile(
          path.join(checksRoot, "automated_checks_run.json"),
          `${JSON.stringify({
            command: checkCommand,
            ok: true,
            status: "completed_by_codex",
            stepId: "automated_checks_run"
          }, null, 2)}\n`
        );
      }
      await writeStepRecord(
        paths,
        "automated_checks_run",
        automatedChecksPrompted ? `Run automated checks completed by Codex: ${checkCommand}.` : "Automated checks skipped."
      );
      await markStatus(paths, SESSION_STATUS.RUNNING);
      return buildSessionResponse(paths, {
        preconditions: stepPreconditions.preconditions
      });
    }
    if (nextStep === "blueprint_updated") {
      const stepPreconditions = await runNamedPreconditions(paths, STEP_PRECONDITION_NAMES[nextStep] || ["session_exists"]);
      if (!stepPreconditions.ok) {
        return sessionStepError(paths, {
          ...stepPreconditions.error,
          repairCommand: stepPreconditions.error?.repairCommand || `jskit session ${paths.sessionId}`
        });
      }
      await writeStepRecord(paths, "blueprint_updated", "Blueprint update step completed.");
      await markStatus(paths, SESSION_STATUS.RUNNING);
      return buildSessionResponse(paths, {
        preconditions: stepPreconditions.preconditions,
        status: SESSION_STATUS.RUNNING
      });
    }
    if (nextStep === "changes_committed") {
      const stepPreconditions = await runNamedPreconditions(paths, STEP_PRECONDITION_NAMES[nextStep] || ["session_exists"]);
      if (!stepPreconditions.ok) {
        return sessionStepError(paths, {
          ...stepPreconditions.error,
          repairCommand: stepPreconditions.error?.repairCommand || `jskit session ${paths.sessionId}`
        });
      }
      const commitInfo = await readAcceptedChangesCommit(paths);
      if (!commitInfo?.commit) {
        return sessionStepError(paths, {
          code: "changes_not_committed",
          message: "Cannot move to the next step until accepted changes have been committed.",
          repairCommand: `jskit session ${paths.sessionId} commit_changes`
        });
      }
      const warnings = [];
      if (commitInfo.noChanges === true) {
        warnings.push({
          code: "accepted_changes_noop",
          message: "No accepted worktree changes were found; continuing without a new commit."
        });
      }
      await writeStepRecord(
        paths,
        "changes_committed",
        commitInfo.noChanges === true
          ? "No accepted worktree changes were found; continued without a new commit."
          : `Committed accepted changes at ${commitInfo.commit || "unknown"}.`
      );
      await markStatus(paths, SESSION_STATUS.RUNNING);
      return buildSessionResponse(paths, {
        preconditions: stepPreconditions.preconditions,
        warnings
      });
    }
    if (nextStep === "final_report_created") {
      const pullRequestText = await readTrimmedFile(path.join(paths.sessionRoot, "pull_request.md"));
      if (!pullRequestText) {
        return sessionStepError(paths, {
          code: "pull_request_file_missing",
          message: "Cannot move to the next step until pull_request.md exists.",
          repairCommand: `jskit session ${paths.sessionId} create_pull_request_file`
        });
      }
      const stepPreconditions = await runNamedPreconditions(paths, STEP_PRECONDITION_NAMES[nextStep] || ["session_exists"]);
      if (!stepPreconditions.ok) {
        return sessionStepError(paths, {
          ...stepPreconditions.error,
          repairCommand: stepPreconditions.error?.repairCommand || `jskit session ${paths.sessionId}`
        });
      }
      await writeStepRecord(paths, "final_report_created", "Pull request file is ready for review and submission.");
      await markStatus(paths, SESSION_STATUS.RUNNING);
      return buildSessionResponse(paths, {
        preconditions: stepPreconditions.preconditions
      });
    }
    if (nextStep === "pr_created") {
      if (!artifacts.prUrl) {
        return sessionStepError(paths, {
          code: "pr_url_missing",
          message: "Cannot move to the next step until the GitHub pull request exists.",
          repairCommand: `jskit session ${paths.sessionId} create_pr_on_gh`
        });
      }
      const stepPreconditions = await runNamedPreconditions(paths, STEP_PRECONDITION_NAMES[nextStep] || ["session_exists"]);
      if (!stepPreconditions.ok) {
        return sessionStepError(paths, {
          ...stepPreconditions.error,
          repairCommand: stepPreconditions.error?.repairCommand || `jskit session ${paths.sessionId}`
        });
      }
      await writeStepRecord(paths, "pr_created", `Created GitHub pull request ${artifacts.prUrl}.`);
      await markStatus(paths, SESSION_STATUS.RUNNING);
      return buildSessionResponse(paths, {
        preconditions: stepPreconditions.preconditions
      });
    }
    return sessionStepError(paths, {
      code: "session_step_not_ready",
      message: `Current step ${nextStep} is not ready to advance.`,
      repairCommand: `jskit session ${paths.sessionId}`
    });
  });
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
    const runner = STEP_RUNNERS[nextStep];
    if (typeof runner !== "function") {
      return failSession(paths, {
        code: "step_not_implemented",
        message: `No runner exists for step ${nextStep}.`,
        status: SESSION_STATUS.FAILED
      });
    }
    if (skipStepRequested(options)) {
      return skipCurrentStep(paths, nextStep, options);
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
      `${timestampForStepRecord()}\nAbandoned session ${paths.sessionId}.`
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
  advanceSessionStep,
  adoptDependenciesInstalled,
  adoptCodexThreadId,
  buildSessionResponse,
  buildSessionErrorResponse,
  createSession,
  createSessionId,
  extractIssueTitle,
  extractIssueText,
  inspectSession,
  inspectSessionDiff,
  inspectSessionDetails,
  isValidSessionId,
  listSessions,
  renderTemplate,
  recordDependenciesInstalled,
  rewindSession,
  resolveSessionPaths,
  runSessionStep,
  runSessionStepAction
};
