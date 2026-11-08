import { capabilityKey } from "../../../shared/capabilities/defineProvider.js";
import { sortStrings } from "../../../shared/support/sorting.js";
import { discoverInstalledPackages } from "../../../internal/node/installedPackages.js";
import { isRecord } from "../../../shared/support/normalize.js";
import { ActionProvider } from "../../actions/actionProvider.js";
import { HttpProvider } from "../../http/HttpProvider.js";
import { BootstrapProvider } from "../../runtime/BootstrapProvider.js";
import { EventProvider } from "../../runtime/EventProvider.js";

const EXCLUSIVE_CAPABILITIES = Object.freeze([
  "auth.service",
  "runtime.database.driver"
]);
/** @typedef {import("../../types.js").ProviderDefinition} ProviderDefinition */
/** @typedef {import("../../types.js").RuntimeLogger} RuntimeLogger */

// What the kernel's own providers give every package: events, actions, HTTP and the bootstrap.
const KERNEL_PROVIDED_CAPABILITIES = new Set([EventProvider, ActionProvider, HttpProvider, BootstrapProvider]
  .flatMap((provider) => Object.values(provider.provides)));
// Client capabilities come from client providers, which the server never loads.
const CLIENT_CAPABILITY = /^client\./u;

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
      const routeRecord = isRecord(routeEntry) ? routeEntry : null;
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
  const normalizedCapabilityId = capabilityKey(capabilityId);
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
      const normalizedCapabilityId = capabilityKey(capabilityId);
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

/**
 * The capability ids a manifest list names, as the runtime compares them (trimmed and lower-cased, as providers' are),
 * without empty entries.
 * @param {unknown} list
 */
function manifestCapabilityIds(list) {
  return new Set((Array.isArray(list) ? list : []).map(capabilityKey).filter(Boolean));
}

/**
 * The capability ids a package's providers name under one key (`requires`, `optional` or `provides`).
 * @param {ReadonlyArray<ProviderDefinition>} providers
 * @param {"requires" | "optional" | "provides"} key
 */
function providerCapabilityIds(providers, key) {
  return new Set(providers.flatMap((provider) => Object.values(provider[key])));
}

/**
 * Checks a package's manifest (`jskit.capabilities`) against the server providers it declares, so the two cannot
 * drift. The manifest provides exactly what the providers provide, client capabilities aside. It requires every
 * capability a provider requires, apart from the kernel's own and those the package provides; optional ones are never
 * required. A manifest requirement no provider has is an install-time one, such as the database a migration needs, so
 * it is logged, not refused.
 * @param {{ packageId: string, packageMetadata?: { capabilities?: { provides?: unknown, requires?: unknown } } }} packageEntry
 * @param {ReadonlyArray<ProviderDefinition>} packageProviders
 * @param {{ logger: RuntimeLogger }} options
 */
function assertManifestMatchesProviders(packageEntry, packageProviders, { logger }) {
  const { packageId } = packageEntry;
  const manifest = packageEntry.packageMetadata?.capabilities;
  const manifestProvides = [...manifestCapabilityIds(manifest?.provides)].filter((id) => !CLIENT_CAPABILITY.test(id));
  const manifestRequires = manifestCapabilityIds(manifest?.requires);
  const provided = providerCapabilityIds(packageProviders, "provides");
  const required = providerCapabilityIds(packageProviders, "requires");

  if (manifestProvides.length !== provided.size || manifestProvides.some((id) => !provided.has(id))) {
    const manifestList = sortStrings(manifestProvides).join(", ");
    const providerList = sortStrings([...provided]).join(", ");
    throw new Error(`Package ${packageId} manifest provides [${manifestList}] but its providers provide [${providerList}].`);
  }
  for (const capabilityId of sortStrings([...required])) {
    if (!KERNEL_PROVIDED_CAPABILITIES.has(capabilityId) && !provided.has(capabilityId) && !manifestRequires.has(capabilityId)) {
      throw new Error(`Package ${packageId} requires capability ${capabilityId} in its providers but not in its manifest.`);
    }
  }
  for (const capabilityId of sortStrings([...manifestRequires])) {
    if (!CLIENT_CAPABILITY.test(capabilityId) && !required.has(capabilityId)) {
      logger.warn({ packageId, capabilityId }, "Package manifest requires a capability its providers do not.");
    }
  }
}

export {
  assertManifestMatchesProviders,
  collectGlobalUiPaths,
  resolveInstalledJskitPackages,
  resolvePackageLoadOrder,
  validatePackageCapabilities
};
