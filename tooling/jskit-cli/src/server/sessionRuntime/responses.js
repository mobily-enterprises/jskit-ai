import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import {
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
  timestampForReceipt,
  writeTextFile
} from "./io.js";
import {
  pathsForExistingSession
} from "./paths.js";
import {
  hasWorktree
} from "./worktrees.js";

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
  return Boolean(step?.codex || step?.kind === "human_input");
}

const PROMPT_ARTIFACT_BY_STEP_ID = Object.freeze({
  issue_drafted: "issue_draft.md",
  plan_executed: "plan_execution.md",
  plan_made: "plan_request.md",
  plan_fine_tuning: "plan_fine_tuning.md",
  user_check_completed: "user_check.md"
});

async function readPromptForStep(paths, stepId) {
  if (!stepCanExposeStoredPrompt(stepId)) {
    return "";
  }
  const promptArtifact = PROMPT_ARTIFACT_BY_STEP_ID[normalizeStepId(stepId)];
  if (promptArtifact) {
    const prompt = await readTextIfExists(path.join(paths.sessionRoot, "prompts", promptArtifact));
    if (prompt) {
      return prompt;
    }
  }
  return readTextIfExists(path.join(paths.sessionRoot, "prompt.md"));
}

async function readCompletedSteps(sessionRoot) {
  const stepsRoot = path.join(sessionRoot, "steps");
  try {
    const entries = await readdir(stepsRoot, { withFileTypes: true });
    return normalizeKnownStepIds(entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name));
  } catch {
    return [];
  }
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

    return Promise.all(stepRows.map(async ({ receiptName, stepId }) => ({
      label: STEP_LABEL_BY_ID[stepId] || stepId,
      receipt: (await readTextIfExists(path.join(stepsRoot, receiptName))).trim(),
      stepId
    })));
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

function publicStepDefinition(step, index) {
  return {
    description: step.description,
    id: step.id,
    index,
    input: cloneContractValue(step.input),
    kind: step.kind,
    label: step.label,
    utilityActions: cloneContractValue(step.utilityActions || [])
  };
}

function buildStepDefinitions() {
  return STEP_DEFINITIONS.map((step, index) => publicStepDefinition(step, index));
}

function buildCurrentStepAction(stepId) {
  const step = STEP_DEFINITION_BY_ID[stepId];
  if (!step) {
    return null;
  }
  return {
    buttonLabel: step.buttonLabel,
    description: step.description,
    index: STEP_IDS.indexOf(step.id),
    input: cloneContractValue(step.input),
    kind: step.kind,
    stepId: step.id,
    utilityActions: cloneContractValue(step.utilityActions || [])
  };
}

function buildCodexHandoff(stepId) {
  const step = STEP_DEFINITION_BY_ID[stepId];
  return step?.codex ? cloneContractValue(step.codex) : null;
}

async function readSessionArtifacts(paths) {
  const [status, rawCurrentStep, issueUrl, prUrl, issueText, issueTitle, planText, codexThreadId] = await Promise.all([
    readTrimmedFile(path.join(paths.sessionRoot, "status")),
    readTrimmedFile(path.join(paths.sessionRoot, "current_step")),
    readTrimmedFile(path.join(paths.sessionRoot, "issue_url")),
    readTrimmedFile(path.join(paths.sessionRoot, "pr_url")),
    readTextIfExists(path.join(paths.sessionRoot, "issue.md")),
    readTrimmedFile(path.join(paths.sessionRoot, "issue_title")),
    readTextIfExists(path.join(paths.sessionRoot, "plan.md")),
    readTrimmedFile(path.join(paths.sessionRoot, "codex_thread_id"))
  ]);
  const currentStep = normalizeStepId(rawCurrentStep);
  const worktreeReady = await hasWorktree(paths);
  let completedSteps = await readCompletedSteps(paths.sessionRoot);
  const worktreeRemovalCompleted = completedSteps.includes("pr_merged") ||
    completedSteps.includes("worktree_removed");
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
    issueTitle,
    issueText: issueText.trim(),
    issueUrl,
    nextStep,
    prUrl,
    planText: planText.trim(),
    prompt: prompt.trim(),
    status: status || SESSION_STATUS.PENDING,
    worktreeReady
  };
}

function buildNextCommand(sessionId, stepId) {
  if (!stepId) {
    return "";
  }
  const template = STEP_DEFINITION_BY_ID[stepId]?.nextCommandTemplate || "jskit session {{session_id}} step";
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
    stepDefinitions: buildStepDefinitions(),
    currentStepAction: buildCurrentStepAction(currentStep),
    codex: codex === undefined ? buildCodexHandoff(currentStep) : cloneContractValue(codex),
    prompt: responsePrompt,
    nextCommand: buildNextCommand(paths.sessionId || "", currentStep),
    issueUrl: artifacts.issueUrl || "",
    issueTitle: artifacts.issueTitle || "",
    issueText: artifacts.issueText || "",
    planText: artifacts.planText || "",
    prUrl: artifacts.prUrl || "",
    preconditions,
    errors,
    archive: responsePaths.archive || (resolvedStatus === SESSION_STATUS.FINISHED ? "completed" : resolvedStatus === SESSION_STATUS.ABANDONED ? "abandoned" : "active"),
    sessionRoot: responsePaths.sessionRoot || "",
    worktree: paths.worktree || "",
    worktreeReady: artifacts.worktreeReady === true,
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
    stepDefinitions: buildStepDefinitions(),
    currentStepAction: null,
    codex: null,
    prompt: "",
    nextCommand: "",
    issueTitle: "",
    issueText: "",
    planText: "",
    issueUrl: "",
    prUrl: "",
    preconditions,
    errors: errorList,
    archive: "",
    sessionRoot: "",
    worktree: "",
    worktreeReady: false,
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
  await mkdir(path.join(paths.sessionRoot, "steps"), { recursive: true });
  await writeTextFile(
    path.join(paths.sessionRoot, "steps", stepId),
    `${timestampForReceipt()}\n${normalizeText(message) || STEP_LABEL_BY_ID[stepId] || stepId}`
  );
  const completedSteps = await readCompletedSteps(paths.sessionRoot);
  await markCurrentStep(paths, resolveNextStep(completedSteps));
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
  readReceiptSteps,
  readSessionArtifacts,
  writeReceipt
};
