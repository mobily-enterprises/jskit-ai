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
    resolvePackageIdInput,
    loadPackageRegistry,
    loadBundleRegistry,
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

  async function commandShow({ positional, options, stdout }) {
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

    throw createCliError(`Unknown package or bundle: ${id}`);
  }

  return {
    commandShow
  };
}

export { createShowCommand };
