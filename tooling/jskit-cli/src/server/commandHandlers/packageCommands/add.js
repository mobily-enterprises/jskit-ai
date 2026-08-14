import path from "node:path";
import {
  collectPackageDependencyIds,
  collectRootDependencySpecifiers
} from "@jskit-ai/kernel/server/support";
import {
  ensureArray,
  ensureObject,
  sortStrings
} from "../../shared/collectionUtils.js";
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
import { resolvePackageDependencySpecifier } from "../../cliRuntime/localPackageSupport.js";
import {
  applyPackageJsonField,
  removePackageJsonField
} from "../../cliRuntime/appState.js";
import { resolvePackageConfiguration } from "./packageConfiguration.js";
import {
  createInstallHookHelpers,
  invokeInstallHook,
  packageManagesNpmInstall,
  resolveInstallHookSpec
} from "./packageInstallLifecycle.js";
import { synchronizeInstalledMigrations } from "../../cliRuntime/migrationSync.js";

const COMPONENT_TOKEN_PATTERN = /\bcomponentToken\s*:\s*["']([^"']+)["']/g;

async function resolveAvailablePackageSource({ packageEntry, appRoot }) {
  try {
    return await resolvePackageTemplateRoot({ packageEntry, appRoot });
  } catch {
    return "";
  }
}

function withResolvedPackageSource({ packageEntry, packageRoot, appRoot }) {
  if (!packageRoot || String(packageEntry?.rootDir || "").trim()) {
    return packageEntry;
  }
  const relativePath = path.relative(appRoot, packageRoot).split(path.sep).join("/");
  return {
    ...packageEntry,
    rootDir: packageRoot,
    relativeDir: relativePath,
    sourceType: "local-package",
    source: {
      type: "local-package",
      packagePath: relativePath,
      manifestPath: `${relativePath}/package.json`
    }
  };
}

function declareDirectPackageDependency({ packageEntry, packageJson, packageKind }) {
  const sectionName = packageKind === "generator" ? "devDependencies" : "dependencies";
  const otherSectionName = packageKind === "generator" ? "dependencies" : "devDependencies";
  const specifier = resolvePackageDependencySpecifier(packageEntry);
  const changed = applyPackageJsonField(
    packageJson,
    sectionName,
    packageEntry.packageId,
    specifier
  ).changed;
  return removePackageJsonField(packageJson, otherSectionName, packageEntry.packageId) || changed;
}

function serializeDependencyState(packageJson = {}) {
  return JSON.stringify({
    dependencies: ensureObject(packageJson.dependencies),
    devDependencies: ensureObject(packageJson.devDependencies),
    optionalDependencies: ensureObject(packageJson.optionalDependencies),
    peerDependencies: ensureObject(packageJson.peerDependencies)
  });
}

function collectPlannedRuntimePackageIds({ packageJson, packageRegistry, targetPackageIds, resolvePackageKind }) {
  const queue = [
    ...collectRootDependencySpecifiers(packageJson).keys(),
    ...targetPackageIds
  ];
  const visited = new Set();

  while (queue.length > 0) {
    const packageId = String(queue.shift() || "").trim();
    if (!packageId || visited.has(packageId)) {
      continue;
    }
    const packageEntry = packageRegistry.get(packageId);
    if (!packageEntry || resolvePackageKind(packageEntry) === "generator") {
      continue;
    }
    visited.add(packageId);
    for (const dependencyId of collectPackageDependencyIds(packageEntry.packageJson)) {
      if (packageRegistry.has(dependencyId) && !visited.has(dependencyId)) {
        queue.push(dependencyId);
      }
    }
  }

  return sortStrings([...visited]);
}

function collectPlacementComponentTokensFromMutationResults(mutationResults = []) {
  const collectedTokens = new Set();

  for (const result of ensureArray(mutationResults)) {
    const textMutations = ensureObject(ensureObject(ensureObject(result).changes).text);
    for (const mutationRecord of Object.values(textMutations)) {
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

async function runPackageAddCommand(ctx = {}, { positional, options, cwd, io }) {
  const {
    createCliError,
    resolveAppRootFromCwd,
    loadPackageRegistry,
    loadInstalledAppPackageRegistry,
    loadAppLocalPackageRegistry,
    loadBundleRegistry,
    mergePackageRegistries,
    loadAppPackageJson,
    resolvePackageIdFromRegistryOrNodeModules,
    hydratePackageRegistryFromInstalledNodeModules,
    resolvePackageKind,
    validateInlineOptionsForPackage,
    validatePlannedCapabilityClosure,
    validateInlineOptionsForBundle,
    resolveBundleInlineOptionsForPackage,
    resolvePackageOptions,
    applyPackageInstall,
    composeInstalledPackageCi,
    synchronizeAppCiWorkflow,
    synchronizeCiWorkflow,
    writeJsonFile,
    readFileBufferIfExists,
    runNpmInstall,
    renderResolvedSummary
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
        `Unknown package: ${addPackageHelpTargetId}. Install an external module first if you want JSKIT to inspect its package metadata.`
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
  const installedPackageRegistry = await loadInstalledAppPackageRegistry(appRoot);
  const bundleRegistry = await loadBundleRegistry();
  const combinedPackageRegistry = mergePackageRegistries(
    packageRegistry,
    appLocalRegistry,
    installedPackageRegistry
  );
  const { packageJsonPath, packageJson } = await loadAppPackageJson(appRoot);
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
      `Unknown package: ${targetId}. Install an external module first if you want JSKIT to inspect its package metadata.`
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

  const resolvedPackageIds = sortStrings([...new Set(targetPackageIds)]);
  const preflightRuntimePackageIds = collectPlannedRuntimePackageIds({
    packageJson,
    packageRegistry: combinedPackageRegistry,
    targetPackageIds: resolvedPackageIds,
    resolvePackageKind
  });
  validatePlannedCapabilityClosure(
    preflightRuntimePackageIds,
    combinedPackageRegistry,
    `${invocationMode} ${targetType} ${targetId}`
  );
  composeInstalledPackageCi({
    packageRegistry: combinedPackageRegistry,
    installedPackageIds: preflightRuntimePackageIds
  });
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
  const installedPackageIds = new Set(installedPackageRegistry.keys());
  let packagesToApply = resolvedPackageIds.filter((packageId) => {
    const packageEntry = combinedPackageRegistry.get(packageId);
    const isExplicitPackageTarget = targetType === "package" && packageId === resolvedTargetPackageId;
    return (
      resolvePackageKind(packageEntry) === "generator" ||
      isExplicitPackageTarget ||
      !installedPackageIds.has(packageId)
    );
  });
  if (targetType === "bundle") {
    validateInlineOptionsForBundle({
      bundleId: targetId,
      inlineOptions: options.inlineOptions,
      packageIds: resolvedPackageIds,
      packageRegistry: combinedPackageRegistry
    });
  }

  const touchedFiles = new Set();
  const packageSourcesToInstall = [];
  const targetManagesNpmInstall = targetPackageIds.some((packageId) =>
    packageManagesNpmInstall(combinedPackageRegistry.get(packageId))
  );
  let npmInstallRequired = false;
  let installedDependencyState = serializeDependencyState(packageJson);
  for (const packageId of targetPackageIds) {
    const packageEntry = combinedPackageRegistry.get(packageId);
    if (!packageEntry) {
      continue;
    }
    const packageRoot = await resolveAvailablePackageSource({ packageEntry, appRoot });
    const resolvedPackageEntry = withResolvedPackageSource({
      packageEntry,
      packageRoot,
      appRoot
    });
    combinedPackageRegistry.set(packageId, resolvedPackageEntry);
    const dependencyChanged = declareDirectPackageDependency({
      packageEntry: resolvedPackageEntry,
      packageJson,
      packageKind: resolvePackageKind(resolvedPackageEntry)
    });
    if (dependencyChanged) {
      touchedFiles.add("package.json");
    }
    if (!packageRoot && options.dryRun === true) {
      throw createCliError(
        `Cannot dry-run ${packageId} before it is installed. Run npm install --save-exact ${packageId}@${packageEntry.version}, then retry.`
      );
    }
    if (dependencyChanged || !packageRoot) {
      npmInstallRequired = true;
    }
    if (!packageRoot) {
      packageSourcesToInstall.push(packageId);
    }
  }

  if (npmInstallRequired && options.dryRun !== true && !targetManagesNpmInstall) {
    await writeJsonFile(packageJsonPath, packageJson);
    await runNpmInstall(appRoot, io.stderr);
    installedDependencyState = serializeDependencyState(packageJson);
    await hydratePackageRegistryFromInstalledNodeModules({
      appRoot,
      packageRegistry: combinedPackageRegistry,
      seedPackageIds: resolvedPackageIds,
      preferInstalledPackages: true
    });
    for (const packageId of packageSourcesToInstall) {
      const installedEntry = combinedPackageRegistry.get(packageId);
      if (
        !installedEntry ||
        !String(installedEntry.rootDir || "").trim() ||
        installedEntry.sourceType === "catalog"
      ) {
        throw createCliError(
          `npm install completed without an installed JSKIT package manifest for ${packageId}.`
        );
      }
    }
  }

  const refreshedInstalledRegistry = options.dryRun === true
    ? installedPackageRegistry
    : await loadInstalledAppPackageRegistry(appRoot);
  for (const [packageId, packageEntry] of refreshedInstalledRegistry.entries()) {
    combinedPackageRegistry.set(packageId, packageEntry);
  }
  await synchronizeInstalledMigrations(ctx, {
    appRoot,
    check: true
  });
  const plannedInstalledPackageIds = sortStrings([...new Set([
    ...refreshedInstalledRegistry.keys(),
    ...resolvedPackageIds.filter((packageId) =>
      resolvePackageKind(combinedPackageRegistry.get(packageId)) !== "generator"
    )
  ])]);
  validatePlannedCapabilityClosure(
    plannedInstalledPackageIds,
    combinedPackageRegistry,
    `${invocationMode} ${targetType} ${targetId}`
  );
  for (const packageId of plannedInstalledPackageIds) {
    const packageEntry = combinedPackageRegistry.get(packageId);
    if (!packageEntry) {
      throw createCliError(
        `[ci:metadata-missing] Installed package metadata not found for ${packageId}. Run npm install before changing package requirements.`
      );
    }
  }
  composeInstalledPackageCi({
    packageRegistry: combinedPackageRegistry,
    installedPackageIds: plannedInstalledPackageIds
  });

  const configurationRegistry = new Map();
  if (invocationMode === "add") {
    for (const [packageId, packageEntry] of refreshedInstalledRegistry.entries()) {
      configurationRegistry.set(packageId, packageEntry);
    }
    for (const packageId of targetPackageIds) {
      const packageEntry = combinedPackageRegistry.get(packageId);
      if (packageEntry) {
        configurationRegistry.set(packageId, packageEntry);
      }
    }
  }

  const packageConfiguration = await resolvePackageConfiguration({
    packageRegistry: combinedPackageRegistry,
    configurationRegistry,
    requestedPackageIds: targetPackageIds,
    packagesToApply,
    invocationMode,
    targetType,
    resolvedTargetPackageId,
    inlineOptions: options.inlineOptions,
    resolvePackageKind,
    resolveBundleInlineOptionsForPackage,
    resolvePackageOptions,
    appRoot,
    readFileBufferIfExists,
    io
  });
  packagesToApply = packageConfiguration.packagesToApply;
  const { resolvedOptionsByPackage } = packageConfiguration;

  const mutationResults = [];
  const prepareHookWarnings = [];
  const installHookHelpers = createInstallHookHelpers({
    ctx,
    appRoot,
    io,
    appPackageJson: packageJson
  });

  for (const packageId of packagesToApply) {
    const packageEntry = combinedPackageRegistry.get(packageId);
    const hookResult = await invokeInstallHook({
      packageEntry,
      appRoot,
      hookSpec: resolveInstallHookSpec(packageEntry, "prepare"),
      hookLabel: "lifecycle.install.prepare",
      createCliError,
      hookContext: {
        appRoot,
        appPackageJson: packageJson,
        packageEntry,
        packageOptions: resolvedOptionsByPackage[packageId],
        io,
        dryRun: options.dryRun === true,
        reason: "install",
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
          dryRun: options.dryRun,
          applied: [],
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
            touchedFileList
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

  for (const packageId of packagesToApply) {
    const packageEntry = combinedPackageRegistry.get(packageId);
    const managedRecord = await applyPackageInstall({
      packageEntry,
      packageOptions: resolvedOptionsByPackage[packageId],
      appRoot,
      appPackageJson: packageJson,
      packageRegistry: combinedPackageRegistry,
      touchedFiles,
      directInstall: targetPackageIds.includes(packageId),
      dryRun: options.dryRun === true
    });
    mutationResults.push(managedRecord);
  }

  const generatedPlacementComponentTokens = await resolveProvisionableLocalPlacementComponentTokens({
    appRoot,
    componentTokens: collectPlacementComponentTokensFromMutationResults(mutationResults)
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

  const successLabel = invocationMode === "generate"
    ? "Generated with"
    : targetType === "bundle"
      ? "Added bundle"
      : "Added package";
  const installWarnings = mutationResults
    .flatMap((record) => ensureArray(ensureObject(record).warnings))
    .concat(prepareHookWarnings)
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const finalizeHookRecords = packagesToApply
    .map((packageId) => {
      const packageEntry = combinedPackageRegistry.get(packageId);
      const finalizeSpec = resolveInstallHookSpec(packageEntry, "finalize");
      if (Object.keys(ensureObject(finalizeSpec)).length < 1) {
        return null;
      }
      return {
        packageEntry,
        hookSpec: finalizeSpec,
        packageOptions: resolvedOptionsByPackage[packageId],
        reason: "install"
      };
    })
    .filter(Boolean)
    .sort((left, right) => Number(Boolean(right.hookSpec?.managesNpmInstall)) - Number(Boolean(left.hookSpec?.managesNpmInstall)));
  const managesNpmInstall = finalizeHookRecords.some((record) => record.hookSpec?.managesNpmInstall === true);

  if (!options.dryRun) {
    await writeJsonFile(packageJsonPath, packageJson);
    const nextDependencyState = serializeDependencyState(packageJson);
    if (!managesNpmInstall && nextDependencyState !== installedDependencyState) {
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
          packageEntry: finalizeRecord.packageEntry,
          packageOptions: finalizeRecord.packageOptions,
          io,
          dryRun: false,
          reason: finalizeRecord.reason,
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

  const migrationResult = await synchronizeInstalledMigrations(ctx, {
    appRoot,
    check: options.dryRun === true
  });
  for (const changedFile of migrationResult.changedFiles) {
    touchedFiles.add(changedFile);
  }

  if (options.dryRun) {
    await synchronizeCiWorkflow({
      appRoot,
      packageRegistry: combinedPackageRegistry,
      installedPackageIds: plannedInstalledPackageIds,
      touchedFiles,
      dryRun: true
    });
  } else {
    const ciResult = await synchronizeAppCiWorkflow({ appRoot });
    if (ciResult.changed) {
      touchedFiles.add(ciResult.path);
    }
  }

  const touchedFileList = sortStrings([...touchedFiles]);

  if (options.json) {
    io.stdout.write(`${JSON.stringify({
      targetType: invocationMode === "generate" ? "generator" : targetType,
      targetId,
      resolvedPackages: resolvedPackageIds,
      touchedFiles: touchedFileList,
      dryRun: options.dryRun,
      applied: mutationResults,
      warnings: installWarnings
    }, null, 2)}\n`);
  } else {
    io.stdout.write(
      `${renderResolvedSummary(
        `${successLabel}`,
        targetId,
        resolvedPackageIds,
        touchedFileList
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

export {
  runPackageAddCommand
};
