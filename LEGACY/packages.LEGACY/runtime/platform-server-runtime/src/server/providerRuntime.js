import { access, constants as fsConstants } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createApplication } from "@jskit-ai/kernel-core/server";
import { createHttpRuntime } from "@jskit-ai/http-fastify-core/kernel";
import { TOKENS } from "@jskit-ai/support-core/tokens";
import { readLockFromApp } from "@jskit-ai/server-runtime-core/lockfile";

function isIdentifier(value) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(String(value || ""));
}

async function fileExists(absolutePath) {
  try {
    await access(absolutePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isInsidePackageRoot(packageRoot, candidatePath) {
  const relative = path.relative(path.resolve(packageRoot), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function toSortedUniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right)
  );
}

async function resolveDescriptorPathForInstalledPackage({ appRoot, installedPackageState, packageId }) {
  const descriptorPathFromSource = String(installedPackageState?.source?.descriptorPath || "").trim();
  const jskitRoot = path.join(appRoot, "node_modules", "@jskit-ai", "jskit");
  const jskitToolingRoot = path.join(jskitRoot, "packages", "tooling", "jskit");

  const candidatePaths = [];
  if (descriptorPathFromSource) {
    candidatePaths.push(path.resolve(jskitRoot, descriptorPathFromSource));
    candidatePaths.push(path.resolve(jskitToolingRoot, descriptorPathFromSource));
    candidatePaths.push(path.resolve(appRoot, descriptorPathFromSource));
  }
  candidatePaths.push(path.resolve(appRoot, "node_modules", packageId, "package.descriptor.mjs"));

  for (const candidatePath of candidatePaths) {
    if (await fileExists(candidatePath)) {
      return candidatePath;
    }
  }

  throw new Error(`Unable to resolve package descriptor for ${packageId}.`);
}

async function resolveInstalledPackageDescriptors({ appRoot, lock }) {
  const installedPackages =
    lock && typeof lock === "object" && lock.installedPackages && typeof lock.installedPackages === "object"
      ? lock.installedPackages
      : {};

  const descriptorEntries = [];
  for (const packageId of toSortedUniqueStrings(Object.keys(installedPackages))) {
    const installedPackageState = installedPackages[packageId] || {};
    const descriptorPath = await resolveDescriptorPathForInstalledPackage({
      appRoot,
      installedPackageState,
      packageId
    });
    const descriptorModule = await import(pathToFileURL(descriptorPath).href + `?t=${Date.now()}_${Math.random()}`);
    const descriptor = descriptorModule?.default && typeof descriptorModule.default === "object" ? descriptorModule.default : {};
    descriptorEntries.push({
      packageId,
      descriptor,
      descriptorPath,
      packageRoot: path.dirname(descriptorPath)
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

  for (const packageId of toSortedUniqueStrings([...byPackageId.keys()])) {
    visit(packageId);
  }

  return ordered;
}

function validateDescriptorCapabilities(descriptorEntries) {
  const providersByCapability = new Map();
  for (const descriptorEntry of descriptorEntries) {
    for (const capabilityId of Array.isArray(descriptorEntry.descriptor?.capabilities?.provides)
      ? descriptorEntry.descriptor.capabilities.provides
      : []) {
      const normalizedCapabilityId = String(capabilityId || "").trim();
      if (!normalizedCapabilityId) {
        continue;
      }
      if (!providersByCapability.has(normalizedCapabilityId)) {
        providersByCapability.set(normalizedCapabilityId, new Set());
      }
      providersByCapability.get(normalizedCapabilityId).add(descriptorEntry.packageId);
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

function normalizeProviderRuntimeConfig(descriptor, packageId) {
  const runtime =
    descriptor && typeof descriptor.runtime === "object" && descriptor.runtime && !Array.isArray(descriptor.runtime)
      ? descriptor.runtime
      : {};
  const server =
    runtime && typeof runtime.server === "object" && runtime.server && !Array.isArray(runtime.server)
      ? runtime.server
      : null;
  if (!server) {
    return null;
  }

  const providerEntrypoint = String(server.providerEntrypoint || "").trim();
  const providerExport = String(server.providerExport || "").trim();
  if (!providerEntrypoint) {
    return null;
  }
  if (providerExport && !isIdentifier(providerExport)) {
    throw new Error(`Package ${packageId} runtime.server.providerExport is invalid: ${providerExport}`);
  }
  return Object.freeze({
    providerEntrypoint,
    providerExport
  });
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

async function loadPackageProviders({ descriptorEntry }) {
  const providerRuntime = normalizeProviderRuntimeConfig(descriptorEntry.descriptor, descriptorEntry.packageId);
  if (!providerRuntime) {
    return Object.freeze([]);
  }

  const providerModulePath = path.resolve(descriptorEntry.packageRoot, providerRuntime.providerEntrypoint);
  if (!isInsidePackageRoot(descriptorEntry.packageRoot, providerModulePath)) {
    throw new Error(
      `Package ${descriptorEntry.packageId} runtime.server.providerEntrypoint escapes package root: ${providerRuntime.providerEntrypoint}`
    );
  }
  if (!(await fileExists(providerModulePath))) {
    throw new Error(
      `Package ${descriptorEntry.packageId} runtime.server.providerEntrypoint not found: ${providerRuntime.providerEntrypoint}`
    );
  }

  const providerModule = await import(pathToFileURL(providerModulePath).href + `?t=${Date.now()}_${Math.random()}`);
  const providerClasses = resolveProviderClassesFromModule(providerModule, {
    packageId: descriptorEntry.packageId,
    providerExport: providerRuntime.providerExport
  });

  return Object.freeze(providerClasses);
}

async function createProviderRuntimeApp({
  profile = "app",
  providers = [],
  env = {},
  logger = console,
  fastify = null
} = {}) {
  const app = createApplication({
    profile
  });

  app.instance(TOKENS.Env, env && typeof env === "object" ? { ...env } : {});
  app.instance(TOKENS.Logger, logger || console);

  let httpRuntime = null;
  if (fastify && typeof fastify.route === "function") {
    httpRuntime = createHttpRuntime({
      app,
      fastify
    });
  }

  await app.start({ providers });

  const routeRegistration = httpRuntime ? httpRuntime.registerRoutes() : { routeCount: 0 };
  return Object.freeze({
    app,
    routeCount: routeRegistration.routeCount,
    routeRegistration,
    diagnostics: app.getDiagnostics()
  });
}

async function createProviderRuntimeFromApp({
  appRoot,
  lockPath = ".jskit/lock.json",
  strict = false,
  profile = "app",
  env = {},
  logger = console,
  fastify = null,
  dependencies = {},
  routeConfig = {},
  missingHandler = null
} = {}) {
  if (!appRoot || typeof appRoot !== "string") {
    throw new TypeError("createProviderRuntimeFromApp requires appRoot.");
  }

  const { lock } = await readLockFromApp({
    appRoot,
    lockPath
  });
  const descriptors = await resolveInstalledPackageDescriptors({
    appRoot,
    lock
  });
  validateDescriptorCapabilities(descriptors);
  const orderedDescriptors = resolveDescriptorLoadOrder(descriptors);
  const catalog = Object.freeze({
    packageOrder: Object.freeze(orderedDescriptors.map((entry) => entry.packageId)),
    descriptors: Object.freeze(orderedDescriptors)
  });

  const orderedProviderClasses = [];
  const providerPackageIds = [];
  const seenProviderIds = new Map();

  for (const descriptorEntry of catalog.descriptors) {
    const packageProviders = await loadPackageProviders({ descriptorEntry });
    if (packageProviders.length < 1) {
      continue;
    }
    providerPackageIds.push(descriptorEntry.packageId);

    for (const providerClass of packageProviders) {
      const providerId = String(providerClass.id || providerClass.name || "<anonymous-provider>").trim();
      if (seenProviderIds.has(providerId)) {
        const existingPackageId = seenProviderIds.get(providerId);
        throw new Error(
          `Provider id "${providerId}" is duplicated between ${existingPackageId} and ${descriptorEntry.packageId}.`
        );
      }
      seenProviderIds.set(providerId, descriptorEntry.packageId);
      orderedProviderClasses.push(providerClass);
    }
  }

  const envRecord = env && typeof env === "object" ? { ...env } : {};
  const loggerInstance = logger || console;

  const providerRuntime = await createProviderRuntimeApp({
    profile,
    providers: orderedProviderClasses,
    env: envRecord,
    logger: loggerInstance,
    fastify
  });

  return Object.freeze({
    ...providerRuntime,
    routeCount: providerRuntime.routeCount,
    packageOrder: catalog.packageOrder,
    providerPackageOrder: Object.freeze(providerPackageIds)
  });
}

export { createProviderRuntimeApp, createProviderRuntimeFromApp };
