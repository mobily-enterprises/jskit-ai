import { createCliError } from "../shared/cliError.js";
import {
  ensureArray,
  ensureObject,
  sortStrings
} from "../shared/collectionUtils.js";
import {
  interpolateOptionValue
} from "../shared/optionInterpolation.js";
import {
  normalizeFileMutationRecord
} from "./mutationWhen.js";
import {
  applyViteMutations,
  removeManagedViteProxyEntries
} from "./viteProxy.js";
import {
  applyPackageJsonField,
  removePackageJsonField
} from "./appState.js";
import {
  isGeneratorPackageEntry,
  loadAppLocalPackageRegistry
} from "./packageRegistries.js";
import {
  resolvePackageDependencySpecifier,
  normalizeJskitDependencySpecifier
} from "./localPackageSupport.js";
import {
  resolvePackageTemplateRoot
} from "./packageTemplateResolution.js";
import {
  applyFileMutations,
  applyTextMutations,
  preflightFileMutationTemplateContexts,
  resolvePositioningMutations
} from "./mutationApplication.js";
function createManagedRecordBase(packageEntry, options) {
  const sourceRecord = {
    type: String(packageEntry?.sourceType || "packages-directory"),
    ...ensureObject(packageEntry?.source)
  };
  if (!sourceRecord.descriptorPath && String(packageEntry?.descriptorRelativePath || "").trim()) {
    sourceRecord.descriptorPath = String(packageEntry.descriptorRelativePath).trim();
  }

  return {
    packageId: packageEntry.packageId,
    version: packageEntry.version,
    source: sourceRecord,
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
    options,
    installedAt: new Date().toISOString()
  };
}


function cloneManagedMap(value = {}) {
  const cloned = {};
  for (const [key, entry] of Object.entries(ensureObject(value))) {
    cloned[key] = {
      ...ensureObject(entry)
    };
  }
  return cloned;
}

function cloneManagedArray(value = []) {
  return ensureArray(value).map((entry) => ({
    ...ensureObject(entry)
  }));
}

function resolveManagedSourceRecord(packageEntry, existingInstall = {}) {
  const existingSource = ensureObject(existingInstall.source);
  if (Object.keys(existingSource).length > 0) {
    return {
      ...existingSource
    };
  }

  const sourceRecord = {
    type: String(packageEntry?.sourceType || "packages-directory"),
    ...ensureObject(packageEntry?.source)
  };
  if (!sourceRecord.descriptorPath && String(packageEntry?.descriptorRelativePath || "").trim()) {
    sourceRecord.descriptorPath = String(packageEntry.descriptorRelativePath).trim();
  }
  return sourceRecord;
}

async function applyPackagePositioning({
  packageEntry,
  packageOptions,
  appRoot,
  lock,
  touchedFiles
}) {
  const existingInstall = ensureObject(lock.installedPackages[packageEntry.packageId]);
  if (Object.keys(existingInstall).length < 1) {
    throw createCliError(`Package is not installed: ${packageEntry.packageId}`);
  }

  const existingManaged = ensureObject(existingInstall.managed);
  const existingPackageJsonManaged = ensureObject(existingManaged.packageJson);
  const nextManaged = {
    packageJson: {
      dependencies: cloneManagedMap(existingPackageJsonManaged.dependencies),
      devDependencies: cloneManagedMap(existingPackageJsonManaged.devDependencies),
      scripts: cloneManagedMap(existingPackageJsonManaged.scripts)
    },
    text: cloneManagedMap(existingManaged.text),
    vite: cloneManagedMap(existingManaged.vite),
    files: cloneManagedArray(existingManaged.files),
    migrations: cloneManagedArray(existingManaged.migrations)
  };

  const templateRoot = await resolvePackageTemplateRoot({ packageEntry, appRoot });
  const packageEntryForMutations =
    templateRoot === packageEntry.rootDir
      ? packageEntry
      : {
          ...packageEntry,
          rootDir: templateRoot
        };

  const mutations = ensureObject(packageEntry.descriptor.mutations);
  const positioningMutations = resolvePositioningMutations(mutations);
  const appliedManagedFiles = [];
  const appliedManagedText = {};
  if (positioningMutations.files.length > 0) {
    await applyFileMutations(
      packageEntryForMutations,
      packageOptions,
      appRoot,
      positioningMutations.files,
      appliedManagedFiles,
      [],
      touchedFiles
    );
  }
  if (positioningMutations.text.length > 0) {
    await applyTextMutations(
      packageEntryForMutations,
      appRoot,
      positioningMutations.text,
      packageOptions,
      appliedManagedText,
      touchedFiles
    );
  }

  if (appliedManagedFiles.length > 0) {
    const replacedPaths = new Set(
      appliedManagedFiles
        .map((entry) => String(ensureObject(entry).path || "").trim())
        .filter(Boolean)
    );
    const retainedFiles = nextManaged.files.filter((entry) => {
      const managedPath = String(ensureObject(entry).path || "").trim();
      return !managedPath || !replacedPaths.has(managedPath);
    });
    nextManaged.files = [...retainedFiles, ...appliedManagedFiles];
  }

  if (Object.keys(appliedManagedText).length > 0) {
    nextManaged.text = {
      ...nextManaged.text,
      ...appliedManagedText
    };
  }

  const managedRecord = {
    ...existingInstall,
    packageId: packageEntry.packageId,
    version: packageEntry.version,
    source: resolveManagedSourceRecord(packageEntry, existingInstall),
    managed: nextManaged,
    options: {
      ...ensureObject(packageOptions)
    },
    installedAt: String(existingInstall.installedAt || new Date().toISOString())
  };
  lock.installedPackages[packageEntry.packageId] = managedRecord;
  return managedRecord;
}

async function applyPackageMigrationsOnly({
  packageEntry,
  packageOptions,
  appRoot,
  lock,
  touchedFiles
}) {
  const existingInstall = ensureObject(lock.installedPackages[packageEntry.packageId]);
  if (Object.keys(existingInstall).length < 1) {
    throw createCliError(`Package is not installed: ${packageEntry.packageId}`);
  }

  const existingManaged = ensureObject(existingInstall.managed);
  const existingPackageJsonManaged = ensureObject(existingManaged.packageJson);
  const nextManaged = {
    packageJson: {
      dependencies: cloneManagedMap(existingPackageJsonManaged.dependencies),
      devDependencies: cloneManagedMap(existingPackageJsonManaged.devDependencies),
      scripts: cloneManagedMap(existingPackageJsonManaged.scripts)
    },
    text: cloneManagedMap(existingManaged.text),
    vite: cloneManagedMap(existingManaged.vite),
    files: cloneManagedArray(existingManaged.files),
    migrations: cloneManagedArray(existingManaged.migrations)
  };

  const templateRoot = await resolvePackageTemplateRoot({ packageEntry, appRoot });
  const packageEntryForMutations =
    templateRoot === packageEntry.rootDir
      ? packageEntry
      : {
          ...packageEntry,
          rootDir: templateRoot
        };
  const mutations = ensureObject(packageEntry.descriptor.mutations);
  const migrationFileMutations = ensureArray(mutations.files).filter((mutationValue) => {
    const normalized = normalizeFileMutationRecord(mutationValue);
    const operation = String(normalized.op || "copy-file").trim();
    return operation === "install-migration";
  });
  const mutationWarnings = [];

  if (migrationFileMutations.length > 0) {
    await applyFileMutations(
      packageEntryForMutations,
      packageOptions,
      appRoot,
      migrationFileMutations,
      [],
      nextManaged.migrations,
      touchedFiles,
      mutationWarnings
    );
  }

  const managedRecord = {
    ...existingInstall,
    packageId: packageEntry.packageId,
    source: resolveManagedSourceRecord(packageEntry, existingInstall),
    managed: nextManaged,
    options: {
      ...ensureObject(packageOptions)
    },
    migrationSyncVersion: packageEntry.version,
    installedAt: String(existingInstall.installedAt || new Date().toISOString())
  };
  lock.installedPackages[packageEntry.packageId] = managedRecord;
  if (mutationWarnings.length > 0) {
    managedRecord.warnings = mutationWarnings;
  }
  return managedRecord;
}

async function applyPackageInstall({
  packageEntry,
  packageOptions,
  appRoot,
  appPackageJson,
  lock,
  packageRegistry,
  touchedFiles,
  reportTemplateFetchStatus = null
}) {
  const existingInstall = ensureObject(lock.installedPackages[packageEntry.packageId]);
  const existingManaged = ensureObject(existingInstall.managed);
  await removeManagedViteProxyEntries({
    appRoot,
    packageId: packageEntry.packageId,
    managedViteChanges: ensureObject(existingManaged.vite),
    touchedFiles
  });

  const managedRecord = createManagedRecordBase(packageEntry, packageOptions);
  managedRecord.managed.migrations = cloneManagedArray(existingManaged.migrations);
  const generatorPackage = isGeneratorPackageEntry(packageEntry);
  const mutationWarnings = [];
  const mutations = ensureObject(packageEntry.descriptor.mutations);
  const fileMutations = ensureArray(mutations.files);
  const templateRoot = await resolvePackageTemplateRoot({
    packageEntry,
    appRoot,
    reportTemplateFetchStatus
  });
  const packageEntryForMutations =
    templateRoot === packageEntry.rootDir
      ? packageEntry
      : {
          ...packageEntry,
          rootDir: templateRoot
        };

  const precomputedTemplateContextByMutationIndex = await preflightFileMutationTemplateContexts(
    packageEntryForMutations,
    packageOptions,
    appRoot,
    fileMutations
  );

  const mutationDependencies = ensureObject(mutations.dependencies);
  const runtimeDependencies = ensureObject(mutationDependencies.runtime);
  const devDependencies = ensureObject(mutationDependencies.dev);
  const mutationScripts = ensureObject(ensureObject(mutations.packageJson).scripts);

  for (const [rawDependencyId, rawDependencyVersion] of Object.entries(runtimeDependencies)) {
    const dependencyId = interpolateOptionValue(
      rawDependencyId,
      packageOptions,
      packageEntry.packageId,
      `dependencies.runtime.${rawDependencyId}.id`
    );
    const dependencyVersion = interpolateOptionValue(
      String(rawDependencyVersion || ""),
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
    const existingRuntimeDependencyValue = String(ensureObject(appPackageJson.dependencies)[dependencyId] || "").trim();
    const resolvedValue = localPackage
      ? resolvePackageDependencySpecifier(localPackage, { existingValue: existingRuntimeDependencyValue })
      : String(dependencyVersion);
    const normalizedResolvedValue = normalizeJskitDependencySpecifier(dependencyId, resolvedValue);
    const applied = applyPackageJsonField(appPackageJson, "dependencies", dependencyId, normalizedResolvedValue);
    if (applied.changed) {
      managedRecord.managed.packageJson.dependencies[dependencyId] = applied.managed;
      touchedFiles.add("package.json");
    }
  }

  for (const [rawDependencyId, rawDependencyVersion] of Object.entries(devDependencies)) {
    const dependencyId = interpolateOptionValue(
      rawDependencyId,
      packageOptions,
      packageEntry.packageId,
      `dependencies.dev.${rawDependencyId}.id`
    );
    const dependencyVersion = interpolateOptionValue(
      String(rawDependencyVersion || ""),
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
    const existingDevDependencyValue = String(ensureObject(appPackageJson.devDependencies)[dependencyId] || "").trim();
    const resolvedValue = localPackage
      ? resolvePackageDependencySpecifier(localPackage, { existingValue: existingDevDependencyValue })
      : String(dependencyVersion);
    const normalizedResolvedValue = normalizeJskitDependencySpecifier(dependencyId, resolvedValue);
    const applied = applyPackageJsonField(appPackageJson, "devDependencies", dependencyId, normalizedResolvedValue);
    if (applied.changed) {
      managedRecord.managed.packageJson.devDependencies[dependencyId] = applied.managed;
      touchedFiles.add("package.json");
    }
  }

  if (generatorPackage) {
    const removedRuntimeDependency = removePackageJsonField(appPackageJson, "dependencies", packageEntry.packageId);
    const removedDevDependency = removePackageJsonField(appPackageJson, "devDependencies", packageEntry.packageId);
    if (removedRuntimeDependency || removedDevDependency) {
      touchedFiles.add("package.json");
    }
  } else {
    const existingSelfDependencyValue = String(ensureObject(appPackageJson.dependencies)[packageEntry.packageId] || "").trim();
    const selfDependencyValue = resolvePackageDependencySpecifier(packageEntry, {
      existingValue: existingSelfDependencyValue
    });
    const normalizedSelfDependencyValue = normalizeJskitDependencySpecifier(packageEntry.packageId, selfDependencyValue);
    const selfApplied = applyPackageJsonField(
      appPackageJson,
      "dependencies",
      packageEntry.packageId,
      normalizedSelfDependencyValue
    );
    if (selfApplied.changed) {
      managedRecord.managed.packageJson.dependencies[packageEntry.packageId] = selfApplied.managed;
      touchedFiles.add("package.json");
    }
  }

  for (const [scriptName, scriptValue] of Object.entries(mutationScripts)) {
    const applied = applyPackageJsonField(appPackageJson, "scripts", scriptName, scriptValue);
    if (applied.changed) {
      managedRecord.managed.packageJson.scripts[scriptName] = applied.managed;
      touchedFiles.add("package.json");
    }
  }

  await applyFileMutations(
    packageEntryForMutations,
    packageOptions,
    appRoot,
    fileMutations,
    managedRecord.managed.files,
    managedRecord.managed.migrations,
    touchedFiles,
    mutationWarnings,
    precomputedTemplateContextByMutationIndex
  );

  await applyTextMutations(
    packageEntryForMutations,
    appRoot,
    ensureArray(mutations.text),
    packageOptions,
    managedRecord.managed.text,
    touchedFiles
  );

  await applyViteMutations(
    packageEntryForMutations,
    appRoot,
    ensureObject(mutations.vite),
    packageOptions,
    managedRecord.managed.vite,
    touchedFiles
  );

  if (generatorPackage) {
    delete lock.installedPackages[packageEntry.packageId];
  } else {
    managedRecord.migrationSyncVersion = packageEntry.version;
    lock.installedPackages[packageEntry.packageId] = managedRecord;
  }
  if (mutationWarnings.length > 0) {
    managedRecord.warnings = mutationWarnings;
  }
  return managedRecord;
}

async function adoptAppLocalPackageDependencies({
  appRoot,
  appPackageJson,
  lock
}) {
  const appLocalRegistry = await loadAppLocalPackageRegistry(appRoot);
  const runtimeDependencies = ensureObject(appPackageJson.dependencies);
  const adoptedPackageIds = [];

  for (const dependencyId of sortStrings(Object.keys(runtimeDependencies))) {
    if (lock.installedPackages[dependencyId]) {
      continue;
    }

    const localPackageEntry = appLocalRegistry.get(dependencyId);
    if (!localPackageEntry) {
      continue;
    }

    lock.installedPackages[dependencyId] = createManagedRecordBase(localPackageEntry, {});
    adoptedPackageIds.push(dependencyId);
  }

  return {
    appLocalRegistry,
    adoptedPackageIds: sortStrings(adoptedPackageIds)
  };
}


export {
  adoptAppLocalPackageDependencies,
  applyPackageInstall,
  applyPackageMigrationsOnly,
  applyPackagePositioning
};
