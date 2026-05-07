import path from "node:path";
import { spawn } from "node:child_process";
import { importFreshModuleFromAbsolutePath } from "@jskit-ai/kernel/server/support";
import {
  ensureArray,
  ensureObject,
  sortStrings
} from "../../shared/collectionUtils.js";
import {
  fileExists
} from "../appCommands/shared.js";
import {
  ensureMobileConfigStub,
  collectCapacitorShellInstallIssues,
  ensureAndroidManifestDeepLinks,
  ensureAndroidNativeShellIdentity
} from "../mobileShellSupport.js";
import {
  isHelpToken,
  renderAddCatalogHelp,
  renderAddPackageHelp,
  renderAddBundleHelp
} from "./discoverabilityHelp.js";
import {
  ensureLocalMainPlacementComponentProvisioning,
  resolveProvisionableLocalPlacementComponentTokens
} from "./tabLinkItemProvisioning.js";
import { resolvePackageTemplateRoot } from "../../cliRuntime/packageTemplateResolution.js";

const COMPONENT_TOKEN_PATTERN = /\bcomponentToken\s*:\s*["']([^"']+)["']/g;

function collectPlacementComponentTokensFromManagedRecords(installedPackageRecords = []) {
  const collectedTokens = new Set();

  for (const record of ensureArray(installedPackageRecords)) {
    const managedTextMutations = ensureObject(ensureObject(ensureObject(record).managed).text);
    for (const mutationRecord of Object.values(managedTextMutations)) {
      const source = String(ensureObject(mutationRecord).value || "");
      for (const match of source.matchAll(COMPONENT_TOKEN_PATTERN)) {
        const componentToken = String(match[1] || "").trim();
        if (componentToken) {
          collectedTokens.add(componentToken);
        }
      }
    }
  }

  return sortStrings([...collectedTokens]);
}

function renderWrappedShellCommand(binaryName, args = [], {
  maxWidth = 100,
  continuationIndent = "  "
} = {}) {
  const tokens = [String(binaryName || "").trim(), ...ensureArray(args).map((entry) => String(entry || "").trim()).filter(Boolean)];
  if (tokens.length < 1 || !tokens[0]) {
    return "$";
  }

  let currentLine = "$";
  const renderedLines = [];
  for (const token of tokens) {
    const prefix = currentLine === "$" ? " " : " ";
    if ((`${currentLine}${prefix}${token}`).length <= maxWidth || currentLine === "$") {
      currentLine = `${currentLine}${prefix}${token}`;
      continue;
    }

    renderedLines.push(`${currentLine} \\`);
    currentLine = `${continuationIndent}${token}`;
  }

  renderedLines.push(currentLine);
  return renderedLines.join("\n");
}

async function runLocalProjectBinary(binaryName, args = [], {
  appRoot,
  io,
  pathModule = path,
  createCliError,
  explanation = "",
  dryRun = false
} = {}) {
  const renderedArgs = Array.isArray(args) ? args.join(" ") : "";
  if (explanation) {
    io?.stdout?.write(`${explanation}\n`);
    io?.stdout?.write(`${renderWrappedShellCommand(binaryName, args)}\n`);
  }
  if (dryRun === true) {
    io?.stdout?.write(`[dry-run] ${binaryName}${renderedArgs ? ` ${renderedArgs}` : ""}\n`);
    return;
  }

  const localBinDirectory = pathModule.join(appRoot, "node_modules", ".bin");
  const inheritedPath = String(process.env.PATH || "");
  const spawnedEnv = {
    ...process.env,
    PATH: `${localBinDirectory}${pathModule.delimiter}${inheritedPath}`
  };

  await new Promise((resolve, reject) => {
    const child = spawn(binaryName, Array.isArray(args) ? args : [], {
      cwd: appRoot,
      env: spawnedEnv,
      stdio: "inherit"
    });

    child.on("error", (error) => {
      if (error?.code === "ENOENT") {
        reject(
          createCliError(
            `Could not find local "${binaryName}" in node_modules/.bin. Re-run the package install after dependencies are installed.`
          )
        );
        return;
      }
      reject(error);
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(createCliError(`${binaryName} ${args.join(" ")} failed with exit code ${code}.`));
    });
  });
}

async function installAppDependenciesForHook({
  appRoot,
  appPackageJson,
  io,
  pathModule = path,
  createCliError,
  dryRun = false,
  runDevlinks = false
} = {}) {
  const packageScripts =
    appPackageJson?.scripts && typeof appPackageJson.scripts === "object"
      ? appPackageJson.scripts
      : {};

  await runLocalProjectBinary("npm", ["install"], {
    appRoot,
    io,
    pathModule,
    createCliError,
    explanation: "[mobile] Installing app dependencies for the mobile shell:",
    dryRun
  });

  if (runDevlinks === true && Object.prototype.hasOwnProperty.call(packageScripts, "devlinks")) {
    await runLocalProjectBinary("npm", ["run", "--if-present", "devlinks"], {
      appRoot,
      io,
      pathModule,
      createCliError,
      explanation: "[mobile] Refreshing local JSKIT package links:",
      dryRun
    });
  }
}

function validateHookResult(result = {}, { packageId = "", hookLabel = "" } = {}) {
  if (typeof result === "undefined" || result === null) {
    return {};
  }
  if (typeof result !== "object" || Array.isArray(result)) {
    throw new Error(`${packageId} ${hookLabel} must return an object when it returns a value.`);
  }
  return result;
}

async function loadInstallHook({
  packageEntry,
  appRoot,
  hookSpec,
  hookLabel = ""
} = {}) {
  const entrypoint = String(hookSpec?.entrypoint || "").trim();
  const exportName = String(hookSpec?.export || "").trim() || "default";
  if (!entrypoint) {
    return null;
  }

  const templateRoot = await resolvePackageTemplateRoot({
    packageEntry,
    appRoot
  });
  const absoluteEntrypointPath = path.resolve(templateRoot, entrypoint);
  if (!(await fileExists(absoluteEntrypointPath))) {
    throw new Error(`${packageEntry.packageId} ${hookLabel} entrypoint not found at ${entrypoint}.`);
  }

  let moduleNamespace = null;
  try {
    moduleNamespace = await importFreshModuleFromAbsolutePath(absoluteEntrypointPath);
  } catch (error) {
    throw new Error(
      `Unable to load ${hookLabel} entrypoint ${entrypoint} for ${packageEntry.packageId}: ${String(error?.message || error || "unknown error")}`
    );
  }

  const handler = exportName === "default" ? moduleNamespace?.default : moduleNamespace?.[exportName];
  if (typeof handler !== "function") {
    throw new Error(`${packageEntry.packageId} ${hookLabel} export "${exportName}" is not a function.`);
  }

  return handler;
}

function createInstallHookHelpers({
  ctx,
  appRoot,
  io,
  appPackageJson,
  commandOptions = {}
} = {}) {
  return Object.freeze({
    ensureManagedMobileConfig: async ({ dryRun = false } = {}) =>
      await ensureMobileConfigStub({
        ctx,
        appRoot,
        packageJson: appPackageJson,
        dryRun,
        stdout: io?.stdout
      }),
    installAppDependencies: async ({ dryRun = false } = {}) =>
      await installAppDependenciesForHook({
        appRoot,
        appPackageJson,
        io,
        pathModule: ctx.path,
        createCliError: ctx.createCliError,
        dryRun,
        runDevlinks: commandOptions.devlinks === true
      }),
    runProjectBinary: async (binaryName, args = [], { dryRun = false, explanation = "" } = {}) =>
      await runLocalProjectBinary(binaryName, args, {
        appRoot,
        io,
        pathModule: ctx.path,
        createCliError: ctx.createCliError,
        explanation,
        dryRun
      }),
    collectCapacitorShellInstallIssues: async () =>
      await collectCapacitorShellInstallIssues({
        ctx,
        appRoot
      }),
    ensureAndroidManifestDeepLinks: async ({ dryRun = false } = {}) =>
      await ensureAndroidManifestDeepLinks({
        ctx,
        appRoot,
        dryRun,
        stdout: io?.stdout
      }),
    ensureAndroidNativeShellIdentity: async ({ dryRun = false } = {}) =>
      await ensureAndroidNativeShellIdentity({
        ctx,
        appRoot,
        dryRun,
        stdout: io?.stdout
      }),
    fileExists
  });
}

async function invokeInstallHook({
  packageEntry,
  appRoot,
  hookSpec,
  hookLabel,
  hookContext,
  createCliError
} = {}) {
  if (!hookSpec || Object.keys(ensureObject(hookSpec)).length < 1) {
    return {};
  }

  const handler = await loadInstallHook({
    packageEntry,
    appRoot,
    hookSpec,
    hookLabel
  });
  if (!handler) {
    return {};
  }

  let result = null;
  try {
    result = await handler(hookContext);
  } catch (error) {
    throw createCliError(
      `${packageEntry.packageId} ${hookLabel} failed: ${String(error?.message || error || "unknown error")}`
    );
  }
  return validateHookResult(result, {
    packageId: packageEntry.packageId,
    hookLabel
  });
}

async function runPackageAddCommand(ctx = {}, { positional, options, cwd, io }) {
  const {
    createCliError,
    normalizeRelativePath,
    resolveAppRootFromCwd,
    loadPackageRegistry,
    loadAppLocalPackageRegistry,
    loadBundleRegistry,
    mergePackageRegistries,
    loadAppPackageJson,
    loadLockFile,
    resolvePackageIdFromRegistryOrNodeModules,
    hydratePackageRegistryFromInstalledNodeModules,
    resolvePackageKind,
    validateInlineOptionsForPackage,
    resolveLocalDependencyOrder,
    validatePlannedCapabilityClosure,
    validateInlineOptionsForBundle,
    resolveBundleInlineOptionsForPackage,
    resolvePackageOptions,
    applyPackageInstall,
    adoptAppLocalPackageDependencies,
    writeJsonFile,
    runNpmInstall,
    renderResolvedSummary,
    createCatalogFetchStatusReporter = () => () => {}
  } = ctx;

  const invocationMode = options?.commandMode === "generate" ? "generate" : "add";
  const targetType = String(positional[0] || "").trim();
  const targetId = String(positional[1] || "").trim();
  const thirdToken = String(positional[2] || "").trim();

  if (invocationMode === "add" && !targetType) {
    const packageRegistry = await loadPackageRegistry();
    const bundleRegistry = await loadBundleRegistry();
    renderAddCatalogHelp({
      io,
      packageRegistry,
      bundleRegistry,
      resolvePackageKind,
      json: options.json
    });
    return 0;
  }

  const addShorthandHelpTargetId =
    invocationMode === "add" &&
    targetType &&
    targetType !== "bundle" &&
    targetType !== "package" &&
    isHelpToken(targetId) &&
    !thirdToken
      ? targetType
      : "";

  const addPackageHelpTargetId =
    invocationMode === "add" && targetType === "package" && targetId && isHelpToken(thirdToken)
      ? targetId
      : addShorthandHelpTargetId;
  const addBundleHelpTargetId =
    invocationMode === "add" && targetType === "bundle" && targetId && isHelpToken(thirdToken)
      ? targetId
      : "";

  if (addPackageHelpTargetId) {
    const appRoot = await resolveAppRootFromCwd(cwd);
    const packageRegistry = await loadPackageRegistry();
    const appLocalRegistry = await loadAppLocalPackageRegistry(appRoot);
    const combinedPackageRegistry = mergePackageRegistries(packageRegistry, appLocalRegistry);
    const resolvedPackageId = await resolvePackageIdFromRegistryOrNodeModules({
      appRoot,
      packageRegistry: combinedPackageRegistry,
      packageIdInput: addPackageHelpTargetId
    });
    if (!resolvedPackageId) {
      throw createCliError(
        `Unknown package: ${addPackageHelpTargetId}. Install an external module first (npm install ${addPackageHelpTargetId}) if you want to adopt it into lock.`
      );
    }

    await hydratePackageRegistryFromInstalledNodeModules({
      appRoot,
      packageRegistry: combinedPackageRegistry,
      seedPackageIds: [resolvedPackageId]
    });
    const packageEntry = combinedPackageRegistry.get(resolvedPackageId);
    if (!packageEntry) {
      throw createCliError(`Unknown package: ${addPackageHelpTargetId}`);
    }
    const packageKind = resolvePackageKind(packageEntry);
    if (packageKind === "generator") {
      throw createCliError(
        `Package ${resolvedPackageId} is a generator. Use: jskit generate ${resolvedPackageId}`
      );
    }
    renderAddPackageHelp({
      io,
      packageEntry,
      packageIdInput: addPackageHelpTargetId,
      json: options.json
    });
    return 0;
  }

  if (addBundleHelpTargetId) {
    const bundleRegistry = await loadBundleRegistry();
    const bundle = bundleRegistry.get(addBundleHelpTargetId);
    if (!bundle) {
      throw createCliError(`Unknown bundle: ${addBundleHelpTargetId}`);
    }
    renderAddBundleHelp({
      io,
      bundleId: addBundleHelpTargetId,
      bundle,
      json: options.json
    });
    return 0;
  }

  if (!targetType || !targetId) {
    if (invocationMode === "generate") {
      throw createCliError("generate requires a package id (generate <packageId>).", {
        showUsage: true
      });
    }
    throw createCliError("add requires target type and id (add bundle <id> | add package <id>).", {
      showUsage: true
    });
  }
  if (targetType !== "bundle" && targetType !== "package") {
    throw createCliError(`Unsupported add target type: ${targetType}`, { showUsage: true });
  }
  if (invocationMode === "generate" && targetType !== "package") {
    throw createCliError("generate requires a package id (generate <packageId>).", {
      showUsage: true
    });
  }

  const appRoot = await resolveAppRootFromCwd(cwd);
  const packageRegistry = await loadPackageRegistry();
  const appLocalRegistry = await loadAppLocalPackageRegistry(appRoot);
  const bundleRegistry = await loadBundleRegistry();
  const combinedPackageRegistry = mergePackageRegistries(packageRegistry, appLocalRegistry);
  const { packageJsonPath, packageJson } = await loadAppPackageJson(appRoot);
  const { lockPath, lock } = await loadLockFile(appRoot);
  const resolvedTargetPackageId = targetType === "package"
    ? await resolvePackageIdFromRegistryOrNodeModules({
        appRoot,
        packageRegistry: combinedPackageRegistry,
        packageIdInput: targetId
      })
    : "";

  const targetPackageIds = targetType === "bundle"
    ? ensureArray(bundleRegistry.get(targetId)?.packages).map((value) => String(value))
    : [resolvedTargetPackageId];
  if (targetType === "bundle" && targetPackageIds.length === 0) {
    throw createCliError(`Unknown bundle: ${targetId}`);
  }
  if (targetType === "package" && !resolvedTargetPackageId) {
    throw createCliError(
      `Unknown package: ${targetId}. Install an external module first (npm install ${targetId}) if you want to adopt it into lock.`
    );
  }

  await hydratePackageRegistryFromInstalledNodeModules({
    appRoot,
    packageRegistry: combinedPackageRegistry,
    seedPackageIds: targetPackageIds
  });

  if (targetType === "package") {
    const targetPackageEntry = combinedPackageRegistry.get(resolvedTargetPackageId);
    if (!targetPackageEntry) {
      throw createCliError(`Unknown package: ${targetId}`);
    }
    const packageKind = resolvePackageKind(targetPackageEntry);
    if (invocationMode === "add" && packageKind === "generator") {
      throw createCliError(
        `Package ${resolvedTargetPackageId} is a generator. Use: jskit generate ${resolvedTargetPackageId}`
      );
    }
    if (invocationMode === "generate" && packageKind !== "generator") {
      throw createCliError(
        `Package ${resolvedTargetPackageId} is a runtime package. Use: jskit add package ${resolvedTargetPackageId}`
      );
    }
    validateInlineOptionsForPackage(targetPackageEntry, options.inlineOptions);
  }

  const { ordered: resolvedPackageIds, externalDependencies } = resolveLocalDependencyOrder(
    targetPackageIds,
    combinedPackageRegistry
  );
  if (invocationMode === "add" && targetType === "bundle") {
    const bundledGenerators = resolvedPackageIds.filter((packageId) => {
      const packageEntry = combinedPackageRegistry.get(packageId);
      return resolvePackageKind(packageEntry) === "generator";
    });
    if (bundledGenerators.length > 0) {
      throw createCliError(
        `Bundle ${targetId} includes generator package(s): ${bundledGenerators.join(", ")}. Use: jskit generate <packageId>`
      );
    }
  }
  const plannedInstalledPackageIds = sortStrings([
    ...new Set([
      ...Object.keys(ensureObject(lock.installedPackages)).map((value) => String(value || "").trim()).filter(Boolean),
      ...resolvedPackageIds
    ])
  ]);
  validatePlannedCapabilityClosure(
    plannedInstalledPackageIds,
    combinedPackageRegistry,
    `${invocationMode} ${targetType} ${targetId}`
  );

  if (targetType === "bundle") {
    validateInlineOptionsForBundle({
      bundleId: targetId,
      inlineOptions: options.inlineOptions,
      packageIds: resolvedPackageIds,
      packageRegistry: combinedPackageRegistry
    });
  }

  const packagesToInstall = [];
  const resolvedOptionsByPackage = {};
  const installReasonByPackage = {};
  const reportTemplateFetchStatus = createCatalogFetchStatusReporter(io, {
    enabled: options.json !== true
  });
  const forceReapplyTarget = options?.forceReapplyTarget === true;
  const hasInlineOptions = Object.keys(ensureObject(options.inlineOptions)).length > 0;
  for (const packageId of resolvedPackageIds) {
    const packageEntry = combinedPackageRegistry.get(packageId);
    const existingInstall = ensureObject(lock.installedPackages[packageId]);
    const existingVersion = String(existingInstall.version || "").trim();
    const isDirectTargetPackage = targetType === "package" && packageId === resolvedTargetPackageId;
    const hasInstallLifecycleHooks =
      Object.keys(ensureObject(ensureObject(ensureObject(packageEntry.descriptor).lifecycle).install)).length > 0;
    const packageInlineOptions = targetType === "bundle"
      ? resolveBundleInlineOptionsForPackage(packageEntry, options.inlineOptions)
      : isDirectTargetPackage
        ? ensureObject(options.inlineOptions)
        : {};
    const hasPackageInlineOptions = Object.keys(packageInlineOptions).length > 0;
    const shouldReapplyInstalledPackage =
      (isDirectTargetPackage && (forceReapplyTarget || hasInlineOptions)) ||
      (isDirectTargetPackage && invocationMode === "add" && hasInstallLifecycleHooks && Boolean(existingVersion)) ||
      (targetType === "bundle" && hasPackageInlineOptions);
    const shouldSkipGenerateDependencyReinstall =
      invocationMode === "generate" &&
      !isDirectTargetPackage &&
      Boolean(existingVersion);
    if (shouldSkipGenerateDependencyReinstall && !shouldReapplyInstalledPackage) {
      continue;
    }
    if (existingVersion && existingVersion === packageEntry.version && !shouldReapplyInstalledPackage) {
      continue;
    }
    packagesToInstall.push(packageId);
    installReasonByPackage[packageId] = !existingVersion
      ? "install"
      : existingVersion === packageEntry.version
        ? "reapply"
        : "upgrade";
    const lockEntryOptions = ensureObject(existingInstall.options);
    resolvedOptionsByPackage[packageId] = await resolvePackageOptions(
      packageEntry,
      {
        ...lockEntryOptions,
        ...packageInlineOptions
      },
      io,
      { appRoot }
    );
  }

  const touchedFiles = new Set();
  const installedPackageRecords = [];
  const prepareHookWarnings = [];
  const installHookHelpers = createInstallHookHelpers({
    ctx,
    appRoot,
    io,
    appPackageJson: packageJson,
    commandOptions: options
  });

  for (const packageId of packagesToInstall) {
    const packageEntry = combinedPackageRegistry.get(packageId);
    const hookResult = await invokeInstallHook({
      packageEntry,
      appRoot,
      hookSpec: ensureObject(ensureObject(ensureObject(packageEntry.descriptor).lifecycle).install).prepare,
      hookLabel: "lifecycle.install.prepare",
      createCliError,
      hookContext: {
        appRoot,
        appPackageJson: packageJson,
        lock,
        packageEntry,
        packageOptions: resolvedOptionsByPackage[packageId],
        io,
        dryRun: options.dryRun === true,
        reason: installReasonByPackage[packageId],
        skipManagedFinalize: options.forceReapplyTarget === true && options.runNpmInstall !== true,
        helpers: installHookHelpers
      }
    });
    for (const warning of ensureArray(hookResult.warnings)) {
      const normalizedWarning = String(warning || "").trim();
      if (normalizedWarning) {
        prepareHookWarnings.push(normalizedWarning);
      }
    }
    for (const touchedPath of ensureArray(hookResult.touchedFiles)) {
      const normalizedPath = String(touchedPath || "").trim();
      if (normalizedPath) {
        touchedFiles.add(normalizedPath);
      }
    }
    if (hookResult.stopInstall === true) {
      if (options.dryRun !== true) {
        throw createCliError(`${packageEntry.packageId} lifecycle.install.prepare requested stopInstall outside dry-run.`);
      }
      const touchedFileList = sortStrings([...touchedFiles]);
      const installWarnings = sortStrings([...new Set(prepareHookWarnings)]);
      const stopMessage = String(hookResult.stopMessage || "").trim();
      if (options.json) {
        io.stdout.write(`${JSON.stringify({
          targetType: invocationMode === "generate" ? "generator" : targetType,
          targetId,
          resolvedPackages: resolvedPackageIds,
          touchedFiles: touchedFileList,
          lockPath: normalizeRelativePath(appRoot, lockPath),
          externalDependencies,
          dryRun: options.dryRun,
          installed: [],
          warnings: installWarnings,
          stoppedAfterPrepare: true,
          message: stopMessage
        }, null, 2)}\n`);
      } else {
        io.stdout.write(
          `${renderResolvedSummary(
            `${invocationMode === "generate" ? "Generated with" : targetType === "bundle" ? "Added bundle" : "Added package"}`,
            targetId,
            resolvedPackageIds,
            touchedFileList,
            appRoot,
            lockPath,
            externalDependencies
          )}\n`
        );
        if (installWarnings.length > 0) {
          io.stdout.write(`Warnings (${installWarnings.length}):\n`);
          for (const warning of installWarnings) {
            io.stdout.write(`- ${warning}\n`);
          }
        }
        if (stopMessage) {
          io.stdout.write(`${stopMessage}\n`);
        }
        io.stdout.write("Dry run enabled: no files were written.\n");
      }
      return 0;
    }
  }

  for (const packageId of packagesToInstall) {
    const packageEntry = combinedPackageRegistry.get(packageId);
    const managedRecord = await applyPackageInstall({
      packageEntry,
      packageOptions: resolvedOptionsByPackage[packageId],
      appRoot,
      appPackageJson: packageJson,
      lock,
      packageRegistry: combinedPackageRegistry,
      touchedFiles,
      reportTemplateFetchStatus,
      dryRun: options.dryRun === true
    });
    installedPackageRecords.push(managedRecord);
  }

  const {
    appLocalRegistry: refreshedAppLocalRegistry,
    adoptedPackageIds
  } = await adoptAppLocalPackageDependencies({
    appRoot,
    appPackageJson: packageJson,
    lock
  });
  for (const [packageId, packageEntry] of refreshedAppLocalRegistry.entries()) {
    combinedPackageRegistry.set(packageId, packageEntry);
  }
  if (adoptedPackageIds.length > 0) {
    const postInstallPackageIds = sortStrings(Object.keys(ensureObject(lock.installedPackages)));
    validatePlannedCapabilityClosure(
      postInstallPackageIds,
      combinedPackageRegistry,
      `${invocationMode} ${targetType} ${targetId}`
    );
  }

  const finalResolvedPackageIds = sortStrings([...resolvedPackageIds, ...adoptedPackageIds]);

  const generatedPlacementComponentTokens = await resolveProvisionableLocalPlacementComponentTokens({
    appRoot,
    componentTokens: collectPlacementComponentTokensFromManagedRecords(installedPackageRecords)
  });
  if (generatedPlacementComponentTokens.length > 0) {
    await ensureLocalMainPlacementComponentProvisioning({
      appRoot,
      createCliError,
      dryRun: options.dryRun === true,
      touchedFiles,
      componentTokens: generatedPlacementComponentTokens
    });
  }

  const touchedFileList = sortStrings([...touchedFiles]);
  const successLabel = invocationMode === "generate"
    ? "Generated with"
    : targetType === "bundle"
      ? "Added bundle"
      : "Added package";
  const installWarnings = installedPackageRecords
    .flatMap((record) => ensureArray(ensureObject(record).warnings))
    .concat(prepareHookWarnings)
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const finalizeHookRecords = packagesToInstall
    .map((packageId) => {
      const packageEntry = combinedPackageRegistry.get(packageId);
      const finalizeSpec = ensureObject(ensureObject(ensureObject(packageEntry.descriptor).lifecycle).install).finalize;
      if (Object.keys(ensureObject(finalizeSpec)).length < 1) {
        return null;
      }
      return {
        packageEntry,
        hookSpec: finalizeSpec,
        packageOptions: resolvedOptionsByPackage[packageId],
        reason: installReasonByPackage[packageId]
      };
    })
    .filter(Boolean)
    .sort((left, right) => Number(Boolean(right.hookSpec?.managesNpmInstall)) - Number(Boolean(left.hookSpec?.managesNpmInstall)));
  const managesNpmInstall = finalizeHookRecords.some((record) => record.hookSpec?.managesNpmInstall === true);

  if (!options.dryRun) {
    await writeJsonFile(packageJsonPath, packageJson);
    await writeJsonFile(lockPath, lock);
    if (options.runNpmInstall && !managesNpmInstall) {
      await runNpmInstall(appRoot, io.stderr);
    }
    for (const finalizeRecord of finalizeHookRecords) {
      const hookResult = await invokeInstallHook({
        packageEntry: finalizeRecord.packageEntry,
        appRoot,
        hookSpec: finalizeRecord.hookSpec,
        hookLabel: "lifecycle.install.finalize",
        createCliError,
        hookContext: {
          appRoot,
          appPackageJson: packageJson,
          lock,
          packageEntry: finalizeRecord.packageEntry,
          packageOptions: finalizeRecord.packageOptions,
          io,
          dryRun: false,
          reason: finalizeRecord.reason,
          skipManagedFinalize: options.forceReapplyTarget === true && options.runNpmInstall !== true,
          helpers: installHookHelpers
        }
      });
      for (const warning of ensureArray(hookResult.warnings)) {
        const normalizedWarning = String(warning || "").trim();
        if (normalizedWarning) {
          installWarnings.push(normalizedWarning);
        }
      }
    }
  }

  if (options.json) {
    io.stdout.write(`${JSON.stringify({
      targetType: invocationMode === "generate" ? "generator" : targetType,
      targetId,
      resolvedPackages: finalResolvedPackageIds,
      touchedFiles: touchedFileList,
      lockPath: normalizeRelativePath(appRoot, lockPath),
      externalDependencies,
      dryRun: options.dryRun,
      installed: installedPackageRecords,
      warnings: installWarnings
    }, null, 2)}\n`);
  } else {
    io.stdout.write(
      `${renderResolvedSummary(
        `${successLabel}`,
        targetId,
        finalResolvedPackageIds,
        touchedFileList,
        appRoot,
        lockPath,
        externalDependencies
      )}\n`
    );
    if (installWarnings.length > 0) {
      io.stdout.write(`Warnings (${installWarnings.length}):\n`);
      for (const warning of installWarnings) {
        io.stdout.write(`- ${warning}\n`);
      }
    }
    if (options.dryRun) {
      io.stdout.write("Dry run enabled: no files were written.\n");
    }
  }

  return 0;
}

export { runPackageAddCommand };
