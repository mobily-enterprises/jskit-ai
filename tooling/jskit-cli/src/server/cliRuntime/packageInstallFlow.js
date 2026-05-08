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
  loadMutationWhenConfigContext
} from "./ioAndMigrations.js";
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
  partitionPreFileConfigTextMutations,
  prepareFileMutations,
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
  touchedFiles,
  dryRun = false
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
  const preparedFileMutations = await prepareFileMutations(
    packageEntryForMutations,
    packageOptions,
    appRoot,
    positioningMutations.files,
    nextManaged.files
  );
  if (positioningMutations.files.length > 0) {
    await applyFileMutations(
      packageEntryForMutations,
      appRoot,
      preparedFileMutations,
      appliedManagedFiles,
      [],
      touchedFiles,
      [],
      nextManaged.files,
      {
        dryRun
      }
    );
  }
  if (positioningMutations.text.length > 0) {
    await applyTextMutations(
      packageEntryForMutations,
      appRoot,
      positioningMutations.text,
      packageOptions,
      appliedManagedText,
      touchedFiles,
      {
        dryRun
      }
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
  touchedFiles,
  dryRun = false
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
  const preparedFileMutations = await prepareFileMutations(
    packageEntryForMutations,
    packageOptions,
    appRoot,
    migrationFileMutations,
    nextManaged.files
  );

  if (migrationFileMutations.length > 0) {
    await applyFileMutations(
      packageEntryForMutations,
      appRoot,
      preparedFileMutations,
      [],
      nextManaged.migrations,
      touchedFiles,
      mutationWarnings,
      nextManaged.files,
      {
        dryRun
      }
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
  reportTemplateFetchStatus = null,
  dryRun = false
}) {
  const existingInstall = ensureObject(lock.installedPackages[packageEntry.packageId]);
  const existingManaged = ensureObject(existingInstall.managed);
  const generatorPackage = isGeneratorPackageEntry(packageEntry);
  const mutationWarnings = [];
  const mutations = ensureObject(packageEntry.descriptor.mutations);
  const fileMutations = ensureArray(mutations.files);
  const textMutations = ensureArray(mutations.text);
  const hasSurfaceTargetedFileMutations = fileMutations.some((mutationValue) =>
    Boolean(normalizeFileMutationRecord(mutationValue).toSurface)
  );
  const {
    preFileTextMutations,
    postFileTextMutations
  } = hasSurfaceTargetedFileMutations
    ? partitionPreFileConfigTextMutations(textMutations)
    : {
        preFileTextMutations: [],
        postFileTextMutations: textMutations
      };
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
  const managedRecord = createManagedRecordBase(packageEntry, packageOptions);
  managedRecord.managed.migrations = cloneManagedArray(existingManaged.migrations);

  if (preFileTextMutations.length > 0) {
    await applyTextMutations(
      packageEntryForMutations,
      appRoot,
      preFileTextMutations,
      packageOptions,
      managedRecord.managed.text,
      touchedFiles,
      {
        dryRun
      }
    );
  }

  const preparedFileMutations = await prepareFileMutations(
    packageEntryForMutations,
    packageOptions,
    appRoot,
    fileMutations,
    ensureArray(existingManaged.files)
  );
  await removeManagedViteProxyEntries({
    appRoot,
    packageId: packageEntry.packageId,
    managedViteChanges: ensureObject(existingManaged.vite),
    touchedFiles,
    dryRun
  });

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
    appRoot,
    preparedFileMutations,
      managedRecord.managed.files,
      managedRecord.managed.migrations,
      touchedFiles,
      mutationWarnings,
      ensureArray(existingManaged.files),
      {
        dryRun,
        reapplyManagedAppFiles: Object.keys(existingInstall).length > 0
      }
    );

  await applyTextMutations(
    packageEntryForMutations,
    appRoot,
    postFileTextMutations,
    packageOptions,
    managedRecord.managed.text,
    touchedFiles,
    {
      dryRun
    }
  );

  await applyViteMutations(
    packageEntryForMutations,
    appRoot,
    ensureObject(mutations.vite),
    packageOptions,
    managedRecord.managed.vite,
    touchedFiles,
    {
      dryRun
    }
  );

  mutationWarnings.push(...await collectInstallWarnings({
    packageEntry,
    appRoot,
    appPackageJson
  }));

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
