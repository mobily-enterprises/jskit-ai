import {
  isHelpToken,
  renderGenerateCatalogHelp,
  renderGeneratePackageHelp,
  renderGenerateSubcommandHelp
} from "./discoverabilityHelp.js";

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

function resolveSubcommandRequiresInput(packageEntry = {}, subcommandName = "") {
  const descriptor = packageEntry?.descriptor && typeof packageEntry.descriptor === "object"
    ? packageEntry.descriptor
    : {};
  const optionSchemas = descriptor?.options && typeof descriptor.options === "object"
    ? descriptor.options
    : {};
  const subcommandDefinition = resolveGeneratorSubcommandDefinitionMetadata(packageEntry, subcommandName);
  const positionalArgs = Array.isArray(subcommandDefinition?.positionalArgs)
    ? subcommandDefinition.positionalArgs
    : [];
  if (positionalArgs.length > 0) {
    return true;
  }
  const requiredOptionNames = Array.isArray(subcommandDefinition?.requiredOptionNames)
    ? subcommandDefinition.requiredOptionNames
    : [];
  if (requiredOptionNames.some((optionName) => String(optionName || "").trim().length > 0)) {
    return true;
  }

  const optionNames = Array.isArray(subcommandDefinition?.optionNames) && subcommandDefinition.optionNames.length > 0
    ? subcommandDefinition.optionNames
    : Object.keys(optionSchemas);
  for (const optionName of optionNames) {
    const normalizedOptionName = String(optionName || "").trim();
    if (!normalizedOptionName) {
      continue;
    }
    const schema = optionSchemas[normalizedOptionName];
    if (schema && typeof schema === "object" && schema.required === true) {
      return true;
    }
  }
  return false;
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
    runGeneratorSubcommand
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
    const helpSubcommandName = String(subcommandArgs[0] || "").trim();
    if (subcommandArgs.length > 1) {
      throw createCliError("generate help accepts at most one subcommand name.");
    }
    const { packageEntry } = await resolveGeneratorPackageEntry(targetId);
    if (helpSubcommandName) {
      const rendered = renderGenerateSubcommandHelp({
        io,
        packageEntry,
        packageIdInput: targetId,
        subcommandName: helpSubcommandName,
        json: options.json
      });
      if (!rendered) {
        throw createCliError(
          `Unknown generator subcommand "${helpSubcommandName}" for ${String(packageEntry?.packageId || targetId)}.`
        );
      }
      return 0;
    }

    renderGeneratePackageHelp({
      io,
      packageEntry,
      packageIdInput: targetId,
      json: options.json
    });
    return 0;
  }

  if (subcommandName) {
    const {
      appRoot,
      packageEntry,
      resolvedPackageId
    } = await resolveGeneratorPackageEntry(targetId);
    const hasInlineOptions = Object.keys(options?.inlineOptions || {}).length > 0;
    const hasSubcommandArgs = subcommandArgs.length > 0;
    if (!hasInlineOptions && !hasSubcommandArgs && resolveSubcommandRequiresInput(packageEntry, subcommandName)) {
      const rendered = renderGenerateSubcommandHelp({
        io,
        packageEntry,
        packageIdInput: targetId,
        subcommandName,
        json: options.json
      });
      if (rendered) {
        return 0;
      }
    }
    if (subcommandArgs.length === 1 && isHelpToken(subcommandArgs[0])) {
      const rendered = renderGenerateSubcommandHelp({
        io,
        packageEntry,
        packageIdInput: targetId,
        subcommandName,
        json: options.json
      });
      if (!rendered) {
        throw createCliError(`Unknown generator subcommand "${subcommandName}" for ${resolvedPackageId}.`);
      }
      return 0;
    }

    const normalizedSubcommandName = String(subcommandName || "").trim().toLowerCase();
    const primarySubcommand = resolveGeneratorPrimarySubcommand(packageEntry);
    if (
      normalizedSubcommandName &&
      normalizedSubcommandName === primarySubcommand &&
      !hasGeneratorSubcommandDefinition(packageEntry, normalizedSubcommandName)
    ) {
      if (subcommandArgs.length > 0) {
        throw createCliError(
          `Generator command "${primarySubcommand}" for ${resolvedPackageId} does not accept positional arguments.`
        );
      }
      return runCommandAdd({
        positional: ["package", resolvedPackageId],
        options: {
          ...options,
          commandMode: "generate"
        },
        cwd,
        io
      });
    }

    const templateRoot = await resolvePackageTemplateRoot({
      packageEntry,
      appRoot
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
      subcommandName,
      subcommandArgs,
      inlineOptions: options.inlineOptions,
      appRoot,
      io,
      dryRun: options.dryRun,
      json: options.json
    });
  }

  return runCommandAdd({
    positional: ["package", targetId],
    options: {
      ...options,
      commandMode: "generate"
    },
    cwd,
    io
  });
}

export { runPackageGenerateCommand };
