import path from "node:path";
import { spawn } from "node:child_process";
import {
  collectPackageDependencyIds,
  collectRootDependencySpecifiers,
  importFreshModuleFromAbsolutePath
} from "@jskit-ai/kernel/server/support";
import {
  ensureArray,
  ensureObject,
  sortStrings
} from "../../shared/collectionUtils.js";
import { resolveOptionEnvFallbacks } from "../../cliRuntime/sensitiveOptions.js";
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
import { resolvePackageDependencySpecifier } from "../../cliRuntime/localPackageSupport.js";
import {
  applyPackageJsonField,
  removePackageJsonField
} from "../../cliRuntime/appState.js";

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

function orderRuntimePackagesForConfiguration(packageRegistry, requestedPackageIds, resolvePackageKind) {
  const requested = new Set(ensureArray(requestedPackageIds).map((value) => String(value || "").trim()));
  const candidates = new Set(
    [...packageRegistry.entries()]
      .filter(([, packageEntry]) => {
        return resolvePackageKind(packageEntry) === "runtime" &&
          Object.keys(ensureObject(packageEntry?.packageMetadata?.options)).length > 0;
      })
      .map(([packageId]) => packageId)
  );
  const visited = new Set();
  const ordered = [];

  function visit(packageId, { allowRequested = false } = {}) {
    if (visited.has(packageId) || !candidates.has(packageId)) {
      return;
    }
    if (requested.has(packageId) && !allowRequested) {
      return;
    }
    visited.add(packageId);
    const packageEntry = packageRegistry.get(packageId);
    const dependencyIds = new Set();
    for (const sectionName of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      for (const dependencyId of Object.keys(ensureObject(packageEntry?.packageJson?.[sectionName]))) {
        dependencyIds.add(String(dependencyId || "").trim());
      }
    }
    for (const dependencyId of sortStrings([...dependencyIds])) {
      visit(dependencyId);
    }
    ordered.push(packageId);
  }

  for (const packageId of sortStrings([...candidates].filter((packageId) => !requested.has(packageId)))) {
    visit(packageId);
  }
  for (const packageId of sortStrings([...requested])) {
    visit(packageId, { allowRequested: true });
  }
  return ordered;
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
  io,
  pathModule = path,
  createCliError,
  dryRun = false
} = {}) {
  await runLocalProjectBinary("npm", ["install"], {
    appRoot,
    io,
    pathModule,
    createCliError,
    explanation: "[mobile] Installing app dependencies for the mobile shell:",
    dryRun
  });
}

async function resolvePackageOptionInputForInstall({
  packageEntry,
  packageInlineOptions,
  appRoot,
  readFileBufferIfExists
}) {
  const inlineOptions = ensureObject(packageInlineOptions);
  const envFallbacks = await resolveOptionEnvFallbacks({
    packageEntry,
    appRoot,
    optionInput: inlineOptions,
    readFileBufferIfExists
  });
  return {
    ...envFallbacks,
    ...inlineOptions
  };
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
  appPackageJson
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
        io,
        pathModule: ctx.path,
        createCliError: ctx.createCliError,
        dryRun
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
    assertAppCiCanSynchronize,
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
  await assertAppCiCanSynchronize({ appRoot });
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
  const externalDependencies = [];
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
    ensureObject(
      ensureObject(
        ensureObject(combinedPackageRegistry.get(packageId)?.packageMetadata).lifecycle
      ).install
    ).finalize?.managesNpmInstall === true
  );
  let npmInstallRequired = false;
  let installedDependencyState = "";
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

  const resolvedOptionsByPackage = {};
  const configurationOrder = invocationMode === "add"
    ? orderRuntimePackagesForConfiguration(
        configurationRegistry,
        targetPackageIds,
        resolvePackageKind
      )
    : packagesToApply;
  const promptedPackageIds = new Set();
  for (const packageId of configurationOrder) {
    const packageEntry = combinedPackageRegistry.get(packageId);
    const isRequestedPackage = targetPackageIds.includes(packageId);
    const isDirectTargetPackage = targetType === "package" && packageId === resolvedTargetPackageId;
    const packageInlineOptions = isRequestedPackage && targetType === "bundle"
      ? resolveBundleInlineOptionsForPackage(packageEntry, options.inlineOptions)
      : isDirectTargetPackage
        ? ensureObject(options.inlineOptions)
        : {};
    const optionInput = await resolvePackageOptionInputForInstall({
      packageEntry,
      packageInlineOptions,
      appRoot,
      readFileBufferIfExists
    });
    resolvedOptionsByPackage[packageId] = await resolvePackageOptions(
      packageEntry,
      optionInput,
      io,
      {
        appRoot,
        onPrompt: () => promptedPackageIds.add(packageId)
      }
    );
  }
  packagesToApply = [
    ...configurationOrder.filter((packageId) =>
      promptedPackageIds.has(packageId) && !targetPackageIds.includes(packageId)
    ),
    ...packagesToApply
  ];

  for (const packageId of packagesToApply) {
    if (Object.prototype.hasOwnProperty.call(resolvedOptionsByPackage, packageId)) {
      continue;
    }
    const packageEntry = combinedPackageRegistry.get(packageId);
    const packageInlineOptions = targetType === "bundle"
      ? resolveBundleInlineOptionsForPackage(packageEntry, options.inlineOptions)
      : ensureObject(options.inlineOptions);
    const optionInput = await resolvePackageOptionInputForInstall({
      packageEntry,
      packageInlineOptions,
      appRoot,
      readFileBufferIfExists
    });
    resolvedOptionsByPackage[packageId] = await resolvePackageOptions(
      packageEntry,
      optionInput,
      io,
      { appRoot }
    );
  }

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
      hookSpec: ensureObject(ensureObject(ensureObject(packageEntry.packageMetadata).lifecycle).install).prepare,
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
          externalDependencies,
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
            touchedFileList,
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
      const finalizeSpec = ensureObject(ensureObject(ensureObject(packageEntry.packageMetadata).lifecycle).install).finalize;
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

  if (options.dryRun) {
    await synchronizeCiWorkflow({
      appRoot,
      packageRegistry: combinedPackageRegistry,
      installedPackageIds: plannedInstalledPackageIds,
      touchedFiles,
      dryRun: true
    });
  } else {
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
      externalDependencies,
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
        touchedFileList,
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

export {
  orderRuntimePackagesForConfiguration,
  runPackageAddCommand
};
