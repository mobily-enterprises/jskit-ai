import { createCliError, ensureObject, ensureRecord, ensurePackageId, normalizeRelativePath } from "./validationHelpers.mjs";

function normalizeProcessType(value) {
  const normalized = String(value || "").trim();
  if (!normalized || !/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw createCliError(`Invalid Procfile process type: ${value}`);
  }
  return normalized;
}

function normalizeOptionValues(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((value) => String(value || "").trim())
    .filter((value) => value.length > 0);
}

function normalizeMutationId(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(normalized)) {
    throw createCliError(`${label} is invalid: ${value}`);
  }
  return normalized;
}

function normalizeOptionalLabel(value) {
  return String(value || "").trim();
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

  const optionsSource = ensureRecord(packaged.options, `Package ${packageId} options`);
  const options = {};
  for (const [optionName, optionValue] of Object.entries(optionsSource)) {
    const normalizedOptionName = String(optionName || "").trim();
    if (!/^[a-z][a-z0-9-]*$/.test(normalizedOptionName)) {
      throw createCliError(`Package ${packageId} has invalid option name: ${optionName}`);
    }

    const option = ensureObject(optionValue, `Package ${packageId} option ${normalizedOptionName}`);
    const values = normalizeOptionValues(option.values);

    options[normalizedOptionName] = {
      required: Boolean(option.required),
      values
    };
  }

  const capabilitiesSource = ensureRecord(packaged.capabilities, `Package ${packageId} capabilities`);
  const provides = Array.isArray(capabilitiesSource.provides)
    ? capabilitiesSource.provides.map((value) => String(value || "").trim()).filter((value) => value.length > 0)
    : [];
  const requires = Array.isArray(capabilitiesSource.requires)
    ? capabilitiesSource.requires.map((value) => String(value || "").trim()).filter((value) => value.length > 0)
    : [];

  const contractsSource = ensureRecord(packaged.contracts, `Package ${packageId} contracts`);
  const contractContributionEntries = Array.isArray(contractsSource.contributes)
    ? contractsSource.contributes
    : typeof contractsSource.contributes === "string"
      ? [contractsSource.contributes]
      : [];
  const contractContributions = contractContributionEntries
    .map((entry) => normalizeRelativePath(entry).replace(/^\.\/+/, ""))
    .filter((entry, index, all) => all.indexOf(entry) === index);

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
  const textMutations = Array.isArray(mutations.text) ? mutations.text : [];
  const files = Array.isArray(mutations.files) ? mutations.files : [];

  const metadata = ensureRecord(packaged.metadata, `Package ${packageId} metadata`);
  const serverMetadata = ensureRecord(metadata.server, `Package ${packageId} metadata.server`);
  const uiMetadata = ensureRecord(metadata.ui, `Package ${packageId} metadata.ui`);

  const serverRoutes = Array.isArray(serverMetadata.routes) ? serverMetadata.routes : [];
  const uiElements = Array.isArray(uiMetadata.elements) ? uiMetadata.elements : [];
  const uiRoutes = Array.isArray(uiMetadata.routes) ? uiMetadata.routes : [];

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

  const normalizedTextFromProcfile = Object.entries(procfile).map(([processType, command]) => ({
    file: "Procfile",
    op: "upsert-line",
    key: normalizeProcessType(processType),
    line: `${normalizeProcessType(processType)}: ${String(command || "").trim()}`,
    value: "",
    reason: `Manage Procfile ${normalizeProcessType(processType)} command.`,
    category: "procfile",
    id: `procfile.${normalizeProcessType(processType)}`
  }));

  const normalizedTextMutations = textMutations.map((entry, index) => {
    ensureObject(entry, `Package ${packageId} mutations.text[${index}]`);

    const file = normalizeRelativePath(entry.file);
    const op = String(entry.op || "").trim();
    const key = String(entry.key || "").trim();
    const line = String(entry.line || "").trim();
    const value = String(entry.value || "").trim();
    const reason = normalizeOptionalLabel(entry.reason);
    const category = normalizeOptionalLabel(entry.category);
    const id = normalizeMutationId(entry.id, `Package ${packageId} mutations.text[${index}] id`);

    if (!op) {
      throw createCliError(`Package ${packageId} mutations.text[${index}] must define op.`);
    }
    if (!["upsert-line", "append-once", "upsert-env"].includes(op)) {
      throw createCliError(
        `Package ${packageId} mutations.text[${index}] op must be one of upsert-line, append-once, upsert-env.`
      );
    }

    if (op === "upsert-line") {
      if (!key || !line) {
        throw createCliError(
          `Package ${packageId} mutations.text[${index}] with op upsert-line must define key and line.`
        );
      }
    }

    if (op === "append-once") {
      if (!line) {
        throw createCliError(
          `Package ${packageId} mutations.text[${index}] with op append-once must define line.`
        );
      }
    }

    if (op === "upsert-env") {
      if (!key || !value) {
        throw createCliError(
          `Package ${packageId} mutations.text[${index}] with op upsert-env must define key and value.`
        );
      }
      if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
        throw createCliError(
          `Package ${packageId} mutations.text[${index}] has invalid env key ${key}.`
        );
      }
    }

    return {
      file,
      op,
      key,
      line,
      value,
      reason,
      category,
      id
    };
  });

  const normalizedFiles = files.map((entry, index) => {
    ensureObject(entry, `Package ${packageId} files[${index}]`);

    const from = normalizeRelativePath(entry.from);
    const to = normalizeRelativePath(entry.to);
    const reason = normalizeOptionalLabel(entry.reason);
    const category = normalizeOptionalLabel(entry.category);
    const id = normalizeMutationId(entry.id, `Package ${packageId} files[${index}] id`);

    return {
      from,
      to,
      reason,
      category,
      id
    };
  });

  const normalizedServerRoutes = serverRoutes.map((entry, index) => {
    ensureObject(entry, `Package ${packageId} metadata.server.routes[${index}]`);
    const method = String(entry.method || "").trim().toUpperCase();
    const routePath = String(entry.path || "").trim();
    if (!method || !routePath) {
      throw createCliError(
        `Package ${packageId} metadata.server.routes[${index}] must define method and path.`
      );
    }
    return {
      method,
      path: routePath,
      summary: String(entry.summary || "").trim()
    };
  });

  const normalizedUiElements = uiElements.map((entry, index) => {
    ensureObject(entry, `Package ${packageId} metadata.ui.elements[${index}]`);
    const name = String(entry.name || "").trim();
    if (!name) {
      throw createCliError(`Package ${packageId} metadata.ui.elements[${index}] must define name.`);
    }
    return {
      name,
      capability: String(entry.capability || "").trim(),
      purpose: String(entry.purpose || "").trim(),
      surface: String(entry.surface || "").trim()
    };
  });

  const normalizedUiRoutes = uiRoutes.map((entry, index) => {
    ensureObject(entry, `Package ${packageId} metadata.ui.routes[${index}]`);
    const routePath = String(entry.path || "").trim();
    if (!routePath) {
      throw createCliError(`Package ${packageId} metadata.ui.routes[${index}] must define path.`);
    }
    return {
      path: routePath,
      surface: String(entry.surface || "").trim(),
      name: String(entry.name || "").trim(),
      purpose: String(entry.purpose || "").trim()
    };
  });

  return {
    packageVersion: 1,
    packageId,
    version,
    description: String(packaged.description || "").trim(),
    dependsOn,
    options,
    capabilities: {
      provides,
      requires
    },
    contracts: {
      contributes: contractContributions
    },
    metadata: {
      server: {
        routes: normalizedServerRoutes
      },
      ui: {
        elements: normalizedUiElements,
        routes: normalizedUiRoutes
      }
    },
    mutations: {
      dependencies: {
        runtime: runtimeDependencies,
        dev: devDependencies
      },
      packageJson: {
        scripts
      },
      text: [...normalizedTextFromProcfile, ...normalizedTextMutations],
      files: normalizedFiles
    }
  };
}
