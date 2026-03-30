import {
  ensureObject,
  sortStrings
} from "../../shared/collectionUtils.js";

async function runPackageCreateCommand(ctx = {}, { positional, options, cwd, io }) {
  const {
    createCliError,
    normalizeRelativePath,
    normalizeRelativePosixPath,
    resolveAppRootFromCwd,
    loadAppPackageJson,
    loadLockFile,
    resolveLocalPackageId,
    createLocalPackageScaffoldFiles,
    path,
    toFileDependencySpecifier,
    fileExists,
    mkdir,
    writeFile,
    applyPackageJsonField,
    writeJsonFile,
    runNpmInstall
  } = ctx;

  const targetType = String(positional[0] || "").trim();
  const rawName = String(positional[1] || "").trim();
  if (targetType !== "package" || !rawName) {
    throw createCliError("create requires: create package <name>", { showUsage: true });
  }

  const appRoot = await resolveAppRootFromCwd(cwd);
  const { packageJsonPath, packageJson } = await loadAppPackageJson(appRoot);
  const { lockPath, lock } = await loadLockFile(appRoot);
  const installedPackages = ensureObject(lock.installedPackages);
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
  const descriptorRelativePath = `${normalizeRelativePosixPath(packageRelativePath)}/package.descriptor.mjs`;
  const localDependencySpecifier = toFileDependencySpecifier(packageRelativePath);
  const packageDescription = String(options.inlineOptions.description || "").trim() || `App-local package ${packageId}.`;

  if (await fileExists(packageRoot)) {
    throw createCliError(`Package directory already exists: ${normalizeRelativePath(appRoot, packageRoot)}`);
  }
  if (Object.prototype.hasOwnProperty.call(installedPackages, packageId)) {
    throw createCliError(`Package is already present in lock file: ${packageId}`);
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
  const touchedFiles = new Set(["package.json", normalizeRelativePath(appRoot, lockPath)]);
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

  const dependencyApplied = applyPackageJsonField(packageJson, "dependencies", packageId, localDependencySpecifier);
  const managedRecord = {
    packageId,
    version: "0.1.0",
    source: {
      type: "local-package",
      packagePath: normalizeRelativePosixPath(packageRelativePath),
      descriptorPath: descriptorRelativePath
    },
    managed: {
      packageJson: {
        dependencies: {},
        devDependencies: {},
        scripts: {}
      },
      text: {},
      vite: {},
      files: [],
      migrations: []
    },
    options: {},
    installedAt: new Date().toISOString()
  };
  if (dependencyApplied.changed) {
    managedRecord.managed.packageJson.dependencies[packageId] = dependencyApplied.managed;
  }
  lock.installedPackages[packageId] = managedRecord;

  const touchedFileList = sortStrings([...touchedFiles]);
  if (!options.dryRun) {
    await writeJsonFile(packageJsonPath, packageJson);
    await writeJsonFile(lockPath, lock);
    if (options.runNpmInstall) {
      await runNpmInstall(appRoot, io.stderr);
    }
  }

  if (options.json) {
    io.stdout.write(
      `${JSON.stringify(
        {
          targetType: "package",
          packageId,
          packageDirectory: normalizeRelativePosixPath(packageRelativePath),
          descriptorPath: descriptorRelativePath,
          dependency: localDependencySpecifier,
          touchedFiles: touchedFileList,
          lockPath: normalizeRelativePath(appRoot, lockPath),
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
    io.stdout.write(`Descriptor: ${descriptorRelativePath}\n`);
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

export { runPackageCreateCommand };
