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

function normalizeOptionName(value, label) {
  const normalized = String(value || "").trim();
  if (!/^[a-z][a-z0-9-]*$/.test(normalized)) {
    throw createCliError(`${label} is invalid: ${value}`);
  }
  return normalized;
}

function normalizeOptionSchema(optionValue, label, { promptByDefault = false } = {}) {
  const option = ensureObject(optionValue, label);
  const values = normalizeOptionValues(option.values);
  const defaultValue = String(option.defaultValue || "").trim();
  const promptLabel = String(option.promptLabel || "").trim();
  const promptHint = String(option.promptHint || "").trim();
  const prompt = option.prompt === undefined ? promptByDefault : Boolean(option.prompt);

  if (defaultValue && values.length > 0 && !values.includes(defaultValue)) {
    throw createCliError(`${label} defaultValue must be one of: ${values.join(", ")}.`);
  }

  return {
    required: Boolean(option.required),
    values,
    defaultValue,
    promptLabel,
    promptHint,
    prompt
  };
}

function normalizeTextMutationEntry(entry, label) {
  ensureObject(entry, label);

  const file = normalizeRelativePath(entry.file);
  const op = String(entry.op || "").trim();
  const key = String(entry.key || "").trim();
  const line = String(entry.line || "").trim();
  const value = String(entry.value || "").trim();
  const reason = normalizeOptionalLabel(entry.reason);
  const category = normalizeOptionalLabel(entry.category);
  const id = normalizeMutationId(entry.id, `${label} id`);

  if (!op) {
    throw createCliError(`${label} must define op.`);
  }
  if (!["upsert-line", "append-once", "upsert-env"].includes(op)) {
    throw createCliError(`${label} op must be one of upsert-line, append-once, upsert-env.`);
  }

  if (op === "upsert-line") {
    if (!key || !line) {
      throw createCliError(`${label} with op upsert-line must define key and line.`);
    }
  }

  if (op === "append-once") {
    if (!line) {
      throw createCliError(`${label} with op append-once must define line.`);
    }
  }

  if (op === "upsert-env") {
    if (!key || !value) {
      throw createCliError(`${label} with op upsert-env must define key and value.`);
    }
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
      throw createCliError(`${label} has invalid env key ${key}.`);
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
}

function normalizeFileMutationEntry(entry, label) {
  ensureObject(entry, label);

  const from = normalizeRelativePath(entry.from);
  const to = normalizeRelativePath(entry.to);
  const reason = normalizeOptionalLabel(entry.reason);
  const category = normalizeOptionalLabel(entry.category);
  const id = normalizeMutationId(entry.id, `${label} id`);

  return {
    from,
    to,
    reason,
    category,
    id
  };
}

function normalizeUiRouteEntry(entry, label) {
  ensureObject(entry, label);
  const routePath = String(entry.path || "").trim();
  if (!routePath) {
    throw createCliError(`${label} must define path.`);
  }
  return {
    path: routePath,
    surface: String(entry.surface || "").trim(),
    name: String(entry.name || "").trim(),
    purpose: String(entry.purpose || "").trim()
  };
}

function normalizeServerRouteEntry(entry, label) {
  ensureObject(entry, label);
  const method = String(entry.method || "").trim().toUpperCase();
  const routePath = String(entry.path || "").trim();
  if (!method || !routePath) {
    throw createCliError(`${label} must define method and path.`);
  }
  return {
    method,
    path: routePath,
    summary: String(entry.summary || "").trim()
  };
}

function normalizeRuntimeServerConfig(runtimeSource, packageId) {
  const runtime = ensureRecord(runtimeSource, `Package ${packageId} runtime`);
  const serverRuntimeSource = runtime.server;
  if (!serverRuntimeSource) {
    return null;
  }

  const serverRuntime = ensureRecord(serverRuntimeSource, `Package ${packageId} runtime.server`);
  const entrypointRaw = String(serverRuntime.entrypoint || "").trim();
  const exportNameRaw = String(serverRuntime.export || "createServerContributions").trim() || "createServerContributions";

  if (!entrypointRaw) {
    throw createCliError(`Package ${packageId} runtime.server.entrypoint is required when runtime.server is declared.`);
  }
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(exportNameRaw)) {
    throw createCliError(`Package ${packageId} runtime.server.export is invalid: ${exportNameRaw}`);
  }

  return {
    entrypoint: normalizeRelativePath(entrypointRaw),
    export: exportNameRaw
  };
}

function normalizeElementId(value, fallback) {
  const raw = String(value || "").trim() || String(fallback || "").trim();
  const candidate = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!candidate) {
    return "";
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(candidate)) {
    return "";
  }
  return candidate;
}

function normalizeUiElementPathOption(entry, label) {
  ensureObject(entry, label);
  const option = normalizeOptionName(entry.option, `${label} option`);
  const optionSchema = normalizeOptionSchema(
    {
      required: entry.required,
      values: entry.values,
      defaultValue: entry.defaultValue,
      promptLabel: entry.promptLabel,
      promptHint: entry.promptHint,
      prompt: entry.prompt
    },
    label,
    { promptByDefault: true }
  );
  return {
    option,
    ...optionSchema
  };
}

function normalizeUiShellEntry(entry, label) {
  ensureObject(entry, label);
  const surface = String(entry.surface || "").trim().toLowerCase();
  const slot = String(entry.slot || "").trim().toLowerCase();
  const id = normalizeMutationId(entry.id, `${label} id`);
  const title = String(entry.title || "").trim();
  const route = String(entry.route || "").trim();
  if (!surface) {
    throw createCliError(`${label} must define surface.`);
  }
  if (!slot) {
    throw createCliError(`${label} must define slot.`);
  }
  if (!id || !title || !route) {
    throw createCliError(`${label} must define id/title/route.`);
  }

  const orderValue = entry.order;
  const order = Number.isFinite(Number(orderValue)) ? Number(orderValue) : 100;
  const to = String(entry.to || "").trim();
  const guard = entry.guard && typeof entry.guard === "object" && !Array.isArray(entry.guard)
    ? JSON.parse(JSON.stringify(entry.guard))
    : null;

  return {
    surface,
    slot,
    id,
    title,
    route,
    icon: String(entry.icon || "").trim(),
    group: String(entry.group || "").trim(),
    description: String(entry.description || "").trim(),
    order,
    to,
    guard
  };
}

function normalizeUiElementEntry(entry, index, packageId) {
  ensureObject(entry, `Package ${packageId} metadata.ui.elements[${index}]`);
  const name = String(entry.name || "").trim();
  if (!name) {
    throw createCliError(`Package ${packageId} metadata.ui.elements[${index}] must define name.`);
  }

  const fallbackIdSource = String(entry.capability || "").trim() || name || `element-${index + 1}`;
  const id =
    normalizeElementId(entry.id, fallbackIdSource) ||
    `element-${index + 1}`;

  const availability = ensureRecord(entry.availability, `Package ${packageId} metadata.ui.elements[${index}] availability`);
  const availabilityImport = ensureRecord(
    availability.import,
    `Package ${packageId} metadata.ui.elements[${index}] availability.import`
  );
  const importModule = String(availabilityImport.module || "").trim();
  const importSymbols = normalizeOptionValues(availabilityImport.symbols);

  const pathOptions = Array.isArray(entry.pathOptions) ? entry.pathOptions : [];
  const normalizedPathOptions = pathOptions.map((pathOption, pathOptionIndex) =>
    normalizeUiElementPathOption(
      pathOption,
      `Package ${packageId} metadata.ui.elements[${index}] pathOptions[${pathOptionIndex}]`
    )
  );

  const contributions = ensureRecord(
    entry.contributions,
    `Package ${packageId} metadata.ui.elements[${index}] contributions`
  );
  const clientRoutes = Array.isArray(contributions.clientRoutes) ? contributions.clientRoutes : [];
  const shellEntries = Array.isArray(contributions.shellEntries) ? contributions.shellEntries : [];
  const files = Array.isArray(contributions.files) ? contributions.files : [];
  const text = Array.isArray(contributions.text) ? contributions.text : [];

  return {
    id,
    name,
    capability: String(entry.capability || "").trim(),
    purpose: String(entry.purpose || "").trim(),
    surface: String(entry.surface || "").trim(),
    availability: {
      import:
        importModule || importSymbols.length > 0
          ? {
              module: importModule,
              symbols: importSymbols
            }
          : null
    },
    pathOptions: normalizedPathOptions,
    contributions: {
      clientRoutes: clientRoutes.map((routeEntry, routeIndex) =>
        normalizeUiRouteEntry(
          routeEntry,
          `Package ${packageId} metadata.ui.elements[${index}] contributions.clientRoutes[${routeIndex}]`
        )
      ),
      shellEntries: shellEntries.map((shellEntry, shellIndex) =>
        normalizeUiShellEntry(
          shellEntry,
          `Package ${packageId} metadata.ui.elements[${index}] contributions.shellEntries[${shellIndex}]`
        )
      ),
      files: files.map((fileEntry, fileIndex) =>
        normalizeFileMutationEntry(
          fileEntry,
          `Package ${packageId} metadata.ui.elements[${index}] contributions.files[${fileIndex}]`
        )
      ),
      text: text.map((textEntry, textIndex) =>
        normalizeTextMutationEntry(
          textEntry,
          `Package ${packageId} metadata.ui.elements[${index}] contributions.text[${textIndex}]`
        )
      )
    }
  };
}

function normalizeSharedScope(value, label) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "package-only";
  }
  if (!["package-only", "client-server", "server-only"].includes(normalized)) {
    throw createCliError(`${label} must be one of package-only, client-server, server-only.`);
  }
  return normalized;
}

function normalizeSharedEntry(entry, index, packageId) {
  ensureObject(entry, `Package ${packageId} metadata.shared.functions[${index}]`);

  const name = String(entry.name || "").trim();
  if (!name) {
    throw createCliError(`Package ${packageId} metadata.shared.functions[${index}] must define name.`);
  }

  const fallbackIdSource = String(entry.id || "").trim() || name || `shared-${index + 1}`;
  const id =
    normalizeElementId(fallbackIdSource, fallbackIdSource) ||
    `shared-${index + 1}`;

  const availability = ensureRecord(
    entry.availability,
    `Package ${packageId} metadata.shared.functions[${index}] availability`
  );
  const availabilityImport = ensureRecord(
    availability.import,
    `Package ${packageId} metadata.shared.functions[${index}] availability.import`
  );
  const importModule = String(availabilityImport.module || "").trim();
  const importSymbols = normalizeOptionValues(availabilityImport.symbols);

  const contributions = ensureRecord(
    entry.contributions,
    `Package ${packageId} metadata.shared.functions[${index}] contributions`
  );
  const files = Array.isArray(contributions.files) ? contributions.files : [];
  const text = Array.isArray(contributions.text) ? contributions.text : [];

  return {
    id,
    name,
    scope: normalizeSharedScope(entry.scope, `Package ${packageId} metadata.shared.functions[${index}] scope`),
    purpose: String(entry.purpose || "").trim(),
    availability: {
      import:
        importModule || importSymbols.length > 0
          ? {
              module: importModule,
              symbols: importSymbols
            }
          : null
    },
    contributions: {
      files: files.map((fileEntry, fileIndex) =>
        normalizeFileMutationEntry(
          fileEntry,
          `Package ${packageId} metadata.shared.functions[${index}] contributions.files[${fileIndex}]`
        )
      ),
      text: text.map((textEntry, textIndex) =>
        normalizeTextMutationEntry(
          textEntry,
          `Package ${packageId} metadata.shared.functions[${index}] contributions.text[${textIndex}]`
        )
      )
    }
  };
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
    const normalizedOptionName = normalizeOptionName(optionName, `Package ${packageId} option name`);
    options[normalizedOptionName] = normalizeOptionSchema(
      optionValue,
      `Package ${packageId} option ${normalizedOptionName}`
    );
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
  const sharedMetadata = ensureRecord(metadata.shared, `Package ${packageId} metadata.shared`);

  const serverRoutes = Array.isArray(serverMetadata.routes) ? serverMetadata.routes : [];
  const uiElements = Array.isArray(uiMetadata.elements) ? uiMetadata.elements : [];
  const uiRoutes = Array.isArray(uiMetadata.routes) ? uiMetadata.routes : [];
  const sharedFunctions = Array.isArray(sharedMetadata.functions) ? sharedMetadata.functions : [];

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
    return normalizeTextMutationEntry(entry, `Package ${packageId} mutations.text[${index}]`);
  });

  const normalizedFiles = files.map((entry, index) => {
    return normalizeFileMutationEntry(entry, `Package ${packageId} files[${index}]`);
  });

  const normalizedServerRoutes = serverRoutes.map((entry, index) => {
    return normalizeServerRouteEntry(entry, `Package ${packageId} metadata.server.routes[${index}]`);
  });

  const normalizedUiElements = uiElements.map((entry, index) => normalizeUiElementEntry(entry, index, packageId));

  const normalizedUiRoutes = uiRoutes.map((entry, index) => {
    return normalizeUiRouteEntry(entry, `Package ${packageId} metadata.ui.routes[${index}]`);
  });
  const normalizedSharedFunctions = sharedFunctions.map((entry, index) =>
    normalizeSharedEntry(entry, index, packageId)
  );

  const normalizedRuntimeServer = normalizeRuntimeServerConfig(packaged.runtime, packageId);

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
    runtime: {
      server: normalizedRuntimeServer
    },
    metadata: {
      server: {
        routes: normalizedServerRoutes
      },
      ui: {
        elements: normalizedUiElements,
        routes: normalizedUiRoutes
      },
      shared: {
        functions: normalizedSharedFunctions
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
