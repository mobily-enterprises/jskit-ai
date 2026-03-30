import {
  ensureArray,
  ensureObject,
  sortStrings
} from "../shared/collectionUtils.js";

function createHealthCommands(ctx = {}) {
  const {
    resolveAppRootFromCwd,
    loadLockFile,
    loadPackageRegistry,
    loadBundleRegistry,
    loadAppLocalPackageRegistry,
    mergePackageRegistries,
    hydratePackageRegistryFromInstalledNodeModules,
    inspectPackageOfferings,
    fileExists,
    path
  } = ctx;

  function collectDescriptorContainerTokens({ packageId, side, values, issues }) {
    const declaredTokens = new Set();
    const duplicateTokens = new Set();
    let invalidCount = 0;

    for (const rawValue of ensureArray(values)) {
      if (typeof rawValue !== "string") {
        invalidCount += 1;
        continue;
      }
      const token = rawValue.trim();
      if (!token) {
        invalidCount += 1;
        continue;
      }
      if (declaredTokens.has(token)) {
        duplicateTokens.add(token);
        continue;
      }
      declaredTokens.add(token);
    }

    if (invalidCount > 0) {
      issues.push({
        packageId,
        side,
        code: "descriptor-token-invalid",
        message: `${packageId} (${side}): metadata.apiSummary.containerTokens includes ${invalidCount} non-string or empty token value(s).`
      });
    }
    for (const token of sortStrings([...duplicateTokens])) {
      issues.push({
        packageId,
        side,
        code: "descriptor-token-duplicate",
        token,
        message: `${packageId} (${side}): descriptor token is declared more than once: ${token}.`
      });
    }

    return declaredTokens;
  }

  function collectUsedContainerTokens({ packageId, side, bindings, issues }) {
    const usedTokens = new Set();
    for (const rawBinding of ensureArray(bindings)) {
      const binding = ensureObject(rawBinding);
      const tokenExpression = String(binding.tokenExpression || "").trim();
      const token = String(binding.token || "").trim();
      const location = String(binding.location || "").trim();
      if (binding.tokenResolved !== true || !token) {
        const expressionLabel = tokenExpression || "<empty>";
        const locationSuffix = location ? ` at ${location}` : "";
        issues.push({
          packageId,
          side,
          code: "binding-token-unresolved",
          tokenExpression: expressionLabel,
          location,
          message: `${packageId} (${side}): unresolved DI token expression "${expressionLabel}"${locationSuffix}.`
        });
        continue;
      }
      usedTokens.add(token);
    }
    return usedTokens;
  }

  function collectProviderIntrospectionIssues({ packageId, packageInsights, issues }) {
    const introspection = ensureObject(packageInsights);
    if (!introspection.available) {
      issues.push({
        packageId,
        side: "",
        code: "provider-introspection-unavailable",
        message: `${packageId}: provider source introspection is unavailable, so DI token parity cannot be verified.`
      });
      return;
    }

    const notes = ensureArray(introspection.notes).map((value) => String(value || "").trim()).filter(Boolean);
    for (const note of notes) {
      if (
        note.startsWith("Skipped wildcard provider entrypoint during introspection:") ||
        note.startsWith("Provider file missing during introspection:") ||
        note.startsWith("Failed reading provider ")
      ) {
        issues.push({
          packageId,
          side: "",
          code: "provider-introspection-incomplete",
          message: `${packageId}: ${note}`
        });
      }
    }
  }

  function collectDiLabelParityIssuesForPackage({ packageEntry, packageInsights }) {
    const packageId = String(packageEntry?.packageId || "").trim();
    const descriptor = ensureObject(packageEntry?.descriptor);
    const metadataApiSummary = ensureObject(ensureObject(descriptor.metadata).apiSummary);
    const descriptorTokenSummary = ensureObject(metadataApiSummary.containerTokens);
    const bindingSections = ensureObject(ensureObject(packageInsights).containerBindings);
    const issues = [];
    const sides = ["server", "client"];

    collectProviderIntrospectionIssues({ packageId, packageInsights, issues });

    for (const side of sides) {
      const declaredTokens = collectDescriptorContainerTokens({
        packageId,
        side,
        values: descriptorTokenSummary[side],
        issues
      });
      const usedTokens = collectUsedContainerTokens({
        packageId,
        side,
        bindings: bindingSections[side],
        issues
      });

      for (const token of sortStrings([...usedTokens])) {
        if (!declaredTokens.has(token)) {
          issues.push({
            packageId,
            side,
            code: "binding-token-undeclared",
            token,
            message: `${packageId} (${side}): token is used by providers but missing from metadata.apiSummary.containerTokens.${side}: ${token}.`
          });
        }
      }
      for (const token of sortStrings([...declaredTokens])) {
        if (!usedTokens.has(token)) {
          issues.push({
            packageId,
            side,
            code: "descriptor-token-unused",
            token,
            message: `${packageId} (${side}): token is declared in metadata.apiSummary.containerTokens.${side} but never bound by providers: ${token}.`
          });
        }
      }
    }

    return issues;
  }

  async function commandDoctor({ cwd, options, stdout }) {
    const appRoot = await resolveAppRootFromCwd(cwd);
    const { lock } = await loadLockFile(appRoot);
    const packageRegistry = await loadPackageRegistry();
    const appLocalRegistry = await loadAppLocalPackageRegistry(appRoot);
    const combinedPackageRegistry = mergePackageRegistries(packageRegistry, appLocalRegistry);
    const issues = [];
    const installed = ensureObject(lock.installedPackages);
    await hydratePackageRegistryFromInstalledNodeModules({
      appRoot,
      packageRegistry: combinedPackageRegistry,
      seedPackageIds: Object.keys(installed)
    });

    for (const [packageId, lockEntryValue] of Object.entries(installed)) {
      const lockEntry = ensureObject(lockEntryValue);
      if (!combinedPackageRegistry.has(packageId)) {
        issues.push(`Installed package not found in package registry: ${packageId}`);
        continue;
      }

      const managed = ensureObject(lockEntry.managed);
      for (const fileChange of ensureArray(managed.files)) {
        const changeRecord = ensureObject(fileChange);
        const relativePath = String(changeRecord.path || "").trim();
        const absolutePath = path.join(appRoot, relativePath);
        if (!(await fileExists(absolutePath))) {
          issues.push(`${packageId}: managed file missing: ${relativePath}`);
        }
      }
    }

    const payload = {
      appRoot,
      lockVersion: lock.lockVersion,
      installedPackages: sortStrings(Object.keys(installed)),
      issues
    };

    if (options.json) {
      stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      stdout.write(`App root: ${appRoot}\n`);
      stdout.write(`Installed packages: ${payload.installedPackages.length}\n`);
      if (issues.length === 0) {
        stdout.write("Doctor status: healthy\n");
      } else {
        stdout.write(`Doctor status: unhealthy (${issues.length} issue(s))\n`);
        for (const issue of issues) {
          stdout.write(`- ${issue}\n`);
        }
      }
    }

    return issues.length === 0 ? 0 : 1;
  }

  async function commandLintDescriptors({ options, stdout }) {
    const packageRegistry = await loadPackageRegistry();
    const bundleRegistry = await loadBundleRegistry();
    const shouldCheckDiLabels = options.checkDiLabels === true;
    let diLabelIssues = [];
    if (shouldCheckDiLabels) {
      const issues = [];
      for (const packageId of sortStrings([...packageRegistry.keys()])) {
        const packageEntry = packageRegistry.get(packageId);
        if (!packageEntry) {
          continue;
        }
        const packageInsights = await inspectPackageOfferings({ packageEntry });
        issues.push(...collectDiLabelParityIssuesForPackage({ packageEntry, packageInsights }));
      }
      diLabelIssues = issues;
    }
    const payload = {
      packageCount: packageRegistry.size,
      bundleCount: bundleRegistry.size,
      packages: sortStrings([...packageRegistry.keys()]),
      bundles: sortStrings([...bundleRegistry.keys()]),
      diLabelCheck: shouldCheckDiLabels
        ? {
            enabled: true,
            issueCount: diLabelIssues.length,
            issues: diLabelIssues
          }
        : {
            enabled: false
          }
    };

    if (options.json) {
      stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      const descriptorStatus = shouldCheckDiLabels && diLabelIssues.length > 0 ? "failed" : "passed";
      stdout.write(`Descriptor lint ${descriptorStatus}.\n`);
      stdout.write(`Packages: ${payload.packageCount}\n`);
      stdout.write(`Bundles: ${payload.bundleCount}\n`);
      if (shouldCheckDiLabels) {
        if (diLabelIssues.length === 0) {
          stdout.write("DI label parity check passed.\n");
        } else {
          stdout.write(`DI label parity check failed (${diLabelIssues.length} issue(s)).\n`);
          for (const issue of diLabelIssues) {
            const code = String(issue?.code || "").trim();
            const codeLabel = code ? `[${code}] ` : "";
            stdout.write(`- ${codeLabel}${String(issue?.message || "").trim()}\n`);
          }
        }
      }
    }
    if (shouldCheckDiLabels && diLabelIssues.length > 0) {
      return 1;
    }
    return 0;
  }

  return {
    commandDoctor,
    commandLintDescriptors
  };
}

export { createHealthCommands };
