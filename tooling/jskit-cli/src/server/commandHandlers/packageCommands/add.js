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
    const packageInlineOptions = targetType === "bundle"
      ? resolveBundleInlineOptionsForPackage(packageEntry, options.inlineOptions)
      : isDirectTargetPackage
        ? ensureObject(options.inlineOptions)
        : {};
    const hasPackageInlineOptions = Object.keys(packageInlineOptions).length > 0;
    const shouldReapplyInstalledPackage =
      (isDirectTargetPackage && (forceReapplyTarget || hasInlineOptions)) ||
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
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  if (!options.dryRun) {
    await writeJsonFile(packageJsonPath, packageJson);
    await writeJsonFile(lockPath, lock);
    if (options.runNpmInstall) {
      await runNpmInstall(appRoot, io.stderr);
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
