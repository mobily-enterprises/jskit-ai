import {
  mkdir,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { discoverShellOutletTargetsFromApp } from "@jskit-ai/kernel/server/support";
import { createCliError } from "../shared/cliError.js";
import {
  createColorFormatter,
  resolveWrapWidth,
  writeWrappedItems
} from "../shared/outputFormatting.js";
import { createCommandHandlers } from "./createCommandHandlers.js";
import { parseArgs } from "./argParser.js";
import { printUsage, shouldShowCommandHelpOnBareInvocation } from "./usageHelp.js";
import { createCommandHandlerDeps } from "./buildCommandDeps.js";
import { createRunCli } from "./dispatchCli.js";
import {
  resolvePackageIdInput,
  resolveInstalledPackageIdInput
} from "../shared/packageIdHelpers.js";
import {
  buildFileWriteGroups,
  fileExists,
  hashBuffer,
  normalizeRelativePath,
  readFileBufferIfExists
} from "../cliRuntime/ioAndMigrations.js";
import {
  resolveAppRootFromCwd,
  loadAppPackageJson,
  loadLockFile,
  applyPackageJsonField,
  restorePackageJsonField,
  removeEnvValue,
  writeJsonFile
} from "../cliRuntime/appState.js";
import {
  mergePackageRegistries,
  loadAppLocalPackageRegistry,
  loadPackageRegistry,
  resolveInstalledNodeModulePackageEntry,
  hydratePackageRegistryFromInstalledNodeModules,
  loadBundleRegistry
} from "../cliRuntime/packageRegistries.js";
import {
  normalizeRelativePosixPath,
  toFileDependencySpecifier,
  resolveLocalPackageId,
  createLocalPackageScaffoldFiles,
  resolveLocalDependencyOrder
} from "../cliRuntime/localPackageSupport.js";
import {
  listDeclaredCapabilities,
  buildCapabilityDetailsForPackage,
  validatePlannedCapabilityClosure
} from "../cliRuntime/capabilitySupport.js";
import {
  classifyExportedSymbols,
  deriveProviderDisplayName,
  formatPackageSubpathImport,
  inspectPackageOfferings,
  normalizePlacementContributions,
  normalizePlacementOutlets,
  shouldShowPackageExportTarget
} from "../cliRuntime/packageIntrospection.js";
import {
  resolvePackageOptions,
  validateInlineOptionsForPackage
} from "../cliRuntime/packageOptions.js";
import {
  cleanupMaterializedPackageRoots
} from "../cliRuntime/packageTemplateResolution.js";
import {
  applyPackageInstall,
  applyPackageMigrationsOnly,
  applyPackagePositioning,
  adoptAppLocalPackageDependencies
} from "../cliRuntime/packageInstallFlow.js";
import {
  removeManagedViteProxyEntries
} from "../cliRuntime/viteProxy.js";

const commandHandlers = createCommandHandlers(
  createCommandHandlerDeps({
    createCliError,
    createColorFormatter,
    resolveWrapWidth,
    writeWrappedItems,
    normalizeRelativePath,
    normalizeRelativePosixPath,
    resolveAppRootFromCwd,
    loadLockFile,
    loadPackageRegistry,
    loadBundleRegistry,
    loadAppLocalPackageRegistry,
    mergePackageRegistries,
    resolvePackageIdInput,
    resolveInstalledPackageIdInput,
    resolveInstalledNodeModulePackageEntry,
    hydratePackageRegistryFromInstalledNodeModules,
    validateInlineOptionsForPackage,
    resolveLocalDependencyOrder,
    validatePlannedCapabilityClosure,
    resolvePackageOptions,
    applyPackageInstall,
    applyPackageMigrationsOnly,
    applyPackagePositioning,
    adoptAppLocalPackageDependencies,
    loadAppPackageJson,
    resolveLocalPackageId,
    createLocalPackageScaffoldFiles,
    fileExists,
    applyPackageJsonField,
    toFileDependencySpecifier,
    writeJsonFile,
    writeFile,
    mkdir,
    path,
    inspectPackageOfferings,
    buildFileWriteGroups,
    listDeclaredCapabilities,
    buildCapabilityDetailsForPackage,
    formatPackageSubpathImport,
    normalizePlacementOutlets,
    normalizePlacementContributions,
    shouldShowPackageExportTarget,
    classifyExportedSymbols,
    deriveProviderDisplayName,
    restorePackageJsonField,
    readFileBufferIfExists,
    removeEnvValue,
    removeManagedViteProxyEntries,
    hashBuffer,
    rm,
    discoverShellOutletTargetsFromApp
  })
);

const runCli = createRunCli({
  parseArgs,
  printUsage,
  shouldShowCommandHelpOnBareInvocation,
  commandHandlers,
  cleanupMaterializedPackageRoots,
  createCliError
});

export { runCli };
