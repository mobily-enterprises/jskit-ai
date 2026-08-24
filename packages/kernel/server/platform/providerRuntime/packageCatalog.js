import { sortStrings } from "../../../shared/support/sorting.js";
import { discoverInstalledPackages } from "../../../internal/node/installedPackages.js";

const EXCLUSIVE_CAPABILITIES = Object.freeze([
  "auth.service",
  "runtime.database.driver"
]);

function normalizeUiRoutePath(pathValue) {
  const rawPath = String(pathValue || "").trim();
  if (!rawPath || !rawPath.startsWith("/") || rawPath.startsWith("//")) {
    return "";
  }

  const normalizedPath = rawPath.replace(/\/{2,}/g, "/");
  if (normalizedPath === "/") {
    return "/";
  }

  return normalizedPath.replace(/\/+$/, "") || "/";
}

function collectGlobalUiPaths(packageEntries) {
  const globalUiPaths = [];
  const entries = Array.isArray(packageEntries) ? packageEntries : [];

  for (const packageEntry of entries) {
    const uiRoutes = Array.isArray(packageEntry?.packageMetadata?.metadata?.ui?.routes)
      ? packageEntry.packageMetadata.metadata.ui.routes
      : [];

    for (const routeEntry of uiRoutes) {
      const routeRecord = routeEntry && typeof routeEntry === "object" && !Array.isArray(routeEntry) ? routeEntry : null;
      if (!routeRecord) {
        continue;
      }

      const scope = String(routeRecord.scope || "")
        .trim()
        .toLowerCase();
      if (scope !== "global") {
        continue;
      }

      const routePath = normalizeUiRoutePath(routeRecord.path);
      if (!routePath) {
        continue;
      }
      globalUiPaths.push(routePath);
    }
  }

  return Object.freeze(sortStrings(globalUiPaths));
}

async function resolveInstalledJskitPackages({ appRoot }) {
  return (await discoverInstalledPackages({ appRoot })).map((entry) => ({
    packageId: entry.packageId,
    packageMetadata: entry.packageMetadata,
    manifestPath: entry.manifestPath,
    packageRoot: entry.packageRoot,
    dependencyIds: entry.dependencyIds,
    sourceType: entry.sourceType,
    direct: entry.direct,
    version: entry.version
  }));
}

function resolvePackageLoadOrder(packageEntries) {
  const byPackageId = new Map(packageEntries.map((entry) => [entry.packageId, entry]));
  const visiting = new Set();
  const visited = new Set();
  const ordered = [];

  function visit(packageId, lineage = []) {
    if (visited.has(packageId)) {
      return;
    }
    if (visiting.has(packageId)) {
      throw new Error(`Package dependency cycle detected: ${[...lineage, packageId].join(" -> ")}`);
    }

    const entry = byPackageId.get(packageId);
    if (!entry) {
      return;
    }

    visiting.add(packageId);
    for (const dependencyPackageId of Array.isArray(entry.dependencyIds) ? entry.dependencyIds : []) {
      if (byPackageId.has(dependencyPackageId)) {
        visit(dependencyPackageId, [...lineage, packageId]);
      }
    }
    visiting.delete(packageId);
    visited.add(packageId);
    ordered.push(entry);
  }

  for (const packageId of sortStrings([...byPackageId.keys()])) {
    visit(packageId);
  }

  return ordered;
}

function registerCapabilityProvider(providersByCapability, capabilityId, providerPackageId) {
  const normalizedCapabilityId = String(capabilityId || "").trim();
  const normalizedProviderPackageId = String(providerPackageId || "").trim();
  if (!normalizedCapabilityId || !normalizedProviderPackageId) {
    return;
  }

  if (!providersByCapability.has(normalizedCapabilityId)) {
    providersByCapability.set(normalizedCapabilityId, new Set());
  }
  providersByCapability.get(normalizedCapabilityId).add(normalizedProviderPackageId);
}

function validatePackageCapabilities(packageEntries, { builtinProvidersByCapability = {} } = {}) {
  const providersByCapability = new Map();
  for (const packageEntry of packageEntries) {
    for (const capabilityId of Array.isArray(packageEntry.packageMetadata?.capabilities?.provides)
      ? packageEntry.packageMetadata.capabilities.provides
      : []) {
      registerCapabilityProvider(providersByCapability, capabilityId, packageEntry.packageId);
    }
  }

  for (const [capabilityId, providerPackageIds] of Object.entries(
    builtinProvidersByCapability && typeof builtinProvidersByCapability === "object" ? builtinProvidersByCapability : {}
  )) {
    for (const providerPackageId of Array.isArray(providerPackageIds) ? providerPackageIds : [providerPackageIds]) {
      registerCapabilityProvider(providersByCapability, capabilityId, providerPackageId);
    }
  }

  for (const packageEntry of packageEntries) {
    for (const capabilityId of Array.isArray(packageEntry.packageMetadata?.capabilities?.requires)
      ? packageEntry.packageMetadata.capabilities.requires
      : []) {
      const normalizedCapabilityId = String(capabilityId || "").trim();
      if (!normalizedCapabilityId) {
        continue;
      }
      const providers = providersByCapability.get(normalizedCapabilityId);
      if (!providers || providers.size < 1) {
        throw new Error(
          `Package ${packageEntry.packageId} requires capability ${normalizedCapabilityId}, but no installed package provides it.`
        );
      }
    }
  }

  for (const capabilityId of EXCLUSIVE_CAPABILITIES) {
    const providers = providersByCapability.get(capabilityId);
    if (providers && providers.size > 1) {
      throw new Error(
        `Capability ${capabilityId} is exclusive, but multiple installed packages provide it: ${sortStrings([...providers]).join(", ")}.`
      );
    }
  }
}

export {
  collectGlobalUiPaths,
  resolveInstalledJskitPackages,
  resolvePackageLoadOrder,
  validatePackageCapabilities
};
