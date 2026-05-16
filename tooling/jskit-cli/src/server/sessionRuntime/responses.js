import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import {
  CYCLE_STEP_IDS,
  DEPENDENCIES_INSTALL_RESULT_FILE,
  ISSUE_FILE_CODEX_HANDOFF,
  ISSUE_DEFINITION_CODEX_HANDOFF,
  JSKIT_CLI_SHELL_COMMAND,
  REVIEW_EXECUTION_CODEX_HANDOFF,
  REVIEW_PASS_LIMIT,
  SESSION_WORKFLOW_VERSION,
  SESSION_STATUS,
  STEP_DEFINITION_BY_ID,
  STEP_DEFINITIONS,
  STEP_IDS,
  STEP_LABEL_BY_ID
} from "./constants.js";
import {
  fileExists,
  normalizeText,
  readTextIfExists,
  readTrimmedFile,
  runGitInWorktree,
  timestampForStepRecord,
  writeTextFile
} from "./io.js";
import {
  pathsForExistingSession
} from "./paths.js";
import {
  hasWorktree
} from "./worktrees.js";
import {
  inspectReadyJskitAppRoot
} from "./appReadiness.js";

function createError({
  code,
  message,
  repairCommand = ""
}) {
  return Object.freeze({
    code: normalizeText(code),
    message: normalizeText(message),
    repairCommand: normalizeText(repairCommand)
  });
}

function createPrecondition({
  id,
  ok,
  message
}) {
  return Object.freeze({
    id: normalizeText(id),
    ok: ok === true,
    message: normalizeText(message)
  });
}

function createWarning({
  code,
  message,
  repairCommand = ""
}) {
  return createError({ code, message, repairCommand });
}

const ACCEPTED_CHANGES_NOOP_WARNING = createWarning({
  code: "accepted_changes_noop",
  message: "No accepted worktree changes were found; continuing without a new commit."
});

function issueNumberFromUrl(issueUrl = "") {
  const match = /\/issues\/(\d+)(?:\b|$)/u.exec(String(issueUrl || ""));
  return match ? match[1] : "";
}

function normalizeStepId(stepId) {
  return normalizeText(stepId);
}

function stepIndex(stepId) {
  return STEP_IDS.indexOf(normalizeStepId(stepId));
}

function normalizeKnownStepIds(stepIds = []) {
  return Array.from(
    new Set(
      stepIds
        .map((stepId) => normalizeText(stepId))
        .filter((stepId) => STEP_IDS.includes(stepId))
    )
  ).sort((left, right) => STEP_IDS.indexOf(left) - STEP_IDS.indexOf(right));
}

function stepCanExposeStoredPrompt(stepId) {
  const normalizedStepId = normalizeStepId(stepId);
  const step = STEP_DEFINITION_BY_ID[normalizedStepId];
  return Boolean(
    normalizedStepId === "review_changes_accepted" ||
    step?.codex ||
    step?.kind === "codex_prompt" ||
    step?.kind === "human_input"
  );
}

const DEFAULT_ACTIVE_CYCLE = "001";
const DEFAULT_REVIEW_PASS = "001";

function normalizeCycleNumber(value = "") {
  const normalized = normalizeText(value).replace(/^cycle_/u, "");
  if (!/^\d+$/u.test(normalized)) {
    return DEFAULT_ACTIVE_CYCLE;
  }
  return String(Number.parseInt(normalized, 10)).padStart(3, "0");
}

function cycleDirectoryName(cycle = DEFAULT_ACTIVE_CYCLE) {
  return `cycle_${normalizeCycleNumber(cycle)}`;
}

function isCycleStepId(stepId = "") {
  return CYCLE_STEP_IDS.includes(normalizeStepId(stepId));
}

async function readWorkflowVersion(paths) {
  return readTrimmedFile(path.join(paths.sessionRoot, "workflow_version"));
}

async function readActiveCycle(paths) {
  const cycle = await readTrimmedFile(path.join(paths.sessionRoot, "active_cycle"));
  return normalizeCycleNumber(cycle || DEFAULT_ACTIVE_CYCLE);
}

function cycleStepsRoot(paths, cycle) {
  return path.join(paths.sessionRoot, "steps", cycleDirectoryName(cycle));
}

function cycleRoot(paths, cycle) {
  return path.join(paths.sessionRoot, "cycles", cycleDirectoryName(cycle));
}

function normalizeReviewPassNumber(value = "") {
  const normalized = normalizeText(value).replace(/^pass_/u, "");
  if (!/^\d+$/u.test(normalized)) {
    return DEFAULT_REVIEW_PASS;
  }
  return String(Number.parseInt(normalized, 10)).padStart(3, "0");
}

function reviewPassDirectoryName(pass = DEFAULT_REVIEW_PASS) {
  return `pass_${normalizeReviewPassNumber(pass)}`;
}

function reviewPassRoot(paths, pass) {
  return path.join(paths.sessionRoot, "review_passes", reviewPassDirectoryName(pass));
}

async function parseJsonFileIfExists(filePath) {
  const source = await readTextIfExists(filePath);
  if (!source) {
    return null;
  }
  try {
    const parsed = JSON.parse(source);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function readReviewPassNumbers(paths) {
  try {
    const entries = await readdir(path.join(paths.sessionRoot, "review_passes"), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && /^pass_\d+$/u.test(entry.name))
      .map((entry) => normalizeReviewPassNumber(entry.name))
      .sort((left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10));
  } catch {
    return [];
  }
}

async function readReviewPassInfo(paths, pass) {
  const normalizedPass = normalizeReviewPassNumber(pass);
  const root = reviewPassRoot(paths, normalizedPass);
  const [prompt, accepted] = await Promise.all([
    parseJsonFileIfExists(path.join(root, "prompt.json")),
    parseJsonFileIfExists(path.join(root, "accepted.json"))
  ]);
  const status = accepted?.status || prompt?.status || "unknown";
  const changedFiles = Array.isArray(accepted?.changedFiles) ? accepted.changedFiles : [];
  return {
    pass: normalizedPass,
    label: reviewPassDirectoryName(normalizedPass),
    status,
    promptPath: prompt?.promptPath || path.join(root, "review_prompt_rendered"),
    acceptedAt: accepted?.acceptedAt || "",
    changedFiles,
    commit: "",
    committedAt: "",
    findingsRemaining: accepted?.findingsRemaining === true,
    maxPasses: REVIEW_PASS_LIMIT
  };
}

async function readReviewPasses(paths) {
  const passes = await readReviewPassNumbers(paths);
  return Promise.all(passes.map((pass) => readReviewPassInfo(paths, pass)));
}

const REVIEW_STEP_IDS = Object.freeze([
  "review_prompt_rendered",
  "review_changes_accepted"
]);

function latestReviewPass(artifacts = {}) {
  const passes = Array.isArray(artifacts.reviewPasses) ? artifacts.reviewPasses : [];
  return passes.at(-1) || null;
}

function latestReviewPassIsPrompted(artifacts = {}) {
  return latestReviewPass(artifacts)?.status === "prompted";
}

async function readPromptFromAbsolutePath(filePath = "") {
  return filePath ? readTextIfExists(filePath) : "";
}

async function readReviewPromptForStep(paths, artifacts = {}) {
  const latestPass = latestReviewPass(artifacts);
  if (latestPass?.status === "prompted") {
    const prompt = await readPromptFromAbsolutePath(latestPass.promptPath);
    if (prompt) {
      return prompt;
    }
  }
  return "";
}

async function readPromptForStep(paths, stepId, artifacts = {}) {
  if (!stepCanExposeStoredPrompt(stepId)) {
    return "";
  }
  if (REVIEW_STEP_IDS.includes(normalizeStepId(stepId))) {
    return readReviewPromptForStep(paths, artifacts);
  }
  return "";
}

async function readStepFileNames(stepsRoot) {
  try {
    const entries = await readdir(stepsRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function readCompletedSteps(paths) {
  const stepsRoot = path.join(paths.sessionRoot, "steps");
  const globalStepIds = normalizeKnownStepIds(
    (await readStepFileNames(stepsRoot)).filter((stepId) => !isCycleStepId(stepId))
  );
  const cycleStepIds = [];
  try {
    const entries = await readdir(stepsRoot, { withFileTypes: true });
    for (const entry of entries.filter((item) => item.isDirectory() && /^cycle_\d+$/u.test(item.name)).sort((left, right) => left.name.localeCompare(right.name))) {
      cycleStepIds.push(...await readStepFileNames(path.join(stepsRoot, entry.name)));
    }
  } catch {
    // Legacy sessions may not have cycle record directories.
  }
  const completed = new Set(await applyReviewPassCompletionOverlay(paths, normalizeKnownStepIds([...globalStepIds, ...cycleStepIds])));
  if (completed.has("issue_created") && !completed.has("issue_submitted") && await readTrimmedFile(path.join(paths.sessionRoot, "issue_url"))) {
    completed.add("issue_submitted");
  }
  return normalizeKnownStepIds([...completed]);
}

async function applyReviewPassCompletionOverlay(paths, completedSteps = []) {
  const completed = new Set(completedSteps);
  if (!REVIEW_STEP_IDS.some((stepId) => completed.has(stepId))) {
    return normalizeKnownStepIds([...completed]);
  }
  const reviewPasses = await readReviewPasses(paths);
  const latestPass = reviewPasses.at(-1);
  if (!latestPass) {
    return normalizeKnownStepIds([...completed]);
  }
  const latestPassAccepted = latestPass.status === "accepted" || latestPass.status === "no_changes";
  const anotherPassRequired = latestPassAccepted && latestPass.findingsRemaining === true;
  if (anotherPassRequired) {
    REVIEW_STEP_IDS.forEach((stepId) => completed.delete(stepId));
    return normalizeKnownStepIds([...completed]);
  }
  if (latestPass.status === "accepted" || latestPass.status === "no_changes") {
    REVIEW_STEP_IDS.forEach((stepId) => completed.add(stepId));
  }
  return normalizeKnownStepIds([...completed]);
}

async function readCycleInfo(paths, cycle) {
  const normalizedCycle = normalizeCycleNumber(cycle);
  const root = cycleRoot(paths, normalizedCycle);
  const userCheckPassed = await readTextIfExists(path.join(cycleStepsRoot(paths, normalizedCycle), "user_check_completed"));
  const userCheckFailed = await readTextIfExists(path.join(cycleStepsRoot(paths, normalizedCycle), "user_check_failed"));
  const reworkRequestPath = path.join(root, "rework_request");
  const reworkRequest = await readTextIfExists(reworkRequestPath);
  return {
    cycle: normalizedCycle,
    label: cycleDirectoryName(normalizedCycle),
    reworkRequest: reworkRequest.trim(),
    reworkRequestPath: reworkRequest ? reworkRequestPath : "",
    status: userCheckPassed ? "passed" : userCheckFailed ? "failed" : "active",
    userCheckResult: userCheckPassed ? "passed" : userCheckFailed ? "failed" : "",
    userCheckRecord: (userCheckPassed || userCheckFailed).trim()
  };
}

async function readCycles(paths, activeCycle) {
  const cycles = new Set([normalizeCycleNumber(activeCycle || DEFAULT_ACTIVE_CYCLE)]);
  for (const root of [path.join(paths.sessionRoot, "steps"), path.join(paths.sessionRoot, "cycles")]) {
    try {
      const entries = await readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && /^cycle_\d+$/u.test(entry.name)) {
          cycles.add(normalizeCycleNumber(entry.name));
        }
      }
    } catch {
      // No cycle directory exists until a session enters a repeatable work cycle.
    }
  }
  return Promise.all([...cycles]
    .sort((left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10))
    .map((cycle) => readCycleInfo(paths, cycle)));
}

async function readStructuredChecks(paths) {
  const checksRoot = path.join(paths.sessionRoot, "checks");
  try {
    const entries = await readdir(checksRoot, { withFileTypes: true });
    const checks = [];
    for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".json")).sort((left, right) => left.name.localeCompare(right.name))) {
      const source = await readTextIfExists(path.join(checksRoot, entry.name));
      try {
        const parsed = JSON.parse(source);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          checks.push(parsed);
        }
      } catch {
        // Ignore malformed check metadata; the raw log remains on disk.
      }
    }
    return checks;
  } catch {
    return [];
  }
}

async function readStructuredUiChecks(paths) {
  const uiChecksRoot = path.join(paths.sessionRoot, "ui_checks");
  try {
    const entries = await readdir(uiChecksRoot, { withFileTypes: true });
    const checks = [];
    for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".json")).sort((left, right) => left.name.localeCompare(right.name))) {
      const source = await readTextIfExists(path.join(uiChecksRoot, entry.name));
      try {
        const parsed = JSON.parse(source);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          checks.push(parsed);
        }
      } catch {
        // Ignore malformed UI check metadata; the raw prompt/log remains on disk.
      }
    }
    return checks;
  } catch {
    return [];
  }
}

async function readWorktreeStatus(paths, worktreeReady) {
  if (!worktreeReady) {
    return {
      changedFiles: [],
      dirty: false,
      ok: true,
      status: "missing",
      statusText: ""
    };
  }
  const result = await runGitInWorktree(paths.worktree, ["status", "--porcelain=v1"], {
    timeout: 15000
  });
  if (!result.ok) {
    return {
      changedFiles: [],
      dirty: false,
      ok: false,
      status: "unknown",
      statusText: result.output
    };
  }
  const changedFiles = result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    changedFiles,
    dirty: changedFiles.length > 0,
    ok: true,
    status: changedFiles.length > 0 ? "dirty" : "clean",
    statusText: result.stdout
  };
}

async function readStepRecords(paths) {
  const stepsRoot = path.join(paths.sessionRoot, "steps");
  try {
    const entries = await readdir(stepsRoot, { withFileTypes: true });
    const knownStepRows = new Map();
    const unknownStepRows = [];
    entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .forEach((recordName) => {
        const stepId = normalizeStepId(recordName);
        if (STEP_IDS.includes(stepId)) {
          if (!knownStepRows.has(stepId) || recordName === stepId) {
            knownStepRows.set(stepId, {
              recordName,
              stepId
            });
          }
          return;
        }
        unknownStepRows.push({
          recordName,
          stepId
        });
      });

    const stepRows = [...knownStepRows.values(), ...unknownStepRows]
      .sort((left, right) => {
        const leftIndex = stepIndex(left.stepId);
        const rightIndex = stepIndex(right.stepId);
        if (leftIndex >= 0 && rightIndex >= 0) {
          return leftIndex - rightIndex;
        }
        if (leftIndex >= 0) {
          return -1;
        }
        if (rightIndex >= 0) {
          return 1;
        }
        return left.stepId.localeCompare(right.stepId);
      });

    const globalRecords = await Promise.all(stepRows.map(async ({ recordName, stepId }) => ({
      cycle: "",
      details: (await readTextIfExists(path.join(stepsRoot, recordName))).trim(),
      label: STEP_LABEL_BY_ID[stepId] || stepId,
      stepId
    })));

    const cycleRecords = [];
    const cycleDirectories = entries
      .filter((entry) => entry.isDirectory() && /^cycle_\d+$/u.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    for (const cycleDirectory of cycleDirectories) {
      const cycle = normalizeCycleNumber(cycleDirectory);
      const cycleRootPath = path.join(stepsRoot, cycleDirectory);
      const cycleStepIds = await readStepFileNames(cycleRootPath);
      for (const recordName of cycleStepIds) {
        const stepId = normalizeStepId(recordName);
        cycleRecords.push({
          cycle,
          details: (await readTextIfExists(path.join(cycleRootPath, recordName))).trim(),
          label: STEP_LABEL_BY_ID[stepId] || stepId,
          stepId
        });
      }
    }

    return [...globalRecords, ...cycleRecords];
  } catch {
    return [];
  }
}

function resolveNextStep(completedSteps = []) {
  const completed = new Set(completedSteps);
  return STEP_IDS.find((stepId) => !completed.has(stepId)) || "";
}

function cloneContractValue(value) {
  if (!value || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => cloneContractValue(entry));
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, cloneContractValue(entry)])
  );
}

function normalizeWarning(warning) {
  if (typeof warning === "string") {
    return createWarning({
      code: "session_warning",
      message: warning
    });
  }
  if (!warning || typeof warning !== "object" || Array.isArray(warning)) {
    return null;
  }
  return createWarning({
    code: warning.code || "session_warning",
    message: warning.message || "",
    repairCommand: warning.repairCommand || ""
  });
}

function mergeWarnings(...warningLists) {
  const merged = [];
  const seen = new Set();
  for (const warnings of warningLists) {
    for (const warning of Array.isArray(warnings) ? warnings : []) {
      const normalized = normalizeWarning(warning);
      if (!normalized?.message) {
        continue;
      }
      const key = `${normalized.code}\n${normalized.message}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(normalized);
    }
  }
  return merged;
}

async function publicCodexContract(codex = null) {
  if (!codex || typeof codex !== "object" || Array.isArray(codex)) {
    return null;
  }
  return cloneContractValue(codex);
}

function stepRepeatabilityContract(stepId) {
  return {
    repeatable: false,
    repeatableGroupId: "",
    repeatableGroupLabel: "",
    repeatableLabel: ""
  };
}

function publicStepDefinition(step, index) {
  return {
    automation: cloneContractValue(step.automation || { mode: "manual" }),
    ...(step.codex ? { codex: cloneContractValue(step.codex) } : {}),
    description: step.description,
    displayGroupId: step.displayGroupId || "",
    displayGroupLabel: step.displayGroupLabel || "",
    id: step.id,
    index,
    input: cloneContractValue(step.input),
    kind: step.kind,
    label: step.label,
    ...stepRepeatabilityContract(step.id),
    requiresExplicitRun: step.requiresExplicitRun === true,
    submitOptions: cloneContractValue(step.submitOptions || {}),
    utilityActions: cloneContractValue(step.utilityActions || [])
  };
}

function buildStepDefinitions() {
  return STEP_DEFINITIONS.map((step, index) => publicStepDefinition(step, index));
}

function stepIsRetryableWhenBlocked(stepId) {
  return [
    "automated_checks_run",
    "deep_ui_check_run",
    "main_checkout_synced"
  ].includes(normalizeStepId(stepId));
}

function uiCheckPromptedForStep(artifacts = {}, stepId = "") {
  const normalizedStepId = normalizeStepId(stepId);
  return (artifacts.uiChecks || []).some((entry) => {
    return normalizeStepId(entry?.stepId || "") === normalizedStepId &&
      normalizeText(entry?.status || "") === "prompted";
  });
}

function skipReasonForStep(stepId, artifacts = {}) {
  void stepId;
  void artifacts;
  return "";
}

function buildCurrentStepAction(stepId, artifacts = {}) {
  const step = STEP_DEFINITION_BY_ID[stepId];
  if (!step) {
    return null;
  }
  const planExecutionPrompted = artifacts.planExecution?.prompted === true;
  const planExecutionSubmitted = artifacts.planExecution?.submitted === true;
  const issueDefinitionPrompted = step.id === "issue_prompt_rendered" && artifacts.issueDefinitionRequested === true;
  const issueFilePromptAction = step.id === "issue_created";
  const issueSubmissionAction = step.id === "issue_submitted";
  const pullRequestFileAction = step.id === "final_report_created";
  const prSubmissionAction = step.id === "pr_created";
  const deepUiCheckPrompted = step.id === "deep_ui_check_run" && uiCheckPromptedForStep(artifacts, "deep_ui_check_run");
  const automatedChecksPrompted = step.id === "automated_checks_run" && (artifacts.checks || []).some((entry) => {
    return normalizeStepId(entry?.stepId || "") === "automated_checks_run" &&
      normalizeText(entry?.status || "") === "prompted";
  });
  const alternateActions = [];
  if (step.id === "review_changes_accepted") {
    alternateActions.push({
      id: "request_another_review_pass",
      helpText: "Run another explicit deslop prompt before continuing.",
      input: {
        type: "none"
      },
      label: "Run deslop",
      presentation: "secondary",
      submitOptions: {
        reviewFindingsRemaining: true
      },
      targetStep: "review_prompt_rendered"
    });
  }
  if (step.id === "pr_finalized") {
    alternateActions.push({
      id: "skip_merge",
      helpText: "Leave the PR open and record the skipped-merge outcome; final cleanup removes the session worktree.",
      input: {
        type: "none"
      },
      label: "Skip merge",
      presentation: "secondary",
      submitOptions: {
        closeWithoutMerge: true
      },
      targetStep: "pr_finalized"
    });
  }
  if (step.id === "main_checkout_synced") {
    alternateActions.push({
      id: "skip_main_checkout_sync",
      helpText: "Leave the main checkout untouched and continue with session cleanup.",
      input: {
        type: "none"
      },
      label: "Skip sync",
      presentation: "secondary",
      submitOptions: {
        skipMainSync: true
      },
      targetStep: "main_checkout_synced"
    });
  }
  const dynamicButtonLabel = (() => {
    if (step.id === "issue_created" && !artifacts.issueText) {
      return "Create issue file";
    }
    if (step.id === "issue_submitted") {
      return "Create issue on GH";
    }
    if (step.id === "pr_created") {
      return "Create PR on GH";
    }
    if (step.id === "main_checkout_synced" && artifacts.prOutcome?.outcome && artifacts.prOutcome.outcome !== "merged") {
      return "Record no sync needed";
    }
    return step.buttonLabel;
  })();
  const dynamicDescription = (() => {
    if (issueDefinitionPrompted) {
      return "Codex has the issue-definition prompt. Continue after the issue is scoped clearly enough.";
    }
    if (issueFilePromptAction && artifacts.issueFileRequested) {
      return "Codex has the issue-file prompt. Review issue.md and issue_title, then continue when ready.";
    }
    if (issueSubmissionAction && artifacts.issueUrl) {
      return "The GitHub issue has been created. Continue when ready.";
    }
    if (pullRequestFileAction && artifacts.pullRequestFileRequested) {
      return "Codex has the PR-file prompt. Review pull_request.md, then continue when ready.";
    }
    if (prSubmissionAction && artifacts.prUrl) {
      return "The GitHub pull request has been created. Continue when ready.";
    }
    if (step.id === "plan_executed" && planExecutionPrompted && !planExecutionSubmitted) {
      return "Codex has the execution prompt. Review the result, then use Next when ready.";
    }
    if (step.id === "deep_ui_check_run" && deepUiCheckPrompted) {
      return "Codex has the run deep UI check prompt. Review the result, then use Next when ready.";
    }
    if (step.id === "automated_checks_run" && automatedChecksPrompted) {
      return "Codex has the run automated checks prompt. Review the result, then use Next when ready.";
    }
    if (step.id === "main_checkout_synced" && artifacts.prOutcome?.outcome && artifacts.prOutcome.outcome !== "merged") {
      return "The PR was not merged, so JSKIT will record main checkout sync as skipped before cleanup.";
    }
    return step.description;
  })();
  const dynamicUtilityActions = (() => {
    if (step.id === "review_prompt_rendered" || step.id === "review_changes_accepted") {
      return [
        {
          id: "resolve_deslop",
          helpText: "Send Codex the explicit resolve deslop prompt. Nothing advances automatically after it finishes.",
          kind: "codex_prompt",
          label: "Resolve deslop",
          submitOptions: {
            actionCommand: "resolve_deslop"
          }
        },
        ...(step.utilityActions || [])
      ];
    }
    return step.utilityActions || [];
  })();
  return {
    alternateActions,
    buttonLabel: dynamicButtonLabel,
    description: dynamicDescription,
    displayGroupId: step.displayGroupId,
    displayGroupLabel: step.displayGroupLabel,
    index: STEP_IDS.indexOf(step.id),
    input: cloneContractValue(issueDefinitionPrompted || issueFilePromptAction || pullRequestFileAction ? { type: "none" } : step.input),
    kind: issueDefinitionPrompted || issueFilePromptAction || pullRequestFileAction ? "codex_prompt" : step.kind,
    label: dynamicButtonLabel,
    automation: cloneContractValue(issueDefinitionPrompted || issueFilePromptAction || pullRequestFileAction ? { mode: "codex_prompt" } : step.automation || { mode: "manual" }),
    ...stepRepeatabilityContract(step.id),
    requiredInput: cloneContractValue(issueDefinitionPrompted || issueFilePromptAction || pullRequestFileAction ? { type: "none" } : step.input),
    requiresExplicitRun: step.requiresExplicitRun === true,
    retryable: artifacts.status === SESSION_STATUS.BLOCKED && stepIsRetryableWhenBlocked(step.id),
    skipReason: skipReasonForStep(step.id, artifacts),
    stepId: step.id,
    submitOptions: cloneContractValue(step.submitOptions || {}),
    utilityActions: cloneContractValue(dynamicUtilityActions)
  };
}

function rawCodexHandoff(stepId, artifacts = {}) {
  if (normalizeStepId(stepId) === "issue_prompt_rendered" && artifacts.issueDefinitionRequested) {
    return cloneContractValue(ISSUE_DEFINITION_CODEX_HANDOFF);
  }
  if (normalizeStepId(stepId) === "issue_created" && artifacts.issueFileRequested) {
    return cloneContractValue(ISSUE_FILE_CODEX_HANDOFF);
  }
  if (normalizeStepId(stepId) === "review_changes_accepted" && latestReviewPassIsPrompted(artifacts)) {
    return cloneContractValue(REVIEW_EXECUTION_CODEX_HANDOFF);
  }
  const step = STEP_DEFINITION_BY_ID[stepId];
  return step?.codex ? cloneContractValue(step.codex) : null;
}

async function buildCodexHandoff(stepId, artifacts = {}) {
  return publicCodexContract(rawCodexHandoff(stepId, artifacts));
}

async function readSessionArtifacts(paths) {
  const activeCycle = await readActiveCycle(paths);
  const globalPlanExecutionRecordPath = path.join(paths.sessionRoot, "steps", "plan_executed");
  const legacyPlanExecutionRecordPath = path.join(cycleStepsRoot(paths, activeCycle), "plan_executed");
  const [
    status,
    rawCurrentStep,
    issueUrl,
    issueNumber,
    prUrl,
    issueText,
    issueTitle,
    finalReportText,
    pullRequestText,
    githubCommentsText,
    codexThreadId,
    workflowVersion,
    baseBranch,
    baseCommit,
    planExecutionRecord,
    issueDefinitionRequested,
    issueFileRequested,
    pullRequestFileRequested,
    makePlanRequested,
    blueprintUpdateRequested,
    executePlanRequested,
    prOutcomeText,
    mainCheckoutSyncText,
    changesCommittedText
  ] = await Promise.all([
    readTrimmedFile(path.join(paths.sessionRoot, "status")),
    readTrimmedFile(path.join(paths.sessionRoot, "current_step")),
    readTrimmedFile(path.join(paths.sessionRoot, "issue_url")),
    readTrimmedFile(path.join(paths.sessionRoot, "metadata", "issue_number")),
    readTrimmedFile(path.join(paths.sessionRoot, "pr_url")),
    readTextIfExists(path.join(paths.sessionRoot, "issue.md")),
    readTrimmedFile(path.join(paths.sessionRoot, "issue_title")),
    readTextIfExists(path.join(paths.sessionRoot, "final_report")),
    readTextIfExists(path.join(paths.sessionRoot, "pull_request.md")),
    readTextIfExists(path.join(paths.sessionRoot, "github_comments.json")),
    readTrimmedFile(path.join(paths.sessionRoot, "codex_thread_id")),
    readWorkflowVersion(paths),
    readTrimmedFile(path.join(paths.sessionRoot, "base_branch")),
    readTrimmedFile(path.join(paths.sessionRoot, "base_commit")),
    readTextIfExists(globalPlanExecutionRecordPath).then(async (text) => text || await readTextIfExists(legacyPlanExecutionRecordPath)),
    readTrimmedFile(path.join(paths.sessionRoot, "metadata", "issue_prompt_rendered_requested")),
    readTrimmedFile(path.join(paths.sessionRoot, "metadata", "issue_created_requested")),
    readTrimmedFile(path.join(paths.sessionRoot, "metadata", "pull_request_file_requested")),
    readTrimmedFile(path.join(paths.sessionRoot, "metadata", "make_plan_requested")),
    readTrimmedFile(path.join(paths.sessionRoot, "metadata", "blueprint_updated_requested")),
    readTrimmedFile(path.join(paths.sessionRoot, "metadata", "execute_plan_requested")),
    readTextIfExists(path.join(paths.sessionRoot, "pr_outcome.json")),
    readTextIfExists(path.join(paths.sessionRoot, "main_checkout_sync.json")),
    readTextIfExists(path.join(paths.sessionRoot, "changes_committed.json"))
  ]);
  let githubComments = {};
  if (githubCommentsText) {
    try {
      const parsed = JSON.parse(githubCommentsText);
      githubComments = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      githubComments = {};
    }
  }
  let prOutcome = null;
  if (prOutcomeText) {
    try {
      const parsed = JSON.parse(prOutcomeText);
      prOutcome = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      prOutcome = null;
    }
  }
  let mainCheckoutSync = null;
  if (mainCheckoutSyncText) {
    try {
      const parsed = JSON.parse(mainCheckoutSyncText);
      mainCheckoutSync = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      mainCheckoutSync = null;
    }
  }
  let acceptedChangesCommit = null;
  if (changesCommittedText) {
    try {
      const parsed = JSON.parse(changesCommittedText);
      acceptedChangesCommit = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      acceptedChangesCommit = null;
    }
  }
  const warnings = acceptedChangesCommit?.noChanges === true
    ? [ACCEPTED_CHANGES_NOOP_WARNING]
    : [];
  const cycles = await readCycles(paths, activeCycle);
  const checks = await readStructuredChecks(paths);
  const uiChecks = await readStructuredUiChecks(paths);
  const reviewPasses = await readReviewPasses(paths);
  const worktreeReady = await hasWorktree(paths);
  const worktreeStatus = await readWorktreeStatus(paths, worktreeReady);
  const commandLogPath = path.join(paths.sessionRoot, "command_log.jsonl");
  const dependencyInstallRecord = await readTextIfExists(path.join(paths.sessionRoot, "steps", "dependencies_installed"));
  const dependencyInstallResult = await readTextIfExists(path.join(paths.sessionRoot, DEPENDENCIES_INSTALL_RESULT_FILE));
  const appRootForArtifacts = worktreeReady ? paths.worktree : paths.targetRoot;
  const appReady = await inspectReadyJskitAppRoot(appRootForArtifacts);
  const blueprintPath = path.join(appRootForArtifacts, ".jskit", "APP_BLUEPRINT.md");
  const helperMapPath = path.join(appRootForArtifacts, ".jskit", "helper-map.md");
  const currentStep = normalizeStepId(rawCurrentStep);
  let completedSteps = await readCompletedSteps(paths);
  const worktreeRemovalCompleted = completedSteps.includes("session_finished");
  const worktreeStepRecordInvalid = !worktreeReady &&
    completedSteps.includes("worktree_created") &&
    !worktreeRemovalCompleted &&
    status !== SESSION_STATUS.FINISHED &&
    status !== SESSION_STATUS.ABANDONED;
  if (worktreeStepRecordInvalid) {
    completedSteps = completedSteps.filter((stepId) => !["worktree_created", "dependencies_installed"].includes(stepId));
  }
  const nextStep = resolveNextStep(completedSteps);
  const currentStepIndex = stepIndex(currentStep);
  const nextStepIndex = stepIndex(nextStep);
  const effectiveCurrentStep = nextStep &&
    (completedSteps.includes(currentStep) || currentStepIndex < 0 || currentStepIndex > nextStepIndex)
    ? nextStep
    : currentStep || nextStep;
  const prompt = await readPromptForStep(paths, effectiveCurrentStep, { reviewPasses });
  const dependencyInstallDetails = dependencyInstallRecord.trim() || dependencyInstallResult.trim();
  const dependencyInstallReady = Boolean(dependencyInstallRecord.trim() || dependencyInstallResult.trim());

  return {
    codexThreadId,
    completedSteps,
    currentStep: effectiveCurrentStep,
    activeCycle,
    appReady,
    baseBranch,
    baseCommit,
    blueprintExists: await fileExists(blueprintPath),
    blueprintPath,
    cycles,
    checks,
    uiChecks,
    reviewPasses,
    currentReviewPass: reviewPasses.at(-1)?.pass || "",
    commandLogExists: await fileExists(commandLogPath),
    commandLogPath,
    dependencyInstall: {
      installed: Boolean(dependencyInstallRecord.trim()),
      ready: dependencyInstallReady,
      details: dependencyInstallDetails,
      status: dependencyInstallRecord.trim()
        ? "installed"
        : dependencyInstallResult.trim() ? "ready_to_advance"
        : worktreeReady ? "pending" : "waiting_for_worktree"
    },
    helperMapExists: await fileExists(helperMapPath),
    helperMapPath,
    githubComments,
    issueNumber: issueNumber || issueNumberFromUrl(issueUrl),
    issueTitle,
    issueText: issueText.trim(),
    issueUrl,
    nextStep,
    pullRequestPath: path.join(paths.sessionRoot, "pull_request.md"),
    pullRequestText: pullRequestText.trim(),
    prUrl,
    prOutcome,
    mainCheckoutSync,
    acceptedChangesCommit,
    issueDefinitionRequested: Boolean(issueDefinitionRequested.trim()),
    issueFileRequested: Boolean(issueFileRequested.trim()),
    pullRequestFileRequested: Boolean(pullRequestFileRequested.trim()),
    makePlanRequested: Boolean(makePlanRequested.trim()),
    blueprintUpdateRequested: Boolean(blueprintUpdateRequested.trim()),
    executePlanRequested: Boolean(executePlanRequested.trim()),
    planExecution: {
      prompted: Boolean(executePlanRequested.trim()),
      promptPath: "",
      details: planExecutionRecord.trim(),
      submitted: Boolean(planExecutionRecord.trim())
    },
    finalReportText: finalReportText.trim(),
    prompt: prompt.trim(),
    status: status || SESSION_STATUS.PENDING,
    warnings,
    workflowVersion,
    worktreeReady,
    worktreeStatus
  };
}

function stepCanExposeNextCommand(stepId, artifacts = {}) {
  if (!stepId) {
    return false;
  }
  if (stepId === "worktree_created") {
    return artifacts.worktreeReady === true;
  }
  if (stepId === "dependencies_installed") {
    return artifacts.dependencyInstall?.ready === true;
  }
  if (stepId === "issue_prompt_rendered") {
    return Boolean(artifacts.issueText);
  }
  if (stepId === "issue_created") {
    return Boolean(artifacts.issueText);
  }
  if (stepId === "issue_submitted") {
    return Boolean(artifacts.issueUrl);
  }
  if (stepId === "changes_committed") {
    return Boolean(artifacts.acceptedChangesCommit?.commit);
  }
  if (stepId === "final_report_created") {
    return Boolean(artifacts.pullRequestText);
  }
  if (stepId === "pr_created") {
    return Boolean(artifacts.prUrl);
  }
  if (stepId === "plan_made") {
    return artifacts.makePlanRequested === true;
  }
  if (stepId === "plan_executed") {
    return artifacts.executePlanRequested === true;
  }
  return true;
}

function buildNextCommand(sessionId, stepId, artifacts = {}) {
  if (!stepCanExposeNextCommand(stepId, artifacts)) {
    return "";
  }
  const template = STEP_DEFINITION_BY_ID[stepId]?.nextCommandTemplate || `${JSKIT_CLI_SHELL_COMMAND} session {{session_id}} next`;
  return template.replaceAll("{{session_id}}", sessionId);
}

function buildStepActionCommands(sessionId, stepId, artifacts = {}) {
  const commandBase = `${JSKIT_CLI_SHELL_COMMAND} session ${sessionId}`;
  if (stepId === "worktree_created") {
    return artifacts.worktreeReady === true
      ? []
      : [
          {
            command: `${commandBase} create_worktree`,
            id: "create_worktree",
            label: "Create worktree"
          }
        ];
  }
  if (stepId === "dependencies_installed") {
    return artifacts.dependencyInstall?.ready === true
      ? []
      : [
          {
            command: `${commandBase} run_npm_install`,
            id: "run_npm_install",
            label: "Run npm install"
          }
        ];
  }
  if (stepId === "issue_prompt_rendered") {
    return [
      {
        command: `${commandBase} define_issue --prompt "<what should change>"`,
        id: "define_issue",
        label: "Define issue"
      },
      ...(artifacts.issueDefinitionRequested
        ? [
            {
              command: `${commandBase} create_issue_file`,
              id: "create_issue_file",
              label: "Create issue file"
            }
          ]
        : [])
    ];
  }
  if (stepId === "issue_created") {
    return [
      {
        command: `${commandBase} create_issue_file`,
        id: "create_issue_file",
        label: "Create issue file"
      }
    ];
  }
  if (stepId === "issue_submitted") {
    return artifacts.issueUrl
      ? []
      : [
          {
            command: `${commandBase} create_issue_on_gh`,
            id: "create_issue_on_gh",
            label: "Create issue on GH"
          }
        ];
  }
  if (stepId === "plan_made") {
    return [
      {
        command: `${commandBase} make_plan`,
        id: "make_plan",
        label: "Make plan"
      }
    ];
  }
  if (stepId === "plan_executed") {
    return [
      {
        command: `${commandBase} execute_plan`,
        id: "execute_plan",
        label: "Execute plan"
      }
    ];
  }
  if (stepId === "deep_ui_check_run") {
    return [
      {
        command: `${commandBase} run_deep_ui_check`,
        id: "run_deep_ui_check",
        label: "Run deep UI check"
      }
    ];
  }
  if (stepId === "automated_checks_run") {
    return [
      {
        command: `${commandBase} run_automated_checks`,
        id: "run_automated_checks",
        label: "Run automated checks"
      }
    ];
  }
  if (stepId === "review_prompt_rendered") {
    return [
      {
        command: `${commandBase} deslop`,
        id: "deslop",
        label: "Run deslop"
      },
      {
        command: `${commandBase} resolve-deslop`,
        id: "resolve_deslop",
        label: "Resolve deslop"
      }
    ];
  }
  if (stepId === "blueprint_updated") {
    return [
      {
        command: `${commandBase} update_blueprint`,
        id: "update_blueprint",
        label: "Update blueprint"
      }
    ];
  }
  if (stepId === "changes_committed") {
    return artifacts.acceptedChangesCommit?.commit
      ? []
      : [
          {
            command: `${commandBase} commit_changes`,
            id: "commit_changes",
            label: "Commit changes"
          }
        ];
  }
  if (stepId === "final_report_created") {
    return artifacts.pullRequestText
      ? []
      : [
          {
            command: `${commandBase} create_pull_request_file`,
            id: "create_pull_request_file",
            label: "Create PR file"
          }
        ];
  }
  if (stepId === "pr_created") {
    return artifacts.prUrl
      ? []
      : [
          {
            command: `${commandBase} create_pr_on_gh`,
            id: "create_pr_on_gh",
            label: "Create PR on GH"
          }
        ];
  }
  return [];
}

async function buildSessionResponse(paths, {
  codex = undefined,
  ok = true,
  errors = [],
  preconditions = [],
  prompt = undefined,
  status = undefined,
  warnings = []
} = {}) {
  const responsePaths = paths.sessionId ? await pathsForExistingSession(paths) : paths;
  const artifacts = responsePaths.sessionRoot ? await readSessionArtifacts(responsePaths) : {};
  const resolvedStatus = status || artifacts.status || (ok ? SESSION_STATUS.PENDING : SESSION_STATUS.BLOCKED);
  if (responsePaths.sessionRoot && await fileExists(responsePaths.sessionRoot) && artifacts.workflowVersion !== SESSION_WORKFLOW_VERSION) {
    return {
      ok: false,
      sessionId: paths.sessionId || "",
      status: SESSION_STATUS.BLOCKED,
      currentStep: "",
      completedSteps: artifacts.completedSteps || [],
      workflowVersion: artifacts.workflowVersion || "",
      baseBranch: artifacts.baseBranch || "",
      baseCommit: artifacts.baseCommit || "",
      blueprintPath: artifacts.blueprintPath || "",
      blueprintExists: artifacts.blueprintExists === true,
      activeCycle: artifacts.activeCycle || "",
      appReady: cloneContractValue(artifacts.appReady || null),
      cycles: cloneContractValue(artifacts.cycles || []),
      checks: cloneContractValue(artifacts.checks || []),
      dependencyInstall: cloneContractValue(artifacts.dependencyInstall || null),
      uiChecks: cloneContractValue(artifacts.uiChecks || []),
      reviewPasses: cloneContractValue(artifacts.reviewPasses || []),
      currentReviewPass: artifacts.currentReviewPass || "",
      commandLogExists: artifacts.commandLogExists === true,
      commandLogPath: artifacts.commandLogPath || "",
      stepDefinitions: buildStepDefinitions(),
      currentStepAction: null,
      codex: null,
      prompt: "",
      nextCommand: "",
      issueDefinitionRequested: artifacts.issueDefinitionRequested === true,
      issueFileRequested: artifacts.issueFileRequested === true,
      issueNumber: artifacts.issueNumber || "",
      issueUrl: artifacts.issueUrl || "",
      issueTitle: artifacts.issueTitle || "",
      issueText: artifacts.issueText || "",
      pullRequestFileRequested: artifacts.pullRequestFileRequested === true,
      pullRequestPath: artifacts.pullRequestPath || "",
      pullRequestText: artifacts.pullRequestText || "",
      githubComments: cloneContractValue(artifacts.githubComments || {}),
      makePlanRequested: artifacts.makePlanRequested === true,
      blueprintUpdateRequested: artifacts.blueprintUpdateRequested === true,
      executePlanRequested: artifacts.executePlanRequested === true,
      planExecution: cloneContractValue(artifacts.planExecution || null),
      finalReportPath: artifacts.finalReportText ? path.join(responsePaths.sessionRoot, "final_report") : "",
      finalReportText: artifacts.finalReportText || "",
      helperMapPath: artifacts.helperMapPath || "",
      helperMapExists: artifacts.helperMapExists === true,
      prUrl: artifacts.prUrl || "",
      prOutcome: cloneContractValue(artifacts.prOutcome || null),
      mainCheckoutSync: cloneContractValue(artifacts.mainCheckoutSync || null),
      acceptedChangesCommit: cloneContractValue(artifacts.acceptedChangesCommit || null),
      preconditions,
      errors: [
        createError({
          code: "unsupported_workflow_version",
          message: `Session ${paths.sessionId || ""} uses workflow version ${artifacts.workflowVersion || "missing"}, but this JSKIT runtime expects ${SESSION_WORKFLOW_VERSION}.`
        })
      ],
      warnings: [],
      archive: responsePaths.archive || "active",
      sessionRoot: responsePaths.sessionRoot || "",
      worktree: paths.worktree || "",
      worktreeReady: artifacts.worktreeReady === true,
      worktreeStatus: cloneContractValue(artifacts.worktreeStatus || null),
      branch: paths.branch || "",
      codexThreadId: artifacts.codexThreadId || ""
    };
  }
  const currentStep = artifacts.currentStep || artifacts.nextStep || "";
  const responsePrompt = typeof prompt === "string"
    ? prompt
    : stepCanExposeStoredPrompt(currentStep) ? artifacts.prompt || "" : "";
  const responseWarnings = mergeWarnings(artifacts.warnings || [], warnings);

  return {
    ok: ok === true,
    sessionId: paths.sessionId || "",
    status: resolvedStatus,
    currentStep,
    completedSteps: artifacts.completedSteps || [],
    workflowVersion: artifacts.workflowVersion || "",
    baseBranch: artifacts.baseBranch || "",
    baseCommit: artifacts.baseCommit || "",
    blueprintPath: artifacts.blueprintPath || "",
    blueprintExists: artifacts.blueprintExists === true,
    activeCycle: artifacts.activeCycle || "",
    appReady: cloneContractValue(artifacts.appReady || null),
    cycles: cloneContractValue(artifacts.cycles || []),
    checks: cloneContractValue(artifacts.checks || []),
    dependencyInstall: cloneContractValue(artifacts.dependencyInstall || null),
    uiChecks: cloneContractValue(artifacts.uiChecks || []),
    reviewPasses: cloneContractValue(artifacts.reviewPasses || []),
    currentReviewPass: artifacts.currentReviewPass || "",
    commandLogExists: artifacts.commandLogExists === true,
    commandLogPath: artifacts.commandLogPath || "",
    stepDefinitions: buildStepDefinitions(),
    currentStepAction: buildCurrentStepAction(currentStep, artifacts),
    actionCommands: buildStepActionCommands(paths.sessionId || "", currentStep, artifacts),
    codex: codex === undefined ? await buildCodexHandoff(currentStep, artifacts) : await publicCodexContract(codex),
    prompt: responsePrompt,
    nextCommand: buildNextCommand(paths.sessionId || "", currentStep, artifacts),
    issueDefinitionRequested: artifacts.issueDefinitionRequested === true,
    issueFileRequested: artifacts.issueFileRequested === true,
    issueNumber: artifacts.issueNumber || "",
    issueUrl: artifacts.issueUrl || "",
    issueTitle: artifacts.issueTitle || "",
    issueText: artifacts.issueText || "",
    pullRequestFileRequested: artifacts.pullRequestFileRequested === true,
    pullRequestPath: artifacts.pullRequestPath || "",
    pullRequestText: artifacts.pullRequestText || "",
    githubComments: cloneContractValue(artifacts.githubComments || {}),
    makePlanRequested: artifacts.makePlanRequested === true,
    blueprintUpdateRequested: artifacts.blueprintUpdateRequested === true,
    executePlanRequested: artifacts.executePlanRequested === true,
    planExecution: cloneContractValue(artifacts.planExecution || null),
    finalReportPath: artifacts.finalReportText ? path.join(responsePaths.sessionRoot, "final_report") : "",
    finalReportText: artifacts.finalReportText || "",
    helperMapPath: artifacts.helperMapPath || "",
    helperMapExists: artifacts.helperMapExists === true,
    prUrl: artifacts.prUrl || "",
    prOutcome: cloneContractValue(artifacts.prOutcome || null),
    mainCheckoutSync: cloneContractValue(artifacts.mainCheckoutSync || null),
    acceptedChangesCommit: cloneContractValue(artifacts.acceptedChangesCommit || null),
    preconditions,
    errors,
    warnings: responseWarnings,
    archive: responsePaths.archive || (resolvedStatus === SESSION_STATUS.FINISHED ? "completed" : resolvedStatus === SESSION_STATUS.ABANDONED ? "abandoned" : "active"),
    sessionRoot: responsePaths.sessionRoot || "",
    worktree: paths.worktree || "",
    worktreeReady: artifacts.worktreeReady === true,
    worktreeStatus: cloneContractValue(artifacts.worktreeStatus || null),
    branch: paths.branch || "",
    codexThreadId: artifacts.codexThreadId || ""
  };
}

function buildSessionErrorResponse({
  targetRoot = process.cwd(),
  sessionId = "",
  code,
  message,
  repairCommand = "",
  status = SESSION_STATUS.BLOCKED,
  preconditions = [],
  errors = undefined
} = {}) {
  const normalizedTargetRoot = path.resolve(normalizeText(targetRoot) || process.cwd());
  const errorList = Array.isArray(errors)
    ? errors
    : [
        createError({
          code,
          message,
          repairCommand
        })
      ];

  return {
    ok: false,
    sessionId: normalizeText(sessionId),
    status,
    currentStep: "",
    completedSteps: [],
    workflowVersion: "",
    baseBranch: "",
    baseCommit: "",
    blueprintPath: "",
    blueprintExists: false,
    activeCycle: "",
    appReady: null,
    cycles: [],
    checks: [],
    dependencyInstall: null,
    uiChecks: [],
    reviewPasses: [],
    currentReviewPass: "",
    commandLogExists: false,
    commandLogPath: "",
    stepDefinitions: buildStepDefinitions(),
    currentStepAction: null,
    codex: null,
    prompt: "",
    nextCommand: "",
    issueTitle: "",
    issueText: "",
    pullRequestFileRequested: false,
    pullRequestPath: "",
    pullRequestText: "",
    githubComments: {},
    planExecution: null,
    finalReportPath: "",
    finalReportText: "",
    helperMapPath: "",
    helperMapExists: false,
    issueUrl: "",
    prUrl: "",
    prOutcome: null,
    preconditions,
    errors: errorList,
    warnings: [],
    archive: "",
    sessionRoot: "",
    worktree: "",
    worktreeReady: false,
    worktreeStatus: null,
    branch: "",
    codexThreadId: "",
    targetRoot: normalizedTargetRoot
  };
}

async function markStatus(paths, status) {
  await writeTextFile(path.join(paths.sessionRoot, "status"), status);
}

async function markCurrentStep(paths, stepId) {
  await writeTextFile(path.join(paths.sessionRoot, "current_step"), stepId);
}

async function writeStepRecord(paths, stepId, message) {
  const root = isCycleStepId(stepId)
    ? cycleStepsRoot(paths, await readActiveCycle(paths))
    : path.join(paths.sessionRoot, "steps");
  await mkdir(root, { recursive: true });
  await writeTextFile(
    path.join(root, stepId),
    `${timestampForStepRecord()}\n${normalizeText(message) || STEP_LABEL_BY_ID[stepId] || stepId}`
  );
  const completedSteps = await readCompletedSteps(paths);
  await markCurrentStep(paths, resolveNextStep(completedSteps));
}

async function writeCycleStepRecord(paths, recordName, message, {
  cycle = ""
} = {}) {
  const activeCycle = normalizeCycleNumber(cycle || await readActiveCycle(paths));
  const root = cycleStepsRoot(paths, activeCycle);
  await mkdir(root, { recursive: true });
  await writeTextFile(
    path.join(root, normalizeText(recordName)),
    `${timestampForStepRecord()}\n${normalizeText(message) || normalizeText(recordName)}`
  );
}

async function failSession(paths, {
  code,
  message,
  repairCommand = "",
  preconditions = [],
  status = SESSION_STATUS.BLOCKED,
  prompt = "",
  codex = undefined
}) {
  if (paths.sessionRoot && await fileExists(paths.sessionRoot)) {
    await markStatus(paths, status);
  }
  return buildSessionResponse(paths, {
    ok: false,
    status,
    prompt,
    codex,
    preconditions,
    errors: [
      createError({
        code,
        message,
        repairCommand
      })
    ]
  });
}

export {
  buildSessionErrorResponse,
  buildSessionResponse,
  buildStepDefinitions,
  createError,
  createPrecondition,
  failSession,
  markCurrentStep,
  markStatus,
  normalizeReviewPassNumber,
  readActiveCycle,
  readStepRecords,
  readReviewPasses,
  readSessionArtifacts,
  reviewPassDirectoryName,
  reviewPassRoot,
  writeCycleStepRecord,
  writeStepRecord
};
