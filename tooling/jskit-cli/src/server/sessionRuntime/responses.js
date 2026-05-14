import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import {
  CYCLE_STEP_IDS,
  JSKIT_CLI_SHELL_COMMAND,
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
  timestampForReceipt,
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
  const step = STEP_DEFINITION_BY_ID[normalizeStepId(stepId)];
  return Boolean(step?.codex || step?.kind === "codex_prompt" || step?.kind === "human_input");
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

async function writeActiveCycle(paths, cycle) {
  await writeTextFile(path.join(paths.sessionRoot, "active_cycle"), `${normalizeCycleNumber(cycle)}\n`);
}

function cycleStepsRoot(paths, cycle) {
  return path.join(paths.sessionRoot, "steps", cycleDirectoryName(cycle));
}

function cycleRoot(paths, cycle) {
  return path.join(paths.sessionRoot, "cycles", cycleDirectoryName(cycle));
}

function cyclePlanPath(paths, cycle) {
  return path.join(cycleRoot(paths, cycle), "plan.md");
}

function cyclePlanPromptFileName(cycle) {
  return `cycle_${normalizeCycleNumber(cycle)}_plan_request.md`;
}

function cyclePlanExecutionPromptFileName(cycle) {
  return `cycle_${normalizeCycleNumber(cycle)}_plan_execution.md`;
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
    promptPath: prompt?.promptPath || path.join(root, "prompt.md"),
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

const PROMPT_ARTIFACT_BY_STEP_ID = Object.freeze({
  issue_drafted: "issue_draft.md",
  issue_details_gathered: "issue_details.md",
  deep_ui_check_run: "deep_ui_check_run.md",
  automated_checks_run: "automated_checks_run.md",
  blueprint_updated: "update_blueprint.md",
  user_check_completed: "user_check.md"
});

async function promptArtifactForStep(paths, stepId) {
  const normalizedStepId = normalizeStepId(stepId);
  if (normalizedStepId === "plan_made") {
    return cyclePlanPromptFileName(await readActiveCycle(paths));
  }
  if (normalizedStepId === "plan_executed") {
    return cyclePlanExecutionPromptFileName(await readActiveCycle(paths));
  }
  return PROMPT_ARTIFACT_BY_STEP_ID[normalizedStepId] || "";
}

async function readPromptForStep(paths, stepId) {
  if (!stepCanExposeStoredPrompt(stepId)) {
    return "";
  }
  const promptArtifact = await promptArtifactForStep(paths, stepId);
  if (promptArtifact) {
    const prompt = await readTextIfExists(path.join(paths.sessionRoot, "prompts", promptArtifact));
    if (prompt) {
      return prompt;
    }
  }
  return readTextIfExists(path.join(paths.sessionRoot, "prompt.md"));
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
  const activeCycle = await readActiveCycle(paths);
  const globalStepIds = normalizeKnownStepIds(
    (await readStepFileNames(stepsRoot)).filter((stepId) => !isCycleStepId(stepId))
  );
  const cycleStepIds = normalizeKnownStepIds(await readStepFileNames(cycleStepsRoot(paths, activeCycle)));
  return applyReviewPassCompletionOverlay(paths, normalizeKnownStepIds([...globalStepIds, ...cycleStepIds]));
}

const REVIEW_STEP_IDS = Object.freeze([
  "review_prompt_rendered",
  "review_changes_accepted"
]);

async function applyReviewPassCompletionOverlay(paths, completedSteps = []) {
  const completed = new Set(completedSteps);
  if (!REVIEW_STEP_IDS.some((stepId) => completed.has(stepId))) {
    return normalizeKnownStepIds([...completed]);
  }
  const reviewPasses = await readReviewPasses(paths);
  const latestPass = reviewPasses.at(-1);
  if (!latestPass) {
    REVIEW_STEP_IDS.forEach((stepId) => completed.delete(stepId));
    return normalizeKnownStepIds([...completed]);
  }
  const latestPassAccepted = latestPass.status === "accepted" || latestPass.status === "no_changes";
  const anotherPassRequired = latestPassAccepted && latestPass.findingsRemaining === true;
  if (anotherPassRequired) {
    REVIEW_STEP_IDS.forEach((stepId) => completed.delete(stepId));
    return normalizeKnownStepIds([...completed]);
  }
  if (latestPass.status === "prompted") {
    completed.add("review_prompt_rendered");
    completed.delete("review_changes_accepted");
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
  const reworkRequestPath = path.join(root, "rework_request.md");
  const reworkRequest = await readTextIfExists(reworkRequestPath);
  return {
    cycle: normalizedCycle,
    label: cycleDirectoryName(normalizedCycle),
    reworkRequest: reworkRequest.trim(),
    reworkRequestPath: reworkRequest ? reworkRequestPath : "",
    status: userCheckPassed ? "passed" : userCheckFailed ? "failed" : "active",
    userCheckResult: userCheckPassed ? "passed" : userCheckFailed ? "failed" : "",
    userCheckReceipt: (userCheckPassed || userCheckFailed).trim()
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
      // Missing cycle directories are normal for older sessions.
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

async function readReceiptSteps(paths) {
  const stepsRoot = path.join(paths.sessionRoot, "steps");
  try {
    const entries = await readdir(stepsRoot, { withFileTypes: true });
    const knownStepRows = new Map();
    const unknownStepRows = [];
    entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .forEach((receiptName) => {
        const stepId = normalizeStepId(receiptName);
        if (STEP_IDS.includes(stepId)) {
          if (!knownStepRows.has(stepId) || receiptName === stepId) {
            knownStepRows.set(stepId, {
              receiptName,
              stepId
            });
          }
          return;
        }
        unknownStepRows.push({
          receiptName,
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

    const globalReceipts = await Promise.all(stepRows.map(async ({ receiptName, stepId }) => ({
      cycle: "",
      label: STEP_LABEL_BY_ID[stepId] || stepId,
      receipt: (await readTextIfExists(path.join(stepsRoot, receiptName))).trim(),
      stepId
    })));

    const cycleReceipts = [];
    const cycleDirectories = entries
      .filter((entry) => entry.isDirectory() && /^cycle_\d+$/u.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    for (const cycleDirectory of cycleDirectories) {
      const cycle = normalizeCycleNumber(cycleDirectory);
      const cycleRootPath = path.join(stepsRoot, cycleDirectory);
      const cycleStepIds = await readStepFileNames(cycleRootPath);
      for (const receiptName of cycleStepIds) {
        const stepId = normalizeStepId(receiptName);
        cycleReceipts.push({
          cycle,
          label: STEP_LABEL_BY_ID[stepId] || stepId,
          receipt: (await readTextIfExists(path.join(cycleRootPath, receiptName))).trim(),
          stepId
        });
      }
    }

    return [...globalReceipts, ...cycleReceipts];
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

function stepRepeatabilityContract(stepId) {
  if (!CYCLE_STEP_IDS.includes(normalizeStepId(stepId))) {
    return {
      repeatable: false,
      repeatableGroupId: "",
      repeatableGroupLabel: "",
      repeatableLabel: ""
    };
  }
  return {
    repeatable: true,
    repeatableGroupId: "rework_cycle",
    repeatableGroupLabel: "Rework cycle",
    repeatableLabel: "Cycle step"
  };
}

function publicStepDefinition(step, index) {
  return {
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
    "doctor_run"
  ].includes(normalizeStepId(stepId));
}

function stepIsConditional(stepId) {
  return [
    "deep_ui_check_run"
  ].includes(normalizeStepId(stepId));
}

function activeCycleInfoFromArtifacts(artifacts = {}) {
  const activeCycle = normalizeCycleNumber(artifacts.activeCycle || "");
  return (artifacts.cycles || []).find((cycle) => cycle?.cycle === activeCycle) || null;
}

function uiCheckPromptedForStep(artifacts = {}, stepId = "") {
  const normalizedStepId = normalizeStepId(stepId);
  return (artifacts.uiChecks || []).some((entry) => {
    return normalizeStepId(entry?.stepId || "") === normalizedStepId &&
      normalizeText(entry?.status || "") === "prompted";
  });
}

function skipReasonForStep(stepId, artifacts = {}) {
  const normalizedStepId = normalizeStepId(stepId);
  if (normalizedStepId === "deep_ui_check_run" && artifacts.uiImpact === "none") {
    return "uiImpact is none.";
  }
  return "";
}

function buildCurrentStepAction(stepId, artifacts = {}) {
  const step = STEP_DEFINITION_BY_ID[stepId];
  if (!step) {
    return null;
  }
  const activeCycleInfo = activeCycleInfoFromArtifacts(artifacts);
  const planExecutionPrompted = artifacts.planExecution?.prompted === true;
  const planExecutionSubmitted = artifacts.planExecution?.submitted === true;
  const planReworkMode = step.id === "plan_made" && normalizeCycleNumber(artifacts.activeCycle || "") !== "001";
  const deepUiCheckPrompted = step.id === "deep_ui_check_run" && uiCheckPromptedForStep(artifacts, "deep_ui_check_run");
  const hasActiveReworkRequest = Boolean(activeCycleInfo?.reworkRequestPath);
  const promptPhaseButtonLabel = step.kind === "codex_output" &&
    step.codex?.mode === "inject_prompt" &&
    !artifacts.prompt
    ? step.codex.promptActionLabel || ""
    : "";
  const buttonLabel = promptPhaseButtonLabel || step.buttonLabel;
  const alternateActions = [];
  if (step.id === "user_check_completed") {
    alternateActions.push({
      id: "return_to_plan_made",
      input: {
        formatHint: "markdown",
        label: "What needs to be reworked?",
        multiline: true,
        name: "reworkNotes",
        required: true,
        type: "text"
      },
      label: "Return to Plan made",
      presentation: "exclusive",
      requiredErrorCode: "user_check_failed",
      submitOptions: {
        userCheck: "failed"
      },
      targetStep: "plan_made"
    });
  }
  if (step.id === "review_changes_accepted") {
    alternateActions.push({
      id: "request_another_review_pass",
      input: {
        formatHint: "markdown",
        label: "What important findings remain?",
        multiline: true,
        name: "reviewFindings",
        required: true,
        type: "text"
      },
      label: "Run another review pass",
      presentation: "secondary",
      submitOptions: {
        reviewFindingsRemaining: true
      },
      targetStep: "review_prompt_rendered"
    });
  }
  if (step.id === "pr_finalized") {
    alternateActions.push({
      id: "close_without_merge",
      input: {
        formatHint: "markdown",
        label: "Why is this session finishing without merge?",
        multiline: true,
        name: "closeReason",
        required: true,
        type: "text"
      },
      label: "Finish without merge",
      presentation: "secondary",
      submitOptions: {
        closeWithoutMerge: true
      },
      targetStep: "pr_finalized"
    });
  }
  const dynamicButtonLabel = (() => {
    if (step.id === "plan_executed" && planExecutionPrompted && !planExecutionSubmitted) {
      return "Go to next step";
    }
    if (step.id === "deep_ui_check_run" && deepUiCheckPrompted) {
      return "Go to next step";
    }
    if (step.id === "automated_checks_run" && artifacts.prompt) {
      return "Go to next step";
    }
    if (step.id === "plan_made" && planReworkMode && !artifacts.prompt && hasActiveReworkRequest) {
      return "Get Codex to create revised plan";
    }
    return buttonLabel;
  })();
  const dynamicDescription = (() => {
    if (step.id === "plan_executed" && planExecutionPrompted && !planExecutionSubmitted) {
      return "Codex has the execution prompt. Studio advances when Codex finishes.";
    }
    if (step.id === "deep_ui_check_run" && deepUiCheckPrompted) {
      return "Codex has the Deep UI check prompt. Studio advances when Codex finishes.";
    }
    if (step.id === "automated_checks_run" && artifacts.prompt) {
      return "Codex has the automated-checks prompt. Studio advances when Codex finishes.";
    }
    if (step.id === "plan_made" && planReworkMode && hasActiveReworkRequest) {
      return "Codex writes a revised implementation plan from the user's rework notes for this cycle.";
    }
    return step.description;
  })();
  const dynamicUtilityActions = (() => {
    return step.utilityActions || [];
  })();
  return {
    alternateActions,
    buttonLabel: dynamicButtonLabel,
    description: dynamicDescription,
    index: STEP_IDS.indexOf(step.id),
    input: cloneContractValue(step.input),
    kind: step.kind,
    label: dynamicButtonLabel,
    ...stepRepeatabilityContract(step.id),
    requiredInput: cloneContractValue(step.input),
    requiresExplicitRun: step.requiresExplicitRun === true,
    conditional: stepIsConditional(step.id),
    retryable: artifacts.status === SESSION_STATUS.BLOCKED && stepIsRetryableWhenBlocked(step.id),
    skipReason: skipReasonForStep(step.id, artifacts),
    stepId: step.id,
    utilityActions: cloneContractValue(dynamicUtilityActions)
  };
}

function buildCodexHandoff(stepId, _artifacts = {}) {
  const step = STEP_DEFINITION_BY_ID[stepId];
  return step?.codex ? cloneContractValue(step.codex) : null;
}

async function readSessionArtifacts(paths) {
  const activeCycle = await readActiveCycle(paths);
  const [
    status,
    rawCurrentStep,
    issueUrl,
    prUrl,
    issueText,
    issueTitle,
    planText,
    issueDetails,
    agentDecisions,
    finalReportText,
    githubCommentsText,
    codexThreadId,
    workflowVersion,
    baseBranch,
    baseCommit,
    issueMetadataText,
    planExecutionReceipt,
    prOutcomeText
  ] = await Promise.all([
    readTrimmedFile(path.join(paths.sessionRoot, "status")),
    readTrimmedFile(path.join(paths.sessionRoot, "current_step")),
    readTrimmedFile(path.join(paths.sessionRoot, "issue_url")),
    readTrimmedFile(path.join(paths.sessionRoot, "pr_url")),
    readTextIfExists(path.join(paths.sessionRoot, "issue.md")),
    readTrimmedFile(path.join(paths.sessionRoot, "issue_title")),
    readTextIfExists(cyclePlanPath(paths, activeCycle)),
    readTextIfExists(path.join(paths.sessionRoot, "issue_details.md")),
    readTextIfExists(path.join(paths.sessionRoot, "agent_decisions.md")),
    readTextIfExists(path.join(paths.sessionRoot, "final_report.md")),
    readTextIfExists(path.join(paths.sessionRoot, "github_comments.json")),
    readTrimmedFile(path.join(paths.sessionRoot, "codex_thread_id")),
    readWorkflowVersion(paths),
    readTrimmedFile(path.join(paths.sessionRoot, "base_branch")),
    readTrimmedFile(path.join(paths.sessionRoot, "base_commit")),
    readTextIfExists(path.join(paths.sessionRoot, "issue_metadata.json")),
    readTextIfExists(path.join(cycleStepsRoot(paths, activeCycle), "plan_executed")),
    readTextIfExists(path.join(paths.sessionRoot, "pr_outcome.json"))
  ]);
  let issueMetadata = null;
  if (issueMetadataText) {
    try {
      issueMetadata = JSON.parse(issueMetadataText);
    } catch {
      issueMetadata = null;
    }
  }
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
  const cycles = await readCycles(paths, activeCycle);
  const checks = await readStructuredChecks(paths);
  const uiChecks = await readStructuredUiChecks(paths);
  const reviewPasses = await readReviewPasses(paths);
  const worktreeReady = await hasWorktree(paths);
  const worktreeStatus = await readWorktreeStatus(paths, worktreeReady);
  const commandLogPath = path.join(paths.sessionRoot, "command_log.jsonl");
  const dependencyInstallReceipt = await readTextIfExists(path.join(paths.sessionRoot, "steps", "dependencies_installed"));
  const planExecutionPromptPath = path.join(paths.sessionRoot, "prompts", cyclePlanExecutionPromptFileName(activeCycle));
  const planExecutionPromptExists = await fileExists(planExecutionPromptPath);
  const appRootForArtifacts = worktreeReady ? paths.worktree : paths.targetRoot;
  const appReady = await inspectReadyJskitAppRoot(appRootForArtifacts);
  const blueprintPath = path.join(appRootForArtifacts, ".jskit", "APP_BLUEPRINT.md");
  const helperMapPath = path.join(appRootForArtifacts, ".jskit", "helper-map.md");
  const currentStep = normalizeStepId(rawCurrentStep);
  let completedSteps = await readCompletedSteps(paths);
  const worktreeRemovalCompleted = completedSteps.includes("pr_finalized");
  const worktreeReceiptInvalid = !worktreeReady &&
    completedSteps.includes("worktree_created") &&
    !worktreeRemovalCompleted &&
    status !== SESSION_STATUS.FINISHED &&
    status !== SESSION_STATUS.ABANDONED;
  if (worktreeReceiptInvalid) {
    completedSteps = completedSteps.filter((stepId) => !["worktree_created", "dependencies_installed"].includes(stepId));
  }
  const nextStep = resolveNextStep(completedSteps);
  const currentStepIndex = stepIndex(currentStep);
  const nextStepIndex = stepIndex(nextStep);
  const effectiveCurrentStep = nextStep &&
    (completedSteps.includes(currentStep) || currentStepIndex < 0 || currentStepIndex > nextStepIndex)
    ? nextStep
    : currentStep || nextStep;
  const prompt = await readPromptForStep(paths, effectiveCurrentStep);

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
      installed: Boolean(dependencyInstallReceipt.trim()),
      receipt: dependencyInstallReceipt.trim(),
      status: dependencyInstallReceipt.trim()
        ? "installed"
        : worktreeReady ? "pending" : "waiting_for_worktree"
    },
    helperMapExists: await fileExists(helperMapPath),
    helperMapPath,
    githubComments,
    issueMetadata,
    issueCategory: normalizeText(issueMetadata?.issueCategory || ""),
    uiImpact: normalizeText(issueMetadata?.uiImpact || ""),
    agentDecisions: agentDecisions.trim(),
    agentDecisionsLatest: agentDecisions
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && !line.startsWith("Session:"))
      .slice(-5)
      .join("\n"),
    issueTitle,
    issueText: issueText.trim(),
    issueUrl,
    nextStep,
    prUrl,
    prOutcome,
    planExecution: {
      prompted: planExecutionPromptExists,
      promptPath: planExecutionPromptExists ? planExecutionPromptPath : "",
      receipt: planExecutionReceipt.trim(),
      submitted: Boolean(planExecutionReceipt.trim())
    },
    planText: planText.trim(),
    issueDetails: issueDetails.trim(),
    finalReportText: finalReportText.trim(),
    prompt: prompt.trim(),
    status: status || SESSION_STATUS.PENDING,
    workflowVersion,
    worktreeReady,
    worktreeStatus
  };
}

function buildNextCommand(sessionId, stepId) {
  if (!stepId) {
    return "";
  }
  const template = STEP_DEFINITION_BY_ID[stepId]?.nextCommandTemplate || `${JSKIT_CLI_SHELL_COMMAND} session {{session_id}} step`;
  return template.replaceAll("{{session_id}}", sessionId);
}

async function buildSessionResponse(paths, {
  codex = undefined,
  ok = true,
  errors = [],
  preconditions = [],
  prompt = undefined,
  status = undefined
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
      issueUrl: artifacts.issueUrl || "",
      issueTitle: artifacts.issueTitle || "",
      issueText: artifacts.issueText || "",
      issueMetadata: cloneContractValue(artifacts.issueMetadata || null),
      githubComments: cloneContractValue(artifacts.githubComments || {}),
      issueCategory: artifacts.issueCategory || "",
      uiImpact: artifacts.uiImpact || "",
      agentDecisionsPath: artifacts.agentDecisions ? path.join(responsePaths.sessionRoot, "agent_decisions.md") : "",
      agentDecisionsLatest: artifacts.agentDecisionsLatest || "",
      planExecution: cloneContractValue(artifacts.planExecution || null),
      planText: artifacts.planText || "",
      issueDetails: artifacts.issueDetails || "",
      issueDetailsPath: artifacts.issueDetails ? path.join(responsePaths.sessionRoot, "issue_details.md") : "",
      finalReportPath: artifacts.finalReportText ? path.join(responsePaths.sessionRoot, "final_report.md") : "",
      finalReportText: artifacts.finalReportText || "",
      helperMapPath: artifacts.helperMapPath || "",
      helperMapExists: artifacts.helperMapExists === true,
      prUrl: artifacts.prUrl || "",
      prOutcome: cloneContractValue(artifacts.prOutcome || null),
      preconditions,
      errors: [
        createError({
          code: "unsupported_workflow_version",
          message: `Session ${paths.sessionId || ""} uses workflow version ${artifacts.workflowVersion || "missing"}, but this JSKIT runtime expects ${SESSION_WORKFLOW_VERSION}.`
        })
      ],
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
    codex: codex === undefined ? buildCodexHandoff(currentStep, artifacts) : cloneContractValue(codex),
    prompt: responsePrompt,
    nextCommand: buildNextCommand(paths.sessionId || "", currentStep),
    issueUrl: artifacts.issueUrl || "",
    issueTitle: artifacts.issueTitle || "",
    issueText: artifacts.issueText || "",
    issueMetadata: cloneContractValue(artifacts.issueMetadata || null),
    githubComments: cloneContractValue(artifacts.githubComments || {}),
    issueCategory: artifacts.issueCategory || "",
    uiImpact: artifacts.uiImpact || "",
    agentDecisionsPath: artifacts.agentDecisions ? path.join(responsePaths.sessionRoot, "agent_decisions.md") : "",
    agentDecisionsLatest: artifacts.agentDecisionsLatest || "",
    planExecution: cloneContractValue(artifacts.planExecution || null),
    planText: artifacts.planText || "",
    issueDetails: artifacts.issueDetails || "",
    issueDetailsPath: artifacts.issueDetails ? path.join(responsePaths.sessionRoot, "issue_details.md") : "",
    finalReportPath: artifacts.finalReportText ? path.join(responsePaths.sessionRoot, "final_report.md") : "",
    finalReportText: artifacts.finalReportText || "",
    helperMapPath: artifacts.helperMapPath || "",
    helperMapExists: artifacts.helperMapExists === true,
    prUrl: artifacts.prUrl || "",
    prOutcome: cloneContractValue(artifacts.prOutcome || null),
    preconditions,
    errors,
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
    issueMetadata: null,
    githubComments: {},
    issueCategory: "",
    uiImpact: "",
    agentDecisionsPath: "",
    agentDecisionsLatest: "",
    planExecution: null,
    planText: "",
    issueDetails: "",
    issueDetailsPath: "",
    finalReportPath: "",
    finalReportText: "",
    helperMapPath: "",
    helperMapExists: false,
    issueUrl: "",
    prUrl: "",
    prOutcome: null,
    preconditions,
    errors: errorList,
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

async function writeReceipt(paths, stepId, message) {
  const activeCycle = await readActiveCycle(paths);
  const root = isCycleStepId(stepId) ? cycleStepsRoot(paths, activeCycle) : path.join(paths.sessionRoot, "steps");
  await mkdir(root, { recursive: true });
  await writeTextFile(
    path.join(root, stepId),
    `${timestampForReceipt()}\n${normalizeText(message) || STEP_LABEL_BY_ID[stepId] || stepId}`
  );
  const completedSteps = await readCompletedSteps(paths);
  await markCurrentStep(paths, resolveNextStep(completedSteps));
}

async function writeCycleReceipt(paths, receiptName, message, {
  cycle = ""
} = {}) {
  const activeCycle = normalizeCycleNumber(cycle || await readActiveCycle(paths));
  const root = cycleStepsRoot(paths, activeCycle);
  await mkdir(root, { recursive: true });
  await writeTextFile(
    path.join(root, normalizeText(receiptName)),
    `${timestampForReceipt()}\n${normalizeText(message) || normalizeText(receiptName)}`
  );
}

async function failSession(paths, {
  code,
  message,
  repairCommand = "",
  preconditions = [],
  status = SESSION_STATUS.BLOCKED,
  prompt = ""
}) {
  if (paths.sessionRoot && await fileExists(paths.sessionRoot)) {
    await markStatus(paths, status);
  }
  return buildSessionResponse(paths, {
    ok: false,
    status,
    prompt,
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
  readReceiptSteps,
  readReviewPasses,
  readSessionArtifacts,
  reviewPassDirectoryName,
  reviewPassRoot,
  writeActiveCycle,
  writeCycleReceipt,
  writeReceipt
};
