import {
  mkdir,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { createCliError } from "../../shared/cliError.js";
import { ensureObject } from "../../shared/collectionUtils.js";
import {
  directoryLooksLikeJskitAppRoot,
  loadLockFile
} from "../appState.js";
import {
  fileExists,
  hashBuffer,
  readFileBufferIfExists,
  writeJsonFile
} from "../ioAndMigrations.js";
import {
  hydratePackageRegistryFromInstalledNodeModules,
  loadAppLocalPackageRegistry,
  loadPackageRegistry,
  mergePackageRegistries
} from "../packageRegistries.js";
import {
  CiCompositionError,
  composeCiContributions
} from "./composer.js";
import {
  JSKIT_CI_WORKFLOW_RELATIVE_PATH,
  LEGACY_CI_WORKFLOW_RELATIVE_PATH,
  LEGACY_VERIFY_WORKFLOW_HASH,
  parseGithubWorkflow,
  renderGithubServiceOptions,
  renderGithubWorkflow
} from "./githubWorkflow.js";

function contentHash(content = "") {
  return hashBuffer(Buffer.from(String(content || ""), "utf8"));
}

function collectInstalledPackageEntries({ lock, packageRegistry, installedPackageIds = null }) {
  const installed = ensureObject(lock?.installedPackages);
  const packageIds = Array.isArray(installedPackageIds)
    ? installedPackageIds
    : Object.keys(installed);
  return [...new Set(packageIds.map((value) => String(value || "").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .map((packageId) => {
      const packageEntry = packageRegistry?.get?.(packageId);
      if (!packageEntry) {
        throw new CiCompositionError(
          "descriptor-missing",
          `Installed package descriptor not found for ${packageId}. Restore the package in node_modules or the JSKIT catalog before synchronizing CI.`,
          { packageId }
        );
      }
      return packageEntry;
    });
}

function composeInstalledPackageCi({ lock, packageRegistry, installedPackageIds = null }) {
  return composeCiContributions(
    collectInstalledPackageEntries({ lock, packageRegistry, installedPackageIds })
  );
}

function managedCiRecord(lock = {}) {
  return ensureObject(ensureObject(lock.managed).ciWorkflow);
}

function setManagedCiRecord(lock, record) {
  lock.managed = {
    ...ensureObject(lock.managed),
    ciWorkflow: {
      path: String(record.path || JSKIT_CI_WORKFLOW_RELATIVE_PATH),
      hash: String(record.hash || "")
    }
  };
}

function recoveryError(message, { force = false } = {}) {
  const command = force ? "npx jskit app sync-ci --force" : "npx jskit app sync-ci";
  return createCliError(`${message} Run: ${command}`);
}

async function inspectWorkflowOwnership({ appRoot, lock }) {
  const record = managedCiRecord(lock);
  const targetPath = path.join(appRoot, JSKIT_CI_WORKFLOW_RELATIVE_PATH);
  const legacyPath = path.join(appRoot, LEGACY_CI_WORKFLOW_RELATIVE_PATH);
  const target = await readFileBufferIfExists(targetPath);
  const legacy = await readFileBufferIfExists(legacyPath);
  return {
    record,
    targetPath,
    target,
    legacyPath,
    legacy,
    targetHash: target.exists ? hashBuffer(target.buffer) : "",
    legacyIsGenerated:
      legacy.exists && hashBuffer(legacy.buffer) === LEGACY_VERIFY_WORKFLOW_HASH
  };
}

async function assertManagedCiWorkflowUnmodified({
  appRoot,
  lock,
  allowManagedOverwrite = false
}) {
  const ownership = await inspectWorkflowOwnership({ appRoot, lock });
  const recordPath = String(ownership.record.path || "").trim();
  const recordHash = String(ownership.record.hash || "").trim();

  if (recordPath && recordPath !== JSKIT_CI_WORKFLOW_RELATIVE_PATH) {
    throw createCliError(
      `[ci:workflow-ownership-invalid] .jskit/lock.json records the managed CI workflow at ${recordPath}, but JSKIT owns ${JSKIT_CI_WORKFLOW_RELATIVE_PATH}. Restore the recorded path before synchronizing CI.`
    );
  }

  if (recordHash && !allowManagedOverwrite) {
    if (!ownership.target.exists) {
      throw recoveryError(
        `[ci:workflow-modified] The JSKIT-managed CI workflow is missing: ${JSKIT_CI_WORKFLOW_RELATIVE_PATH}.`,
        { force: true }
      );
    }
    if (ownership.targetHash !== recordHash) {
      throw recoveryError(
        `[ci:workflow-modified] ${JSKIT_CI_WORKFLOW_RELATIVE_PATH} differs from the generated version recorded in .jskit/lock.json. Move application-specific CI to a separate workflow before regenerating.`,
        { force: true }
      );
    }
  }

  if (!recordHash && ownership.target.exists) {
    throw createCliError(
      `[ci:workflow-unowned] ${JSKIT_CI_WORKFLOW_RELATIVE_PATH} already exists without JSKIT ownership in .jskit/lock.json. Rename or remove it, then run: npx jskit app sync-ci`
    );
  }

  if (ownership.legacy.exists && !ownership.legacyIsGenerated) {
    throw createCliError(
      `[ci:legacy-workflow-conflict] ${LEGACY_CI_WORKFLOW_RELATIVE_PATH} is not the original JSKIT scaffold and will not be removed. Move application-specific CI to a separate workflow, remove the duplicate verification workflow, then run: npx jskit app sync-ci`
    );
  }

  return ownership;
}

async function synchronizeManagedCiWorkflow({
  appRoot,
  lock,
  packageRegistry,
  installedPackageIds = null,
  touchedFiles = null,
  dryRun = false,
  allowManagedOverwrite = false
}) {
  const model = composeInstalledPackageCi({
    lock,
    packageRegistry,
    installedPackageIds
  });
  const content = renderGithubWorkflow(model);
  const hash = contentHash(content);
  const ownership = await assertManagedCiWorkflowUnmodified({
    appRoot,
    lock,
    allowManagedOverwrite
  });
  const currentContent = ownership.target.exists ? ownership.target.buffer.toString("utf8") : "";
  const workflowChanged = currentContent !== content;
  const removedLegacyWorkflow = ownership.legacyIsGenerated;
  const replacedModifiedWorkflow =
    allowManagedOverwrite &&
    Boolean(ownership.record.hash) &&
    ownership.targetHash !== String(ownership.record.hash || "");

  if (!dryRun) {
    if (workflowChanged) {
      await mkdir(path.dirname(ownership.targetPath), { recursive: true });
      await writeFile(ownership.targetPath, content, "utf8");
    }
    if (removedLegacyWorkflow) {
      await rm(ownership.legacyPath, { force: true });
    }
    setManagedCiRecord(lock, {
      path: JSKIT_CI_WORKFLOW_RELATIVE_PATH,
      hash
    });
  }

  if (workflowChanged) {
    touchedFiles?.add?.(JSKIT_CI_WORKFLOW_RELATIVE_PATH);
  }
  if (removedLegacyWorkflow) {
    touchedFiles?.add?.(LEGACY_CI_WORKFLOW_RELATIVE_PATH);
  }

  return {
    applicable: true,
    path: JSKIT_CI_WORKFLOW_RELATIVE_PATH,
    hash,
    content,
    model,
    changed: workflowChanged || removedLegacyWorkflow,
    workflowChanged,
    removedLegacyWorkflow,
    replacedModifiedWorkflow
  };
}

function createValidationIssue(code, message, details = {}) {
  return {
    code: `ci:${code}`,
    message: `[ci:${code}] ${message}`,
    ...details
  };
}

function formatRequirementPackages(packageIds = []) {
  return packageIds.join(", ");
}

function describeCiRequirements(model = {}) {
  const descriptions = [];
  for (const service of model.services || []) {
    descriptions.push(
      `${formatRequirementPackages(model.sources?.services?.[service.id] || [])} requires the ${service.id} service`
    );
  }
  if (Object.prototype.hasOwnProperty.call(model.environment || {}, "DB_CLIENT")) {
    descriptions.push(
      `${formatRequirementPackages(model.sources?.environment?.DB_CLIENT || [])} requires DB_CLIENT=${model.environment.DB_CLIENT}`
    );
  }
  for (const step of model.steps || []) {
    descriptions.push(
      `${formatRequirementPackages(model.sources?.steps?.[step.id] || [])} requires ${step.label} before verification`
    );
  }
  return descriptions.filter((value) => !value.startsWith(" requires")).join("; ");
}

function normalizeActualEnvironment(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(
    Object.entries(source)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, String(entry)])
  );
}

function collectEnvironmentIssues({ expected, actual, sources, issues }) {
  for (const [key, value] of Object.entries(expected)) {
    const packageIds = sources[key] || [];
    if (!Object.prototype.hasOwnProperty.call(actual, key)) {
      issues.push(createValidationIssue(
        "environment-missing",
        `${formatRequirementPackages(packageIds)} requires ${key}=${value} in the verify job environment.`
      ));
      continue;
    }
    if (actual[key] !== value) {
      issues.push(createValidationIssue(
        "environment-incorrect",
        `${formatRequirementPackages(packageIds)} requires ${key}=${value}, but the managed workflow contains ${key}=${actual[key]}.`
      ));
    }
  }
}

function collectServiceIssues({ model, verifyJob, issues }) {
  const actualServices = ensureObject(verifyJob.services);
  for (const service of model.services || []) {
    const packageIds = model.sources?.services?.[service.id] || [];
    const actual = actualServices[service.id];
    if (!actual || typeof actual !== "object") {
      issues.push(createValidationIssue(
        "service-missing",
        `${formatRequirementPackages(packageIds)} requires the ${service.id} service.`
      ));
      continue;
    }
    const expectedOptions = renderGithubServiceOptions(service);
    const actualPorts = Array.isArray(actual.ports) ? actual.ports.map(String) : [];
    const serviceMatches =
      String(actual.image || "") === service.image &&
      JSON.stringify(normalizeActualEnvironment(actual.env)) === JSON.stringify(service.environment) &&
      JSON.stringify(actualPorts) === JSON.stringify(service.ports) &&
      String(actual.options || "") === expectedOptions;
    if (!serviceMatches) {
      issues.push(createValidationIssue(
        "service-incorrect",
        `${formatRequirementPackages(packageIds)} requires the generated ${service.id} service image, environment, ports, and health check to remain unchanged.`
      ));
    }
  }
}

function collectStepIssues({ model, verifyJob, issues }) {
  const actualSteps = Array.isArray(verifyJob.steps) ? verifyJob.steps : [];
  const stepIndexById = new Map();
  for (const [index, step] of actualSteps.entries()) {
    const id = String(step?.id || "").trim();
    if (id && !stepIndexById.has(id)) {
      stepIndexById.set(id, index);
    }
  }

  for (const step of model.steps || []) {
    const packageIds = model.sources?.steps?.[step.id] || [];
    const index = stepIndexById.get(step.id);
    if (typeof index === "undefined") {
      issues.push(createValidationIssue(
        "step-missing",
        `${formatRequirementPackages(packageIds)} requires the "${step.label}" step (${step.id}).`
      ));
      continue;
    }
    const actual = actualSteps[index];
    if (String(actual.name || "") !== step.label || String(actual.run || "") !== step.command) {
      issues.push(createValidationIssue(
        "step-incorrect",
        `${formatRequirementPackages(packageIds)} requires ${step.id} to run ${step.command}.`
      ));
    }
  }

  const expectedOrder = [
    "checkout",
    "setup-node",
    "install-dependencies",
    ...(model.steps || []).map((step) => step.id),
    "verify"
  ];
  const actualIndexes = expectedOrder.map((id) => stepIndexById.get(id));
  if (
    actualIndexes.every((index) => typeof index !== "undefined") &&
    actualIndexes.some((index, position) => position > 0 && index <= actualIndexes[position - 1])
  ) {
    issues.push(createValidationIssue(
      "step-order-incorrect",
      `Managed preparation steps must run after npm ci and before npm run verify in this order: ${expectedOrder.join(" -> ")}.`
    ));
  }
}

async function validateManagedCiWorkflow({ appRoot, lock, packageRegistry }) {
  let model = null;
  try {
    model = composeInstalledPackageCi({ lock, packageRegistry });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      applicable: true,
      valid: false,
      model: null,
      issues: [createValidationIssue(
        "contribution-conflict",
        `Installed package CI contributions could not be composed: ${message}`
      )]
    };
  }

  const record = managedCiRecord(lock);
  const workflowPath = path.join(appRoot, JSKIT_CI_WORKFLOW_RELATIVE_PATH);
  const legacyPath = path.join(appRoot, LEGACY_CI_WORKFLOW_RELATIVE_PATH);
  const workflow = await readFileBufferIfExists(workflowPath);
  const hasLegacyWorkflow = await fileExists(legacyPath);
  const applicable =
    Boolean(record.hash || record.path) ||
    workflow.exists ||
    hasLegacyWorkflow ||
    model.packages.length > 0;
  if (!applicable) {
    return {
      applicable: false,
      valid: true,
      model,
      issues: []
    };
  }

  const expectedContent = renderGithubWorkflow(model);
  const expectedHash = contentHash(expectedContent);
  const requirementSummary = describeCiRequirements(model);
  const requirementSuffix = requirementSummary ? ` ${requirementSummary}.` : "";
  const recovery = " Run: npx jskit app sync-ci";
  const forcedRecovery = " Run: npx jskit app sync-ci --force";
  const issues = [];
  const recordPath = String(record.path || "").trim();
  const recordHash = String(record.hash || "").trim();

  if (recordPath !== JSKIT_CI_WORKFLOW_RELATIVE_PATH || !recordHash) {
    issues.push(createValidationIssue(
      "workflow-ownership-missing",
      `The generated workflow is not recorded as a managed projection in .jskit/lock.json.${recovery}`
    ));
  }
  if (!workflow.exists) {
    const missingWorkflowRecovery = recordHash ? forcedRecovery : recovery;
    issues.push(createValidationIssue(
      "workflow-missing",
      `The managed CI workflow is missing at ${JSKIT_CI_WORKFLOW_RELATIVE_PATH}.${missingWorkflowRecovery}`
    ));
    issues.push(createValidationIssue(
      "workflow-out-of-date",
      `The managed CI workflow does not match the installed packages.${requirementSuffix}${missingWorkflowRecovery}`
    ));
    return {
      applicable,
      valid: false,
      model,
      expectedContent,
      expectedHash,
      issues
    };
  }

  const actualContent = workflow.buffer.toString("utf8");
  const actualHash = hashBuffer(workflow.buffer);
  const workflowWasModified = Boolean(recordHash && actualHash !== recordHash);
  const workflowRecovery = workflowWasModified ? forcedRecovery : recovery;
  if (workflowWasModified) {
    issues.push(createValidationIssue(
      "workflow-modified",
      `${JSKIT_CI_WORKFLOW_RELATIVE_PATH} differs from the generated version recorded in .jskit/lock.json. Move application-specific CI to a separate workflow.${forcedRecovery}`
    ));
  }
  if (actualHash !== expectedHash || recordHash !== expectedHash) {
    issues.push(createValidationIssue(
      "workflow-out-of-date",
      `The managed CI workflow does not match the installed packages.${requirementSuffix}${workflowRecovery}`
    ));
  }

  let document = null;
  try {
    document = parseGithubWorkflow(actualContent);
  } catch (error) {
    issues.push(createValidationIssue(
      "workflow-invalid-yaml",
      `${JSKIT_CI_WORKFLOW_RELATIVE_PATH} is not valid YAML: ${error instanceof Error ? error.message : String(error)}.${workflowRecovery}`
    ));
    return {
      applicable,
      valid: false,
      model,
      expectedContent,
      expectedHash,
      actualHash,
      issues
    };
  }

  const verifyJob = ensureObject(ensureObject(ensureObject(document).jobs).verify);
  collectEnvironmentIssues({
    expected: model.environment,
    actual: normalizeActualEnvironment(verifyJob.env),
    sources: model.sources.environment,
    issues
  });
  collectServiceIssues({ model, verifyJob, issues });
  collectStepIssues({ model, verifyJob, issues });

  return {
    applicable,
    valid: issues.length === 0,
    model,
    expectedContent,
    expectedHash,
    actualHash,
    issues
  };
}

async function loadAppCiContext(appRoot) {
  const { lockPath, lock } = await loadLockFile(appRoot);
  const catalogRegistry = await loadPackageRegistry();
  const appLocalRegistry = await loadAppLocalPackageRegistry(appRoot);
  const packageRegistry = mergePackageRegistries(catalogRegistry, appLocalRegistry);
  await hydratePackageRegistryFromInstalledNodeModules({
    appRoot,
    packageRegistry,
    seedPackageIds: Object.keys(ensureObject(lock.installedPackages))
  });
  return {
    lockPath,
    lock,
    packageRegistry
  };
}

async function assertAppManagedCiWorkflowUnmodified({ appRoot }) {
  if (!(await directoryLooksLikeJskitAppRoot(appRoot))) {
    return { applicable: false };
  }
  const { lock } = await loadLockFile(appRoot);
  await assertManagedCiWorkflowUnmodified({ appRoot, lock });
  return { applicable: true };
}

async function synchronizeAppCiWorkflow({
  appRoot,
  allowManagedOverwrite = false,
  dryRun = false
}) {
  if (!(await directoryLooksLikeJskitAppRoot(appRoot))) {
    return { applicable: false, changed: false };
  }
  const { lockPath, lock, packageRegistry } = await loadAppCiContext(appRoot);
  const result = await synchronizeManagedCiWorkflow({
    appRoot,
    lock,
    packageRegistry,
    dryRun,
    allowManagedOverwrite
  });
  if (!dryRun) {
    await writeJsonFile(lockPath, lock);
  }
  return {
    ...result,
    lockPath
  };
}

async function validateAppCiWorkflow({ appRoot }) {
  if (!(await directoryLooksLikeJskitAppRoot(appRoot))) {
    return { applicable: false, valid: true, issues: [] };
  }
  const { lock, packageRegistry } = await loadAppCiContext(appRoot);
  return validateManagedCiWorkflow({
    appRoot,
    lock,
    packageRegistry
  });
}

export {
  assertAppManagedCiWorkflowUnmodified,
  assertManagedCiWorkflowUnmodified,
  composeInstalledPackageCi,
  synchronizeAppCiWorkflow,
  synchronizeManagedCiWorkflow,
  validateAppCiWorkflow,
  validateManagedCiWorkflow
};
