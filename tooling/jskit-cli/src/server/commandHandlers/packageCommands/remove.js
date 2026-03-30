import {
  ensureArray,
  ensureObject,
  sortStrings
} from "../../shared/collectionUtils.js";

async function runPackageRemoveCommand(ctx = {}, { positional, options, cwd, io }) {
  const {
    createCliError,
    normalizeRelativePath,
    resolveAppRootFromCwd,
    loadPackageRegistry,
    loadAppLocalPackageRegistry,
    mergePackageRegistries,
    loadAppPackageJson,
    loadLockFile,
    hydratePackageRegistryFromInstalledNodeModules,
    resolveInstalledPackageIdInput,
    getInstalledDependents,
    restorePackageJsonField,
    path,
    readFileBufferIfExists,
    removeEnvValue,
    writeFile,
    removeManagedViteProxyEntries,
    hashBuffer,
    rm,
    writeJsonFile,
    runNpmInstall
  } = ctx;

  const targetType = String(positional[0] || "").trim();
  const targetId = String(positional[1] || "").trim();
  if (targetType !== "package" || !targetId) {
    throw createCliError("remove requires: remove package <packageId>", { showUsage: true });
  }

  const appRoot = await resolveAppRootFromCwd(cwd);
  const packageRegistry = await loadPackageRegistry();
  const appLocalRegistry = await loadAppLocalPackageRegistry(appRoot);
  const combinedPackageRegistry = mergePackageRegistries(packageRegistry, appLocalRegistry);
  const { packageJsonPath, packageJson } = await loadAppPackageJson(appRoot);
  const { lockPath, lock } = await loadLockFile(appRoot);
  const installed = ensureObject(lock.installedPackages);
  await hydratePackageRegistryFromInstalledNodeModules({
    appRoot,
    packageRegistry: combinedPackageRegistry,
    seedPackageIds: Object.keys(installed)
  });
  const resolvedTargetId = resolveInstalledPackageIdInput(targetId, installed);

  if (!resolvedTargetId) {
    throw createCliError(`Package is not installed: ${targetId}`);
  }

  const dependents = getInstalledDependents(lock, resolvedTargetId, combinedPackageRegistry);
  if (dependents.length > 0) {
    throw createCliError(
      `Cannot remove ${resolvedTargetId}; installed packages depend on it: ${dependents.join(", ")}`
    );
  }

  const lockEntry = ensureObject(installed[resolvedTargetId]);
  const managed = ensureObject(lockEntry.managed);
  const touchedFiles = new Set();

  const managedPackageJson = ensureObject(managed.packageJson);
  for (const [dependencyId, managedChange] of Object.entries(ensureObject(managedPackageJson.dependencies))) {
    if (restorePackageJsonField(packageJson, "dependencies", dependencyId, managedChange)) {
      touchedFiles.add("package.json");
    }
  }
  for (const [dependencyId, managedChange] of Object.entries(ensureObject(managedPackageJson.devDependencies))) {
    if (restorePackageJsonField(packageJson, "devDependencies", dependencyId, managedChange)) {
      touchedFiles.add("package.json");
    }
  }
  for (const [scriptName, managedChange] of Object.entries(ensureObject(managedPackageJson.scripts))) {
    if (restorePackageJsonField(packageJson, "scripts", scriptName, managedChange)) {
      touchedFiles.add("package.json");
    }
  }

  const managedText = ensureObject(managed.text);
  for (const change of Object.values(managedText)) {
    const changeRecord = ensureObject(change);
    if (String(changeRecord.op || "") !== "upsert-env") {
      continue;
    }
    const relativeFile = String(changeRecord.file || "").trim();
    if (!relativeFile) {
      continue;
    }
    const absoluteFile = path.join(appRoot, relativeFile);
    const existing = await readFileBufferIfExists(absoluteFile);
    if (!existing.exists) {
      continue;
    }
    const updated = removeEnvValue(
      existing.buffer.toString("utf8"),
      String(changeRecord.key || ""),
      String(changeRecord.value || ""),
      {
        hadPrevious: Boolean(changeRecord.hadPrevious),
        previousValue: String(changeRecord.previousValue || "")
      }
    );
    if (updated.changed) {
      await writeFile(absoluteFile, updated.content, "utf8");
      touchedFiles.add(normalizeRelativePath(appRoot, absoluteFile));
    }
  }

  await removeManagedViteProxyEntries({
    appRoot,
    packageId: resolvedTargetId,
    managedViteChanges: ensureObject(managed.vite),
    touchedFiles
  });

  for (const fileChange of ensureArray(managed.files)) {
    const changeRecord = ensureObject(fileChange);
    if (changeRecord.preserveOnRemove === true) {
      continue;
    }
    const relativeFile = String(changeRecord.path || "").trim();
    if (!relativeFile) {
      continue;
    }
    const absoluteFile = path.join(appRoot, relativeFile);
    const existing = await readFileBufferIfExists(absoluteFile);
    if (!existing.exists) {
      continue;
    }
    if (hashBuffer(existing.buffer) !== String(changeRecord.hash || "")) {
      continue;
    }

    if (changeRecord.hadPrevious) {
      const previousBuffer = Buffer.from(String(changeRecord.previousContentBase64 || ""), "base64");
      await writeFile(absoluteFile, previousBuffer);
    } else {
      await rm(absoluteFile);
    }
    touchedFiles.add(relativeFile);
  }

  delete installed[resolvedTargetId];
  const touchedFileList = sortStrings([...touchedFiles]);

  if (!options.dryRun) {
    await writeJsonFile(packageJsonPath, packageJson);
    await writeJsonFile(lockPath, lock);
    if (options.runNpmInstall) {
      await runNpmInstall(appRoot, io.stderr);
    }
  }

  if (options.json) {
    io.stdout.write(`${JSON.stringify({
      removedPackage: resolvedTargetId,
      touchedFiles: touchedFileList,
      lockPath: normalizeRelativePath(appRoot, lockPath),
      dryRun: options.dryRun
    }, null, 2)}\n`);
  } else {
    io.stdout.write(`Removed package ${resolvedTargetId}.\n`);
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

export { runPackageRemoveCommand };
