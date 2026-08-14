import {
  ensureObject,
  sortStrings
} from "../../shared/collectionUtils.js";
import {
  runMigrationCreateCommand
} from "./createMigration.js";

async function runPackageCreateCommand(ctx = {}, { positional, options, cwd, io }) {
  const targetType = String(positional[0] || "").trim();
  if (targetType === "migration") {
    return runMigrationCreateCommand(ctx, {
      positional,
      options,
      cwd,
      io
    });
  }
  const createPackageOptions = options?.inlineOptions && typeof options.inlineOptions === "object"
    ? options.inlineOptions
    : {};
  const unsupportedPackageOptions = ["package", "id"].filter((optionName) =>
    Object.prototype.hasOwnProperty.call(createPackageOptions, optionName)
  );
  if (unsupportedPackageOptions.length > 0) {
    throw ctx.createCliError(
      `Unknown option${unsupportedPackageOptions.length === 1 ? "" : "s"} for create package: ${unsupportedPackageOptions.map((optionName) => `--${optionName}`).join(", ")}.`
    );
  }

  const {
    createCliError,
    normalizeRelativePath,
    normalizeRelativePosixPath,
    resolveAppRootFromCwd,
    loadAppPackageJson,
    loadInstalledAppPackageRegistry,
    resolveLocalPackageId,
    createLocalPackageScaffoldFiles,
    path,
    toFileDependencySpecifier,
    fileExists,
    mkdir,
    writeFile,
    applyPackageJsonField,
    writeJsonFile,
    runNpmInstall,
    synchronizeAppCiWorkflow
  } = ctx;

  const rawName = String(positional[1] || "").trim();
  if (targetType !== "package" || !rawName) {
    throw createCliError(
      "create requires: create package <name> or create migration --package <id> --id <migration-id>",
      { showUsage: true }
    );
  }

  const appRoot = await resolveAppRootFromCwd(cwd);
  const { packageJsonPath, packageJson } = await loadAppPackageJson(appRoot);
  const installedPackages = await loadInstalledAppPackageRegistry(appRoot);
  const dependencies = ensureObject(packageJson.dependencies);
  const devDependencies = ensureObject(packageJson.devDependencies);

  const { packageId, packageDirName } = resolveLocalPackageId({
    rawName,
    appPackageName: packageJson.name,
    inlineOptions: options.inlineOptions
  });
  const localPackagesRoot = path.join(appRoot, "packages");
  const packageRoot = path.join(localPackagesRoot, packageDirName);
  const packageRelativePath = normalizeRelativePath(appRoot, packageRoot);
  const manifestRelativePath = `${normalizeRelativePosixPath(packageRelativePath)}/package.json`;
  const localDependencySpecifier = toFileDependencySpecifier(packageRelativePath);
  const packageDescription = String(options.inlineOptions.description || "").trim() || `App-local package ${packageId}.`;

  if (await fileExists(packageRoot)) {
    throw createCliError(`Package directory already exists: ${normalizeRelativePath(appRoot, packageRoot)}`);
  }
  if (installedPackages.has(packageId)) {
    throw createCliError(`Package is already installed: ${packageId}`);
  }
  if (Object.prototype.hasOwnProperty.call(dependencies, packageId)) {
    throw createCliError(`package.json dependencies already contains ${packageId}.`);
  }
  if (Object.prototype.hasOwnProperty.call(devDependencies, packageId)) {
    throw createCliError(`package.json devDependencies already contains ${packageId}.`);
  }

  const scaffoldFiles = createLocalPackageScaffoldFiles({
    packageId,
    packageDescription
  });
  const touchedFiles = new Set(["package.json"]);
  for (const scaffoldFile of scaffoldFiles) {
    touchedFiles.add(
      `${normalizeRelativePosixPath(packageRelativePath)}/${normalizeRelativePosixPath(scaffoldFile.relativePath)}`
    );
  }

  if (!options.dryRun) {
    for (const scaffoldFile of scaffoldFiles) {
      const absoluteFilePath = path.join(packageRoot, scaffoldFile.relativePath);
      await mkdir(path.dirname(absoluteFilePath), { recursive: true });
      await writeFile(absoluteFilePath, String(scaffoldFile.content || ""), "utf8");
    }
  }

  applyPackageJsonField(packageJson, "dependencies", packageId, localDependencySpecifier);

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
    io.stdout.write(
      `${JSON.stringify(
        {
          targetType: "package",
          packageId,
          packageDirectory: normalizeRelativePosixPath(packageRelativePath),
          manifestPath: manifestRelativePath,
          dependency: localDependencySpecifier,
          touchedFiles: touchedFileList,
          dryRun: options.dryRun
        },
        null,
        2
      )}\n`
    );
  } else {
    io.stdout.write(`Created local package ${packageId}.\n`);
    io.stdout.write(`Directory: ${normalizeRelativePosixPath(packageRelativePath)}\n`);
    io.stdout.write(`Dependency: ${packageId} -> ${localDependencySpecifier}\n`);
    io.stdout.write(`Manifest: ${manifestRelativePath}\n`);
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

export { runPackageCreateCommand };
