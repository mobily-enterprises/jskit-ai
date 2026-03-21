import { isRecord } from "../shared/support/normalize.js";
import { sortStrings } from "../shared/support/sorting.js";

function normalizeDescriptorUiRoutes(value) {
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

function normalizeDescriptorClientProviders(value) {
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

function normalizeDescriptorClientOptimizeIncludeSpecifiers(value) {
  return Object.freeze(sortStrings(value));
}

function normalizeClientDescriptorSections(descriptorValue) {
  const descriptor = isRecord(descriptorValue) ? descriptorValue : {};
  const metadata = isRecord(descriptor.metadata) ? descriptor.metadata : {};
  const runtime = isRecord(descriptor.runtime) ? descriptor.runtime : {};
  const ui = isRecord(metadata.ui) ? metadata.ui : {};
  const clientMetadata = isRecord(metadata.client) ? metadata.client : {};
  const optimizeDeps = isRecord(clientMetadata.optimizeDeps) ? clientMetadata.optimizeDeps : {};
  const runtimeClient = isRecord(runtime.client) ? runtime.client : {};

  return Object.freeze({
    descriptorUiRoutes: normalizeDescriptorUiRoutes(ui.routes),
    descriptorClientProviders: normalizeDescriptorClientProviders(runtimeClient.providers),
    descriptorClientOptimizeIncludeSpecifiers: normalizeDescriptorClientOptimizeIncludeSpecifiers(
      optimizeDeps.include
    )
  });
}

export {
  normalizeDescriptorUiRoutes,
  normalizeDescriptorClientProviders,
  normalizeDescriptorClientOptimizeIncludeSpecifiers,
  normalizeClientDescriptorSections
};
