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
  if (!targetId) {
    throw createCliError("generate requires a package id (generate <packageId>).", {
      showUsage: true
    });
  }

  if (subcommandName) {
    const appRoot = await resolveAppRootFromCwd(cwd);
    const packageRegistry = await loadPackageRegistry();
    const appLocalRegistry = await loadAppLocalPackageRegistry(appRoot);
    const combinedPackageRegistry = mergePackageRegistries(packageRegistry, appLocalRegistry);

    const resolvedPackageId = await resolvePackageIdFromRegistryOrNodeModules({
      appRoot,
      packageRegistry: combinedPackageRegistry,
      packageIdInput: targetId
    });
    if (!resolvedPackageId) {
      throw createCliError(
        `Unknown package: ${targetId}. Install it first (npm install ${targetId}) if you want to run generator subcommands from node_modules.`
      );
    }

    await hydratePackageRegistryFromInstalledNodeModules({
      appRoot,
      packageRegistry: combinedPackageRegistry,
      seedPackageIds: [resolvedPackageId]
    });
    const packageEntry = combinedPackageRegistry.get(resolvedPackageId);
    if (!packageEntry) {
      throw createCliError(`Unknown package: ${targetId}`);
    }

    if (resolvePackageKind(packageEntry) !== "generator") {
      throw createCliError(
        `Package ${resolvedPackageId} is a runtime package. Use: jskit add package ${resolvedPackageId}`
      );
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

    return runGeneratorSubcommand({
      packageEntry,
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
