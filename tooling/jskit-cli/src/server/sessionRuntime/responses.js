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

async function readCompletedSteps(sessionRoot) {
  const stepsRoot = path.join(sessionRoot, "steps");
  try {
    const entries = await readdir(stepsRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((entry) => STEP_IDS.includes(entry))
      .sort((left, right) => STEP_IDS.indexOf(left) - STEP_IDS.indexOf(right));
  } catch {
    return [];
  }
}

async function readReceiptSteps(paths) {
  const stepsRoot = path.join(paths.sessionRoot, "steps");
  try {
    const entries = await readdir(stepsRoot, { withFileTypes: true });
    const stepNames = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort((left, right) => {
        const leftIndex = STEP_IDS.indexOf(left);
        const rightIndex = STEP_IDS.indexOf(right);
        if (leftIndex >= 0 && rightIndex >= 0) {
          return leftIndex - rightIndex;
        }
        if (leftIndex >= 0) {
          return -1;
        }
        if (rightIndex >= 0) {
          return 1;
        }
        return left.localeCompare(right);
      });

    return Promise.all(stepNames.map(async (stepId) => ({
      label: STEP_LABEL_BY_ID[stepId] || stepId,
      receipt: (await readTextIfExists(path.join(stepsRoot, stepId))).trim(),
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
    label: step.label
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
    stepId: step.id
  };
}

function buildCodexHandoff(stepId) {
  const step = STEP_DEFINITION_BY_ID[stepId];
  return step?.codex ? cloneContractValue(step.codex) : null;
}

async function readSessionArtifacts(paths) {
  const [status, currentStep, issueUrl, prUrl, prompt, issueText, codexThreadId] = await Promise.all([
    readTrimmedFile(path.join(paths.sessionRoot, "status")),
    readTrimmedFile(path.join(paths.sessionRoot, "current_step")),
    readTrimmedFile(path.join(paths.sessionRoot, "issue_url")),
    readTrimmedFile(path.join(paths.sessionRoot, "pr_url")),
    readTextIfExists(path.join(paths.sessionRoot, "prompt.md")),
    readTextIfExists(path.join(paths.sessionRoot, "issue.md")),
    readTrimmedFile(path.join(paths.sessionRoot, "codex_thread_id"))
  ]);
  const completedSteps = await readCompletedSteps(paths.sessionRoot);
  const nextStep = resolveNextStep(completedSteps);

  return {
    codexThreadId,
    completedSteps,
    currentStep: currentStep || nextStep,
    issueText: issueText.trim(),
    issueUrl,
    nextStep,
    prUrl,
    prompt: prompt.trim(),
    status: status || SESSION_STATUS.PENDING
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
  const responsePrompt = typeof prompt === "string" ? prompt : artifacts.prompt || "";

  return {
    ok: ok === true,
    sessionId: paths.sessionId || "",
    status: resolvedStatus,
    currentStep,
    completedSteps: artifacts.completedSteps || [],
    stepDefinitions: buildStepDefinitions(),
    currentStepAction: buildCurrentStepAction(currentStep),
    codex: buildCodexHandoff(currentStep),
    prompt: responsePrompt,
    nextCommand: buildNextCommand(paths.sessionId || "", currentStep),
    issueUrl: artifacts.issueUrl || "",
    prUrl: artifacts.prUrl || "",
    preconditions,
    errors,
    archive: responsePaths.archive || (resolvedStatus === SESSION_STATUS.FINISHED ? "completed" : resolvedStatus === SESSION_STATUS.ABANDONED ? "abandoned" : "active"),
    sessionRoot: responsePaths.sessionRoot || "",
    worktree: paths.worktree || "",
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
    issueUrl: "",
    prUrl: "",
    preconditions,
    errors: errorList,
    archive: "",
    sessionRoot: "",
    worktree: "",
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
