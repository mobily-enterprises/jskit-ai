import {
  ensureObject,
  sortStrings
} from "../../shared/collectionUtils.js";

async function runPackagePositionCommand(ctx = {}, { positional, options, cwd, io }) {
  const {
    createCliError,
    normalizeRelativePath,
    resolveAppRootFromCwd,
    loadPackageRegistry,
    loadAppLocalPackageRegistry,
    mergePackageRegistries,
    loadLockFile,
    resolveInstalledPackageIdInput,
    hydratePackageRegistryFromInstalledNodeModules,
    validateInlineOptionsForPackage,
    resolvePackageOptions,
    applyPackagePositioning,
    writeJsonFile
  } = ctx;

  const targetType = String(positional[0] || "").trim();
  const targetId = String(positional[1] || "").trim();
  if (targetType !== "element" || !targetId) {
    throw createCliError("position requires: position element <packageId>", { showUsage: true });
  }

  const appRoot = await resolveAppRootFromCwd(cwd);
  const packageRegistry = await loadPackageRegistry();
  const appLocalRegistry = await loadAppLocalPackageRegistry(appRoot);
  const combinedPackageRegistry = mergePackageRegistries(packageRegistry, appLocalRegistry);
  const { lockPath, lock } = await loadLockFile(appRoot);
  const installedPackages = ensureObject(lock.installedPackages);
  const resolvedTargetId = resolveInstalledPackageIdInput(targetId, installedPackages);
  if (!resolvedTargetId) {
    throw createCliError(`Element is not installed: ${targetId}`);
  }

  await hydratePackageRegistryFromInstalledNodeModules({
    appRoot,
    packageRegistry: combinedPackageRegistry,
    seedPackageIds: [resolvedTargetId]
  });
  const packageEntry = combinedPackageRegistry.get(resolvedTargetId);
  if (!packageEntry) {
    throw createCliError(
      `Installed element descriptor not found: ${resolvedTargetId}. Ensure it exists in catalog, app packages/, or node_modules.`
    );
  }
  validateInlineOptionsForPackage(packageEntry, options.inlineOptions);

  const installedRecord = ensureObject(installedPackages[resolvedTargetId]);
  const resolvedOptions = await resolvePackageOptions(
    packageEntry,
    {
      ...ensureObject(installedRecord.options),
      ...ensureObject(options.inlineOptions)
    },
    io,
    { appRoot }
  );

  const touchedFiles = new Set();
  const positionedRecord = await applyPackagePositioning({
    packageEntry,
    packageOptions: resolvedOptions,
    appRoot,
    lock,
    touchedFiles
  });
  const touchedFileList = sortStrings([...touchedFiles]);

  if (!options.dryRun) {
    await writeJsonFile(lockPath, lock);
  }

  if (options.json) {
    io.stdout.write(`${JSON.stringify({
      targetType: "element",
      elementId: resolvedTargetId,
      packageId: resolvedTargetId,
      touchedFiles: touchedFileList,
      lockPath: normalizeRelativePath(appRoot, lockPath),
      dryRun: options.dryRun,
      positioned: positionedRecord
    }, null, 2)}\n`);
  } else {
    io.stdout.write(`Positioned element ${resolvedTargetId}.\n`);
    io.stdout.write(`Touched files (${touchedFileList.length}):\n`);
    for (const touchedFile of touchedFileList) {
      io.stdout.write(`- ${touchedFile}\n`);
    }
    io.stdout.write(`Lock file: ${normalizeRelativePath(appRoot, lockPath)}\n`);
    if (options.dryRun) {
      io.stdout.write("Dry run enabled: no files were written.\n");
    }
  }

  return 0;
}

export { runPackagePositionCommand };
