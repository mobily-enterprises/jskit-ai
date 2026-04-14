import { spawn } from "node:child_process";
import { importFreshModuleFromAbsolutePath } from "@jskit-ai/kernel/server/support";
import {
  ensureArray,
  ensureObject,
  sortStrings
} from "../shared/collectionUtils.js";
import {
  ensureLocalMainPlacementComponentProvisioning,
  resolveProvisionableLocalPlacementComponentTokens
} from "./packageCommands/tabLinkItemProvisioning.js";

function createCommandHandlerShared(ctx = {}) {
  const {
    createCliError,
    normalizeRelativePath,
    resolvePackageIdInput,
    resolveInstalledNodeModulePackageEntry,
    path,
    fileExists
  } = ctx;

  function renderResolvedSummary(commandType, targetId, resolvedPackageIds, touchedFiles, appRoot, lockPath, externalDependencies) {
    const lines = [];
    lines.push(`${commandType} ${targetId}.`);
    lines.push(`Resolved packages (${resolvedPackageIds.length}):`);
    for (const packageId of resolvedPackageIds) {
      lines.push(`- ${packageId}`);
    }

    if (externalDependencies.length > 0) {
      lines.push(`External dependencies (${externalDependencies.length}):`);
      for (const dependencyId of externalDependencies) {
        lines.push(`- ${dependencyId}`);
      }
    }

    lines.push(`Touched files (${touchedFiles.length}):`);
    for (const touchedFile of touchedFiles) {
      lines.push(`- ${touchedFile}`);
    }
    lines.push(`Lock file: ${normalizeRelativePath(appRoot, lockPath)}`);
    return lines.join("\n");
  }

  function createCatalogFetchStatusReporter(io = {}, { enabled = true } = {}) {
    if (enabled !== true) {
      return () => {};
    }

    const stdout = io?.stdout;
    if (!stdout || typeof stdout.write !== "function") {
      return () => {};
    }

    const activeFetchLabels = new Set();
    return ({ packageEntry, state } = {}) => {
      const packageId = String(packageEntry?.packageId || "").trim();
      const version = String(packageEntry?.version || "").trim();
      const packageLabel = version ? `${packageId}@${version}` : packageId;
      if (!packageLabel) {
        return;
      }

      if (state === "start") {
        if (activeFetchLabels.has(packageLabel)) {
          return;
        }
        activeFetchLabels.add(packageLabel);
        stdout.write(`Fetching ${packageLabel}...\n`);
        return;
      }

      if (state === "complete") {
        if (!activeFetchLabels.has(packageLabel)) {
          return;
        }
        activeFetchLabels.delete(packageLabel);
        stdout.write(`Fetching ${packageLabel}... done!\n`);
      }
    };
  }

  async function runNpmInstall(appRoot, stderr) {
    await new Promise((resolve, reject) => {
      const child = spawn("npm", ["install"], {
        cwd: appRoot,
        stdio: "inherit"
      });

      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(createCliError(`npm install failed with exit code ${code}.`));
        }
      });
    }).catch((error) => {
      stderr.write(`npm install failed: ${error.message}\n`);
      throw error;
    });
  }

  function getInstalledDependents(lock, packageId, packageRegistry) {
    const dependents = [];
    const installedPackageIds = Object.keys(ensureObject(lock.installedPackages));

    for (const installedId of installedPackageIds) {
      if (installedId === packageId) {
        continue;
      }
      const packageEntry = packageRegistry.get(installedId);
      if (!packageEntry) {
        continue;
      }
      const dependencies = ensureArray(packageEntry.descriptor.dependsOn).map((value) => String(value));
      if (dependencies.includes(packageId)) {
        dependents.push(installedId);
      }
    }

    return sortStrings(dependents);
  }

  function resolvePackageKind(packageEntry) {
    const descriptor = ensureObject(packageEntry?.descriptor);
    const normalizedKind = String(descriptor.kind || "").trim().toLowerCase();
    if (normalizedKind === "runtime" || normalizedKind === "generator") {
      return normalizedKind;
    }
    const packageId = String(packageEntry?.packageId || descriptor.packageId || "unknown-package").trim();
    throw createCliError(
      `Invalid package descriptor for ${packageId}: missing/invalid kind (expected runtime or generator).`
    );
  }

  function resolvePackageOptionNames(packageEntry) {
    const optionSchemas = ensureObject(packageEntry?.descriptor?.options);
    return Object.keys(optionSchemas);
  }

  function resolveBundleInlineOptionsForPackage(packageEntry, inlineOptions) {
    const allowedOptionNames = new Set(resolvePackageOptionNames(packageEntry));
    const resolved = {};

    for (const [optionName, optionValue] of Object.entries(ensureObject(inlineOptions))) {
      if (!allowedOptionNames.has(optionName)) {
        continue;
      }
      resolved[optionName] = String(optionValue || "").trim();
    }

    return resolved;
  }

  function resolveGeneratorSubcommands(packageEntry) {
    const descriptor = ensureObject(packageEntry?.descriptor);
    const metadata = ensureObject(descriptor.metadata);
    return ensureObject(metadata.generatorSubcommands || descriptor.generatorSubcommands);
  }

  function resolveGeneratorSubcommandDefinition(packageEntry, subcommandName) {
    const subcommands = resolveGeneratorSubcommands(packageEntry);
    const definition = ensureObject(subcommands[subcommandName]);
    const entrypoint = String(definition.entrypoint || "").trim();
    const exportName = String(definition.export || "runGeneratorSubcommand").trim() || "runGeneratorSubcommand";
    if (!entrypoint) {
      throw createCliError(
        `Generator ${packageEntry?.packageId || "unknown"} does not define subcommand "${subcommandName}".`
      );
    }

    return Object.freeze({
      entrypoint,
      exportName
    });
  }

  function hasGeneratorSubcommandDefinition(packageEntry, subcommandName) {
    const subcommands = resolveGeneratorSubcommands(packageEntry);
    const normalizedSubcommandName = String(subcommandName || "").trim();
    if (!normalizedSubcommandName) {
      return false;
    }

    const definition = ensureObject(subcommands[normalizedSubcommandName]);
    return String(definition.entrypoint || "").trim().length > 0;
  }

  function resolveGeneratorPrimarySubcommand(packageEntry) {
    const descriptor = ensureObject(packageEntry?.descriptor);
    const metadata = ensureObject(descriptor.metadata);
    return String(metadata.generatorPrimarySubcommand || descriptor.generatorPrimarySubcommand || "")
      .trim()
      .toLowerCase();
  }

  async function resolvePackageIdFromRegistryOrNodeModules({
    appRoot,
    packageRegistry,
    packageIdInput
  }) {
    let resolvedPackageId = resolvePackageIdInput(packageIdInput, packageRegistry);
    const packageIdForNodeModulesLookup = resolvedPackageId || packageIdInput;
    const installedNodeModuleEntry = await resolveInstalledNodeModulePackageEntry({
      appRoot,
      packageId: packageIdForNodeModulesLookup
    });
    if (installedNodeModuleEntry) {
      packageRegistry.set(installedNodeModuleEntry.packageId, installedNodeModuleEntry);
      resolvedPackageId = installedNodeModuleEntry.packageId;
    }

    return resolvedPackageId;
  }

  async function runGeneratorSubcommand({
    packageEntry,
    subcommandName,
    subcommandArgs = [],
    inlineOptions = {},
    appRoot,
    io,
    dryRun = false,
    json = false
  }) {
    const normalizedSubcommandName = String(subcommandName || "").trim();
    if (!normalizedSubcommandName) {
      throw createCliError("Generator subcommand name is required.");
    }

    const packageId = String(packageEntry?.packageId || "").trim();
    const packageRoot = String(packageEntry?.rootDir || "").trim();
    if (!packageRoot) {
      throw createCliError(`Could not resolve package root for generator ${packageId || "<unknown>"}.`);
    }

    const definition = resolveGeneratorSubcommandDefinition(packageEntry, normalizedSubcommandName);
    const entrypointPath = path.resolve(packageRoot, definition.entrypoint);
    if (!(await fileExists(entrypointPath))) {
      throw createCliError(
        `Generator subcommand entrypoint not found: ${normalizeRelativePath(appRoot, entrypointPath)}`
      );
    }

    let moduleNamespace = null;
    try {
      moduleNamespace = await importFreshModuleFromAbsolutePath(entrypointPath);
    } catch (error) {
      throw createCliError(
        `Unable to load generator subcommand entrypoint ${normalizeRelativePath(appRoot, entrypointPath)}: ${String(error?.message || error || "unknown error")}`
      );
    }

    const handler =
      (typeof moduleNamespace?.[definition.exportName] === "function" && moduleNamespace[definition.exportName]) ||
      (typeof moduleNamespace?.default === "function" && moduleNamespace.default) ||
      null;
    if (!handler) {
      throw createCliError(
        `Generator subcommand "${normalizedSubcommandName}" export "${definition.exportName}" was not found in ${normalizeRelativePath(appRoot, entrypointPath)}.`
      );
    }

    const result = await handler({
      appRoot,
      packageId,
      subcommand: normalizedSubcommandName,
      args: ensureArray(subcommandArgs).map((value) => String(value || "")),
      options: ensureObject(inlineOptions),
      dryRun: dryRun === true
    });
    const payload = ensureObject(result);
    const touchedFileSet = new Set(
      ensureArray(payload.touchedFiles).map((value) => String(value || "").trim()).filter(Boolean)
    );
    const placementComponentTokens = await resolveProvisionableLocalPlacementComponentTokens({
      appRoot,
      componentTokens: ensureArray(payload.placementComponentTokens)
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    });
    if (placementComponentTokens.length > 0) {
      await ensureLocalMainPlacementComponentProvisioning({
        appRoot,
        createCliError,
        dryRun: dryRun === true,
        touchedFiles: touchedFileSet,
        componentTokens: placementComponentTokens
      });
    }
    const touchedFiles = sortStrings([...touchedFileSet]);
    const summary = String(payload.summary || "").trim();

    if (json) {
      io.stdout.write(`${JSON.stringify({
        targetType: "generator-subcommand",
        packageId,
        subcommand: normalizedSubcommandName,
        touchedFiles,
        summary,
        dryRun: dryRun === true
      }, null, 2)}\n`);
    } else {
      io.stdout.write(`Generated with ${packageId} (${normalizedSubcommandName}).\n`);
      if (summary) {
        io.stdout.write(`${summary}\n`);
      }
      io.stdout.write(`Touched files (${touchedFiles.length}):\n`);
      for (const touchedFile of touchedFiles) {
        io.stdout.write(`- ${touchedFile}\n`);
      }
      if (dryRun) {
        io.stdout.write("Dry run enabled: no files were written.\n");
      }
    }

    return 0;
  }

  function validateInlineOptionsForBundle({
    bundleId,
    inlineOptions,
    packageIds,
    packageRegistry
  }) {
    const providedOptionNames = Object.keys(ensureObject(inlineOptions));
    if (providedOptionNames.length < 1) {
      return;
    }

    const allowedOptionNames = new Set();
    for (const packageId of ensureArray(packageIds).map((value) => String(value || "").trim()).filter(Boolean)) {
      const packageEntry = packageRegistry.get(packageId);
      if (!packageEntry) {
        continue;
      }
      for (const optionName of resolvePackageOptionNames(packageEntry)) {
        allowedOptionNames.add(optionName);
      }
    }

    const unknownOptionNames = providedOptionNames.filter((optionName) => !allowedOptionNames.has(optionName));
    if (unknownOptionNames.length < 1) {
      return;
    }

    const sortedUnknown = sortStrings(unknownOptionNames);
    const sortedAllowed = sortStrings([...allowedOptionNames]);
    const suffix = sortedAllowed.length > 0
      ? ` Allowed options: ${sortedAllowed.join(", ")}.`
      : " This bundle does not accept inline options.";
    throw createCliError(`Unknown option(s) for bundle ${bundleId}: ${sortedUnknown.join(", ")}.${suffix}`);
  }

  return {
    renderResolvedSummary,
    createCatalogFetchStatusReporter,
    runNpmInstall,
    getInstalledDependents,
    resolvePackageKind,
    resolveBundleInlineOptionsForPackage,
    resolveGeneratorSubcommandDefinition,
    hasGeneratorSubcommandDefinition,
    resolveGeneratorPrimarySubcommand,
    resolvePackageIdFromRegistryOrNodeModules,
    runGeneratorSubcommand,
    validateInlineOptionsForBundle
  };
}

export { createCommandHandlerShared };
