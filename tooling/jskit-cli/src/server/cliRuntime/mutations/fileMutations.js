import {
  mkdir,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { createCliError } from "../../shared/cliError.js";
import {
  ensureArray,
  ensureObject
} from "../../shared/collectionUtils.js";
import {
  normalizeFileMutationRecord,
  shouldApplyMutationWhen
} from "../mutationWhen.js";
import {
  normalizeRelativePath,
  hashBuffer,
  fileExists,
  readFileBufferIfExists,
  loadMutationWhenConfigContext,
  resolveAppRelativePathWithinRoot
} from "../ioAndMigrations.js";
import {
  interpolateFileMutationRecord,
  renderTemplateFile,
  resolveTemplateContextReplacementsForMutation
} from "./templateContext.js";
import { resolveSurfaceTargetPathsForMutation } from "./surfaceTargets.js";
import { applyInstallMigrationMutation } from "./installMigrationMutation.js";

async function prepareFileMutations(
  packageEntry,
  options,
  appRoot,
  fileMutations,
  existingManagedFiles = []
) {
  const mutationList = ensureArray(fileMutations);
  const existingManagedFilesByPath = new Map();
  for (const managedFileValue of ensureArray(existingManagedFiles)) {
    const managedFile = ensureObject(managedFileValue);
    const managedPath = String(managedFile.path || "").trim();
    if (!managedPath) {
      continue;
    }
    existingManagedFilesByPath.set(managedPath, managedFile);
  }

  const preparedMutations = [];
  for (const [mutationIndex, mutationValue] of mutationList.entries()) {
    const normalizedMutation = normalizeFileMutationRecord(mutationValue);
    const requiresConfigContext = Boolean(normalizedMutation.when?.config || normalizedMutation.toSurface);
    const configContext = requiresConfigContext ? await loadMutationWhenConfigContext(appRoot) : {};
    if (
      !shouldApplyMutationWhen(normalizedMutation.when, {
        options,
        configContext,
        packageId: packageEntry.packageId,
        mutationContext: "files mutation"
      })
    ) {
      continue;
    }

    const mutation = interpolateFileMutationRecord(normalizedMutation, options, packageEntry.packageId);
    const operation = mutation.op || "copy-file";
    if (operation !== "copy-file" && operation !== "install-migration") {
      throw createCliError(`Unsupported files mutation op "${operation}" in ${packageEntry.packageId}.`);
    }

    const from = mutation.from;
    const to = mutation.to;
    const toSurface = mutation.toSurface;
    if (!from) {
      throw createCliError(`Invalid files mutation in ${packageEntry.packageId}: "from" is required.`);
    }
    if (operation === "copy-file") {
      if (to && toSurface) {
        throw createCliError(
          `Invalid files mutation in ${packageEntry.packageId}: "to" and "toSurface" cannot both be set.`
        );
      }
      if (!to && !toSurface) {
        throw createCliError(
          `Invalid files mutation in ${packageEntry.packageId}: "from" plus one destination ("to" or "toSurface") are required.`
        );
      }
    }

    const sourcePath = path.join(packageEntry.rootDir, from);
    if (!(await fileExists(sourcePath))) {
      throw createCliError(`Missing template source ${sourcePath} for ${packageEntry.packageId}.`);
    }

    const targetPaths = operation === "copy-file"
      ? toSurface
        ? resolveSurfaceTargetPathsForMutation({
            appRoot,
            packageId: packageEntry.packageId,
            mutation,
            configContext
          })
        : [resolveAppRelativePathWithinRoot(appRoot, to, `${packageEntry.packageId} files mutation.to`).absolutePath]
      : [path.join(appRoot, mutation.toDir || "migrations")];
    const templateContextReplacements = await resolveTemplateContextReplacementsForMutation({
      packageEntry,
      mutation,
      options,
      appRoot,
      sourcePath,
      targetPaths,
      mutationContext: "files mutation"
    });
    const interpolationKey = `${mutation.id || to || from}.source`;
    const renderedSourceContent = await renderTemplateFile(
      sourcePath,
      options,
      packageEntry.packageId,
      interpolationKey,
      templateContextReplacements
    );

    if (operation === "copy-file" && mutation.ownership === "app") {
      const renderedSourceBuffer = Buffer.from(renderedSourceContent, "utf8");
      const renderedSourceHash = hashBuffer(renderedSourceBuffer);
      let expectedExistingHash = "";
      if (mutation.expectedExistingFrom) {
        const expectedExistingPath = path.join(packageEntry.rootDir, mutation.expectedExistingFrom);
        if (!(await fileExists(expectedExistingPath))) {
          throw createCliError(
            `Missing expected existing source ${expectedExistingPath} for ${packageEntry.packageId}.`
          );
        }
        const expectedExistingContent = await renderTemplateFile(
          expectedExistingPath,
          options,
          packageEntry.packageId,
          `${mutation.id || to || from}.expectedExisting`,
          templateContextReplacements
        );
        expectedExistingHash = hashBuffer(Buffer.from(expectedExistingContent, "utf8"));
      }

      for (const targetPath of targetPaths) {
        const relativeTargetPath = normalizeRelativePath(appRoot, targetPath);
        if (existingManagedFilesByPath.has(relativeTargetPath)) {
          const existing = await readFileBufferIfExists(targetPath);
          if (!existing.exists) {
            throw createCliError(
              `${packageEntry.packageId}: app-owned file ${relativeTargetPath} is managed in lock but missing on disk. Restore it before updating, or remove and re-add the package intentionally.`
            );
          }
          continue;
        }

        const existing = await readFileBufferIfExists(targetPath);
        if (!existing.exists) {
          continue;
        }

        const existingHash = hashBuffer(existing.buffer);
        if (existingHash === renderedSourceHash) {
          continue;
        }
        if (expectedExistingHash && existingHash === expectedExistingHash) {
          continue;
        }

        const expectedSourceLabel = mutation.expectedExistingFrom
          ? ` or match ${mutation.expectedExistingFrom}`
          : "";
        throw createCliError(
          `${packageEntry.packageId}: app-owned file ${relativeTargetPath} already exists and cannot be claimed. It must already match the rendered scaffold${expectedSourceLabel}.`
        );
      }
    }

    preparedMutations.push({
      mutationIndex,
      mutation,
      operation,
      sourcePath,
      targetPaths,
      renderedSourceContent
    });
  }

  return preparedMutations;
}

async function applyFileMutations(
  packageEntry,
  appRoot,
  preparedMutations,
  managedFiles,
  managedMigrations,
  touchedFiles,
  warnings = [],
  existingManagedFiles = [],
  {
    reapplyManagedAppFiles = false
  } = {}
) {
  const existingManagedFilesByPath = new Map();
  for (const managedFileValue of ensureArray(existingManagedFiles)) {
    const managedFile = ensureObject(managedFileValue);
    const managedPath = String(managedFile.path || "").trim();
    if (!managedPath) {
      continue;
    }
    existingManagedFilesByPath.set(managedPath, managedFile);
  }

  const managedMigrationById = new Map();
  for (const managedMigrationValue of ensureArray(managedMigrations)) {
    const managedMigration = ensureObject(managedMigrationValue);
    const migrationId = String(managedMigration.id || "").trim();
    if (!migrationId) {
      continue;
    }
    managedMigrationById.set(migrationId, managedMigration);
  }

  for (const preparedMutation of ensureArray(preparedMutations)) {
    const mutation = ensureObject(preparedMutation.mutation);
    const operation = String(preparedMutation.operation || "").trim() || "copy-file";
    if (operation === "install-migration") {
      await applyInstallMigrationMutation({
        packageEntry,
        preparedMutation,
        appRoot,
        managedMigrations,
        managedMigrationById,
        touchedFiles,
        warnings
      });
      continue;
    }

    const renderedSourceContent = String(preparedMutation.renderedSourceContent || "");
    const renderedSourceBuffer = Buffer.from(renderedSourceContent, "utf8");
    const renderedSourceHash = hashBuffer(renderedSourceBuffer);

    for (const targetPath of ensureArray(preparedMutation.targetPaths)) {
      const relativeTargetPath = normalizeRelativePath(appRoot, targetPath);
      const previous = await readFileBufferIfExists(targetPath);
      const existingManaged = existingManagedFilesByPath.get(relativeTargetPath);
      const existingManagedHash = String(existingManaged?.hash || "").trim();
      const currentContentMatchesManagedVersion =
        previous.exists &&
        existingManagedHash &&
        hashBuffer(previous.buffer) === existingManagedHash;
      const canSafelyReapplyManagedAppFile =
        reapplyManagedAppFiles === true &&
        (!previous.exists || currentContentMatchesManagedVersion);

      if (mutation.ownership === "app" && existingManaged && !canSafelyReapplyManagedAppFile) {
        managedFiles.push({
          ...existingManaged,
          path: relativeTargetPath,
          preserveOnRemove: mutation.preserveOnRemove,
          reason: mutation.reason || String(existingManaged.reason || ""),
          category: mutation.category || String(existingManaged.category || ""),
          id: mutation.id || String(existingManaged.id || "")
        });
        continue;
      }

      if (mutation.ownership === "app" && previous.exists && hashBuffer(previous.buffer) === renderedSourceHash) {
        managedFiles.push({
          path: relativeTargetPath,
          hash: renderedSourceHash,
          hadPrevious: true,
          previousContentBase64: previous.buffer.toString("base64"),
          preserveOnRemove: mutation.preserveOnRemove,
          reason: mutation.reason,
          category: mutation.category,
          id: mutation.id
        });
        continue;
      }

      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, renderedSourceContent, "utf8");

      managedFiles.push({
        path: relativeTargetPath,
        hash: renderedSourceHash,
        hadPrevious: previous.exists,
        previousContentBase64: previous.exists ? previous.buffer.toString("base64") : "",
        preserveOnRemove: mutation.preserveOnRemove,
        reason: mutation.reason,
        category: mutation.category,
        id: mutation.id
      });
      touchedFiles.add(relativeTargetPath);
    }
  }
}

export {
  applyFileMutations,
  prepareFileMutations
};
