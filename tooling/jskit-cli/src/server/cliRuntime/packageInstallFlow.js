import { createCliError } from "../shared/cliError.js";
import {
  ensureArray,
  ensureObject
} from "../shared/collectionUtils.js";
import { interpolateOptionValue } from "../shared/optionInterpolation.js";
import {
  normalizeDependencyMutationRecord,
  normalizeFileMutationRecord,
  shouldApplyMutationWhen
} from "./mutationWhen.js";
import { applyViteMutations } from "./viteProxy.js";
import {
  applyPackageJsonField,
  removePackageJsonField
} from "./appState.js";
import { loadMutationWhenConfigContext } from "./ioAndMigrations.js";
import { isGeneratorPackageEntry } from "./packageRegistries.js";
import { resolvePackageDependencySpecifier } from "./localPackageSupport.js";
import { resolvePackageTemplateRoot } from "./packageTemplateResolution.js";
import {
  applyFileMutations,
  applySourceMutations,
  applyTextMutations,
  partitionPreFileConfigSourceMutations,
  partitionPreFileConfigTextMutations,
  prepareFileMutations
} from "./mutationApplication.js";

function createMutationResult(packageEntry) {
  return {
    packageId: packageEntry.packageId,
    version: packageEntry.version,
    changes: {
      packageJson: {
        dependencies: {},
        devDependencies: {},
        scripts: {}
      },
      text: {},
      source: {},
      vite: {},
      files: [],
      migrations: []
    }
  };
}

function recordPackageJsonChange(result, sectionName, key, value) {
  result.changes.packageJson[sectionName][key] = String(value);
}

function normalizeModeToken(value = "") {
  return String(value || "").trim().toLowerCase();
}

function isWorkspaceCapableTenancyMode(value = "") {
  const normalized = normalizeModeToken(value);
  return normalized === "personal" || normalized === "workspaces";
}

async function collectInstallWarnings({
  packageEntry,
  appRoot,
  appPackageJson
}) {
  const warnings = [];
  if (packageEntry?.packageId !== "@jskit-ai/users-core") {
    return warnings;
  }

  const configContext = await loadMutationWhenConfigContext(appRoot);
  const tenancyMode = normalizeModeToken(ensureObject(configContext).merged?.tenancyMode);
  const runtimeDependencies = ensureObject(appPackageJson.dependencies);
  const devDependencies = ensureObject(appPackageJson.devDependencies);
  const hasWorkspacesCore = Boolean(
    runtimeDependencies["@jskit-ai/workspaces-core"] || devDependencies["@jskit-ai/workspaces-core"]
  );

  if (isWorkspaceCapableTenancyMode(tenancyMode) && !hasWorkspacesCore) {
    warnings.push(
      `users-core selected the workspace users scaffold because config.tenancyMode is "${tenancyMode}". ` +
      'Install @jskit-ai/workspaces-core so the app gets the required "app" and "admin" surfaces and workspace helpers.'
    );
  }
  return warnings;
}

function dependencyMutationUsesWhen(entries = []) {
  return entries.some(([, rawDependencySpec]) => {
    const dependencySpec = normalizeDependencyMutationRecord(rawDependencySpec);
    return Boolean(dependencySpec.when);
  });
}

async function applyStatelessPackageMigrations({
  packageEntry,
  packageOptions = {},
  appRoot,
  touchedFiles,
  dryRun = false
}) {
  const templateRoot = await resolvePackageTemplateRoot({ packageEntry, appRoot });
  const packageEntryForMutations = templateRoot === packageEntry.rootDir
    ? packageEntry
    : { ...packageEntry, rootDir: templateRoot };
  const mutations = ensureObject(packageEntry.packageMetadata.mutations);
  const migrationFileMutations = ensureArray(mutations.files).filter((mutationValue) => {
    const normalized = normalizeFileMutationRecord(mutationValue);
    return String(normalized.op || "copy-file").trim() === "install-migration";
  });
  const result = createMutationResult(packageEntry);
  const warnings = [];
  const preparedFileMutations = await prepareFileMutations(
    packageEntryForMutations,
    packageOptions,
    appRoot,
    migrationFileMutations
  );

  await applyFileMutations(
    packageEntryForMutations,
    appRoot,
    preparedFileMutations,
    result.changes.files,
    result.changes.migrations,
    touchedFiles,
    warnings,
    { dryRun }
  );

  if (warnings.length > 0) {
    result.warnings = warnings;
  }
  return result;
}

async function applyPackageInstall({
  packageEntry,
  packageOptions,
  appRoot,
  appPackageJson,
  packageRegistry,
  touchedFiles,
  directInstall = false,
  dryRun = false
}) {
  const generatorPackage = isGeneratorPackageEntry(packageEntry);
  const warnings = [];
  const mutations = ensureObject(packageEntry.packageMetadata.mutations);
  const fileMutations = ensureArray(mutations.files);
  const textMutations = ensureArray(mutations.text);
  const sourceMutations = ensureArray(mutations.source);
  const hasSurfaceTargetedFileMutations = fileMutations.some((mutationValue) =>
    Boolean(normalizeFileMutationRecord(mutationValue).toSurface)
  );
  const {
    preFileTextMutations,
    postFileTextMutations
  } = hasSurfaceTargetedFileMutations
    ? partitionPreFileConfigTextMutations(textMutations)
    : { preFileTextMutations: [], postFileTextMutations: textMutations };
  const {
    preFileSourceMutations,
    postFileSourceMutations
  } = hasSurfaceTargetedFileMutations
    ? partitionPreFileConfigSourceMutations(sourceMutations)
    : { preFileSourceMutations: [], postFileSourceMutations: sourceMutations };
  const templateRoot = await resolvePackageTemplateRoot({
    packageEntry,
    appRoot
  });
  const packageEntryForMutations = templateRoot === packageEntry.rootDir
    ? packageEntry
    : { ...packageEntry, rootDir: templateRoot };
  const result = createMutationResult(packageEntry);

  if (preFileTextMutations.length > 0) {
    await applyTextMutations(
      packageEntryForMutations,
      appRoot,
      preFileTextMutations,
      packageOptions,
      result.changes.text,
      touchedFiles,
      { dryRun }
    );
  }
  if (preFileSourceMutations.length > 0) {
    await applySourceMutations(
      packageEntryForMutations,
      appRoot,
      preFileSourceMutations,
      packageOptions,
      result.changes.source,
      touchedFiles,
      { dryRun }
    );
  }

  const preparedFileMutations = await prepareFileMutations(
    packageEntryForMutations,
    packageOptions,
    appRoot,
    fileMutations
  );
  const mutationDependencies = ensureObject(mutations.dependencies);
  const runtimeDependencyEntries = Object.entries(ensureObject(mutationDependencies.runtime));
  const devDependencyEntries = Object.entries(ensureObject(mutationDependencies.dev));
  const dependencyWhenConfigContext = dependencyMutationUsesWhen([
    ...runtimeDependencyEntries,
    ...devDependencyEntries
  ])
    ? await loadMutationWhenConfigContext(appRoot)
    : {};

  for (const [rawDependencyId, rawDependencySpec] of runtimeDependencyEntries) {
    const dependencySpec = normalizeDependencyMutationRecord(rawDependencySpec);
    if (!shouldApplyMutationWhen(dependencySpec.when, {
      options: packageOptions,
      configContext: dependencyWhenConfigContext,
      packageId: packageEntry.packageId,
      mutationContext: `dependencies.runtime.${rawDependencyId}`
    })) {
      continue;
    }
    const dependencyId = interpolateOptionValue(
      rawDependencyId,
      packageOptions,
      packageEntry.packageId,
      `dependencies.runtime.${rawDependencyId}.id`
    );
    const dependencyVersion = interpolateOptionValue(
      dependencySpec.version,
      packageOptions,
      packageEntry.packageId,
      `dependencies.runtime.${rawDependencyId}.value`
    );
    if (!dependencyId) {
      throw createCliError(
        `Invalid runtime dependency key after option interpolation in ${packageEntry.packageId}: ${rawDependencyId}`
      );
    }
    const localPackage = packageRegistry.get(dependencyId);
    const existingValue = String(ensureObject(appPackageJson.dependencies)[dependencyId] || "").trim();
    const resolvedValue = localPackage
      ? resolvePackageDependencySpecifier(localPackage, { existingValue })
      : String(dependencyVersion);
    if (applyPackageJsonField(appPackageJson, "dependencies", dependencyId, resolvedValue).changed) {
      recordPackageJsonChange(result, "dependencies", dependencyId, resolvedValue);
      touchedFiles.add("package.json");
    }
  }

  for (const [rawDependencyId, rawDependencySpec] of devDependencyEntries) {
    const dependencySpec = normalizeDependencyMutationRecord(rawDependencySpec);
    if (!shouldApplyMutationWhen(dependencySpec.when, {
      options: packageOptions,
      configContext: dependencyWhenConfigContext,
      packageId: packageEntry.packageId,
      mutationContext: `dependencies.dev.${rawDependencyId}`
    })) {
      continue;
    }
    const dependencyId = interpolateOptionValue(
      rawDependencyId,
      packageOptions,
      packageEntry.packageId,
      `dependencies.dev.${rawDependencyId}.id`
    );
    const dependencyVersion = interpolateOptionValue(
      dependencySpec.version,
      packageOptions,
      packageEntry.packageId,
      `dependencies.dev.${rawDependencyId}.value`
    );
    if (!dependencyId) {
      throw createCliError(
        `Invalid dev dependency key after option interpolation in ${packageEntry.packageId}: ${rawDependencyId}`
      );
    }
    const localPackage = packageRegistry.get(dependencyId);
    const existingValue = String(ensureObject(appPackageJson.devDependencies)[dependencyId] || "").trim();
    const resolvedValue = localPackage
      ? resolvePackageDependencySpecifier(localPackage, { existingValue })
      : String(dependencyVersion);
    if (applyPackageJsonField(appPackageJson, "devDependencies", dependencyId, resolvedValue).changed) {
      recordPackageJsonChange(result, "devDependencies", dependencyId, resolvedValue);
      touchedFiles.add("package.json");
    }
  }

  if (directInstall) {
    const sectionName = generatorPackage ? "devDependencies" : "dependencies";
    const otherSectionName = generatorPackage ? "dependencies" : "devDependencies";
    const resolvedValue = resolvePackageDependencySpecifier(packageEntry);
    if (removePackageJsonField(appPackageJson, otherSectionName, packageEntry.packageId)) {
      touchedFiles.add("package.json");
    }
    if (applyPackageJsonField(appPackageJson, sectionName, packageEntry.packageId, resolvedValue).changed) {
      recordPackageJsonChange(result, sectionName, packageEntry.packageId, resolvedValue);
      touchedFiles.add("package.json");
    }
  }

  for (const [scriptName, scriptValue] of Object.entries(ensureObject(ensureObject(mutations.packageJson).scripts))) {
    if (applyPackageJsonField(appPackageJson, "scripts", scriptName, scriptValue).changed) {
      recordPackageJsonChange(result, "scripts", scriptName, scriptValue);
      touchedFiles.add("package.json");
    }
  }

  await applyFileMutations(
    packageEntryForMutations,
    appRoot,
    preparedFileMutations,
    result.changes.files,
    result.changes.migrations,
    touchedFiles,
    warnings,
    { dryRun }
  );
  await applyTextMutations(
    packageEntryForMutations,
    appRoot,
    postFileTextMutations,
    packageOptions,
    result.changes.text,
    touchedFiles,
    { dryRun }
  );
  await applySourceMutations(
    packageEntryForMutations,
    appRoot,
    postFileSourceMutations,
    packageOptions,
    result.changes.source,
    touchedFiles,
    { dryRun }
  );
  await applyViteMutations(
    packageEntryForMutations,
    appRoot,
    ensureObject(mutations.vite),
    packageOptions,
    result.changes.vite,
    touchedFiles,
    { dryRun }
  );

  warnings.push(...await collectInstallWarnings({ packageEntry, appRoot, appPackageJson }));
  if (warnings.length > 0) {
    result.warnings = warnings;
  }
  return result;
}

export {
  applyPackageInstall,
  applyStatelessPackageMigrations
};
