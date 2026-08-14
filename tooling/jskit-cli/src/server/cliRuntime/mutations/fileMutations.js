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
  fileMutations
) {
  const mutationList = ensureArray(fileMutations);
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
  fileChanges,
  migrationChanges,
  touchedFiles,
  warnings = [],
  { dryRun = false } = {}
) {
  const managedMigrationById = new Map();
  for (const managedMigrationValue of ensureArray(migrationChanges)) {
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
          managedMigrations: migrationChanges,
          managedMigrationById,
          touchedFiles,
          warnings,
          dryRun
        });
        continue;
      }

    const renderedSourceContent = String(preparedMutation.renderedSourceContent || "");
    const renderedSourceBuffer = Buffer.from(renderedSourceContent, "utf8");
    const renderedSourceHash = hashBuffer(renderedSourceBuffer);

    for (const targetPath of ensureArray(preparedMutation.targetPaths)) {
      const relativeTargetPath = normalizeRelativePath(appRoot, targetPath);
      const previous = await readFileBufferIfExists(targetPath);
      if (mutation.ownership === "app" && previous.exists && hashBuffer(previous.buffer) === renderedSourceHash) {
        fileChanges.push({
          path: relativeTargetPath,
          ownership: mutation.ownership,
          hash: renderedSourceHash,
          reason: mutation.reason,
          category: mutation.category,
          id: mutation.id
        });
        continue;
      }

      if (!dryRun) {
        await mkdir(path.dirname(targetPath), { recursive: true });
        await writeFile(targetPath, renderedSourceContent, "utf8");
      }

      fileChanges.push({
        path: relativeTargetPath,
        ownership: mutation.ownership,
        hash: renderedSourceHash,
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
