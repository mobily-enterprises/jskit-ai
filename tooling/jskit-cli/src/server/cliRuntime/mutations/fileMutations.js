import {
  readFile
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
  copyTemplateFile,
  interpolateFileMutationRecord,
  resolveTemplateContextReplacementsForMutation
} from "./templateContext.js";
import { resolveSurfaceTargetPathsForMutation } from "./surfaceTargets.js";
import { applyInstallMigrationMutation } from "./installMigrationMutation.js";

async function applyFileMutations(
  packageEntry,
  options,
  appRoot,
  fileMutations,
  managedFiles,
  managedMigrations,
  touchedFiles,
  warnings = [],
  precomputedTemplateContextByMutationIndex = null
) {
  const mutationList = ensureArray(fileMutations);
  const managedMigrationById = new Map();
  for (const managedMigrationValue of ensureArray(managedMigrations)) {
    const managedMigration = ensureObject(managedMigrationValue);
    const migrationId = String(managedMigration.id || "").trim();
    if (!migrationId) {
      continue;
    }
    managedMigrationById.set(migrationId, managedMigration);
  }

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

    if (operation === "install-migration") {
      await applyInstallMigrationMutation({
        packageEntry,
        mutation,
        rawMutation: mutationValue,
        mutationIndex,
        options,
        appRoot,
        managedMigrations,
        managedMigrationById,
        touchedFiles,
        warnings,
        precomputedTemplateContextByMutationIndex
      });
      continue;
    }

    if (operation !== "copy-file") {
      throw createCliError(`Unsupported files mutation op \"${operation}\" in ${packageEntry.packageId}.`);
    }

    const from = mutation.from;
    const to = mutation.to;
    const toSurface = mutation.toSurface;
    if (to && toSurface) {
      throw createCliError(
        `Invalid files mutation in ${packageEntry.packageId}: "to" and "toSurface" cannot both be set.`
      );
    }
    if (!from || (!to && !toSurface)) {
      throw createCliError(
        `Invalid files mutation in ${packageEntry.packageId}: "from" plus one destination ("to" or "toSurface") are required.`
      );
    }

    const sourcePath = path.join(packageEntry.rootDir, from);
    if (!(await fileExists(sourcePath))) {
      throw createCliError(`Missing template source ${sourcePath} for ${packageEntry.packageId}.`);
    }

    const targetPaths = toSurface
      ? resolveSurfaceTargetPathsForMutation({
          appRoot,
          packageId: packageEntry.packageId,
          mutation,
          configContext
        })
      : [resolveAppRelativePathWithinRoot(appRoot, to, `${packageEntry.packageId} files mutation.to`).absolutePath];
    const hasPrecomputedTemplateContext =
      precomputedTemplateContextByMutationIndex instanceof Map &&
      precomputedTemplateContextByMutationIndex.has(mutationIndex);
    const templateContextReplacements = hasPrecomputedTemplateContext
      ? precomputedTemplateContextByMutationIndex.get(mutationIndex)
      : await resolveTemplateContextReplacementsForMutation({
          packageEntry,
          mutation,
          options,
          appRoot,
          sourcePath,
          targetPaths
        });

    for (const targetPath of targetPaths) {
      const previous = await readFileBufferIfExists(targetPath);
      await copyTemplateFile(
        sourcePath,
        targetPath,
        options,
        packageEntry.packageId,
        `${mutation.id || to || from}.source`,
        templateContextReplacements
      );
      const nextBuffer = await readFile(targetPath);

      managedFiles.push({
        path: normalizeRelativePath(appRoot, targetPath),
        hash: hashBuffer(nextBuffer),
        hadPrevious: previous.exists,
        previousContentBase64: previous.exists ? previous.buffer.toString("base64") : "",
        preserveOnRemove: mutation.preserveOnRemove,
        reason: mutation.reason,
        category: mutation.category,
        id: mutation.id
      });
      touchedFiles.add(normalizeRelativePath(appRoot, targetPath));
    }
  }
}

async function preflightFileMutationTemplateContexts(
  packageEntry,
  options,
  appRoot,
  fileMutations
) {
  const mutationList = ensureArray(fileMutations);
  const replacementsByMutationIndex = new Map();

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
    const templateContext = ensureObject(mutation.templateContext);
    if (Object.keys(templateContext).length < 1) {
      continue;
    }

    const operation = mutation.op || "copy-file";
    if (operation !== "copy-file" && operation !== "install-migration") {
      continue;
    }

    const from = mutation.from;
    const to = mutation.to;
    const toSurface = mutation.toSurface;
    if (!from) {
      throw createCliError(
        `Invalid files mutation in ${packageEntry.packageId}: "from" is required.`
      );
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
    const replacements = await resolveTemplateContextReplacementsForMutation({
      packageEntry,
      mutation,
      options,
      appRoot,
      sourcePath,
      targetPaths,
      mutationContext: "files mutation"
    });
    replacementsByMutationIndex.set(mutationIndex, replacements);
  }

  return replacementsByMutationIndex;
}

export {
  applyFileMutations,
  preflightFileMutationTemplateContexts
};
