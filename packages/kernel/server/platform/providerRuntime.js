import { ActionRuntimeServiceProvider } from "../actions/ActionRuntimeServiceProvider.js";
import { ServerRuntimeCoreServiceProvider } from "../runtime/ServerRuntimeCoreServiceProvider.js";
import { createApplication } from "../kernel/index.js";
import { createHttpRuntime } from "../http/lib/kernel.js";
import { readLockFromApp } from "./providerRuntime/lockfile.js";
import {
  collectGlobalUiPaths,
  resolveInstalledPackageDescriptors,
  resolveDescriptorLoadOrder,
  validateDescriptorCapabilities
} from "./providerRuntime/descriptorCatalog.js";
import { loadPackageProviders, registerProviderClass } from "./providerRuntime/providerLoader.js";

const KERNEL_BUILTIN_CAPABILITY_PROVIDERS = Object.freeze({
  "runtime.actions": Object.freeze(["@jskit-ai/kernel"])
});

async function createProviderRuntimeApp({
  profile = "",
  providers = [],
  env = {},
  logger = console,
  fastify = null
} = {}) {
  const app = createApplication({
    profile
  });

  app.instance("jskit.env", env && typeof env === "object" ? { ...env } : {});
  app.instance("jskit.logger", logger || console);

  let httpRuntime = null;
  if (fastify && typeof fastify.route === "function") {
    httpRuntime = createHttpRuntime({
      app,
      fastify
    });
  }

  await app.start({ providers });

  if (fastify && typeof fastify.addHook === "function") {
    let didShutdown = false;
    fastify.addHook("onClose", async () => {
      if (didShutdown) {
        return;
      }

      didShutdown = true;
      await app.shutdown();
    });
  }

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
  profile = "",
  env = {},
  logger = console,
  fastify = null
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
  validateDescriptorCapabilities(descriptors, {
    builtinProvidersByCapability: KERNEL_BUILTIN_CAPABILITY_PROVIDERS
  });
  const orderedDescriptors = resolveDescriptorLoadOrder(descriptors);
  const catalog = Object.freeze({
    packageOrder: Object.freeze(orderedDescriptors.map((entry) => entry.packageId)),
    globalUiPaths: collectGlobalUiPaths(orderedDescriptors),
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
      registerProviderClass({
        providerClass,
        sourceId: descriptorEntry.packageId,
        seenProviderIds,
        orderedProviderClasses
      });
    }
  }

  if (!seenProviderIds.has(ActionRuntimeServiceProvider.id)) {
    registerProviderClass({
      providerClass: ActionRuntimeServiceProvider,
      sourceId: "@jskit-ai/kernel",
      seenProviderIds,
      orderedProviderClasses
    });
  }

  if (!seenProviderIds.has(ServerRuntimeCoreServiceProvider.id)) {
    registerProviderClass({
      providerClass: ServerRuntimeCoreServiceProvider,
      sourceId: "@jskit-ai/kernel",
      seenProviderIds,
      orderedProviderClasses
    });
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
    globalUiPaths: catalog.globalUiPaths,
    providerPackageOrder: Object.freeze(providerPackageIds),
    appLocalProviderOrder: Object.freeze([])
  });
}

export { createProviderRuntimeApp, createProviderRuntimeFromApp };
