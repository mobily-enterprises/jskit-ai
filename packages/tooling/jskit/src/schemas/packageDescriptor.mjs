import { createCliError, ensureObject, ensureRecord, ensurePackageId, normalizeRelativePath } from "./validationHelpers.mjs";

function normalizeProcessType(value) {
  const normalized = String(value || "").trim();
  if (!normalized || !/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw createCliError(`Invalid Procfile process type: ${value}`);
  }
  return normalized;
}

export function normalizePackageDescriptor(packaged, descriptorPath) {
  ensureObject(packaged, `Package descriptor at ${descriptorPath}`);

  if (Number(packaged.packageVersion) !== 1) {
    throw createCliError(`Package descriptor ${descriptorPath} must set packageVersion to 1.`);
  }

  const packageId = ensurePackageId(packaged.packageId, `Package descriptor ${descriptorPath} packageId`);
  const version = String(packaged.version || "").trim();
  if (!version) {
    throw createCliError(`Package descriptor ${descriptorPath} must define version.`);
  }

  const dependsOn = (Array.isArray(packaged.dependsOn) ? packaged.dependsOn : []).map((entry, index) =>
    ensurePackageId(entry, `Package ${packageId} dependsOn[${index}]`)
  );

  const capabilitiesSource = ensureRecord(packaged.capabilities, `Package ${packageId} capabilities`);
  const provides = Array.isArray(capabilitiesSource.provides)
    ? capabilitiesSource.provides.map((value) => String(value || "").trim()).filter((value) => value.length > 0)
    : [];
  const requires = Array.isArray(capabilitiesSource.requires)
    ? capabilitiesSource.requires.map((value) => String(value || "").trim()).filter((value) => value.length > 0)
    : [];

  const mutations = ensureRecord(packaged.mutations, `Package ${packageId} mutations`);
  const dependencies = ensureRecord(mutations.dependencies, `Package ${packageId} mutations.dependencies`);
  const runtimeDependencies = ensureRecord(
    dependencies.runtime,
    `Package ${packageId} mutations.dependencies.runtime`
  );
  const devDependencies = ensureRecord(dependencies.dev, `Package ${packageId} mutations.dependencies.dev`);

  const packageJson = ensureRecord(mutations.packageJson, `Package ${packageId} mutations.packageJson`);
  const scripts = ensureRecord(packageJson.scripts, `Package ${packageId} mutations.packageJson.scripts`);

  const procfile = ensureRecord(mutations.procfile, `Package ${packageId} mutations.procfile`);
  const files = Array.isArray(mutations.files) ? mutations.files : [];

  for (const [dependencyName, range] of Object.entries({ ...runtimeDependencies, ...devDependencies })) {
    if (!String(dependencyName || "").trim()) {
      throw createCliError(`Package ${packageId} has an empty dependency key.`);
    }
    if (!String(range || "").trim()) {
      throw createCliError(`Package ${packageId} dependency ${dependencyName} must define a range.`);
    }
  }

  for (const [scriptName, command] of Object.entries(scripts)) {
    if (!String(scriptName || "").trim()) {
      throw createCliError(`Package ${packageId} has an empty script key.`);
    }
    if (!String(command || "").trim()) {
      throw createCliError(`Package ${packageId} script ${scriptName} must define a command.`);
    }
  }

  for (const [processType, command] of Object.entries(procfile)) {
    normalizeProcessType(processType);
    if (!String(command || "").trim()) {
      throw createCliError(`Package ${packageId} Procfile entry ${processType} must define a command.`);
    }
  }

  const normalizedFiles = files.map((entry, index) => {
    ensureObject(entry, `Package ${packageId} files[${index}]`);

    const from = normalizeRelativePath(entry.from);
    const to = normalizeRelativePath(entry.to);

    return {
      from,
      to
    };
  });

  return {
    packageVersion: 1,
    packageId,
    version,
    description: String(packaged.description || "").trim(),
    dependsOn,
    capabilities: {
      provides,
      requires
    },
    mutations: {
      dependencies: {
        runtime: runtimeDependencies,
        dev: devDependencies
      },
      packageJson: {
        scripts
      },
      procfile,
      files: normalizedFiles
    }
  };
}
