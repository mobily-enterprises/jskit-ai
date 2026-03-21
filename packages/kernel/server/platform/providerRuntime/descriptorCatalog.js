import path from "node:path";
import { sortStrings } from "../../../shared/support/sorting.js";
import { loadInstalledPackageDescriptor } from "../../../shared/support/packageDescriptor.js";

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

function collectGlobalUiPaths(descriptorEntries) {
  const globalUiPaths = [];
  const entries = Array.isArray(descriptorEntries) ? descriptorEntries : [];

  for (const descriptorEntry of entries) {
    const uiRoutes = Array.isArray(descriptorEntry?.descriptor?.metadata?.ui?.routes)
      ? descriptorEntry.descriptor.metadata.ui.routes
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

async function resolveInstalledPackageDescriptors({ appRoot, lock }) {
  const installedPackages =
    lock && typeof lock === "object" && lock.installedPackages && typeof lock.installedPackages === "object"
      ? lock.installedPackages
      : {};

  const descriptorEntries = [];
  for (const packageId of sortStrings(Object.keys(installedPackages))) {
    const installedPackageState = installedPackages[packageId] || {};
    const descriptorRecord = await loadInstalledPackageDescriptor({
      appRoot,
      installedPackageState,
      packageId,
      required: true
    });
    descriptorEntries.push({
      packageId,
      descriptor: descriptorRecord.descriptor,
      descriptorPath: descriptorRecord.descriptorPath,
      packageRoot: path.dirname(descriptorRecord.descriptorPath)
    });
  }

  return descriptorEntries;
}

function resolveDescriptorLoadOrder(descriptorEntries) {
  const byPackageId = new Map(descriptorEntries.map((entry) => [entry.packageId, entry]));
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
    const dependsOn = Array.isArray(entry.descriptor?.dependsOn) ? entry.descriptor.dependsOn : [];
    for (const dependencyPackageId of dependsOn) {
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

function validateDescriptorCapabilities(descriptorEntries, { builtinProvidersByCapability = {} } = {}) {
  const providersByCapability = new Map();
  for (const descriptorEntry of descriptorEntries) {
    for (const capabilityId of Array.isArray(descriptorEntry.descriptor?.capabilities?.provides)
      ? descriptorEntry.descriptor.capabilities.provides
      : []) {
      registerCapabilityProvider(providersByCapability, capabilityId, descriptorEntry.packageId);
    }
  }

  for (const [capabilityId, providerPackageIds] of Object.entries(
    builtinProvidersByCapability && typeof builtinProvidersByCapability === "object" ? builtinProvidersByCapability : {}
  )) {
    for (const providerPackageId of Array.isArray(providerPackageIds) ? providerPackageIds : [providerPackageIds]) {
      registerCapabilityProvider(providersByCapability, capabilityId, providerPackageId);
    }
  }

  for (const descriptorEntry of descriptorEntries) {
    for (const capabilityId of Array.isArray(descriptorEntry.descriptor?.capabilities?.requires)
      ? descriptorEntry.descriptor.capabilities.requires
      : []) {
      const normalizedCapabilityId = String(capabilityId || "").trim();
      if (!normalizedCapabilityId) {
        continue;
      }
      const providers = providersByCapability.get(normalizedCapabilityId);
      if (!providers || providers.size < 1) {
        throw new Error(
          `Package ${descriptorEntry.packageId} requires capability ${normalizedCapabilityId}, but no installed package provides it.`
        );
      }
    }
  }
}

export {
  collectGlobalUiPaths,
  resolveInstalledPackageDescriptors,
  resolveDescriptorLoadOrder,
  validateDescriptorCapabilities
};
