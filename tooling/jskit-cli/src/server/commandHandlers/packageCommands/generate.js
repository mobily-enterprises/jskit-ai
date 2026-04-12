import path from "node:path";
import {
  isHelpToken,
  renderGenerateCatalogHelp,
  renderGeneratePackageHelp,
  renderGenerateSubcommandHelp
} from "./discoverabilityHelp.js";
import { interpolateOptionValue } from "../../shared/optionInterpolation.js";

function resolveGeneratorSubcommandDefinitionMetadata(packageEntry = {}, subcommandName = "") {
  const descriptor = packageEntry?.descriptor && typeof packageEntry.descriptor === "object"
    ? packageEntry.descriptor
    : {};
  const metadata = descriptor?.metadata && typeof descriptor.metadata === "object"
    ? descriptor.metadata
    : {};
  const subcommands = metadata?.generatorSubcommands && typeof metadata.generatorSubcommands === "object"
    ? metadata.generatorSubcommands
    : descriptor?.generatorSubcommands && typeof descriptor.generatorSubcommands === "object"
      ? descriptor.generatorSubcommands
      : {};
  const normalizedSubcommandName = String(subcommandName || "").trim();
  if (!normalizedSubcommandName) {
    return {};
  }
  const definition = subcommands[normalizedSubcommandName];
  return definition && typeof definition === "object" ? definition : {};
}

function mapDescriptorBackedSubcommandArgsToInlineOptions(
  packageEntry = {},
  subcommandName = "",
  subcommandArgs = [],
  inlineOptions = {},
  createCliError
) {
  const definition = resolveGeneratorSubcommandDefinitionMetadata(packageEntry, subcommandName);
  const positionalArgs = Array.isArray(definition?.positionalArgs)
    ? definition.positionalArgs
    : [];
  const providedArgs = Array.isArray(subcommandArgs) ? subcommandArgs : [];
  if (providedArgs.length > positionalArgs.length) {
    throw createCliError(
      `Generator command "${subcommandName}" for ${String(packageEntry?.packageId || "unknown-package")} accepts at most ${positionalArgs.length} positional argument${positionalArgs.length === 1 ? "" : "s"}.`
    );
  }

  const mappedInlineOptions = {
    ...(inlineOptions && typeof inlineOptions === "object" ? inlineOptions : {})
  };
  for (const [index, rawValue] of providedArgs.entries()) {
    const positionalArg = positionalArgs[index];
    const optionName = String(positionalArg?.name || "").trim();
    if (!optionName) {
      throw createCliError(
        `Generator command "${subcommandName}" for ${String(packageEntry?.packageId || "unknown-package")} defines positional arg ${index + 1} without a name.`
      );
    }

    const value = String(rawValue || "").trim();
    const existingValue = Object.prototype.hasOwnProperty.call(mappedInlineOptions, optionName)
      ? String(mappedInlineOptions[optionName] || "").trim()
      : null;
    if (existingValue != null && existingValue !== value) {
      throw createCliError(
        `Generator command "${subcommandName}" for ${String(packageEntry?.packageId || "unknown-package")} received both positional "${optionName}" and --${optionName} with different values.`
      );
    }
    mappedInlineOptions[optionName] = value;
  }

  return mappedInlineOptions;
}

function resolveSubcommandRequiresInput(packageEntry = {}, subcommandName = "") {
  const subcommandDefinition = resolveGeneratorSubcommandDefinitionMetadata(packageEntry, subcommandName);
  const positionalArgs = Array.isArray(subcommandDefinition?.positionalArgs)
    ? subcommandDefinition.positionalArgs
    : [];
  return positionalArgs.some((arg) => arg && typeof arg === "object" && arg.required !== false);
}

function collectUnexpectedGeneratorSubcommandOptionNames(packageEntry = {}, subcommandName = "", inlineOptions = {}) {
  const subcommandDefinition = resolveGeneratorSubcommandDefinitionMetadata(packageEntry, subcommandName);
  if (!Array.isArray(subcommandDefinition?.optionNames)) {
    return [];
  }

  const allowedOptionNameSet = new Set(
    subcommandDefinition.optionNames
      .map((optionName) => String(optionName || "").trim())
      .filter(Boolean)
  );
  return Object.keys(inlineOptions || {})
    .map((optionName) => String(optionName || "").trim())
    .filter(Boolean)
    .filter((optionName) => !allowedOptionNameSet.has(optionName))
    .sort((left, right) => left.localeCompare(right));
}

function resolveCreateTargetPolicy(packageEntry = {}, subcommandName = "") {
  const definition = resolveGeneratorSubcommandDefinitionMetadata(packageEntry, subcommandName);
  const createTarget = definition?.createTarget;
  return createTarget && typeof createTarget === "object" ? createTarget : {};
}

function normalizeRelativePathWithinApp(appRoot = "", targetPath = "", createCliError) {
  const normalizedTargetPath = String(targetPath || "").trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (!normalizedTargetPath) {
    throw createCliError("Generator create target path cannot be empty.");
  }

  const absolutePath = path.resolve(appRoot, normalizedTargetPath);
  const relativePath = path.relative(appRoot, absolutePath);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw createCliError(`Generator create target must stay within app root: ${normalizedTargetPath}`);
  }

  return {
    absolutePath,
    relativePath: relativePath.split(path.sep).join("/")
  };
}

async function enforceDescriptorBackedCreateTargetPolicy({
  packageEntry,
  subcommandName,
  inlineOptions = {},
  appRoot = "",
  packageIdInput = "",
  createCliError,
  readdir
} = {}) {
  const policy = resolveCreateTargetPolicy(packageEntry, subcommandName);
  const pathTemplate = String(policy.pathTemplate || "").trim();
  if (!pathTemplate) {
    return;
  }

  const forceOptionName = String(policy.forceOptionName || "force").trim() || "force";
  const forceOverwrite = String(inlineOptions?.[forceOptionName] || "").trim().toLowerCase() === "true";
  if (forceOverwrite) {
    return;
  }

  const interpolatedTargetPath = interpolateOptionValue(
    pathTemplate,
    inlineOptions,
    String(packageEntry?.packageId || "unknown-package"),
    `${String(subcommandName || "generator")}.createTarget.pathTemplate`
  );
  const resolvedTargetPath = normalizeRelativePathWithinApp(appRoot, interpolatedTargetPath, createCliError);

  try {
    const entries = await readdir(resolvedTargetPath.absolutePath);
    if (policy.allowExistingEmptyDirectory === true && entries.length < 1) {
      return;
    }

    const commandLabel = `${String(packageIdInput || packageEntry?.packageId || "generator").trim()} ${String(subcommandName || "").trim()}`.trim();
    const targetLabel = String(policy.label || "target").trim() || "target";
    throw createCliError(
      `${commandLabel} will not overwrite existing ${targetLabel} ${resolvedTargetPath.relativePath}. Re-run with --force to overwrite it.`
    );
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    if (error?.code === "ENOTDIR") {
      const commandLabel = `${String(packageIdInput || packageEntry?.packageId || "generator").trim()} ${String(subcommandName || "").trim()}`.trim();
      const targetLabel = String(policy.label || "target").trim() || "target";
      throw createCliError(
        `${commandLabel} will not overwrite existing ${targetLabel} ${resolvedTargetPath.relativePath}. Re-run with --force to overwrite it.`
      );
    }
    throw error;
  }
}

async function runPackageGenerateCommand(
  ctx = {},
  { positional, options, cwd, io },
  { runCommandAdd }
) {
  const {
    createCliError,
    resolveAppRootFromCwd,
    loadPackageRegistry,
    loadAppLocalPackageRegistry,
    mergePackageRegistries,
    resolvePackageIdFromRegistryOrNodeModules,
    hydratePackageRegistryFromInstalledNodeModules,
    resolvePackageTemplateRoot,
    resolvePackageKind,
    resolveGeneratorPrimarySubcommand,
    hasGeneratorSubcommandDefinition,
    readdir,
    validateInlineOptionValuesForPackage,
    runGeneratorSubcommand,
    createCatalogFetchStatusReporter = () => () => {}
  } = ctx;

  const firstToken = String(positional[0] || "").trim();
  const secondToken = String(positional[1] || "").trim();
  const thirdToken = String(positional[2] || "").trim();
  if (firstToken === "bundle") {
    throw createCliError("generate supports packages only (generate <packageId>).", {
      showUsage: true
    });
  }
  const targetId = firstToken === "package" ? secondToken : firstToken;
  const subcommandName = firstToken === "package" ? thirdToken : secondToken;
  const subcommandArgs = firstToken === "package" ? positional.slice(3) : positional.slice(2);
  const reportTemplateFetchStatus = createCatalogFetchStatusReporter(io, {
    enabled: options.json !== true
  });

  async function resolveGeneratorPackageEntry(packageIdInput = "") {
    const appRoot = await resolveAppRootFromCwd(cwd);
    const packageRegistry = await loadPackageRegistry();
    const appLocalRegistry = await loadAppLocalPackageRegistry(appRoot);
    const combinedPackageRegistry = mergePackageRegistries(packageRegistry, appLocalRegistry);

    const resolvedPackageId = await resolvePackageIdFromRegistryOrNodeModules({
      appRoot,
      packageRegistry: combinedPackageRegistry,
      packageIdInput
    });
    if (!resolvedPackageId) {
      throw createCliError(
        `Unknown package: ${packageIdInput}. Install it first (npm install ${packageIdInput}) if you want to run generator subcommands from node_modules.`
      );
    }

    await hydratePackageRegistryFromInstalledNodeModules({
      appRoot,
      packageRegistry: combinedPackageRegistry,
      seedPackageIds: [resolvedPackageId]
    });
    const packageEntry = combinedPackageRegistry.get(resolvedPackageId);
    if (!packageEntry) {
      throw createCliError(`Unknown package: ${packageIdInput}`);
    }
    if (resolvePackageKind(packageEntry) !== "generator") {
      throw createCliError(
        `Package ${resolvedPackageId} is a runtime package. Use: jskit add package ${resolvedPackageId}`
      );
    }

    return Object.freeze({
      appRoot,
      packageEntry,
      resolvedPackageId
    });
  }

  if (!targetId) {
    const packageRegistry = await loadPackageRegistry();
    renderGenerateCatalogHelp({
      io,
      packageRegistry,
      resolvePackageKind,
      json: options.json
    });
    return 0;
  }

  if (isHelpToken(subcommandName)) {
    if (subcommandArgs.length > 0) {
      throw createCliError(
        `Unknown generator usage: jskit generate ${targetId} help ${subcommandArgs.join(" ")}. Use: jskit generate ${targetId} <subcommand> help`
      );
    }
    const { packageEntry } = await resolveGeneratorPackageEntry(targetId);
    renderGeneratePackageHelp({
      io,
      packageEntry,
      packageIdInput: targetId,
      json: options.json
    });
    return 0;
  }

  async function runResolvedGeneratorSubcommand({
    appRoot,
    packageEntry,
    resolvedPackageId,
    subcommandName: rawSubcommandName = "",
    subcommandArgs: rawSubcommandArgs = []
  } = {}) {
    const normalizedSubcommandName = String(rawSubcommandName || "").trim().toLowerCase();
    const normalizedSubcommandArgs = Array.isArray(rawSubcommandArgs)
      ? rawSubcommandArgs
      : [];
    const hasInlineOptions = Object.keys(options?.inlineOptions || {}).length > 0;
    const hasSubcommandArgs = normalizedSubcommandArgs.length > 0;
    if (!hasInlineOptions && !hasSubcommandArgs && resolveSubcommandRequiresInput(packageEntry, normalizedSubcommandName)) {
      const rendered = renderGenerateSubcommandHelp({
        io,
        packageEntry,
        packageIdInput: targetId,
        subcommandName: normalizedSubcommandName,
        json: options.json
      });
      if (rendered) {
        return 0;
      }
    }
    if (normalizedSubcommandArgs.length === 1 && isHelpToken(normalizedSubcommandArgs[0])) {
      const rendered = renderGenerateSubcommandHelp({
        io,
        packageEntry,
        packageIdInput: targetId,
        subcommandName: normalizedSubcommandName,
        json: options.json
      });
      if (!rendered) {
        throw createCliError(`Unknown generator subcommand "${normalizedSubcommandName}" for ${resolvedPackageId}.`);
      }
      return 0;
    }

    const subcommandDefinition = resolveGeneratorSubcommandDefinitionMetadata(packageEntry, normalizedSubcommandName);
    const unexpectedOptionNames = collectUnexpectedGeneratorSubcommandOptionNames(
      packageEntry,
      normalizedSubcommandName,
      options.inlineOptions
    );
    if (unexpectedOptionNames.length > 0) {
      const commandLabel = String(targetId || resolvedPackageId || "").trim() || resolvedPackageId;
      throw createCliError(
        `Unknown option${unexpectedOptionNames.length === 1 ? "" : "s"} for generator command ${commandLabel} ${normalizedSubcommandName}: ${unexpectedOptionNames.map((optionName) => `--${optionName}`).join(", ")}.`,
        {
          renderUsage: options.json
            ? null
            : () => {
                renderGenerateSubcommandHelp({
                  io: {
                    ...io,
                    stdout: io.stderr || io.stdout
                  },
                  packageEntry,
                  packageIdInput: targetId,
                  subcommandName: normalizedSubcommandName,
                  json: false
                });
              }
        }
      );
    }
    const validatedOptionNames = Array.isArray(subcommandDefinition?.optionNames)
      ? subcommandDefinition.optionNames
      : [];
    await validateInlineOptionValuesForPackage(packageEntry, options.inlineOptions, {
      appRoot,
      optionNames: validatedOptionNames
    });

    const primarySubcommand = resolveGeneratorPrimarySubcommand(packageEntry);
    if (
      normalizedSubcommandName &&
      normalizedSubcommandName === primarySubcommand &&
      !hasGeneratorSubcommandDefinition(packageEntry, normalizedSubcommandName)
    ) {
      const inlineOptionsForPrimarySubcommand = mapDescriptorBackedSubcommandArgsToInlineOptions(
        packageEntry,
        normalizedSubcommandName,
        normalizedSubcommandArgs,
        options.inlineOptions,
        createCliError
      );
      await validateInlineOptionValuesForPackage(packageEntry, inlineOptionsForPrimarySubcommand, {
        appRoot
      });
      await enforceDescriptorBackedCreateTargetPolicy({
        packageEntry,
        subcommandName: normalizedSubcommandName,
        inlineOptions: inlineOptionsForPrimarySubcommand,
        appRoot,
        packageIdInput: targetId,
        createCliError,
        readdir
      });
      return runCommandAdd({
        positional: ["package", resolvedPackageId],
        options: {
          ...options,
          inlineOptions: inlineOptionsForPrimarySubcommand,
          commandMode: "generate"
        },
        cwd,
        io
      });
    }

    const templateRoot = await resolvePackageTemplateRoot({
      packageEntry,
      appRoot,
      reportTemplateFetchStatus
    });
    const executablePackageEntry =
      templateRoot === packageEntry.rootDir
        ? packageEntry
        : {
            ...packageEntry,
            rootDir: templateRoot
          };

    return runGeneratorSubcommand({
      packageEntry: executablePackageEntry,
      subcommandName: normalizedSubcommandName,
      subcommandArgs: normalizedSubcommandArgs,
      inlineOptions: options.inlineOptions,
      appRoot,
      io,
      dryRun: options.dryRun,
      json: options.json
    });
  }

  if (subcommandName) {
    const resolvedGeneratorPackage = await resolveGeneratorPackageEntry(targetId);
    return runResolvedGeneratorSubcommand({
      ...resolvedGeneratorPackage,
      subcommandName,
      subcommandArgs
    });
  }

  const { packageEntry } = await resolveGeneratorPackageEntry(targetId);
  renderGeneratePackageHelp({
    io,
    packageEntry,
    packageIdInput: targetId,
    json: options.json
  });
  return 0;
}

export { runPackageGenerateCommand };
