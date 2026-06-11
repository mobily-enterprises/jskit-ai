import { createShowRenderHelpers } from "./show/renderHelpers.js";
import {
  buildBundleShowPayload,
  buildPackageShowPayload
} from "./show/payloads.js";
import { renderBundlePayloadText } from "./show/renderBundleText.js";
import { renderPackagePayloadText } from "./show/renderPackageText.js";

function createShowCommand(ctx = {}) {
  const {
    createCliError,
    createColorFormatter,
    resolveWrapWidth,
    writeWrappedItems,
    normalizeRelativePath,
    normalizeRelativePosixPath,
    resolveAppRootFromCwd,
    resolvePackageIdInput,
    loadPackageRegistry,
    loadBundleRegistry,
    loadAppLocalPackageRegistry,
    loadLockFile,
    mergePackageRegistries,
    path,
    fileExists,
    inspectPackageOfferings,
    buildFileWriteGroups,
    listDeclaredCapabilities,
    buildCapabilityDetailsForPackage,
    formatPackageSubpathImport,
    normalizePlacementOutlets,
    normalizePlacementContributions,
    shouldShowPackageExportTarget,
    classifyExportedSymbols,
    deriveProviderDisplayName
  } = ctx;

  async function renderPackageEntry({
    packageRegistry,
    packageEntry,
    options,
    stdout,
    color
  }) {
    const {
      payload,
      provides,
      requires,
      capabilityDetails
    } = await buildPackageShowPayload({
      packageRegistry,
      packageEntry,
      options,
      inspectPackageOfferings,
      buildFileWriteGroups,
      listDeclaredCapabilities,
      buildCapabilityDetailsForPackage
    });

    if (options.json) {
      stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      renderPackagePayloadText({
        payload,
        provides,
        requires,
        capabilityDetails,
        options,
        stdout,
        color,
        resolveWrapWidth,
        writeWrappedItems,
        normalizeRelativePosixPath,
        formatPackageSubpathImport,
        normalizePlacementOutlets,
        normalizePlacementContributions,
        shouldShowPackageExportTarget,
        classifyExportedSymbols,
        deriveProviderDisplayName
      });
    }
  }

  function isLocalPackageLockEntry(lockEntry = {}) {
    const sourceType = String(lockEntry?.source?.type || "").trim();
    return sourceType === "local-package" || sourceType === "app-local-package";
  }

  function resolveInstalledLocalPackageEntry(lock = {}, id = "") {
    const normalizedId = String(id || "").trim();
    if (!normalizedId) {
      return null;
    }

    const installedPackages = lock?.installedPackages || {};
    const directEntry = installedPackages[normalizedId];
    if (directEntry && isLocalPackageLockEntry(directEntry)) {
      return {
        packageId: normalizedId,
        lockEntry: directEntry
      };
    }

    for (const [packageId, lockEntry] of Object.entries(installedPackages)) {
      if (!isLocalPackageLockEntry(lockEntry)) {
        continue;
      }
      const recordedPackageId = String(lockEntry?.packageId || "").trim();
      if (recordedPackageId === normalizedId) {
        return {
          packageId,
          lockEntry
        };
      }
    }

    return null;
  }

  async function assertInstalledLocalPackageIsDiscoverable({ appRoot, id }) {
    const { lock } = await loadLockFile(appRoot);
    const installedLocalPackage = resolveInstalledLocalPackageEntry(lock, id);
    if (!installedLocalPackage) {
      return;
    }

    const { packageId, lockEntry } = installedLocalPackage;
    const source = lockEntry?.source || {};
    const descriptorPath = String(source.descriptorPath || "").trim();
    if (!descriptorPath) {
      throw createCliError(
        `Local package ${packageId} is recorded in .jskit/lock.json but has no descriptorPath.`
      );
    }

    const absoluteDescriptorPath = path.resolve(appRoot, descriptorPath);
    if (!(await fileExists(absoluteDescriptorPath))) {
      throw createCliError(
        `Local package ${packageId} is recorded in .jskit/lock.json but descriptor is missing at ${descriptorPath}.`
      );
    }

    const packagePath = String(source.packagePath || "").trim();
    if (packagePath) {
      const packageJsonPath = path.join(appRoot, packagePath, "package.json");
      if (!(await fileExists(packageJsonPath))) {
        throw createCliError(
          `Local package ${packageId} is recorded in .jskit/lock.json but package.json is missing at ${packagePath}/package.json.`
        );
      }
    }

    const descriptorLabel = normalizeRelativePath(appRoot, absoluteDescriptorPath);
    throw createCliError(
      `Local package ${packageId} is recorded in .jskit/lock.json but was not discoverable from ${descriptorLabel}. Ensure its package.json name matches the descriptor packageId.`
    );
  }

  async function resolveAppLocalShowTarget({ id, cwd, catalogPackageRegistry }) {
    let appRoot = "";
    try {
      appRoot = await resolveAppRootFromCwd(cwd);
    } catch {
      return null;
    }

    const appLocalRegistry = await loadAppLocalPackageRegistry(appRoot);
    const resolvedPackageId = resolvePackageIdInput(id, appLocalRegistry);
    if (resolvedPackageId) {
      return {
        packageRegistry: mergePackageRegistries(catalogPackageRegistry, appLocalRegistry),
        packageEntry: appLocalRegistry.get(resolvedPackageId)
      };
    }

    await assertInstalledLocalPackageIsDiscoverable({ appRoot, id });
    return null;
  }

  async function commandShow({ positional, options, cwd, stdout }) {
    const id = String(positional[0] || "").trim();
    if (!id) {
      throw createCliError("show requires an id.", { showUsage: true });
    }

    const packageRegistry = await loadPackageRegistry();
    const bundleRegistry = await loadBundleRegistry();
    const color = createColorFormatter(stdout);
    const resolvedPackageId = resolvePackageIdInput(id, packageRegistry);

    if (resolvedPackageId) {
      const packageEntry = packageRegistry.get(resolvedPackageId);
      await renderPackageEntry({
        packageRegistry,
        packageEntry,
        options,
        stdout,
        color
      });
      return 0;
    }

    if (bundleRegistry.has(id)) {
      const bundle = bundleRegistry.get(id);
      const payload = buildBundleShowPayload(bundle);
      if (options.json) {
        stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      } else {
        const { writeField } = createShowRenderHelpers({
          stdout,
          color,
          options,
          deriveProviderDisplayName
        });
        renderBundlePayloadText({
          payload,
          stdout,
          color,
          writeField
        });
      }
      return 0;
    }

    const appLocalTarget = await resolveAppLocalShowTarget({
      id,
      cwd,
      catalogPackageRegistry: packageRegistry
    });
    if (appLocalTarget) {
      await renderPackageEntry({
        packageRegistry: appLocalTarget.packageRegistry,
        packageEntry: appLocalTarget.packageEntry,
        options,
        stdout,
        color
      });
      return 0;
    }

    throw createCliError(`Unknown package or bundle: ${id}`);
  }

  return {
    commandShow
  };
}

export { createShowCommand };
