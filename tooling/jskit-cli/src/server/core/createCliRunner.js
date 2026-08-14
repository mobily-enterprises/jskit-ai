import {
  mkdir,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import {
  discoverPlacementTopologyFromApp,
  discoverShellOutletSourcePathsFromApp,
  discoverShellOutletTargetsFromApp
} from "@jskit-ai/kernel/server/support";
import { createCliError } from "../shared/cliError.js";
import {
  createColorFormatter,
  resolveWrapWidth,
  writeWrappedItems
} from "../shared/outputFormatting.js";
import { createCommandHandlers } from "./createCommandHandlers.js";
import { parseArgs } from "./argParser.js";
import { printUsage, shouldShowCommandHelpOnBareInvocation } from "./usageHelp.js";
import {
  resolveCommandDescriptor,
  validateCommandOptions
} from "./commandCatalog.js";
import { createCommandHandlerDeps } from "./buildCommandDeps.js";
import { createRunCli } from "./dispatchCli.js";
import {
  resolvePackageIdInput,
  resolveInstalledPackageIdInput
} from "../shared/packageIdHelpers.js";
import {
  buildFileWriteGroups,
  fileExists,
  normalizeMigrationId,
  normalizeRelativePath,
  readFileBufferIfExists,
  writeJsonFile
} from "../cliRuntime/ioAndMigrations.js";
import {
  directoryLooksLikeJskitAppRoot,
  resolveAppRootFromCwd,
  loadAppPackageJson,
  applyPackageJsonField,
  removePackageJsonField
} from "../cliRuntime/appState.js";
import {
  mergePackageRegistries,
  loadAppLocalPackageRegistry,
  loadPackageRegistry,
  resolveInstalledNodeModulePackageEntry,
  hydratePackageRegistryFromInstalledNodeModules,
  loadBundleRegistry,
  loadInstalledAppPackageRegistry,
  installedPackageRecordFromRegistry
} from "../cliRuntime/packageRegistries.js";
import {
  normalizeRelativePosixPath,
  toFileDependencySpecifier,
  resolveLocalPackageId,
  createLocalPackageScaffoldFiles
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
  validateInlineOptionsForPackage,
  validateInlineOptionValuesForPackage
} from "../cliRuntime/packageOptions.js";
import {
  resolvePackageTemplateRoot,
  cleanupPackageRootCaches
} from "../cliRuntime/packageTemplateResolution.js";
import {
  applyPackageInstall,
  applyStatelessPackageMigrations
} from "../cliRuntime/packageInstallFlow.js";
import {
  composeInstalledPackageCi,
  synchronizeAppCiWorkflow,
  synchronizeCiWorkflow
} from "../cliRuntime/ci/managedWorkflow.js";

const commandHandlers = createCommandHandlers(
  createCommandHandlerDeps({
    createCliError,
    createColorFormatter,
    resolveWrapWidth,
    writeWrappedItems,
    normalizeRelativePath,
    normalizeRelativePosixPath,
    directoryLooksLikeJskitAppRoot,
    resolveAppRootFromCwd,
    loadPackageRegistry,
    loadBundleRegistry,
    loadInstalledAppPackageRegistry,
    installedPackageRecordFromRegistry,
    loadAppLocalPackageRegistry,
    mergePackageRegistries,
    resolvePackageIdInput,
    resolveInstalledPackageIdInput,
    resolveInstalledNodeModulePackageEntry,
    hydratePackageRegistryFromInstalledNodeModules,
    resolvePackageTemplateRoot,
    validateInlineOptionsForPackage,
    validateInlineOptionValuesForPackage,
    validatePlannedCapabilityClosure,
    resolvePackageOptions,
    applyPackageInstall,
    applyStatelessPackageMigrations,
    composeInstalledPackageCi,
    synchronizeAppCiWorkflow,
    synchronizeCiWorkflow,
    loadAppPackageJson,
    resolveLocalPackageId,
    createLocalPackageScaffoldFiles,
    normalizeMigrationId,
    fileExists,
    applyPackageJsonField,
    removePackageJsonField,
    toFileDependencySpecifier,
    writeJsonFile,
    writeFile,
    rename,
    mkdir,
    readdir,
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
    readFileBufferIfExists,
    rm,
    discoverShellOutletSourcePathsFromApp,
    discoverShellOutletTargetsFromApp,
    discoverPlacementTopologyFromApp
  })
);

const runCli = createRunCli({
  parseArgs,
  printUsage,
  shouldShowCommandHelpOnBareInvocation,
  validateCommandOptions,
  resolveCommandDescriptor,
  commandHandlers,
  cleanupPackageRootCaches,
  createCliError
});

export { runCli };
