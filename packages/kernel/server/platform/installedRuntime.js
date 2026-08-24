import { createActionProvider } from "../actions/actionProvider.js";
import { createCapabilityRuntime } from "../../shared/capabilities/runtime.js";
import { HttpProvider } from "../http/HttpProvider.js";
import { BootstrapProvider } from "../runtime/BootstrapProvider.js";
import { EventProvider } from "../runtime/EventProvider.js";
import {
  collectGlobalUiPaths,
  resolveInstalledJskitPackages,
  resolvePackageLoadOrder,
  validatePackageCapabilities
} from "./providerRuntime/packageCatalog.js";
import {
  appendCapabilityProviders,
  loadCapabilityProviders
} from "./providerRuntime/capabilityProviderLoader.js";

function normalizeInputCapabilities({ inputs, config, env, logger, fastify, appRoot }) {
  const source = inputs && typeof inputs === "object" && !Array.isArray(inputs) ? inputs : {};
  const normalized = {
    ...source,
    "runtime.app-root": appRoot,
    "runtime.config": Object.freeze({ ...(config && typeof config === "object" ? config : {}) }),
    "runtime.env": Object.freeze({ ...(env && typeof env === "object" ? env : {}) }),
    "runtime.logger": logger || console,
    ...(fastify && typeof fastify.route === "function" ? { "runtime.fastify": fastify } : {})
  };
  return Object.freeze(normalized);
}

function builtinCapabilityProviders(inputCapabilities) {
  return Object.fromEntries([
    ["runtime.actions", ["@jskit-ai/kernel"]],
    ["runtime.events", ["@jskit-ai/kernel"]],
    ...(Object.hasOwn(inputCapabilities, "runtime.fastify")
      ? [
          ["runtime.bootstrap", ["@jskit-ai/kernel"]],
          ["runtime.http", ["@jskit-ai/kernel"]]
        ]
      : []),
    ...Object.keys(inputCapabilities).map((capabilityId) => [capabilityId, ["application"]])
  ]);
}

async function createInstalledRuntime({
  appRoot,
  profile = "",
  providers = [],
  inputs = {},
  config = {},
  env = {},
  logger = console,
  fastify = null
} = {}) {
  if (!appRoot || typeof appRoot !== "string") {
    throw new TypeError("createInstalledRuntime requires appRoot.");
  }

  const inputCapabilities = normalizeInputCapabilities({ inputs, config, env, logger, fastify, appRoot });
  const installedPackages = await resolveInstalledJskitPackages({ appRoot });
  validatePackageCapabilities(installedPackages, {
    builtinProvidersByCapability: builtinCapabilityProviders(inputCapabilities)
  });
  const orderedPackages = resolvePackageLoadOrder(installedPackages);
  const orderedProviders = [];
  const seenProviderIds = new Map();
  const providerPackageOrder = [];

  appendCapabilityProviders({
    providers: [
      EventProvider,
      createActionProvider({ logger }),
      ...(fastify && typeof fastify.route === "function" ? [HttpProvider, BootstrapProvider] : [])
    ],
    sourceId: "@jskit-ai/kernel",
    seenProviderIds,
    orderedProviders
  });

  for (const packageEntry of orderedPackages) {
    const packageProviders = await loadCapabilityProviders({ packageEntry });
    if (packageProviders.length === 0) {
      continue;
    }
    providerPackageOrder.push(packageEntry.packageId);
    appendCapabilityProviders({
      providers: packageProviders,
      sourceId: packageEntry.packageId,
      seenProviderIds,
      orderedProviders
    });
  }

  appendCapabilityProviders({
    providers: Array.isArray(providers) ? providers : [],
    sourceId: "application",
    seenProviderIds,
    orderedProviders
  });

  const runtime = createCapabilityRuntime({
    providers: orderedProviders,
    inputs: inputCapabilities,
    profile
  });
  await runtime.start();

  if (fastify && typeof fastify.addHook === "function") {
    fastify.addHook("onClose", async () => {
      await runtime.shutdown();
    });
  }

  return Object.freeze({
    runtime,
    packageOrder: Object.freeze(orderedPackages.map((entry) => entry.packageId)),
    providerPackageOrder: Object.freeze(providerPackageOrder),
    globalUiPaths: collectGlobalUiPaths(orderedPackages),
    diagnostics: runtime.diagnostics()
  });
}

export { createInstalledRuntime };
