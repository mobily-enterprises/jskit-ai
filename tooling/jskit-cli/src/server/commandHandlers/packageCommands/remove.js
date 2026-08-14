import {
  ensureObject,
  sortStrings
} from "../../shared/collectionUtils.js";

const ROOT_DEPENDENCY_SECTIONS = Object.freeze([
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies"
]);

async function runPackageRemoveCommand(ctx = {}, { positional, options, cwd, io }) {
  const {
    createCliError,
    resolveAppRootFromCwd,
    loadInstalledAppPackageRegistry,
    installedPackageRecordFromRegistry,
    loadAppPackageJson,
    resolveInstalledPackageIdInput,
    removePackageJsonField,
    writeJsonFile,
    runNpmInstall,
    synchronizeAppCiWorkflow
  } = ctx;

  const targetType = String(positional[0] || "").trim();
  const targetId = String(positional[1] || "").trim();
  if (targetType !== "package" || !targetId) {
    throw createCliError("remove requires: remove package <packageId>", { showUsage: true });
  }

  const appRoot = await resolveAppRootFromCwd(cwd);
  const installedRegistry = await loadInstalledAppPackageRegistry(appRoot);
  const installedRecord = installedPackageRecordFromRegistry(installedRegistry);
  const resolvedTargetId = resolveInstalledPackageIdInput(targetId, installedRecord);
  if (!resolvedTargetId) {
    throw createCliError(`Package is not installed: ${targetId}`);
  }

  const { packageJsonPath, packageJson } = await loadAppPackageJson(appRoot);
  const declaredSections = ROOT_DEPENDENCY_SECTIONS.filter((sectionName) =>
    Object.prototype.hasOwnProperty.call(ensureObject(packageJson[sectionName]), resolvedTargetId)
  );
  if (declaredSections.length < 1) {
    throw createCliError(
      `${resolvedTargetId} is installed transitively, not declared by this app. Remove the package that depends on it instead.`
    );
  }

  for (const sectionName of declaredSections) {
    removePackageJsonField(packageJson, sectionName, resolvedTargetId);
  }
  const touchedFiles = new Set(["package.json"]);
  if (!options.dryRun) {
    await writeJsonFile(packageJsonPath, packageJson);
    await runNpmInstall(appRoot, io.stderr);
    const ciResult = await synchronizeAppCiWorkflow({ appRoot });
    if (ciResult.changed) {
      touchedFiles.add(ciResult.path);
    }
  }
  const touchedFileList = sortStrings([...touchedFiles]);

  if (options.json) {
    io.stdout.write(`${JSON.stringify({
      removedPackage: resolvedTargetId,
      removedFrom: declaredSections,
      touchedFiles: touchedFileList,
      retainedAppFiles: true,
      dryRun: options.dryRun
    }, null, 2)}\n`);
  } else {
    io.stdout.write(`Removed dependency ${resolvedTargetId} from ${declaredSections.join(", ")}.\n`);
    io.stdout.write("App-owned source files and migration history were retained.\n");
    io.stdout.write(`Touched files (${touchedFileList.length}):\n`);
    for (const touchedFile of touchedFileList) {
      io.stdout.write(`- ${touchedFile}\n`);
    }
    if (options.dryRun) {
      io.stdout.write("Dry run enabled: no files were written.\n");
    }
  }
  return 0;
}

export { runPackageRemoveCommand };
