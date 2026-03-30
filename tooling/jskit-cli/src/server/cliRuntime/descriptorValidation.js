import { createCliError } from "../shared/cliError.js";
import {
  ensureArray,
  ensureObject
} from "../shared/collectionUtils.js";
import { normalizeFileMutationRecord } from "./mutationWhen.js";

const PACKAGE_KIND_RUNTIME = "runtime";
const PACKAGE_KIND_GENERATOR = "generator";
const PACKAGE_KINDS = Object.freeze([PACKAGE_KIND_RUNTIME, PACKAGE_KIND_GENERATOR]);

function normalizePackageKind(rawValue, descriptorPath) {
  const normalized = String(rawValue || "").trim().toLowerCase();
  if (!normalized) {
    throw createCliError(
      `Invalid package descriptor at ${descriptorPath}: missing kind (expected ${PACKAGE_KINDS.join(" | ")}).`
    );
  }
  if (!PACKAGE_KINDS.includes(normalized)) {
    throw createCliError(
      `Invalid package descriptor at ${descriptorPath}: kind must be one of: ${PACKAGE_KINDS.join(", ")}.`
    );
  }
  return normalized;
}

function validateInstallMigrationMutationShape(descriptor, descriptorPath) {
  const packageId = String(ensureObject(descriptor).packageId || "").trim() || "unknown-package";
  const mutations = ensureObject(ensureObject(descriptor).mutations);
  const files = ensureArray(mutations.files);
  for (const fileMutation of files) {
    const normalized = normalizeFileMutationRecord(fileMutation);
    if (normalized.op !== "install-migration") {
      continue;
    }
    if (!normalized.from) {
      throw createCliError(
        `Invalid package descriptor at ${descriptorPath}: install-migration in ${packageId} requires "from".`
      );
    }
    if (!normalized.id) {
      throw createCliError(
        `Invalid package descriptor at ${descriptorPath}: install-migration in ${packageId} requires "id".`
      );
    }
  }
}

function validatePackageDescriptorShape(descriptor, descriptorPath) {
  const normalized = ensureObject(descriptor);
  const packageId = String(normalized.packageId || "").trim();
  const version = String(normalized.version || "").trim();

  if (!packageId.startsWith("@jskit-ai/")) {
    throw createCliError(`Invalid package descriptor at ${descriptorPath}: packageId must start with @jskit-ai/.`);
  }
  if (!version) {
    throw createCliError(`Invalid package descriptor at ${descriptorPath}: missing version.`);
  }

  const runtime = ensureObject(normalized.runtime);
  const server = ensureObject(runtime.server);
  const client = ensureObject(runtime.client);
  const hasServerProviders = Array.isArray(server.providers);
  const hasClientProviders = Array.isArray(client.providers);
  if (!hasServerProviders && !hasClientProviders) {
    throw createCliError(
      `Invalid package descriptor at ${descriptorPath}: runtime.server.providers or runtime.client.providers must be declared.`
    );
  }

  validateInstallMigrationMutationShape(normalized, descriptorPath);

  return {
    ...normalized,
    kind: normalizePackageKind(normalized.kind, descriptorPath)
  };
}

function isGeneratorPackageEntry(packageEntry) {
  const descriptor = ensureObject(packageEntry?.descriptor);
  return String(descriptor.kind || "").trim().toLowerCase() === PACKAGE_KIND_GENERATOR;
}

function validateAppLocalPackageDescriptorShape(descriptor, descriptorPath, { expectedPackageId = "", fallbackVersion = "" } = {}) {
  const normalized = ensureObject(descriptor);
  const packageId = String(normalized.packageId || "").trim();
  const version = String(normalized.version || "").trim() || String(fallbackVersion || "").trim();

  if (!packageId) {
    throw createCliError(`Invalid app-local package descriptor at ${descriptorPath}: missing packageId.`);
  }
  if (expectedPackageId && packageId !== expectedPackageId) {
    throw createCliError(
      `Descriptor/package mismatch at ${descriptorPath}: package.descriptor.mjs has ${packageId} but package.json has ${expectedPackageId}.`
    );
  }
  if (!version) {
    throw createCliError(`Invalid app-local package descriptor at ${descriptorPath}: missing version.`);
  }

  validateInstallMigrationMutationShape(normalized, descriptorPath);

  return {
    ...normalized,
    packageId,
    version,
    kind: normalizePackageKind(normalized.kind, descriptorPath)
  };
}

function createPackageEntry({
  packageId,
  version,
  descriptor,
  rootDir = "",
  relativeDir = "",
  descriptorRelativePath = "",
  packageJson = {},
  sourceType = "",
  source = {}
}) {
  const normalizedSourceType = String(sourceType || "").trim() || "package";
  const normalizedDescriptorPath = String(descriptorRelativePath || "").trim();
  const normalizedSource = {
    type: normalizedSourceType,
    ...ensureObject(source)
  };
  if (!normalizedSource.descriptorPath && normalizedDescriptorPath) {
    normalizedSource.descriptorPath = normalizedDescriptorPath;
  }
  return {
    packageId: String(packageId || "").trim(),
    version: String(version || "").trim(),
    descriptor: ensureObject(descriptor),
    rootDir: String(rootDir || "").trim(),
    relativeDir: String(relativeDir || "").trim(),
    descriptorRelativePath: normalizedDescriptorPath,
    packageJson: ensureObject(packageJson),
    sourceType: normalizedSourceType,
    source: normalizedSource
  };
}

export {
  validatePackageDescriptorShape,
  validateAppLocalPackageDescriptorShape,
  createPackageEntry,
  isGeneratorPackageEntry
};
