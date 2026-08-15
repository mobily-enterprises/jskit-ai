import path from "node:path";
import { pathToFileURL } from "node:url";
import { defineProvider } from "../../../shared/capabilities/defineProvider.js";
import { fileExists, isIdentifier, isInsidePackageRoot } from "./helpers.js";

function declaredProviderEntrypoints(packageEntry) {
  const runtime = packageEntry?.packageMetadata?.runtime;
  const server = runtime && typeof runtime === "object" ? runtime.server : null;
  const entries = Array.isArray(server?.providers) ? server.providers : [];

  return entries.map((value) => {
    const entry = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    if (entry.discover != null) {
      throw new Error(
        `Package ${packageEntry.packageId} runtime.server.providers[] must declare an explicit entrypoint and export.`
      );
    }
    const entrypoint = String(entry.entrypoint || "").trim();
    const exportName = String(entry.export || "").trim();
    if (!entrypoint) {
      throw new Error(`Package ${packageEntry.packageId} runtime.server.providers[] entrypoint is required.`);
    }
    if (!isIdentifier(exportName)) {
      throw new Error(
        `Package ${packageEntry.packageId} runtime.server.providers[] export is invalid: ${exportName || "<missing>"}`
      );
    }
    return Object.freeze({ entrypoint, exportName });
  });
}

function normalizeProviderExports(value, packageId, exportName) {
  const queue = Array.isArray(value) ? [...value] : [value];
  const providers = [];
  while (queue.length > 0) {
    const candidate = queue.shift();
    if (Array.isArray(candidate)) {
      queue.unshift(...candidate);
      continue;
    }
    try {
      providers.push(defineProvider(candidate));
    } catch (error) {
      throw new Error(
        `Package ${packageId} provider export "${exportName}" must contain provider definitions: ${error.message}`,
        { cause: error }
      );
    }
  }
  if (providers.length < 1) {
    throw new Error(`Package ${packageId} provider export "${exportName}" is empty.`);
  }
  return providers;
}

async function loadCapabilityProviders({ packageEntry } = {}) {
  const providers = [];
  for (const declaration of declaredProviderEntrypoints(packageEntry)) {
    const modulePath = path.resolve(packageEntry.packageRoot, declaration.entrypoint);
    if (!isInsidePackageRoot(packageEntry.packageRoot, modulePath)) {
      throw new Error(
        `Package ${packageEntry.packageId} provider entrypoint escapes package root: ${declaration.entrypoint}`
      );
    }
    if (!(await fileExists(modulePath))) {
      throw new Error(
        `Package ${packageEntry.packageId} provider entrypoint not found: ${declaration.entrypoint}`
      );
    }

    const namespace = await import(pathToFileURL(modulePath).href);
    if (!Object.hasOwn(namespace, declaration.exportName)) {
      throw new Error(
        `Package ${packageEntry.packageId} provider export "${declaration.exportName}" was not found.`
      );
    }
    providers.push(
      ...normalizeProviderExports(
        namespace[declaration.exportName],
        packageEntry.packageId,
        declaration.exportName
      )
    );
  }
  return Object.freeze(providers);
}

function appendCapabilityProviders({ providers, sourceId, seenProviderIds, orderedProviders }) {
  for (const provider of providers) {
    if (seenProviderIds.has(provider.id)) {
      throw new Error(
        `Provider id "${provider.id}" is duplicated between ${seenProviderIds.get(provider.id)} and ${sourceId}.`
      );
    }
    seenProviderIds.set(provider.id, sourceId);
    orderedProviders.push(provider);
  }
}

export { appendCapabilityProviders, loadCapabilityProviders };
