import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  isIdentifier,
  createWildcardMatcher,
  normalizeRelativePath,
  fileExists,
  isInsidePackageRoot,
  toAbsoluteSortedUniquePaths
} from "./helpers.js";

function normalizeServerProviderDefinitions(descriptor, packageId) {
  const runtime =
    descriptor && typeof descriptor.runtime === "object" && descriptor.runtime && !Array.isArray(descriptor.runtime)
      ? descriptor.runtime
      : {};
  const server =
    runtime && typeof runtime.server === "object" && runtime.server && !Array.isArray(runtime.server)
      ? runtime.server
      : null;
  if (!server) {
    return Object.freeze([]);
  }

  const providers = Array.isArray(server.providers) ? server.providers : [];
  const normalizedProviders = [];

  for (const providerDefinition of providers) {
    const entry = providerDefinition && typeof providerDefinition === "object" ? providerDefinition : {};
    const providerEntrypoint = String(entry.entrypoint || "").trim();
    const providerExport = String(entry.export || "").trim();
    const discoverConfig =
      entry.discover && typeof entry.discover === "object" && !Array.isArray(entry.discover) ? entry.discover : null;

    if (discoverConfig) {
      if (providerEntrypoint || providerExport) {
        throw new Error(
          `Package ${packageId} runtime.server.providers[] discover entries cannot include entrypoint/export fields.`
        );
      }

      const discoverDir = String(discoverConfig.dir || "").trim();
      if (!discoverDir) {
        throw new Error(`Package ${packageId} runtime.server.providers[] discover.dir is required.`);
      }
      if (discoverDir.startsWith("/") || discoverDir.startsWith("//")) {
        throw new Error(`Package ${packageId} runtime.server.providers[] discover.dir must be relative.`);
      }
      if (discoverDir.includes("*")) {
        throw new Error(`Package ${packageId} runtime.server.providers[] discover.dir cannot contain wildcard "*".`);
      }

      const discoverPattern = String(discoverConfig.pattern || "*Provider.js").trim() || "*Provider.js";
      if (discoverPattern.includes(path.sep) || discoverPattern.includes("/")) {
        throw new Error(
          `Package ${packageId} runtime.server.providers[] discover.pattern must match filenames only.`
        );
      }
      if (!createWildcardMatcher(discoverPattern)) {
        throw new Error(`Package ${packageId} runtime.server.providers[] discover.pattern is invalid.`);
      }

      const discoverRecursive = discoverConfig.recursive === true;
      normalizedProviders.push(
        Object.freeze({
          type: "discover",
          discoverDir,
          discoverPattern,
          discoverRecursive
        })
      );
      continue;
    }

    if (!providerEntrypoint) {
      throw new Error(`Package ${packageId} runtime.server.providers[] entrypoint is required.`);
    }
    if (!providerExport) {
      throw new Error(`Package ${packageId} runtime.server.providers[] export is required for ${providerEntrypoint}.`);
    }
    if (!isIdentifier(providerExport)) {
      throw new Error(`Package ${packageId} runtime.server.providers[] export is invalid: ${providerExport}`);
    }

    normalizedProviders.push(
      Object.freeze({
        type: "explicit",
        providerEntrypoint,
        providerExport
      })
    );
  }

  return Object.freeze(normalizedProviders);
}

function isProviderDefinition(value) {
  if (typeof value !== "function") {
    return false;
  }
  const prototype = value.prototype && typeof value.prototype === "object" ? value.prototype : null;
  const hasLifecycleMethods = Boolean(
    (prototype && typeof prototype.register === "function") ||
      (prototype && typeof prototype.boot === "function") ||
      (prototype && typeof prototype.shutdown === "function")
  );
  const rawId = value.id;
  const hasProviderId = rawId !== undefined && rawId !== null && String(rawId).trim().length > 0;
  return hasLifecycleMethods && hasProviderId;
}

function normalizeProviderExportValue(value, { packageId, label }) {
  const output = [];
  const queue = Array.isArray(value) ? [...value] : [value];
  while (queue.length > 0) {
    const candidate = queue.shift();
    if (!candidate) {
      continue;
    }
    if (Array.isArray(candidate)) {
      queue.push(...candidate);
      continue;
    }
    if (isProviderDefinition(candidate)) {
      output.push(candidate);
      continue;
    }
    throw new Error(
      `Package ${packageId} ${label} must export a provider class/function or an array of provider classes/functions.`
    );
  }
  return output;
}

function resolveProviderClassesFromModule(moduleNamespace, { packageId, providerExport }) {
  const namespace = moduleNamespace && typeof moduleNamespace === "object" ? moduleNamespace : {};
  if (providerExport) {
    if (!Object.prototype.hasOwnProperty.call(namespace, providerExport)) {
      throw new Error(`Package ${packageId} provider export "${providerExport}" was not found.`);
    }
    return normalizeProviderExportValue(namespace[providerExport], {
      packageId,
      label: `provider export "${providerExport}"`
    });
  }

  const discovered = [];
  for (const [exportName, exportValue] of Object.entries(namespace)) {
    if (!isProviderDefinition(exportValue)) {
      continue;
    }
    discovered.push(...normalizeProviderExportValue(exportValue, { packageId, label: `export "${exportName}"` }));
  }

  if (discovered.length < 1) {
    throw new Error(
      `Package ${packageId} provider entrypoint did not export any provider classes/functions.`
    );
  }

  return discovered;
}

async function collectDiscoveredProviderModulePaths({ descriptorEntry, providerDefinition }) {
  const discoverRoot = path.resolve(descriptorEntry.packageRoot, providerDefinition.discoverDir);
  if (!isInsidePackageRoot(descriptorEntry.packageRoot, discoverRoot)) {
    throw new Error(
      `Package ${descriptorEntry.packageId} runtime.server.providers[] discover.dir escapes package root: ${providerDefinition.discoverDir}`
    );
  }
  if (!(await fileExists(discoverRoot))) {
    return Object.freeze([]);
  }

  const patternMatcher = createWildcardMatcher(providerDefinition.discoverPattern);
  if (!(patternMatcher instanceof RegExp)) {
    throw new Error(
      `Package ${descriptorEntry.packageId} runtime.server.providers[] discover.pattern is invalid: ${providerDefinition.discoverPattern}`
    );
  }
  const collectedPaths = [];

  async function walk(currentPath) {
    const entries = await readdir(currentPath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const entryName = String(entry?.name || "");
      if (!entryName || entryName.startsWith(".")) {
        continue;
      }

      const absoluteEntryPath = path.join(currentPath, entryName);
      if (entry.isDirectory()) {
        if (entryName === "node_modules") {
          continue;
        }
        if (providerDefinition.discoverRecursive === true) {
          await walk(absoluteEntryPath);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (patternMatcher.test(entryName)) {
        collectedPaths.push(absoluteEntryPath);
      }
    }
  }

  await walk(discoverRoot);
  return toAbsoluteSortedUniquePaths(collectedPaths);
}

function registerProviderClass({ providerClass, sourceId, seenProviderIds, orderedProviderClasses }) {
  const providerId = String(providerClass.id || providerClass.name || "<anonymous-provider>").trim();
  if (seenProviderIds.has(providerId)) {
    const existingSourceId = seenProviderIds.get(providerId);
    throw new Error(`Provider id "${providerId}" is duplicated between ${existingSourceId} and ${sourceId}.`);
  }

  seenProviderIds.set(providerId, sourceId);
  orderedProviderClasses.push(providerClass);
}

async function loadPackageProviders({ descriptorEntry }) {
  const providerDefinitions = normalizeServerProviderDefinitions(descriptorEntry.descriptor, descriptorEntry.packageId);
  if (providerDefinitions.length < 1) {
    return Object.freeze([]);
  }

  const providerClasses = [];
  for (const providerDefinition of providerDefinitions) {
    if (providerDefinition.type === "discover") {
      const discoveredProviderPaths = await collectDiscoveredProviderModulePaths({
        descriptorEntry,
        providerDefinition
      });

      for (const discoveredProviderPath of discoveredProviderPaths) {
        const providerModule = await import(pathToFileURL(discoveredProviderPath).href);
        providerClasses.push(
          ...resolveProviderClassesFromModule(providerModule, {
            packageId: `${descriptorEntry.packageId} (${normalizeRelativePath(
              descriptorEntry.packageRoot,
              discoveredProviderPath
            )})`,
            providerExport: ""
          })
        );
      }
      continue;
    }

    const providerModulePath = path.resolve(descriptorEntry.packageRoot, providerDefinition.providerEntrypoint);
    if (!isInsidePackageRoot(descriptorEntry.packageRoot, providerModulePath)) {
      throw new Error(
        `Package ${descriptorEntry.packageId} runtime.server.providers[] entrypoint escapes package root: ${providerDefinition.providerEntrypoint}`
      );
    }
    if (!(await fileExists(providerModulePath))) {
      throw new Error(
        `Package ${descriptorEntry.packageId} runtime.server.providers[] entrypoint not found: ${providerDefinition.providerEntrypoint}`
      );
    }

    const providerModule = await import(pathToFileURL(providerModulePath).href);
    providerClasses.push(
      ...resolveProviderClassesFromModule(providerModule, {
        packageId: descriptorEntry.packageId,
        providerExport: providerDefinition.providerExport
      })
    );
  }

  return Object.freeze(providerClasses);
}

export { loadPackageProviders, registerProviderClass };
