import { access, constants as fsConstants, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRuntimeAssembly, buildRoutesFromManifest } from "./runtimeAssembly.js";
import { defaultMissingHandler } from "./routeUtils.js";

const SERVER_CONTRIBUTION_KEYS = Object.freeze([
  "repositories",
  "services",
  "controllers",
  "routes",
  "actions",
  "plugins",
  "workers",
  "lifecycle"
]);

function toSortedUniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right)
  );
}

function normalizeObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function normalizeContributionId(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new TypeError(`${label} id is required.`);
  }
  return normalized;
}

function normalizeCreateDefinition(entry, label) {
  const normalizedEntry = normalizeObject(entry, label);
  const id = normalizeContributionId(normalizedEntry.id, label);
  if (typeof normalizedEntry.create !== "function") {
    throw new TypeError(`${label} "${id}" create must be a function.`);
  }
  return {
    ...normalizedEntry,
    id
  };
}

function normalizeRouteDefinition(entry, label) {
  const normalizedEntry = normalizeObject(entry, label);
  const id = normalizeContributionId(normalizedEntry.id, label);
  if (typeof normalizedEntry.buildRoutes !== "function") {
    throw new TypeError(`${label} "${id}" buildRoutes must be a function.`);
  }
  if (normalizedEntry.resolveOptions != null && typeof normalizedEntry.resolveOptions !== "function") {
    throw new TypeError(`${label} "${id}" resolveOptions must be a function when provided.`);
  }
  return {
    ...normalizedEntry,
    id
  };
}

function normalizeLifecycleDefinition(entry, label) {
  const normalizedEntry = normalizeObject(entry, label);
  const id = normalizeContributionId(normalizedEntry.id, label);
  const hasOnBoot = typeof normalizedEntry.onBoot === "function";
  const hasOnShutdown = typeof normalizedEntry.onShutdown === "function";
  if (!hasOnBoot && !hasOnShutdown) {
    throw new TypeError(`${label} "${id}" must define onBoot() and/or onShutdown().`);
  }
  return {
    ...normalizedEntry,
    id
  };
}

function normalizeDefinitionArray(entries, label, normalizeEntry) {
  const source = Array.isArray(entries) ? entries : [];
  const normalized = [];
  const seenIds = new Set();

  for (const rawEntry of source) {
    const entry = normalizeEntry(rawEntry, label);
    if (seenIds.has(entry.id)) {
      throw new TypeError(`${label} "${entry.id}" is duplicated.`);
    }
    seenIds.add(entry.id);
    normalized.push(entry);
  }

  return Object.freeze(normalized);
}

function normalizeServerContributions(rawContributions, { label = "server contributions" } = {}) {
  const source = normalizeObject(rawContributions, label);
  const unknownKeys = Object.keys(source).filter((key) => !SERVER_CONTRIBUTION_KEYS.includes(key));
  if (unknownKeys.length > 0) {
    throw new TypeError(`${label} contains unknown keys: ${unknownKeys.sort((left, right) => left.localeCompare(right)).join(", ")}.`);
  }

  return Object.freeze({
    repositories: normalizeDefinitionArray(source.repositories, `${label}.repositories`, normalizeCreateDefinition),
    services: normalizeDefinitionArray(source.services, `${label}.services`, normalizeCreateDefinition),
    controllers: normalizeDefinitionArray(source.controllers, `${label}.controllers`, normalizeCreateDefinition),
    routes: normalizeDefinitionArray(source.routes, `${label}.routes`, normalizeRouteDefinition),
    actions: normalizeDefinitionArray(source.actions, `${label}.actions`, normalizeCreateDefinition),
    plugins: normalizeDefinitionArray(source.plugins, `${label}.plugins`, normalizeCreateDefinition),
    workers: normalizeDefinitionArray(source.workers, `${label}.workers`, normalizeCreateDefinition),
    lifecycle: normalizeDefinitionArray(source.lifecycle, `${label}.lifecycle`, normalizeLifecycleDefinition)
  });
}

function createEmptyServerContributions() {
  return Object.freeze({
    repositories: Object.freeze([]),
    services: Object.freeze([]),
    controllers: Object.freeze([]),
    routes: Object.freeze([]),
    actions: Object.freeze([]),
    plugins: Object.freeze([]),
    workers: Object.freeze([]),
    lifecycle: Object.freeze([])
  });
}

function mergeContributionLists(lists, key) {
  const merged = [];
  const seen = new Map();
  for (const listEntry of lists) {
    const packageId = String(listEntry.packageId || "").trim() || "<unknown>";
    const contributions = normalizeServerContributions(listEntry.contributions, {
      label: `package ${packageId} server contributions`
    });
    for (const item of contributions[key]) {
      if (seen.has(item.id)) {
        const existing = seen.get(item.id);
        throw new TypeError(`Contribution id "${item.id}" in ${key} is duplicated between ${existing} and ${packageId}.`);
      }
      seen.set(item.id, packageId);
      merged.push({
        ...item,
        packageId
      });
    }
  }
  return Object.freeze(merged);
}

function mergeServerContributions(contributionEntries = []) {
  const source = Array.isArray(contributionEntries) ? contributionEntries : [];
  return Object.freeze({
    repositories: mergeContributionLists(source, "repositories"),
    services: mergeContributionLists(source, "services"),
    controllers: mergeContributionLists(source, "controllers"),
    routes: mergeContributionLists(source, "routes"),
    actions: mergeContributionLists(source, "actions"),
    plugins: mergeContributionLists(source, "plugins"),
    workers: mergeContributionLists(source, "workers"),
    lifecycle: mergeContributionLists(source, "lifecycle")
  });
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

function normalizeDescriptorServerRuntime(descriptor, packageId) {
  const source = descriptor && typeof descriptor === "object" ? descriptor : {};
  const runtime = source.runtime && typeof source.runtime === "object" && !Array.isArray(source.runtime) ? source.runtime : {};
  const server = runtime.server && typeof runtime.server === "object" && !Array.isArray(runtime.server) ? runtime.server : null;
  if (!server) {
    return null;
  }

  const entrypoint = String(server.entrypoint || "").trim();
  const exportName = String(server.export || "createServerContributions").trim() || "createServerContributions";
  if (!entrypoint) {
    throw new TypeError(`Package ${packageId} runtime.server.entrypoint is required when runtime.server is declared.`);
  }
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(exportName)) {
    throw new TypeError(`Package ${packageId} runtime.server.export is invalid: ${exportName}`);
  }

  return {
    entrypoint,
    exportName
  };
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
  const installedPackages = lock && typeof lock === "object" && lock.installedPackages && typeof lock.installedPackages === "object"
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

function packageProvidesServerRouteCapabilities(descriptor = {}) {
  const provided = Array.isArray(descriptor?.capabilities?.provides) ? descriptor.capabilities.provides : [];
  return provided.some((capabilityId) => String(capabilityId || "").trim().includes(".server-routes"));
}

async function loadPackageServerContributions({ descriptorEntry, strict = false }) {
  const serverRuntime = normalizeDescriptorServerRuntime(descriptorEntry.descriptor, descriptorEntry.packageId);
  const providesServerRouteCapabilities = packageProvidesServerRouteCapabilities(descriptorEntry.descriptor);

  if (!serverRuntime) {
    if (strict && providesServerRouteCapabilities) {
      throw new Error(
        `Package ${descriptorEntry.packageId} provides server route capabilities but does not declare runtime.server entrypoint.`
      );
    }
    return null;
  }

  const contributionModulePath = path.resolve(descriptorEntry.packageRoot, serverRuntime.entrypoint);
  if (!isInsidePackageRoot(descriptorEntry.packageRoot, contributionModulePath)) {
    throw new Error(
      `Package ${descriptorEntry.packageId} runtime.server.entrypoint escapes package root: ${serverRuntime.entrypoint}`
    );
  }
  if (!(await fileExists(contributionModulePath))) {
    throw new Error(
      `Package ${descriptorEntry.packageId} runtime.server.entrypoint not found: ${serverRuntime.entrypoint}`
    );
  }

  const contributionModule = await import(
    pathToFileURL(contributionModulePath).href + `?t=${Date.now()}_${Math.random()}`
  );
  const contributionFactory = contributionModule?.[serverRuntime.exportName];
  if (typeof contributionFactory !== "function") {
    throw new Error(
      `Package ${descriptorEntry.packageId} runtime.server export ${serverRuntime.exportName} must be a function.`
    );
  }

  const rawContributions = await contributionFactory({
    packageId: descriptorEntry.packageId,
    descriptor: descriptorEntry.descriptor
  });
  const contributions = normalizeServerContributions(rawContributions, {
    label: `package ${descriptorEntry.packageId} server contributions`
  });

  if (strict && providesServerRouteCapabilities && contributions.routes.length < 1) {
    throw new Error(
      `Package ${descriptorEntry.packageId} provides server route capabilities but runtime contributions.routes is empty.`
    );
  }

  return {
    packageId: descriptorEntry.packageId,
    descriptor: descriptorEntry.descriptor,
    contributions
  };
}

async function loadServerContributionsFromLock({
  appRoot,
  lock,
  strict = false
} = {}) {
  if (!appRoot || typeof appRoot !== "string") {
    throw new TypeError("loadServerContributionsFromLock requires appRoot.");
  }
  if (!lock || typeof lock !== "object") {
    throw new TypeError("loadServerContributionsFromLock requires lock.");
  }

  const descriptorEntries = await resolveInstalledPackageDescriptors({
    appRoot,
    lock
  });
  validateDescriptorCapabilities(descriptorEntries);
  const orderedDescriptors = resolveDescriptorLoadOrder(descriptorEntries);

  const loaded = [];
  for (const descriptorEntry of orderedDescriptors) {
    const packageContributions = await loadPackageServerContributions({
      descriptorEntry,
      strict
    });
    if (packageContributions) {
      loaded.push(packageContributions);
    }
  }

  return Object.freeze({
    packageOrder: Object.freeze(orderedDescriptors.map((entry) => entry.packageId)),
    descriptors: Object.freeze(orderedDescriptors),
    contributionsByPackage: Object.freeze(loaded),
    mergedContributions: mergeServerContributions(loaded)
  });
}

function createServerRuntimeFromContributions({
  mergedContributions,
  dependencies = {},
  repositoryDependencies = {},
  serviceDependencies = {},
  controllerDependencies = {},
  routeConfig = {},
  missingHandler = null
} = {}) {
  const sharedDependencies = dependencies && typeof dependencies === "object" ? dependencies : {};
  const contributions = normalizeServerContributions(
    mergedContributions || createEmptyServerContributions(),
    {
      label: "merged server contributions"
    }
  );

  const runtime = createRuntimeAssembly({
    bundles: [
      {
        repositoryDefinitions: contributions.repositories,
        serviceDefinitions: contributions.services,
        controllerDefinitions: contributions.controllers
      }
    ],
    dependencies: {
      ...sharedDependencies,
      dependencies: sharedDependencies
    },
    repositoryDependencies,
    serviceDependencies,
    controllerDependencies
  });

  const routes = buildRoutesFromManifest({
    definitions: contributions.routes,
    controllers: runtime.controllers,
    routeConfig,
    missingHandler: typeof missingHandler === "function" ? missingHandler : defaultMissingHandler
  });

  return Object.freeze({
    runtime,
    routes,
    actions: contributions.actions,
    plugins: contributions.plugins,
    workers: contributions.workers,
    lifecycle: contributions.lifecycle
  });
}

function createContributionExecutionContext({
  app = null,
  runtimeResult,
  dependencies = {}
} = {}) {
  return Object.freeze({
    app,
    dependencies,
    runtime: runtimeResult.runtime,
    routes: runtimeResult.routes,
    repositories: runtimeResult.runtime.repositories,
    services: runtimeResult.runtime.services,
    controllers: runtimeResult.runtime.controllers
  });
}

async function initializeContributedPlugins({
  app,
  pluginDefinitions = [],
  executionContext
} = {}) {
  if (!app || typeof app.register !== "function") {
    throw new TypeError("initializeContributedPlugins requires a Fastify instance with register().");
  }

  const initialized = [];
  for (const definition of Array.isArray(pluginDefinitions) ? pluginDefinitions : []) {
    const created = await definition.create(executionContext);
    if (!created) {
      continue;
    }
    if (typeof created === "function") {
      await app.register(created);
      initialized.push({
        id: definition.id,
        mode: "fastify-plugin"
      });
      continue;
    }
    if (created && typeof created.register === "function") {
      await created.register(app, executionContext);
      initialized.push({
        id: definition.id,
        mode: "custom-register"
      });
      continue;
    }
    throw new TypeError(
      `Plugin contribution ${definition.id} create() must return a Fastify plugin function or object with register(app, context).`
    );
  }
  return Object.freeze(initialized);
}

async function initializeContributedWorkers({
  workerDefinitions = [],
  executionContext
} = {}) {
  const initialized = [];
  for (const definition of Array.isArray(workerDefinitions) ? workerDefinitions : []) {
    const created = await definition.create(executionContext);
    if (!created) {
      continue;
    }
    const worker = created && typeof created === "object" ? created : { run: created };
    if (typeof worker.start === "function") {
      await worker.start(executionContext);
    }
    initialized.push({
      id: definition.id,
      worker
    });
  }
  return Object.freeze(initialized);
}

async function runLifecyclePhase({
  lifecycleDefinitions = [],
  phase,
  executionContext
} = {}) {
  const executed = [];
  for (const definition of Array.isArray(lifecycleDefinitions) ? lifecycleDefinitions : []) {
    const hook = definition?.[phase];
    if (typeof hook !== "function") {
      continue;
    }
    await hook(executionContext);
    executed.push(definition.id);
  }
  return Object.freeze(executed);
}

async function stopInitializedWorkers(initializedWorkers = [], executionContext) {
  for (const initializedWorker of [...initializedWorkers].reverse()) {
    const worker = initializedWorker?.worker;
    const stopFn =
      (worker && typeof worker.stop === "function" && worker.stop.bind(worker)) ||
      (worker && typeof worker.shutdown === "function" && worker.shutdown.bind(worker)) ||
      null;
    if (!stopFn) {
      continue;
    }
    await stopFn(executionContext);
  }
}

async function applyContributedRuntimeLifecycle({
  app,
  runtimeResult,
  dependencies = {}
} = {}) {
  if (!app || typeof app.addHook !== "function" || typeof app.register !== "function") {
    throw new TypeError("applyContributedRuntimeLifecycle requires a Fastify instance.");
  }
  if (!runtimeResult || typeof runtimeResult !== "object") {
    throw new TypeError("applyContributedRuntimeLifecycle requires runtimeResult.");
  }

  const executionContext = createContributionExecutionContext({
    app,
    runtimeResult,
    dependencies
  });

  const initializedPlugins = await initializeContributedPlugins({
    app,
    pluginDefinitions: runtimeResult.plugins || [],
    executionContext
  });
  const initializedWorkers = await initializeContributedWorkers({
    workerDefinitions: runtimeResult.workers || [],
    executionContext
  });
  const onBootExecuted = await runLifecyclePhase({
    lifecycleDefinitions: runtimeResult.lifecycle || [],
    phase: "onBoot",
    executionContext
  });

  app.addHook("onClose", async () => {
    const shutdownContext = createContributionExecutionContext({
      app,
      runtimeResult,
      dependencies
    });
    await runLifecyclePhase({
      lifecycleDefinitions: runtimeResult.lifecycle || [],
      phase: "onShutdown",
      executionContext: shutdownContext
    });
    await stopInitializedWorkers(initializedWorkers, shutdownContext);
  });

  return Object.freeze({
    pluginCount: initializedPlugins.length,
    workerCount: initializedWorkers.length,
    onBootCount: onBootExecuted.length
  });
}

async function createServerRuntimeFromLock({
  appRoot,
  lock,
  strict = false,
  dependencies = {},
  repositoryDependencies = {},
  serviceDependencies = {},
  controllerDependencies = {},
  routeConfig = {},
  missingHandler = null
} = {}) {
  const catalog = await loadServerContributionsFromLock({
    appRoot,
    lock,
    strict
  });

  const runtimeResult = createServerRuntimeFromContributions({
    mergedContributions: catalog.mergedContributions,
    dependencies,
    repositoryDependencies,
    serviceDependencies,
    controllerDependencies,
    routeConfig,
    missingHandler
  });

  return Object.freeze({
    ...runtimeResult,
    packageOrder: catalog.packageOrder,
    contributionsByPackage: catalog.contributionsByPackage
  });
}

async function readLockFromApp({ appRoot, lockPath = ".jskit/lock.json" } = {}) {
  if (!appRoot || typeof appRoot !== "string") {
    throw new TypeError("readLockFromApp requires appRoot.");
  }
  const absoluteLockPath = path.resolve(appRoot, String(lockPath || ".jskit/lock.json"));
  if (!(await fileExists(absoluteLockPath))) {
    throw new Error(`Lock file not found: ${absoluteLockPath}`);
  }
  const source = await readFile(absoluteLockPath, "utf8");
  const lock = JSON.parse(source);
  if (!lock || typeof lock !== "object") {
    throw new TypeError(`Invalid lock file payload at ${absoluteLockPath}.`);
  }
  return {
    lock,
    lockPath: absoluteLockPath
  };
}

async function loadServerContributionsFromApp({
  appRoot,
  lockPath = ".jskit/lock.json",
  strict = false
} = {}) {
  const { lock } = await readLockFromApp({
    appRoot,
    lockPath
  });
  return loadServerContributionsFromLock({
    appRoot,
    lock,
    strict
  });
}

async function createServerRuntimeFromApp({
  appRoot,
  lockPath = ".jskit/lock.json",
  strict = false,
  dependencies = {},
  repositoryDependencies = {},
  serviceDependencies = {},
  controllerDependencies = {},
  routeConfig = {},
  missingHandler = null
} = {}) {
  const { lock } = await readLockFromApp({
    appRoot,
    lockPath
  });

  return createServerRuntimeFromLock({
    appRoot,
    lock,
    strict,
    dependencies,
    repositoryDependencies,
    serviceDependencies,
    controllerDependencies,
    routeConfig,
    missingHandler
  });
}

export {
  SERVER_CONTRIBUTION_KEYS,
  createEmptyServerContributions,
  normalizeServerContributions,
  mergeServerContributions,
  readLockFromApp,
  loadServerContributionsFromApp,
  createServerRuntimeFromApp,
  loadServerContributionsFromLock,
  createServerRuntimeFromContributions,
  createServerRuntimeFromLock,
  initializeContributedPlugins,
  initializeContributedWorkers,
  runLifecyclePhase,
  applyContributedRuntimeLifecycle
};
