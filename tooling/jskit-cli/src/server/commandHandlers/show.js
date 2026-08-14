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
    normalizeRelativePosixPath,
    resolveAppRootFromCwd,
    resolvePackageIdInput,
    loadPackageRegistry,
    loadBundleRegistry,
    loadAppLocalPackageRegistry,
    loadInstalledAppPackageRegistry,
    mergePackageRegistries,
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

  async function resolveAppLocalShowTarget({ id, cwd, catalogPackageRegistry }) {
    let appRoot = "";
    try {
      appRoot = await resolveAppRootFromCwd(cwd);
    } catch {
      return null;
    }

    const appLocalRegistry = await loadAppLocalPackageRegistry(appRoot);
    const installedPackageRegistry = await loadInstalledAppPackageRegistry(appRoot);
    const appPackageRegistry = mergePackageRegistries(appLocalRegistry, installedPackageRegistry);
    const resolvedPackageId = resolvePackageIdInput(id, appPackageRegistry);
    if (resolvedPackageId) {
      return {
        packageRegistry: mergePackageRegistries(catalogPackageRegistry, appPackageRegistry),
        packageEntry: appPackageRegistry.get(resolvedPackageId)
      };
    }
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
