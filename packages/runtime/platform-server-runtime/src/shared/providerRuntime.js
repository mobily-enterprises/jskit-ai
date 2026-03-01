import { access, constants as fsConstants } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createApplication } from "@jskit-ai/kernel-core";
import { createHttpRuntime } from "@jskit-ai/http-fastify-core/kernel";
import { TOKENS } from "@jskit-ai/support-core/tokens";
import { registerApiRouteDefinitions } from "@jskit-ai/server-runtime-core/apiRouteRegistration";
import {
  applyContributedRuntimeLifecycle,
  createServerRuntimeFromContributions,
  loadServerContributionsFromLock,
  mergeServerContributions,
  readLockFromApp
} from "@jskit-ai/server-runtime-core/serverContributions";

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
  const hasProviderId = value.id !== undefined;
  return hasLifecycleMethods || hasProviderId;
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
  const catalog = await loadServerContributionsFromLock({
    appRoot,
    lock,
    strict
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
  const dependencyRecord = dependencies && typeof dependencies === "object" ? { ...dependencies } : {};
  const loggerInstance = logger || console;
  const baseDependencies = {
    ...dependencyRecord,
    env: envRecord,
    logger: loggerInstance
  };

  const providerRuntime = await createProviderRuntimeApp({
    profile,
    providers: orderedProviderClasses,
    env: envRecord,
    logger: loggerInstance,
    fastify
  });

  const providerPackageIdSet = new Set(providerPackageIds);
  const legacyContributionEntries = catalog.contributionsByPackage.filter(
    (entry) => !providerPackageIdSet.has(entry.packageId)
  );
  const legacyPackageOrder = legacyContributionEntries.map((entry) => entry.packageId);

  let legacyRuntime = null;
  let legacyLifecycle = Object.freeze({
    pluginCount: 0,
    workerCount: 0,
    onBootCount: 0
  });

  if (legacyContributionEntries.length > 0) {
    legacyRuntime = createServerRuntimeFromContributions({
      mergedContributions: mergeServerContributions(legacyContributionEntries),
      dependencies: baseDependencies,
      routeConfig,
      missingHandler
    });

    if (fastify && Array.isArray(legacyRuntime.routes) && legacyRuntime.routes.length > 0) {
      registerApiRouteDefinitions(fastify, {
        routes: legacyRuntime.routes
      });
    }

    if (fastify) {
      legacyLifecycle = await applyContributedRuntimeLifecycle({
        app: fastify,
        runtimeResult: legacyRuntime,
        dependencies: baseDependencies
      });
    }
  }

  const legacyRouteCount = legacyRuntime && Array.isArray(legacyRuntime.routes) ? legacyRuntime.routes.length : 0;

  return Object.freeze({
    ...providerRuntime,
    routeCount: providerRuntime.routeCount + legacyRouteCount,
    packageOrder: catalog.packageOrder,
    providerPackageOrder: Object.freeze(providerPackageIds),
    legacyPackageOrder: Object.freeze(legacyPackageOrder),
    legacyRuntime: legacyRuntime
      ? Object.freeze({
        routeCount: legacyRouteCount,
        pluginCount: legacyLifecycle.pluginCount,
        workerCount: legacyLifecycle.workerCount,
        onBootCount: legacyLifecycle.onBootCount
      })
      : Object.freeze({
        routeCount: 0,
        pluginCount: 0,
        workerCount: 0,
        onBootCount: 0
      })
  });
}

export { createProviderRuntimeApp, createProviderRuntimeFromApp };
