import { spawn } from "node:child_process";
import {
  ensureArray,
  ensureObject,
  sortStrings
} from "./collectionUtils.js";

function createCommandHandlers(deps) {
  const {
    createCliError,
    createColorFormatter,
    resolveWrapWidth,
    writeWrappedItems,
    normalizeRelativePath,
    normalizeRelativePosixPath,
    resolveAppRootFromCwd,
    loadLockFile,
    loadPackageRegistry,
    loadBundleRegistry,
    loadAppLocalPackageRegistry,
    mergePackageRegistries,
    resolvePackageIdInput,
    resolveInstalledPackageIdInput,
    resolveInstalledNodeModulePackageEntry,
    hydratePackageRegistryFromInstalledNodeModules,
    validateInlineOptionsForPackage,
    resolveLocalDependencyOrder,
    validatePlannedCapabilityClosure,
    resolvePackageOptions,
    applyPackageInstall,
    adoptAppLocalPackageDependencies,
    loadAppPackageJson,
    resolveLocalPackageId,
    createLocalPackageScaffoldFiles,
    fileExists,
    applyPackageJsonField,
    toFileDependencySpecifier,
    writeJsonFile,
    writeFile,
    mkdir,
    path,
    inspectPackageOfferings,
    buildFileWriteGroups,
    listDeclaredCapabilities,
    buildCapabilityDetailsForPackage,
    formatPackageSubpathImport,
    normalizePlacementOutlets,
    normalizePlacementContributions,
    shouldShowPackageExportTarget,
    classifyExportedSymbols,
    deriveProviderDisplayName,
    runCommandCapture,
    restorePackageJsonField,
    readFileBufferIfExists,
    removeEnvValue,
    hashBuffer,
    rm
  } = deps;

  function renderResolvedSummary(commandType, targetId, resolvedPackageIds, touchedFiles, appRoot, lockPath, externalDependencies) {
    const lines = [];
    lines.push(`${commandType} ${targetId}.`);
    lines.push(`Resolved packages (${resolvedPackageIds.length}):`);
    for (const packageId of resolvedPackageIds) {
      lines.push(`- ${packageId}`);
    }
  
    if (externalDependencies.length > 0) {
      lines.push(`External dependencies (${externalDependencies.length}):`);
      for (const dependencyId of externalDependencies) {
        lines.push(`- ${dependencyId}`);
      }
    }
  
    lines.push(`Touched files (${touchedFiles.length}):`);
    for (const touchedFile of touchedFiles) {
      lines.push(`- ${touchedFile}`);
    }
    lines.push(`Lock file: ${normalizeRelativePath(appRoot, lockPath)}`);
    return lines.join("\n");
  }
  
  async function runNpmInstall(appRoot, stderr) {
    await new Promise((resolve, reject) => {
      const child = spawn("npm", ["install"], {
        cwd: appRoot,
        stdio: "inherit"
      });
  
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(createCliError(`npm install failed with exit code ${code}.`));
        }
      });
    }).catch((error) => {
      stderr.write(`npm install failed: ${error.message}\n`);
      throw error;
    });
  }
  
  function getInstalledDependents(lock, packageId, packageRegistry) {
    const dependents = [];
    const installedPackageIds = Object.keys(ensureObject(lock.installedPackages));
  
    for (const installedId of installedPackageIds) {
      if (installedId === packageId) {
        continue;
      }
      const packageEntry = packageRegistry.get(installedId);
      if (!packageEntry) {
        continue;
      }
      const dependencies = ensureArray(packageEntry.descriptor.dependsOn).map((value) => String(value));
      if (dependencies.includes(packageId)) {
        dependents.push(installedId);
      }
    }
  
    return sortStrings(dependents);
  }
  
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
  
    if (!shouldListBundles && !shouldListPackages) {
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
      lines.push(color.heading("Available packages:"));
      const packageIds = sortStrings([...packageRegistry.keys()]);
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
          ? sortStrings([...packageRegistry.keys()]).map((packageId) => {
            const packageEntry = packageRegistry.get(packageId);
            return {
              packageId,
              version: packageEntry.version,
              installed: installedPackages.has(packageId)
            };
          })
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
  
  async function commandShow({ positional, options, stdout }) {
    const id = String(positional[0] || "").trim();
    if (!id) {
      throw createCliError("show requires an id.", { showUsage: true });
    }
  
    const packageRegistry = await loadPackageRegistry();
    const bundleRegistry = await loadBundleRegistry();
    const color = createColorFormatter(stdout);
    const writeField = (label, value, formatValue = (raw) => raw) => {
      stdout.write(`${color.dim(`${label}:`)} ${formatValue(String(value || ""))}\n`);
    };
    const resolvedPackageId = resolvePackageIdInput(id, packageRegistry);
  
    if (resolvedPackageId) {
      const packageEntry = packageRegistry.get(resolvedPackageId);
      const descriptor = packageEntry.descriptor;
      const fileWriteGroups = buildFileWriteGroups(ensureArray(ensureObject(descriptor.mutations).files));
      const fileWriteCount = fileWriteGroups.reduce((total, group) => total + ensureArray(group.files).length, 0);
      const capabilities = ensureObject(descriptor.capabilities);
      const runtime = ensureObject(descriptor.runtime);
      const metadata = ensureObject(descriptor.metadata);
      const mutations = ensureObject(descriptor.mutations);
      const runtimeMutations = ensureObject(ensureObject(mutations.dependencies).runtime);
      const devMutations = ensureObject(ensureObject(mutations.dependencies).dev);
      const scriptMutations = ensureObject(ensureObject(mutations.packageJson).scripts);
      const textMutations = ensureArray(mutations.text);
      const packageInsights = await inspectPackageOfferings({ packageEntry });
      const payload = {
        kind: "package",
        packageId: descriptor.packageId,
        version: descriptor.version,
        description: String(descriptor.description || ""),
        dependsOn: ensureArray(descriptor.dependsOn).map((value) => String(value)),
        capabilities,
        options: ensureObject(descriptor.options),
        runtime,
        metadata,
        mutations,
        fileWritePlan: {
          groupCount: fileWriteGroups.length,
          fileCount: fileWriteCount,
          groups: fileWriteGroups
        },
        descriptorPath: packageEntry.descriptorRelativePath,
        introspection: {
          available: Boolean(packageInsights.available),
          notes: ensureArray(packageInsights.notes)
        },
        packageExports: ensureArray(packageInsights.packageExports),
        containerBindings: ensureObject(packageInsights.containerBindings),
        exportedSymbols: ensureArray(packageInsights.exportedSymbols)
      };
      const provides = listDeclaredCapabilities(payload.capabilities, "provides");
      const requires = listDeclaredCapabilities(payload.capabilities, "requires");
      const capabilityDetails = options.details
        ? buildCapabilityDetailsForPackage({
            packageRegistry,
            packageId: payload.packageId,
            dependsOn: payload.dependsOn,
            provides,
            requires
          })
        : null;
      if (capabilityDetails) {
        payload.capabilityDetails = capabilityDetails;
      }
      if (options.json) {
        stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      } else {
        const runtimeMutationEntries = Object.entries(runtimeMutations);
        const devMutationEntries = Object.entries(devMutations);
        const scriptMutationEntries = Object.entries(scriptMutations);
        const wrapWidth = resolveWrapWidth(stdout, 80);
        const introspection = ensureObject(payload.introspection);
        const introspectionAvailable = introspection.available === true;
        const introspectionNotes = ensureArray(introspection.notes)
          .map((value) => String(value || "").trim())
          .filter(Boolean);
        const metadataApiSummary = ensureObject(ensureObject(payload.metadata).apiSummary);
        const metadataUi = ensureObject(ensureObject(payload.metadata).ui);
        const summarySurfaces = ensureArray(metadataApiSummary.surfaces)
          .map((entry) => {
            const record = ensureObject(entry);
            return {
              subpath: String(record.subpath || "").trim(),
              summary: String(record.summary || "").trim()
            };
          })
          .filter((entry) => entry.subpath && entry.summary);
        const containerTokenSummary = ensureObject(metadataApiSummary.containerTokens);
        const quickServerTokens = ensureArray(containerTokenSummary.server).map((value) => String(value || "").trim()).filter(Boolean);
        const quickClientTokens = ensureArray(containerTokenSummary.client).map((value) => String(value || "").trim()).filter(Boolean);
        const metadataUiPlacements = ensureObject(metadataUi.placements);
        const placementOutlets = normalizePlacementOutlets(metadataUiPlacements.outlets);
        const placementContributions = normalizePlacementContributions(metadataUiPlacements.contributions);
        const packageExports = ensureArray(payload.packageExports);
        const exportedSymbols = ensureArray(payload.exportedSymbols);
        const exportedSymbolsByFile = new Map(
          exportedSymbols
            .map((entry) => ensureObject(entry))
            .map((entry) => {
              const file = normalizeRelativePosixPath(String(entry.file || "").trim());
              return file ? [file, entry] : null;
            })
            .filter(Boolean)
        );
        const bindingSections = ensureObject(payload.containerBindings);
        const serverBindings = ensureArray(bindingSections.server);
        const clientBindings = ensureArray(bindingSections.client);
        stdout.write(`${color.heading("Information")}\n`);
        writeField("Package", payload.packageId, color.item);
        writeField("Version", payload.version, color.installed);
        if (payload.description) {
          writeField("Description", payload.description);
        }
        writeField("Descriptor", payload.descriptorPath, color.dim);
        if (summarySurfaces.length > 0) {
          stdout.write(`${color.heading("Summary:")}\n`);
          for (const summaryEntry of summarySurfaces) {
            const importPath = formatPackageSubpathImport(payload.packageId, summaryEntry.subpath);
            stdout.write(`- ${color.item(`${importPath}:`)}\n`);
            stdout.write(`  ${summaryEntry.summary}\n`);
          }
        }
        if (quickServerTokens.length > 0 || quickClientTokens.length > 0) {
          stdout.write(`${color.heading("Container tokens")} ${color.dim("-- app.make('...'):")}\n`);
          if (quickServerTokens.length > 0) {
            stdout.write(`- ${color.installed("server")}: ${quickServerTokens.map((token) => color.item(token)).join(", ")}\n`);
          }
          if (quickClientTokens.length > 0) {
            stdout.write(`- ${color.installed("client")}: ${quickClientTokens.map((token) => color.item(token)).join(", ")}\n`);
          }
        }
        if (placementOutlets.length > 0) {
          stdout.write(`${color.heading(`Placement outlets (accepted slots) (${placementOutlets.length}):`)}\n`);
          for (const outlet of placementOutlets) {
            const surfaces = ensureArray(outlet.surfaces).map((value) => String(value || "").trim()).filter(Boolean);
            const surfacesLabel = surfaces.length > 0 ? ` ${color.installed(`[surfaces:${surfaces.join(", ")}]`)}` : "";
            const description = String(outlet.description || "").trim();
            const descriptionSuffix = description ? `: ${description}` : "";
            stdout.write(`- ${color.item(outlet.slot)}${surfacesLabel}${descriptionSuffix}\n`);
            if (options.details) {
              const sourceLabel = String(outlet.source || "").trim();
              if (sourceLabel) {
                stdout.write(`  ${color.dim(`source: ${sourceLabel}`)}\n`);
              }
            }
          }
        }
        if (placementContributions.length > 0) {
          stdout.write(`${color.heading(`Placement contributions (default entries) (${placementContributions.length}):`)}\n`);
          for (const contribution of placementContributions) {
            const surface = String(contribution.surface || "").trim() || "*";
            const orderSuffix = Number.isFinite(contribution.order) ? ` ${color.installed(`[order:${contribution.order}]`)}` : "";
            const componentToken = String(contribution.componentToken || "").trim();
            const componentSuffix = componentToken ? ` ${color.dim(`component:${componentToken}`)}` : "";
            const description = String(contribution.description || "").trim();
            const descriptionSuffix = description ? `: ${description}` : "";
            stdout.write(
              `- ${color.item(contribution.id)} ${color.dim("->")} ${color.item(contribution.slot)} ${color.installed(`[surface:${surface}]`)}${orderSuffix}${componentSuffix}${descriptionSuffix}\n`
            );
            if (options.details) {
              const when = String(contribution.when || "").trim();
              if (when) {
                stdout.write(`  ${color.dim(`when: ${when}`)}\n`);
              }
              const sourceLabel = String(contribution.source || "").trim();
              if (sourceLabel) {
                stdout.write(`  ${color.dim(`source: ${sourceLabel}`)}\n`);
              }
            }
          }
        }
        if (introspectionAvailable) {
          stdout.write(`${color.heading(`Container bindings server (${serverBindings.length}):`)}\n`);
          if (serverBindings.length < 1) {
            stdout.write(`- ${color.dim("none detected")}\n`);
          } else {
            for (const bindingRecord of serverBindings) {
              const binding = ensureObject(bindingRecord);
              const token = String(binding.token || "").trim();
              const tokenExpression = String(binding.tokenExpression || "").trim();
              const tokenLabel = binding.tokenResolved === true
                ? token
                : token || tokenExpression;
              const bindingMethod = String(binding.binding || "").trim();
              const providerName = deriveProviderDisplayName(binding);
              const lifecycle = String(binding.lifecycle || "").trim();
              const lifecycleSuffix = lifecycle && lifecycle !== "unknown" ? ` ${color.dim(`(${lifecycle})`)}` : "";
              const unresolvedSuffix = binding.tokenResolved === true ? "" : color.dim(" [unresolved token]");
              stdout.write(
                `- ${color.item(tokenLabel)} ${color.installed(`[${bindingMethod}]`)} ${color.dim("by")} ${color.item(providerName)}${lifecycleSuffix}${unresolvedSuffix}\n`
              );
              if (options.details) {
                const location = String(binding.location || "").trim();
                if (location) {
                  stdout.write(`  ${color.dim(`source: ${location}`)}\n`);
                }
                const providerLabel = String(binding.provider || "").trim();
                if (providerLabel) {
                  stdout.write(`  ${color.dim(`provider: ${providerLabel}`)}\n`);
                }
                if (binding.tokenResolved !== true && tokenExpression) {
                  stdout.write(`  ${color.dim(`token expression: ${tokenExpression}`)}\n`);
                }
              }
            }
          }
  
          stdout.write(`${color.heading(`Container bindings client (${clientBindings.length}):`)}\n`);
          if (clientBindings.length < 1) {
            stdout.write(`- ${color.dim("none detected")}\n`);
          } else {
            for (const bindingRecord of clientBindings) {
              const binding = ensureObject(bindingRecord);
              const token = String(binding.token || "").trim();
              const tokenExpression = String(binding.tokenExpression || "").trim();
              const tokenLabel = binding.tokenResolved === true
                ? token
                : token || tokenExpression;
              const bindingMethod = String(binding.binding || "").trim();
              const providerName = deriveProviderDisplayName(binding);
              const lifecycle = String(binding.lifecycle || "").trim();
              const lifecycleSuffix = lifecycle && lifecycle !== "unknown" ? ` ${color.dim(`(${lifecycle})`)}` : "";
              const unresolvedSuffix = binding.tokenResolved === true ? "" : color.dim(" [unresolved token]");
              stdout.write(
                `- ${color.item(tokenLabel)} ${color.installed(`[${bindingMethod}]`)} ${color.dim("by")} ${color.item(providerName)}${lifecycleSuffix}${unresolvedSuffix}\n`
              );
              if (options.details) {
                const location = String(binding.location || "").trim();
                if (location) {
                  stdout.write(`  ${color.dim(`source: ${location}`)}\n`);
                }
                const providerLabel = String(binding.provider || "").trim();
                if (providerLabel) {
                  stdout.write(`  ${color.dim(`provider: ${providerLabel}`)}\n`);
                }
                if (binding.tokenResolved !== true && tokenExpression) {
                  stdout.write(`  ${color.dim(`token expression: ${tokenExpression}`)}\n`);
                }
              }
            }
          }
        }
        if (introspectionAvailable) {
          stdout.write(`${color.heading(`Package exports (${packageExports.length}):`)}\n`);
          if (packageExports.length < 1) {
            stdout.write(`- ${color.dim("none declared")}\n`);
          } else {
            const symbolDetailsShown = new Set();
            for (const packageExport of packageExports) {
              const record = ensureObject(packageExport);
              const subpath = String(record.subpath || ".").trim() || ".";
              const condition = String(record.condition || "default").trim() || "default";
              const target = String(record.target || "").trim();
              const targetType = String(record.targetType || "").trim();
              const conditionSuffix = condition !== "default" ? ` ${color.installed(`[${condition}]`)}` : "";
              const status = targetType === "file"
                ? record.targetExists === true
                  ? color.installed("[ok]")
                  : color.provider("[missing]")
                : targetType === "pattern"
                  ? color.dim("[pattern]")
                  : color.dim("[external]");
              const showTarget = shouldShowPackageExportTarget({ subpath, target, targetType });
              const targetSuffix = showTarget ? ` -> ${color.item(target)}` : "";
              const subpathLabel = options.details ? color.white(subpath) : color.item(subpath);
              stdout.write(`- ${subpathLabel}${conditionSuffix}${targetSuffix} ${status}\n`);
  
              if (!options.details) {
                continue;
              }
              if (targetType !== "file" || !target.startsWith("./")) {
                continue;
              }
  
              const normalizedTarget = normalizeRelativePosixPath(target.slice(2));
              const summary = ensureObject(exportedSymbolsByFile.get(normalizedTarget));
              if (!summary || Object.keys(summary).length < 1) {
                continue;
              }
  
              const detailKey = `${subpath}::${normalizedTarget}`;
              if (symbolDetailsShown.has(detailKey)) {
                continue;
              }
              symbolDetailsShown.add(detailKey);
  
              const symbols = ensureArray(summary.symbols).map((value) => String(value)).filter(Boolean);
              const classifiedSymbols = classifyExportedSymbols(symbols);
              const writeClassifiedSymbols = (label, entries) => {
                const items = ensureArray(entries).map((entry) => String(entry || "").trim()).filter(Boolean);
                if (items.length < 1) {
                  return;
                }
                writeWrappedItems({
                  stdout,
                  heading: `  ${color.installed(`${label} (${items.length}):`)}`,
                  lineIndent: "    ",
                  wrapWidth,
                  items: items.map((symbol) => ({
                    text: symbol,
                    rendered: color.item(symbol)
                  }))
                });
              };
              writeClassifiedSymbols("providers", classifiedSymbols.providers);
              writeClassifiedSymbols("functions/helpers", classifiedSymbols.functions);
              writeClassifiedSymbols("constants", classifiedSymbols.constants);
              writeClassifiedSymbols("classes/types", classifiedSymbols.classesOrTypes);
              writeClassifiedSymbols("internal/test hooks", classifiedSymbols.internals);
              writeClassifiedSymbols("other symbols", classifiedSymbols.others);
  
              if (summary.hasDefaultExport === true) {
                stdout.write(`  ${color.installed("default export: yes")}\n`);
              }
              const starReExports = ensureArray(summary.starReExports).map((value) => String(value)).filter(Boolean);
              const namedReExports = ensureArray(summary.namedReExports).map((value) => String(value)).filter(Boolean);
              const reExportSummary = [];
              if (namedReExports.length > 0) {
                reExportSummary.push(`named from ${namedReExports.length} files`);
              }
              if (starReExports.length > 0) {
                reExportSummary.push(`star from ${starReExports.length} files`);
              }
              if (options.debugExports && reExportSummary.length > 0) {
                stdout.write(`  ${color.dim(`re-export sources: ${reExportSummary.join(", ")}`)}\n`);
              }
  
              if (options.debugExports && starReExports.length > 0) {
                writeWrappedItems({
                  stdout,
                  heading: `  ${color.installed(`star re-exports (${starReExports.length}):`)}`,
                  lineIndent: "    ",
                  wrapWidth,
                  items: starReExports.map((specifier) => ({
                    text: specifier,
                    rendered: color.item(specifier)
                  }))
                });
              }
              if (options.debugExports && namedReExports.length > 0) {
                writeWrappedItems({
                  stdout,
                  heading: `  ${color.installed(`named re-exports (${namedReExports.length}):`)}`,
                  lineIndent: "    ",
                  wrapWidth,
                  items: namedReExports.map((specifier) => ({
                    text: specifier,
                    rendered: color.item(specifier)
                  }))
                });
              }
            }
          }
        } else {
          stdout.write(`${color.heading("Code introspection:")}\n`);
          stdout.write(`- ${color.dim("Source files unavailable (descriptor metadata only).")}\n`);
        }
        if (payload.dependsOn.length > 0) {
          writeWrappedItems({
            stdout,
            heading: `${color.heading("Depends on")} ${color.installed(`(${payload.dependsOn.length})`)}:`,
            wrapWidth,
            items: payload.dependsOn.map((dependencyId) => {
              const text = String(dependencyId);
              return {
                text,
                rendered: color.item(text)
              };
            })
          });
        }
        if (runtimeMutationEntries.length > 0) {
          writeWrappedItems({
            stdout,
            heading: color.heading(`Dependency mutations runtime (${runtimeMutationEntries.length}):`),
            wrapWidth,
            items: runtimeMutationEntries.map(([dependencyId, versionSpec]) => {
              const dependencyText = String(dependencyId);
              const versionText = String(versionSpec);
              return {
                text: `${dependencyText} ${versionText}`,
                rendered: `${color.item(dependencyText)} ${color.installed(versionText)}`
              };
            })
          });
        }
  
        if (provides.length > 0 || requires.length > 0) {
          stdout.write(`${color.heading("Capabilities:")}\n`);
          if (provides.length > 0) {
            const providesText = provides.map((capabilityId) => color.item(capabilityId)).join(" ");
            stdout.write(`${color.installed("Provides:")} ${providesText}\n`);
          }
          if (requires.length > 0) {
            const requiresText = requires.map((capabilityId) => color.item(capabilityId)).join(" ");
            stdout.write(`${color.installed("Requires:")} ${requiresText}\n`);
          }
        }
        if (capabilityDetails && (capabilityDetails.provides.length > 0 || capabilityDetails.requires.length > 0)) {
          const formatPackageSummary = (detail) => {
            const packageId = String(detail?.packageId || "").trim();
            const version = String(detail?.version || "").trim();
            const descriptorPath = String(detail?.descriptorPath || "").trim();
            const versionSuffix = version ? `@${version}` : "";
            const pathSuffix = descriptorPath ? ` [${descriptorPath}]` : "";
            return `${packageId}${versionSuffix}${pathSuffix}`;
          };
  
          const writeCapabilityRecord = ({ heading, records, includeDependsOnProviders = false }) => {
            if (records.length < 1) {
              return;
            }
            stdout.write(`${color.heading(heading)}\n`);
            for (const record of records) {
              const capabilityId = String(record.capabilityId || "").trim();
              stdout.write(`- ${color.item(capabilityId)}\n`);
  
              const providerItems = ensureArray(record.providerDetails).map((detail) => ({
                text: formatPackageSummary(detail),
                rendered: color.item(formatPackageSummary(detail))
              }));
              if (providerItems.length > 0) {
                writeWrappedItems({
                  stdout,
                  heading: `  ${color.installed(`providers (${providerItems.length}):`)}`,
                  lineIndent: "    ",
                  wrapWidth,
                  items: providerItems
                });
              }
  
              if (includeDependsOnProviders) {
                const providersInDependsOn = ensureArray(record.providersInDependsOn).map((packageId) => ({
                  text: String(packageId),
                  rendered: color.item(String(packageId))
                }));
                if (providersInDependsOn.length > 0) {
                  writeWrappedItems({
                    stdout,
                    heading: `  ${color.installed(`providers in dependsOn (${providersInDependsOn.length}):`)}`,
                    lineIndent: "    ",
                    wrapWidth,
                    items: providersInDependsOn
                  });
                }
              }
  
              const requirerItems = ensureArray(record.requirerDetails).map((detail) => ({
                text: formatPackageSummary(detail),
                rendered: color.item(formatPackageSummary(detail))
              }));
              if (requirerItems.length > 0) {
                writeWrappedItems({
                  stdout,
                  heading: `  ${color.installed(`required by (${requirerItems.length}):`)}`,
                  lineIndent: "    ",
                  wrapWidth,
                  items: requirerItems
                });
              }
            }
          };
  
          stdout.write(`${color.heading("Capability details:")}\n`);
          writeCapabilityRecord({
            heading: `Provides detail (${capabilityDetails.provides.length}):`,
            records: capabilityDetails.provides,
            includeDependsOnProviders: false
          });
          writeCapabilityRecord({
            heading: `Requires detail (${capabilityDetails.requires.length}):`,
            records: capabilityDetails.requires,
            includeDependsOnProviders: true
          });
        }
  
        const uiRoutes = ensureArray(ensureObject(payload.metadata.ui).routes);
        if (uiRoutes.length > 0) {
          stdout.write(`${color.heading(`UI routes (${uiRoutes.length}):`)}\n`);
          for (const route of uiRoutes) {
            const record = ensureObject(route);
            const routePath = String(record.path || "").trim();
            const scope = String(record.scope || "").trim();
            const routeId = String(record.id || record.name || "").trim();
            const purpose = String(record.purpose || "").trim();
            const modeLabel = record.autoRegister === false ? "advisory" : "auto";
            const scopeLabel = scope ? ` (${scope})` : "";
            const modePart = ` ${color.installed(`[${modeLabel}]`)}`;
            const purposePart = purpose ? ` ${purpose}` : "";
            const idPart = routeId ? ` ${color.installed(`(id:${routeId})`)}` : "";
            stdout.write(`- ${color.item(routePath)}${color.installed(scopeLabel)}${modePart}${purposePart}${idPart}\n`);
          }
        }
  
        const serverRoutes = ensureArray(ensureObject(payload.metadata.server).routes);
        if (serverRoutes.length > 0) {
          stdout.write(`${color.heading(`Server routes (${serverRoutes.length}):`)}\n`);
          for (const route of serverRoutes) {
            const record = ensureObject(route);
            const method = String(record.method || "").trim().toUpperCase();
            const routePath = String(record.path || "").trim();
            const summary = String(record.summary || "").trim();
            const routeLabel = `${method} ${routePath}`.trim();
            const summarySuffix = summary ? `: ${summary}` : "";
            stdout.write(`- ${color.item(routeLabel)}${summarySuffix}\n`);
          }
        }
  
        const optionNames = Object.keys(payload.options);
        if (optionNames.length > 0) {
          stdout.write(`${color.heading(`Options (${optionNames.length}):`)}\n`);
          for (const optionName of optionNames) {
            const schema = ensureObject(payload.options[optionName]);
            const required = schema.required ? "required" : "optional";
            const defaultSuffix = schema.defaultValue ? ` (default: ${schema.defaultValue})` : "";
            stdout.write(`- ${color.item(optionName)} ${color.installed(`[${required}]`)}${color.dim(defaultSuffix)}\n`);
          }
        }
  
        if (devMutationEntries.length > 0) {
          writeWrappedItems({
            stdout,
            heading: color.heading(`Dependency mutations dev (${devMutationEntries.length}):`),
            wrapWidth,
            items: devMutationEntries.map(([dependencyId, versionSpec]) => {
              const dependencyText = String(dependencyId);
              const versionText = String(versionSpec);
              return {
                text: `${dependencyText} ${versionText}`,
                rendered: `${color.item(dependencyText)} ${color.installed(versionText)}`
              };
            })
          });
        }
        if (scriptMutationEntries.length > 0) {
          stdout.write(`${color.heading(`Script mutations (${scriptMutationEntries.length}):`)}\n`);
          for (const [scriptName, scriptValue] of scriptMutationEntries) {
            stdout.write(`- ${color.item(scriptName)}: ${String(scriptValue)}\n`);
          }
        }
        if (textMutations.length > 0) {
          stdout.write(`${color.heading(`Text mutations (${textMutations.length}):`)}\n`);
          for (const mutation of textMutations) {
            const record = ensureObject(mutation);
            const op = String(record.op || "").trim();
            const file = String(record.file || "").trim();
            const key = String(record.key || "").trim();
            const position = String(record.position || "").trim();
            const reason = String(record.reason || "").trim();
            const reasonSuffix = reason ? `: ${reason}` : "";
            const mutationLabel = op === "append-text"
              ? `${op} ${file}${position ? ` [${position}]` : ""}`
              : `${op} ${file} ${key}`.trim();
            stdout.write(`- ${color.item(mutationLabel)}${reasonSuffix}\n`);
          }
        }
  
        if (payload.fileWritePlan.fileCount > 0) {
          stdout.write(`${color.heading(`File writes (${payload.fileWritePlan.fileCount}):`)}\n`);
          for (const group of payload.fileWritePlan.groups) {
            const groupId = String(group.id || "").trim();
            const category = String(group.category || "").trim();
            const reason = String(group.reason || "").trim();
            const files = ensureArray(group.files);
            const marker = groupId ? `id:${groupId}` : category ? `category:${category}` : "";
            const markerSuffix = marker ? ` (${marker})` : "";
            for (const file of files) {
              const targetPath = String(ensureObject(file).to || "").trim();
              if (!targetPath) {
                continue;
              }
              stdout.write(`- ${color.item(targetPath)}${color.installed(markerSuffix)}:\n`);
              if (reason) {
                stdout.write(`  ${reason}\n`);
              }
            }
          }
        }
  
        const serverProviders = ensureArray(ensureObject(payload.runtime.server).providers);
        const clientProviders = ensureArray(ensureObject(payload.runtime.client).providers);
        if (serverProviders.length > 0) {
          stdout.write(`${color.heading(`Runtime server providers (${serverProviders.length}):`)}\n`);
          for (const provider of serverProviders) {
            const record = ensureObject(provider);
            const entrypoint = String(record.entrypoint || "").trim();
            const exportName = String(record.export || "").trim();
            const label = exportName ? `${entrypoint}#${exportName}` : entrypoint;
            stdout.write(`- ${color.item(label)}\n`);
          }
        }
        if (clientProviders.length > 0) {
          stdout.write(`${color.heading(`Runtime client providers (${clientProviders.length}):`)}\n`);
          for (const provider of clientProviders) {
            const record = ensureObject(provider);
            const entrypoint = String(record.entrypoint || "").trim();
            const exportName = String(record.export || "").trim();
            const label = exportName ? `${entrypoint}#${exportName}` : entrypoint;
            stdout.write(`- ${color.item(label)}\n`);
          }
        }
        if (introspectionNotes.length > 0) {
          stdout.write(`${color.heading(`Introspection notes (${introspectionNotes.length}):`)}\n`);
          for (const note of introspectionNotes) {
            stdout.write(`- ${color.dim(note)}\n`);
          }
        }
      }
      return 0;
    }
  
    if (bundleRegistry.has(id)) {
      const bundle = bundleRegistry.get(id);
      const payload = {
        kind: "bundle",
        bundleId: bundle.bundleId,
        version: bundle.version,
        description: String(bundle.description || ""),
        provider: Number(bundle.provider) === 1,
        curated: Number(bundle.curated) === 1,
        packages: ensureArray(bundle.packages).map((value) => String(value))
      };
      if (options.json) {
        stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      } else {
        stdout.write(`${color.heading("Information")}\n`);
        writeField("Bundle", payload.bundleId, color.item);
        writeField("Version", payload.version, color.installed);
        if (payload.description) {
          writeField("Description", payload.description);
        }
        stdout.write(`${color.heading(`Packages (${payload.packages.length}):`)}\n`);
        for (const packageId of payload.packages) {
          stdout.write(`- ${color.item(packageId)}\n`);
        }
      }
      return 0;
    }
  
    throw createCliError(`Unknown package or bundle: ${id}`);
  }
  
  async function commandCreate({ positional, options, cwd, io }) {
    const targetType = String(positional[0] || "").trim();
    const rawName = String(positional[1] || "").trim();
    if (targetType !== "package" || !rawName) {
      throw createCliError("create requires: create package <name>", { showUsage: true });
    }
  
    const appRoot = await resolveAppRootFromCwd(cwd);
    const { packageJsonPath, packageJson } = await loadAppPackageJson(appRoot);
    const { lockPath, lock } = await loadLockFile(appRoot);
    const installedPackages = ensureObject(lock.installedPackages);
    const dependencies = ensureObject(packageJson.dependencies);
    const devDependencies = ensureObject(packageJson.devDependencies);
  
    const { packageId, packageDirName } = resolveLocalPackageId({
      rawName,
      appPackageName: packageJson.name,
      inlineOptions: options.inlineOptions
    });
    const localPackagesRoot = path.join(appRoot, "packages");
    const packageRoot = path.join(localPackagesRoot, packageDirName);
    const packageRelativePath = normalizeRelativePath(appRoot, packageRoot);
    const descriptorRelativePath = `${normalizeRelativePosixPath(packageRelativePath)}/package.descriptor.mjs`;
    const localDependencySpecifier = toFileDependencySpecifier(packageRelativePath);
    const packageDescription = String(options.inlineOptions.description || "").trim() || `App-local package ${packageId}.`;
  
    if (await fileExists(packageRoot)) {
      throw createCliError(`Package directory already exists: ${normalizeRelativePath(appRoot, packageRoot)}`);
    }
    if (Object.prototype.hasOwnProperty.call(installedPackages, packageId)) {
      throw createCliError(`Package is already present in lock file: ${packageId}`);
    }
    if (Object.prototype.hasOwnProperty.call(dependencies, packageId)) {
      throw createCliError(`package.json dependencies already contains ${packageId}.`);
    }
    if (Object.prototype.hasOwnProperty.call(devDependencies, packageId)) {
      throw createCliError(`package.json devDependencies already contains ${packageId}.`);
    }
  
    const scaffoldFiles = createLocalPackageScaffoldFiles({
      packageId,
      packageDescription
    });
    const touchedFiles = new Set(["package.json", normalizeRelativePath(appRoot, lockPath)]);
    for (const scaffoldFile of scaffoldFiles) {
      touchedFiles.add(`${normalizeRelativePosixPath(packageRelativePath)}/${normalizeRelativePosixPath(scaffoldFile.relativePath)}`);
    }
  
    if (!options.dryRun) {
      for (const scaffoldFile of scaffoldFiles) {
        const absoluteFilePath = path.join(packageRoot, scaffoldFile.relativePath);
        await mkdir(path.dirname(absoluteFilePath), { recursive: true });
        await writeFile(absoluteFilePath, String(scaffoldFile.content || ""), "utf8");
      }
    }
  
    const dependencyApplied = applyPackageJsonField(packageJson, "dependencies", packageId, localDependencySpecifier);
    const managedRecord = {
      packageId,
      version: "0.1.0",
      source: {
        type: "local-package",
        packagePath: normalizeRelativePosixPath(packageRelativePath),
        descriptorPath: descriptorRelativePath
      },
      managed: {
        packageJson: {
          dependencies: {},
          devDependencies: {},
          scripts: {}
        },
        text: {},
        files: [],
        migrations: []
      },
      options: {},
      installedAt: new Date().toISOString()
    };
    if (dependencyApplied.changed) {
      managedRecord.managed.packageJson.dependencies[packageId] = dependencyApplied.managed;
    }
    lock.installedPackages[packageId] = managedRecord;
  
    const touchedFileList = sortStrings([...touchedFiles]);
    if (!options.dryRun) {
      await writeJsonFile(packageJsonPath, packageJson);
      await writeJsonFile(lockPath, lock);
      if (!options.noInstall) {
        await runNpmInstall(appRoot, io.stderr);
      }
    }
  
    if (options.json) {
      io.stdout.write(
        `${JSON.stringify(
          {
            targetType: "package",
            packageId,
            packageDirectory: normalizeRelativePosixPath(packageRelativePath),
            descriptorPath: descriptorRelativePath,
            dependency: localDependencySpecifier,
            touchedFiles: touchedFileList,
            lockPath: normalizeRelativePath(appRoot, lockPath),
            dryRun: options.dryRun
          },
          null,
          2
        )}\n`
      );
    } else {
      io.stdout.write(`Created local package ${packageId}.\n`);
      io.stdout.write(`Directory: ${normalizeRelativePosixPath(packageRelativePath)}\n`);
      io.stdout.write(`Dependency: ${packageId} -> ${localDependencySpecifier}\n`);
      io.stdout.write(`Descriptor: ${descriptorRelativePath}\n`);
      io.stdout.write(`Touched files (${touchedFileList.length}):\n`);
      for (const touchedFile of touchedFileList) {
        io.stdout.write(`- ${touchedFile}\n`);
      }
      io.stdout.write(`Lock file: ${normalizeRelativePath(appRoot, lockPath)}\n`);
      if (options.dryRun) {
        io.stdout.write("Dry run enabled: no files were written.\n");
      }
    }
  
    return 0;
  }
  
  async function commandAdd({ positional, options, cwd, io }) {
    const targetType = String(positional[0] || "").trim();
    const targetId = String(positional[1] || "").trim();
  
    if (!targetType || !targetId) {
      throw createCliError("add requires target type and id (add bundle <id> | add package <id>).", {
        showUsage: true
      });
    }
    if (targetType !== "bundle" && targetType !== "package") {
      throw createCliError(`Unsupported add target type: ${targetType}`, { showUsage: true });
    }
  
    const appRoot = await resolveAppRootFromCwd(cwd);
    const packageRegistry = await loadPackageRegistry();
    const appLocalRegistry = await loadAppLocalPackageRegistry(appRoot);
    const bundleRegistry = await loadBundleRegistry();
    const combinedPackageRegistry = mergePackageRegistries(packageRegistry, appLocalRegistry);
    const { packageJsonPath, packageJson } = await loadAppPackageJson(appRoot);
    const { lockPath, lock } = await loadLockFile(appRoot);
    let resolvedTargetPackageId = targetType === "package" ? resolvePackageIdInput(targetId, combinedPackageRegistry) : "";
    if (targetType === "package" && !resolvedTargetPackageId) {
      const installedNodeModuleEntry = await resolveInstalledNodeModulePackageEntry({
        appRoot,
        packageId: targetId
      });
      if (installedNodeModuleEntry) {
        combinedPackageRegistry.set(installedNodeModuleEntry.packageId, installedNodeModuleEntry);
        resolvedTargetPackageId = installedNodeModuleEntry.packageId;
      }
    }
  
    const targetPackageIds = targetType === "bundle"
      ? ensureArray(bundleRegistry.get(targetId)?.packages).map((value) => String(value))
      : [resolvedTargetPackageId];
    if (targetType === "bundle" && targetPackageIds.length === 0) {
      throw createCliError(`Unknown bundle: ${targetId}`);
    }
    if (targetType === "package" && !resolvedTargetPackageId) {
      throw createCliError(
        `Unknown package: ${targetId}. Install an external module first (npm install ${targetId}) if you want to adopt it into lock.`
      );
    }
  
    await hydratePackageRegistryFromInstalledNodeModules({
      appRoot,
      packageRegistry: combinedPackageRegistry,
      seedPackageIds: targetPackageIds
    });
  
    if (targetType === "package") {
      const targetPackageEntry = combinedPackageRegistry.get(resolvedTargetPackageId);
      if (!targetPackageEntry) {
        throw createCliError(`Unknown package: ${targetId}`);
      }
      validateInlineOptionsForPackage(targetPackageEntry, options.inlineOptions);
    }
  
    const { ordered: resolvedPackageIds, externalDependencies } = resolveLocalDependencyOrder(
      targetPackageIds,
      combinedPackageRegistry
    );
    const plannedInstalledPackageIds = sortStrings([
      ...new Set([
        ...Object.keys(ensureObject(lock.installedPackages)).map((value) => String(value || "").trim()).filter(Boolean),
        ...resolvedPackageIds
      ])
    ]);
    validatePlannedCapabilityClosure(
      plannedInstalledPackageIds,
      combinedPackageRegistry,
      `add ${targetType} ${targetId}`
    );
  
    const packagesToInstall = [];
    const resolvedOptionsByPackage = {};
    const forceReapplyTarget = options?.forceReapplyTarget === true;
    const hasInlineOptions = Object.keys(ensureObject(options.inlineOptions)).length > 0;
    for (const packageId of resolvedPackageIds) {
      const packageEntry = combinedPackageRegistry.get(packageId);
      const existingInstall = ensureObject(lock.installedPackages[packageId]);
      const existingVersion = String(existingInstall.version || "").trim();
      const isDirectTargetPackage = targetType === "package" && packageId === resolvedTargetPackageId;
      const shouldReapplyInstalledPackage = isDirectTargetPackage && (forceReapplyTarget || hasInlineOptions);
      if (existingVersion && existingVersion === packageEntry.version && !shouldReapplyInstalledPackage) {
        continue;
      }
      packagesToInstall.push(packageId);
      const lockEntryOptions = ensureObject(existingInstall.options);
      resolvedOptionsByPackage[packageId] = await resolvePackageOptions(
        packageEntry,
        {
          ...lockEntryOptions,
          ...(isDirectTargetPackage ? options.inlineOptions : {})
        },
        io
      );
    }
  
    const touchedFiles = new Set();
    const installedPackageRecords = [];
  
    for (const packageId of packagesToInstall) {
      const packageEntry = combinedPackageRegistry.get(packageId);
      const managedRecord = await applyPackageInstall({
        packageEntry,
        packageOptions: resolvedOptionsByPackage[packageId],
        appRoot,
        appPackageJson: packageJson,
        lock,
        packageRegistry: combinedPackageRegistry,
        touchedFiles
      });
      installedPackageRecords.push(managedRecord);
    }
  
    const {
      appLocalRegistry: refreshedAppLocalRegistry,
      adoptedPackageIds
    } = await adoptAppLocalPackageDependencies({
      appRoot,
      appPackageJson: packageJson,
      lock
    });
    for (const [packageId, packageEntry] of refreshedAppLocalRegistry.entries()) {
      combinedPackageRegistry.set(packageId, packageEntry);
    }
    if (adoptedPackageIds.length > 0) {
      const postInstallPackageIds = sortStrings(Object.keys(ensureObject(lock.installedPackages)));
      validatePlannedCapabilityClosure(
        postInstallPackageIds,
        combinedPackageRegistry,
        `add ${targetType} ${targetId}`
      );
    }
  
    const finalResolvedPackageIds = sortStrings([...resolvedPackageIds, ...adoptedPackageIds]);
  
    const touchedFileList = sortStrings([...touchedFiles]);
    const successLabel = targetType === "bundle" ? "Added bundle" : "Added package";
    const installWarnings = installedPackageRecords
      .flatMap((record) => ensureArray(ensureObject(record).warnings))
      .map((value) => String(value || "").trim())
      .filter(Boolean);
  
    if (!options.dryRun) {
      await writeJsonFile(packageJsonPath, packageJson);
      await writeJsonFile(lockPath, lock);
      if (!options.noInstall) {
        await runNpmInstall(appRoot, io.stderr);
      }
    }
  
    if (options.json) {
      io.stdout.write(`${JSON.stringify({
        targetType,
        targetId,
        resolvedPackages: finalResolvedPackageIds,
        touchedFiles: touchedFileList,
        lockPath: normalizeRelativePath(appRoot, lockPath),
        externalDependencies,
        dryRun: options.dryRun,
        installed: installedPackageRecords,
        warnings: installWarnings
      }, null, 2)}\n`);
    } else {
      io.stdout.write(
        `${renderResolvedSummary(
          `${successLabel}`,
          targetId,
          finalResolvedPackageIds,
          touchedFileList,
          appRoot,
          lockPath,
          externalDependencies
        )}\n`
      );
      if (installWarnings.length > 0) {
        io.stdout.write(`Warnings (${installWarnings.length}):\n`);
        for (const warning of installWarnings) {
          io.stdout.write(`- ${warning}\n`);
        }
      }
      if (options.dryRun) {
        io.stdout.write("Dry run enabled: no files were written.\n");
      }
    }
  
    return 0;
  }
  
  async function commandUpdate({ positional, options, cwd, io }) {
    const targetType = String(positional[0] || "").trim();
    const targetId = String(positional[1] || "").trim();
    if (targetType !== "package" || !targetId) {
      throw createCliError("update requires: update package <packageId>", { showUsage: true });
    }
  
    const appRoot = await resolveAppRootFromCwd(cwd);
    const { lock } = await loadLockFile(appRoot);
    const installedPackages = ensureObject(lock.installedPackages);
    const resolvedTargetId = resolveInstalledPackageIdInput(targetId, installedPackages);
    if (!resolvedTargetId) {
      throw createCliError(`Package is not installed: ${targetId}`);
    }
  
    return commandAdd({
      positional: ["package", resolvedTargetId],
      options: {
        ...options,
        forceReapplyTarget: true
      },
      cwd,
      io
    });
  }
  
  async function commandRemove({ positional, options, cwd, io }) {
    const targetType = String(positional[0] || "").trim();
    const targetId = String(positional[1] || "").trim();
    if (targetType !== "package" || !targetId) {
      throw createCliError("remove requires: remove package <packageId>", { showUsage: true });
    }
  
    const appRoot = await resolveAppRootFromCwd(cwd);
    const packageRegistry = await loadPackageRegistry();
    const appLocalRegistry = await loadAppLocalPackageRegistry(appRoot);
    const combinedPackageRegistry = mergePackageRegistries(packageRegistry, appLocalRegistry);
    const { packageJsonPath, packageJson } = await loadAppPackageJson(appRoot);
    const { lockPath, lock } = await loadLockFile(appRoot);
    const installed = ensureObject(lock.installedPackages);
    await hydratePackageRegistryFromInstalledNodeModules({
      appRoot,
      packageRegistry: combinedPackageRegistry,
      seedPackageIds: Object.keys(installed)
    });
    const resolvedTargetId = resolveInstalledPackageIdInput(targetId, installed);
  
    if (!resolvedTargetId) {
      throw createCliError(`Package is not installed: ${targetId}`);
    }
  
    const dependents = getInstalledDependents(lock, resolvedTargetId, combinedPackageRegistry);
    if (dependents.length > 0) {
      throw createCliError(
        `Cannot remove ${resolvedTargetId}; installed packages depend on it: ${dependents.join(", ")}`
      );
    }
  
    const lockEntry = ensureObject(installed[resolvedTargetId]);
    const managed = ensureObject(lockEntry.managed);
    const touchedFiles = new Set();
  
    const managedPackageJson = ensureObject(managed.packageJson);
    for (const [dependencyId, managedChange] of Object.entries(ensureObject(managedPackageJson.dependencies))) {
      if (restorePackageJsonField(packageJson, "dependencies", dependencyId, managedChange)) {
        touchedFiles.add("package.json");
      }
    }
    for (const [dependencyId, managedChange] of Object.entries(ensureObject(managedPackageJson.devDependencies))) {
      if (restorePackageJsonField(packageJson, "devDependencies", dependencyId, managedChange)) {
        touchedFiles.add("package.json");
      }
    }
    for (const [scriptName, managedChange] of Object.entries(ensureObject(managedPackageJson.scripts))) {
      if (restorePackageJsonField(packageJson, "scripts", scriptName, managedChange)) {
        touchedFiles.add("package.json");
      }
    }
  
    const managedText = ensureObject(managed.text);
    for (const change of Object.values(managedText)) {
      const changeRecord = ensureObject(change);
      if (String(changeRecord.op || "") !== "upsert-env") {
        continue;
      }
      const relativeFile = String(changeRecord.file || "").trim();
      if (!relativeFile) {
        continue;
      }
      const absoluteFile = path.join(appRoot, relativeFile);
      const existing = await readFileBufferIfExists(absoluteFile);
      if (!existing.exists) {
        continue;
      }
      const updated = removeEnvValue(
        existing.buffer.toString("utf8"),
        String(changeRecord.key || ""),
        String(changeRecord.value || ""),
        {
          hadPrevious: Boolean(changeRecord.hadPrevious),
          previousValue: String(changeRecord.previousValue || "")
        }
      );
      if (updated.changed) {
        await writeFile(absoluteFile, updated.content, "utf8");
        touchedFiles.add(normalizeRelativePath(appRoot, absoluteFile));
      }
    }
  
    for (const fileChange of ensureArray(managed.files)) {
      const changeRecord = ensureObject(fileChange);
      if (changeRecord.preserveOnRemove === true) {
        continue;
      }
      const relativeFile = String(changeRecord.path || "").trim();
      if (!relativeFile) {
        continue;
      }
      const absoluteFile = path.join(appRoot, relativeFile);
      const existing = await readFileBufferIfExists(absoluteFile);
      if (!existing.exists) {
        continue;
      }
      if (hashBuffer(existing.buffer) !== String(changeRecord.hash || "")) {
        continue;
      }
  
      if (changeRecord.hadPrevious) {
        const previousBuffer = Buffer.from(String(changeRecord.previousContentBase64 || ""), "base64");
        await writeFile(absoluteFile, previousBuffer);
      } else {
        await rm(absoluteFile);
      }
      touchedFiles.add(relativeFile);
    }
  
    delete installed[resolvedTargetId];
    const touchedFileList = sortStrings([...touchedFiles]);
  
    if (!options.dryRun) {
      await writeJsonFile(packageJsonPath, packageJson);
      await writeJsonFile(lockPath, lock);
      if (!options.noInstall) {
        await runNpmInstall(appRoot, io.stderr);
      }
    }
  
    if (options.json) {
      io.stdout.write(`${JSON.stringify({
        removedPackage: resolvedTargetId,
        touchedFiles: touchedFileList,
        lockPath: normalizeRelativePath(appRoot, lockPath),
        dryRun: options.dryRun
      }, null, 2)}\n`);
    } else {
      io.stdout.write(`Removed package ${resolvedTargetId}.\n`);
      io.stdout.write(`Touched files (${touchedFileList.length}):\n`);
      for (const touchedFile of touchedFileList) {
        io.stdout.write(`- ${touchedFile}\n`);
      }
      io.stdout.write(`Lock file: ${normalizeRelativePath(appRoot, lockPath)}\n`);
      if (options.dryRun) {
        io.stdout.write("Dry run enabled: no files were written.\n");
      }
    }
  
    return 0;
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
    const payload = {
      packageCount: packageRegistry.size,
      bundleCount: bundleRegistry.size,
      packages: sortStrings([...packageRegistry.keys()]),
      bundles: sortStrings([...bundleRegistry.keys()])
    };

    if (options.json) {
      stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      stdout.write(`Descriptor lint passed.\n`);
      stdout.write(`Packages: ${payload.packageCount}\n`);
      stdout.write(`Bundles: ${payload.bundleCount}\n`);
    }
    return 0;
  }

  return {
    commandList,
    commandShow,
    commandCreate,
    commandAdd,
    commandUpdate,
    commandRemove,
    commandDoctor,
    commandLintDescriptors
  };
}

export { createCommandHandlers };
