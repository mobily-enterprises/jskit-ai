import { createCliError } from "../shared/cliError.js";
import {
  ensureArray,
  ensureObject
} from "../shared/collectionUtils.js";
import { normalizeFileMutationRecord } from "./mutationWhen.js";
import { normalizeCiContribution } from "./ci/contract.js";

const PACKAGE_KIND_RUNTIME = "runtime";
const PACKAGE_KIND_GENERATOR = "generator";
const PACKAGE_KINDS = Object.freeze([PACKAGE_KIND_RUNTIME, PACKAGE_KIND_GENERATOR]);

function normalizePackageKind(rawValue, metadataPath) {
  const normalized = String(rawValue || "").trim().toLowerCase();
  if (!normalized) {
    throw createCliError(
      `Invalid package metadata at ${metadataPath}: missing kind (expected ${PACKAGE_KINDS.join(" | ")}).`
    );
  }
  if (!PACKAGE_KINDS.includes(normalized)) {
    throw createCliError(
      `Invalid package metadata at ${metadataPath}: kind must be one of: ${PACKAGE_KINDS.join(", ")}.`
    );
  }
  return normalized;
}

function validateFileMutationShape(packageMetadata, metadataPath) {
  const packageId = String(ensureObject(packageMetadata).packageId || "").trim() || "unknown-package";
  const mutations = ensureObject(ensureObject(packageMetadata).mutations);
  const files = ensureArray(mutations.files);
  for (const fileMutation of files) {
    const normalized = normalizeFileMutationRecord(fileMutation);
    if (normalized.ownership !== "package" && normalized.ownership !== "app") {
      throw createCliError(
        `Invalid package metadata at ${metadataPath}: files mutation in ${packageId} has unsupported ownership "${normalized.ownership}". Expected "package" or "app".`
      );
    }
    if (normalized.expectedExistingFrom && normalized.op !== "copy-file") {
      throw createCliError(
        `Invalid package metadata at ${metadataPath}: files mutation in ${packageId} can only use "expectedExistingFrom" with copy-file.`
      );
    }
    if (normalized.expectedExistingFrom && normalized.ownership !== "app") {
      throw createCliError(
        `Invalid package metadata at ${metadataPath}: files mutation in ${packageId} can only use "expectedExistingFrom" when ownership is "app".`
      );
    }
    if (normalized.op !== "install-migration") {
      continue;
    }
    if (!normalized.from) {
      throw createCliError(
        `Invalid package metadata at ${metadataPath}: install-migration in ${packageId} requires "from".`
      );
    }
    if (!normalized.id) {
      throw createCliError(
        `Invalid package metadata at ${metadataPath}: install-migration in ${packageId} requires "id".`
      );
    }
  }
}

function validateSourceMutationShape(packageMetadata, metadataPath) {
  const packageId = String(ensureObject(packageMetadata).packageId || "").trim() || "unknown-package";
  const mutations = ensureObject(ensureObject(packageMetadata).mutations);
  const sourceMutations = ensureArray(mutations.source);
  const supportedOps = new Set([
    "ensure-assignment",
    "ensure-call",
    "ensure-export-const",
    "ensure-import"
  ]);

  for (const rawMutation of sourceMutations) {
    const mutation = ensureObject(rawMutation);
    const operation = String(mutation.op || "").trim();
    const file = String(mutation.file || "").trim();
    if (!supportedOps.has(operation)) {
      throw createCliError(
        `Invalid package metadata at ${metadataPath}: source mutation in ${packageId} has unsupported op "${operation}".`
      );
    }
    if (!file) {
      throw createCliError(
        `Invalid package metadata at ${metadataPath}: source mutation in ${packageId} requires "file".`
      );
    }
    if (operation === "ensure-import") {
      const hasImportBinding =
        String(mutation.defaultImport || "").trim() ||
        String(mutation.namespaceImport || "").trim() ||
        ensureArray(mutation.namedImports).length > 0;
      if (!String(mutation.from || "").trim() || !hasImportBinding) {
        throw createCliError(
          `Invalid package metadata at ${metadataPath}: ensure-import in ${packageId} requires "from" and an import binding.`
        );
      }
    }
    if (operation === "ensure-call" && !String(mutation.callee || "").trim()) {
      throw createCliError(
        `Invalid package metadata at ${metadataPath}: ensure-call in ${packageId} requires "callee".`
      );
    }
    if (operation === "ensure-assignment") {
      if (!String(mutation.target || "").trim() || !String(mutation.value || "").trim()) {
        throw createCliError(
          `Invalid package metadata at ${metadataPath}: ensure-assignment in ${packageId} requires "target" and "value".`
        );
      }
    }
    if (operation === "ensure-export-const" && !String(mutation.name || "").trim()) {
      throw createCliError(
        `Invalid package metadata at ${metadataPath}: ensure-export-const in ${packageId} requires "name".`
      );
    }
  }
}

function validateLifecycleHookSpec(spec = {}, metadataPath, label = "lifecycle hook") {
  const normalized = ensureObject(spec);
  if (Object.keys(normalized).length < 1) {
    return null;
  }

  const entrypoint = String(normalized.entrypoint || "").trim();
  if (!entrypoint) {
    throw createCliError(`Invalid package metadata at ${metadataPath}: ${label} requires "entrypoint".`);
  }

  const exportName = String(normalized.export || "").trim() || "default";
  return {
    ...normalized,
    entrypoint,
    export: exportName
  };
}

function validateLifecycleShape(packageMetadata, metadataPath) {
  const lifecycle = ensureObject(ensureObject(packageMetadata).lifecycle);
  const install = ensureObject(lifecycle.install);
  if (Object.keys(install).length < 1) {
    return lifecycle;
  }

  const prepare = validateLifecycleHookSpec(install.prepare, metadataPath, "lifecycle.install.prepare");
  const finalize = validateLifecycleHookSpec(install.finalize, metadataPath, "lifecycle.install.finalize");

  if (install.finalize && typeof install.finalize === "object") {
    const managesNpmInstall = install.finalize.managesNpmInstall;
    if (typeof managesNpmInstall !== "undefined" && typeof managesNpmInstall !== "boolean") {
      throw createCliError(
        `Invalid package metadata at ${metadataPath}: lifecycle.install.finalize.managesNpmInstall must be boolean when provided.`
      );
    }
  }

  return {
    ...lifecycle,
    install: {
      ...install,
      ...(prepare ? { prepare } : {}),
      ...(finalize ? { finalize } : {})
    }
  };
}

function validatePackageMetadataShape(packageMetadata, metadataPath) {
  const normalized = ensureObject(packageMetadata);
  const packageId = String(normalized.packageId || "").trim();
  const version = String(normalized.version || "").trim();

  if (!packageId.startsWith("@jskit-ai/")) {
    throw createCliError(`Invalid package metadata at ${metadataPath}: packageId must start with @jskit-ai/.`);
  }
  if (!version) {
    throw createCliError(`Invalid package metadata at ${metadataPath}: missing version.`);
  }

  const runtime = ensureObject(normalized.runtime);
  const server = ensureObject(runtime.server);
  const client = ensureObject(runtime.client);
  const hasServerProviders = Array.isArray(server.providers);
  const hasClientProviders = Array.isArray(client.providers);
  if (!hasServerProviders && !hasClientProviders) {
    throw createCliError(
      `Invalid package metadata at ${metadataPath}: runtime.server.providers or runtime.client.providers must be declared.`
    );
  }

  validateFileMutationShape(normalized, metadataPath);
  validateSourceMutationShape(normalized, metadataPath);
  const lifecycle = validateLifecycleShape(normalized, metadataPath);
  const ci = normalizeCiContribution(normalized.ci, {
    metadataPath,
    packageId
  });

  return {
    ...normalized,
    ci,
    lifecycle,
    kind: normalizePackageKind(normalized.kind, metadataPath)
  };
}

function isGeneratorPackageEntry(packageEntry) {
  const packageMetadata = ensureObject(packageEntry?.packageMetadata);
  return String(packageMetadata.kind || "").trim().toLowerCase() === PACKAGE_KIND_GENERATOR;
}

function validateAppLocalPackageMetadataShape(packageMetadata, metadataPath, { expectedPackageId = "", fallbackVersion = "" } = {}) {
  const normalized = ensureObject(packageMetadata);
  const packageId = String(normalized.packageId || "").trim();
  const version = String(normalized.version || "").trim() || String(fallbackVersion || "").trim();

  if (!packageId) {
    throw createCliError(`Invalid app-local JSKIT metadata at ${metadataPath}: missing packageId.`);
  }
  if (expectedPackageId && packageId !== expectedPackageId) {
    throw createCliError(
      `Package metadata/name mismatch at ${metadataPath}: JSKIT metadata resolves to ${packageId} but package.json names ${expectedPackageId}.`
    );
  }
  if (!version) {
    throw createCliError(`Invalid app-local JSKIT metadata at ${metadataPath}: missing version.`);
  }

  validateFileMutationShape(normalized, metadataPath);
  validateSourceMutationShape(normalized, metadataPath);
  const lifecycle = validateLifecycleShape(normalized, metadataPath);
  const ci = normalizeCiContribution(normalized.ci, {
    metadataPath,
    packageId
  });

  return {
    ...normalized,
    packageId,
    version,
    ci,
    lifecycle,
    kind: normalizePackageKind(normalized.kind, metadataPath)
  };
}

function createPackageEntry({
  packageId,
  version,
  packageMetadata,
  rootDir = "",
  relativeDir = "",
  manifestRelativePath = "",
  packageJson = {},
  sourceType = "",
  source = {}
}) {
  const normalizedSourceType = String(sourceType || "").trim() || "package";
  const normalizedManifestPath = String(manifestRelativePath || "").trim();
  const normalizedSource = {
    type: normalizedSourceType,
    ...ensureObject(source)
  };
  if (!normalizedSource.manifestPath && normalizedManifestPath) {
    normalizedSource.manifestPath = normalizedManifestPath;
  }
  return {
    packageId: String(packageId || "").trim(),
    version: String(version || "").trim(),
    packageMetadata: ensureObject(packageMetadata),
    rootDir: String(rootDir || "").trim(),
    relativeDir: String(relativeDir || "").trim(),
    manifestRelativePath: normalizedManifestPath,
    packageJson: ensureObject(packageJson),
    sourceType: normalizedSourceType,
    source: normalizedSource
  };
}

export {
  validatePackageMetadataShape,
  validateAppLocalPackageMetadataShape,
  createPackageEntry,
  isGeneratorPackageEntry
};
