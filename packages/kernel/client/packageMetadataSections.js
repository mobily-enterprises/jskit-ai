import { isRecord } from "../shared/support/normalize.js";
import { sortStrings } from "../shared/support/sorting.js";

function normalizePackageMetadataUiRoutes(value) {
  const routeEntries = Array.isArray(value) ? value : [];
  const normalizedRoutes = [];

  for (const routeEntry of routeEntries) {
    if (!isRecord(routeEntry)) {
      continue;
    }

    try {
      normalizedRoutes.push(Object.freeze(JSON.parse(JSON.stringify(routeEntry))));
    } catch {
      // Skip non-serializable route declarations.
    }
  }

  return Object.freeze(normalizedRoutes);
}

function normalizePackageMetadataClientProviders(value) {
  const entries = Array.isArray(value) ? value : [];
  const providers = [];

  for (const entry of entries) {
    if (!isRecord(entry)) {
      continue;
    }

    const exportName = String(entry.export || "").trim();
    if (!exportName) {
      continue;
    }

    providers.push(
      Object.freeze({
        export: exportName,
        entrypoint: String(entry.entrypoint || "").trim()
      })
    );
  }

  return Object.freeze(providers);
}

function normalizePackageMetadataClientOptimizeSpecifiers(value) {
  return Object.freeze(sortStrings(value));
}

function normalizeClientPackageMetadataSections(packageMetadataValue) {
  const packageMetadata = isRecord(packageMetadataValue) ? packageMetadataValue : {};
  const metadata = isRecord(packageMetadata.metadata) ? packageMetadata.metadata : {};
  const runtime = isRecord(packageMetadata.runtime) ? packageMetadata.runtime : {};
  const ui = isRecord(metadata.ui) ? metadata.ui : {};
  const clientMetadata = isRecord(metadata.client) ? metadata.client : {};
  const optimizeDeps = isRecord(clientMetadata.optimizeDeps) ? clientMetadata.optimizeDeps : {};
  const runtimeClient = isRecord(runtime.client) ? runtime.client : {};

  return Object.freeze({
    packageMetadataUiRoutes: normalizePackageMetadataUiRoutes(ui.routes),
    packageMetadataClientProviders: normalizePackageMetadataClientProviders(runtimeClient.providers),
    packageMetadataClientOptimizeIncludeSpecifiers: normalizePackageMetadataClientOptimizeSpecifiers(optimizeDeps.include),
    packageMetadataClientOptimizeExcludeSpecifiers: normalizePackageMetadataClientOptimizeSpecifiers(optimizeDeps.exclude)
  });
}

export {
  normalizePackageMetadataUiRoutes,
  normalizePackageMetadataClientProviders,
  normalizePackageMetadataClientOptimizeSpecifiers,
  normalizeClientPackageMetadataSections
};
