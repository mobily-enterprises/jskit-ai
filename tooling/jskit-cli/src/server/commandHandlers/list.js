import {
  ensureArray,
  ensureObject,
  sortStrings
} from "../shared/collectionUtils.js";

function createListCommands(ctx = {}) {
  const {
    createCliError,
    createColorFormatter,
    normalizeRelativePosixPath,
    resolveAppRootFromCwd,
    loadLockFile,
    loadPackageRegistry,
    loadBundleRegistry,
    loadAppLocalPackageRegistry,
    discoverShellOutletTargetsFromApp,
    resolvePackageKind
  } = ctx;

  async function commandList({ positional, options, cwd, stdout }) {
    const packageRegistry = await loadPackageRegistry();
    const bundleRegistry = await loadBundleRegistry();

    const appRoot = await resolveAppRootFromCwd(cwd);
    const appLocalRegistry = await loadAppLocalPackageRegistry(appRoot);
    const { lock } = await loadLockFile(appRoot);
    const installedPackageEntries = ensureObject(lock.installedPackages);
    const installedPackages = new Set(Object.keys(installedPackageEntries));
    const installedUnknownPackageIds = sortStrings(
      [...installedPackages].filter((packageId) => !packageRegistry.has(packageId))
    );
    const installedLocalPackageIds = sortStrings(
      installedUnknownPackageIds.filter((packageId) => {
        const lockEntry = ensureObject(installedPackageEntries[packageId]);
        const sourceType = String(ensureObject(lockEntry.source).type || "").trim();
        return sourceType === "local-package" || sourceType === "app-local-package" || appLocalRegistry.has(packageId);
      })
    );
    const installedExternalPackageIds = sortStrings(
      installedUnknownPackageIds.filter((packageId) => !installedLocalPackageIds.includes(packageId))
    );
    const availableLocalPackageIds = sortStrings(
      [...appLocalRegistry.keys()].filter((packageId) => !installedPackages.has(packageId))
    );

    const mode = String(positional[0] || "").trim();
    const shouldListBundles = !mode || mode === "bundles";
    const shouldListPackages = !mode || mode === "packages";
    const shouldListGenerators = !mode || mode === "generators";
    if (mode === "placements") {
      throw createCliError('list mode "placements" moved to a dedicated command: jskit list-placements.');
    }

    if (!shouldListBundles && !shouldListPackages && !shouldListGenerators) {
      throw createCliError(`Unknown list mode: ${mode}`, { showUsage: true });
    }

    const color = createColorFormatter(stdout);
    const lines = [];
    if (shouldListBundles) {
      lines.push(color.heading("Available bundles:"));
      const bundleIds = sortStrings([...bundleRegistry.keys()]);
      for (const bundleId of bundleIds) {
        const bundle = bundleRegistry.get(bundleId);
        const packageIds = ensureArray(bundle.packages).map((value) => String(value));
        const isInstalled = packageIds.length > 0 && packageIds.every((packageId) => installedPackages.has(packageId));
        const providerLabel = Number(bundle.provider) === 1 ? " [provider]" : "";
        const installedLabel = isInstalled ? " (installed)" : "";
        lines.push(
          `- ${color.item(bundle.bundleId)} ${color.version(`(${bundle.version})`)}${isInstalled ? color.installed(installedLabel) : installedLabel}${providerLabel ? color.provider(providerLabel) : providerLabel}: ${String(bundle.description || "")}`
        );
        if (options.full || options.expanded) {
          for (const packageId of packageIds) {
            lines.push(`  - ${color.dim(packageId)}`);
          }
        }
      }
    }

    if (shouldListPackages) {
      if (lines.length > 0) {
        lines.push("");
      }
      lines.push(color.heading("Available runtime packages:"));
      const packageIds = sortStrings([...packageRegistry.keys()].filter((packageId) => {
        const packageEntry = packageRegistry.get(packageId);
        return resolvePackageKind(packageEntry) === "runtime";
      }));
      for (const packageId of packageIds) {
        const packageEntry = packageRegistry.get(packageId);
        const installedLabel = installedPackages.has(packageId) ? " (installed)" : "";
        lines.push(
          `- ${color.item(packageId)} ${color.version(`(${packageEntry.version})`)}${installedLabel ? color.installed(installedLabel) : ""}`
        );
      }

      if (installedLocalPackageIds.length > 0) {
        lines.push("");
        lines.push(color.heading("Installed local packages:"));
        for (const packageId of installedLocalPackageIds) {
          const lockEntry = ensureObject(installedPackageEntries[packageId]);
          const version = String(lockEntry.version || "").trim();
          const versionLabel = version ? ` ${color.version(`(${version})`)}` : "";
          lines.push(`- ${color.item(packageId)}${versionLabel}${color.installed(" (installed)")}`);
        }
      }

      if (installedExternalPackageIds.length > 0) {
        lines.push("");
        lines.push(color.heading("Installed external packages:"));
        for (const packageId of installedExternalPackageIds) {
          const lockEntry = ensureObject(installedPackageEntries[packageId]);
          const version = String(lockEntry.version || "").trim();
          const versionLabel = version ? ` ${color.version(`(${version})`)}` : "";
          lines.push(`- ${color.item(packageId)}${versionLabel}${color.installed(" (installed)")}`);
        }
      }

      if (availableLocalPackageIds.length > 0) {
        lines.push("");
        lines.push(color.heading("Available local packages (not installed):"));
        for (const packageId of availableLocalPackageIds) {
          const packageEntry = appLocalRegistry.get(packageId);
          const version = String(packageEntry?.version || "").trim();
          const versionLabel = version ? ` ${color.version(`(${version})`)}` : "";
          lines.push(`- ${color.item(packageId)}${versionLabel}`);
        }
      }
    }

    if (shouldListGenerators) {
      if (lines.length > 0) {
        lines.push("");
      }
      lines.push(color.heading("Available generators:"));
      const packageIds = sortStrings([...packageRegistry.keys()].filter((packageId) => {
        const packageEntry = packageRegistry.get(packageId);
        return resolvePackageKind(packageEntry) === "generator";
      }));
      for (const packageId of packageIds) {
        const packageEntry = packageRegistry.get(packageId);
        const installedLabel = installedPackages.has(packageId) ? " (installed)" : "";
        lines.push(
          `- ${color.item(packageId)} ${color.version(`(${packageEntry.version})`)}${installedLabel ? color.installed(installedLabel) : ""}`
        );
      }
    }

    if (options.json) {
      const payload = {
        bundles: shouldListBundles
          ? sortStrings([...bundleRegistry.keys()]).map((bundleId) => {
            const bundle = bundleRegistry.get(bundleId);
            const packageIds = ensureArray(bundle.packages).map((value) => String(value));
            return {
              bundleId: bundle.bundleId,
              version: bundle.version,
              description: bundle.description || "",
              provider: Number(bundle.provider) === 1,
              installed: packageIds.length > 0 && packageIds.every((packageId) => installedPackages.has(packageId)),
              packages: packageIds
            };
          })
          : [],
        packages: shouldListPackages
          ? sortStrings([...packageRegistry.keys()])
            .filter((packageId) => resolvePackageKind(packageRegistry.get(packageId)) === "runtime")
            .map((packageId) => {
              const packageEntry = packageRegistry.get(packageId);
              return {
                packageId,
                version: packageEntry.version,
                installed: installedPackages.has(packageId)
              };
            })
          : [],
        runtimePackages: shouldListPackages
          ? sortStrings([...packageRegistry.keys()]).map((packageId) => {
            const packageEntry = packageRegistry.get(packageId);
            if (resolvePackageKind(packageEntry) !== "runtime") {
              return null;
            }
            return {
              packageId,
              version: packageEntry.version,
              installed: installedPackages.has(packageId)
            };
          }).filter(Boolean)
          : [],
        generators: shouldListGenerators
          ? sortStrings([...packageRegistry.keys()]).map((packageId) => {
            const packageEntry = packageRegistry.get(packageId);
            if (resolvePackageKind(packageEntry) !== "generator") {
              return null;
            }
            return {
              packageId,
              version: packageEntry.version,
              installed: installedPackages.has(packageId)
            };
          }).filter(Boolean)
          : [],
        installedLocalPackages: shouldListPackages
          ? installedLocalPackageIds.map((packageId) => {
            const lockEntry = ensureObject(installedPackageEntries[packageId]);
            return {
              packageId,
              version: String(lockEntry.version || "").trim()
            };
          })
          : [],
        installedExternalPackages: shouldListPackages
          ? installedExternalPackageIds.map((packageId) => {
            const lockEntry = ensureObject(installedPackageEntries[packageId]);
            return {
              packageId,
              version: String(lockEntry.version || "").trim(),
              source: ensureObject(lockEntry.source)
            };
          })
          : [],
        availableLocalPackages: shouldListPackages
          ? availableLocalPackageIds.map((packageId) => {
            const packageEntry = appLocalRegistry.get(packageId);
            return {
              packageId,
              version: String(packageEntry?.version || "").trim(),
              packagePath: normalizeRelativePosixPath(String(packageEntry?.relativeDir || ""))
            };
          })
          : []
      };
      stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      stdout.write(`${lines.join("\n")}\n`);
    }

    return 0;
  }

  async function commandListPlacements({ options, cwd, stdout }) {
    const appRoot = await resolveAppRootFromCwd(cwd);
    const discoveredPlacements = await discoverShellOutletTargetsFromApp({
      appRoot,
      sourceRoot: "src"
    });
    const placementTargets = ensureArray(discoveredPlacements.targets)
      .map((entry) => ensureObject(entry))
      .filter((entry) => String(entry.id || "").trim())
      .sort((left, right) => String(left.id || "").localeCompare(String(right.id || "")));

    if (options.json) {
      const payload = {
        placements: placementTargets.map((placementTarget) => ({
          id: String(placementTarget.id || "").trim(),
          host: String(placementTarget.host || "").trim(),
          position: String(placementTarget.position || "").trim(),
          default: placementTarget.default === true,
          sourcePath: String(placementTarget.sourcePath || "").trim()
        }))
      };
      stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      return 0;
    }

    const color = createColorFormatter(stdout);
    const lines = [color.heading("Available placements:")];
    if (placementTargets.length < 1) {
      lines.push("- none");
    } else {
      for (const placementTarget of placementTargets) {
        const placementId = String(placementTarget.id || "").trim();
        const sourcePath = String(placementTarget.sourcePath || "").trim();
        const isDefault = placementTarget.default === true;
        const defaultLabel = isDefault ? color.installed(" (default)") : "";
        const sourceLabel = sourcePath ? ` ${color.dim(`[${sourcePath}]`)}` : "";
        lines.push(`- ${color.item(placementId)}${defaultLabel}${sourceLabel}`);
      }
    }

    stdout.write(`${lines.join("\n")}\n`);
    return 0;
  }

  return {
    commandList,
    commandListPlacements
  };
}

export { createListCommands };
