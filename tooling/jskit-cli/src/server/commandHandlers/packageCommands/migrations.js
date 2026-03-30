import {
  ensureArray,
  ensureObject,
  sortStrings
} from "../../shared/collectionUtils.js";

async function runPackageMigrationsCommand(ctx = {}, { positional, options, cwd, io }) {
  const {
    createCliError,
    normalizeRelativePath,
    resolveAppRootFromCwd,
    loadPackageRegistry,
    loadAppLocalPackageRegistry,
    mergePackageRegistries,
    loadLockFile,
    hydratePackageRegistryFromInstalledNodeModules,
    resolveInstalledPackageIdInput,
    validateInlineOptionsForPackage,
    resolvePackageOptions,
    applyPackageMigrationsOnly,
    writeJsonFile
  } = ctx;

  const scope = String(positional[0] || "").trim().toLowerCase();
  const targetId = String(positional[1] || "").trim();
  if (!scope || (scope !== "all" && scope !== "changed" && scope !== "package")) {
    throw createCliError("migrations requires: migrations <all|changed|package <packageId>>", {
      showUsage: true
    });
  }
  if (scope === "package" && !targetId) {
    throw createCliError("migrations package requires a package id.", {
      showUsage: true
    });
  }
  if (scope !== "package" && Object.keys(ensureObject(options.inlineOptions)).length > 0) {
    throw createCliError("Inline options are only supported with: migrations package <packageId>.");
  }

  const appRoot = await resolveAppRootFromCwd(cwd);
  const packageRegistry = await loadPackageRegistry();
  const appLocalRegistry = await loadAppLocalPackageRegistry(appRoot);
  const combinedPackageRegistry = mergePackageRegistries(packageRegistry, appLocalRegistry);
  const { lockPath, lock } = await loadLockFile(appRoot);
  const installedPackages = ensureObject(lock.installedPackages);
  const installedPackageIds = sortStrings(Object.keys(installedPackages));
  await hydratePackageRegistryFromInstalledNodeModules({
    appRoot,
    packageRegistry: combinedPackageRegistry,
    seedPackageIds: installedPackageIds
  });

  let requestedPackageIds = [];
  if (scope === "all") {
    requestedPackageIds = installedPackageIds;
  } else if (scope === "package") {
    const resolvedTargetId = resolveInstalledPackageIdInput(targetId, installedPackages);
    if (!resolvedTargetId) {
      throw createCliError(`Package is not installed: ${targetId}`);
    }
    requestedPackageIds = [resolvedTargetId];
  } else {
    requestedPackageIds = installedPackageIds.filter((packageId) => {
      const packageEntry = combinedPackageRegistry.get(packageId);
      if (!packageEntry) {
        return true;
      }
      const lockEntry = ensureObject(installedPackages[packageId]);
      const migrationSyncVersion = String(lockEntry.migrationSyncVersion || "").trim();
      return migrationSyncVersion !== String(packageEntry.version || "").trim();
    });
  }

  const touchedFiles = new Set();
  const migratedRecords = [];
  const migrationWarnings = [];
  for (const packageId of requestedPackageIds) {
    const packageEntry = combinedPackageRegistry.get(packageId);
    if (!packageEntry) {
      throw createCliError(
        `Installed package descriptor not found: ${packageId}. Ensure it is available in catalog, app packages/, or node_modules.`
      );
    }
    validateInlineOptionsForPackage(packageEntry, options.inlineOptions);
    const installedRecord = ensureObject(installedPackages[packageId]);
    const mergedInlineOptions = scope === "package" ? ensureObject(options.inlineOptions) : {};
    const resolvedOptions = await resolvePackageOptions(
      packageEntry,
      {
        ...ensureObject(installedRecord.options),
        ...mergedInlineOptions
      },
      io,
      { appRoot }
    );

    const managedRecord = await applyPackageMigrationsOnly({
      packageEntry,
      packageOptions: resolvedOptions,
      appRoot,
      lock,
      touchedFiles
    });
    migratedRecords.push(managedRecord);
    for (const warning of ensureArray(ensureObject(managedRecord).warnings)) {
      const normalizedWarning = String(warning || "").trim();
      if (!normalizedWarning) {
        continue;
      }
      migrationWarnings.push(normalizedWarning);
    }
  }

  const touchedFileList = sortStrings([...touchedFiles]);
  if (!options.dryRun) {
    await writeJsonFile(lockPath, lock);
  }

  if (options.json) {
    io.stdout.write(`${JSON.stringify({
      targetType: "migrations",
      scope,
      requestedPackages: requestedPackageIds,
      touchedFiles: touchedFileList,
      lockPath: normalizeRelativePath(appRoot, lockPath),
      dryRun: options.dryRun,
      migrated: migratedRecords,
      warnings: migrationWarnings
    }, null, 2)}\n`);
  } else {
    io.stdout.write(`Generated migrations (${scope}).\n`);
    io.stdout.write(`Resolved packages (${requestedPackageIds.length}):\n`);
    for (const packageId of requestedPackageIds) {
      io.stdout.write(`- ${packageId}\n`);
    }
    io.stdout.write(`Touched files (${touchedFileList.length}):\n`);
    for (const touchedFile of touchedFileList) {
      io.stdout.write(`- ${touchedFile}\n`);
    }
    io.stdout.write(`Lock file: ${normalizeRelativePath(appRoot, lockPath)}\n`);
    if (options.verbose && migrationWarnings.length > 0) {
      io.stdout.write(`Warnings (${migrationWarnings.length}):\n`);
      for (const warning of migrationWarnings) {
        io.stdout.write(`- ${warning}\n`);
      }
    }
    if (options.dryRun) {
      io.stdout.write("Dry run enabled: no files were written.\n");
    }
  }

  return 0;
}

export { runPackageMigrationsCommand };
