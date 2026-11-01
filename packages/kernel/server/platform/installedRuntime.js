import { ActionProvider } from "../actions/actionProvider.js";
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

/** @typedef {import("../types.js").RuntimeFastify} RuntimeFastify */
/** @typedef {import("../types.js").RuntimeLogger} RuntimeLogger */

const RUNTIME_LOGGER_METHODS = Object.freeze(["debug", "info", "warn", "error"]);

/**
 * @param {object} seeds
 * @param {Record<string, unknown>} seeds.inputs
 * @param {Record<string, any>} seeds.config
 * @param {Record<string, unknown>} seeds.env
 * @param {RuntimeLogger} seeds.logger
 * @param {RuntimeFastify | null} seeds.httpServer The Fastify instance that serves HTTP, if any.
 * @param {string} seeds.appRoot
 */
function normalizeInputCapabilities({ inputs, config, env, logger, httpServer, appRoot }) {
  const source = inputs && typeof inputs === "object" && !Array.isArray(inputs) ? inputs : {};
  const normalized = {
    ...source,
    "runtime.app-root": appRoot,
    "runtime.config": Object.freeze({ ...(config && typeof config === "object" ? config : {}) }),
    "runtime.env": Object.freeze({ ...(env && typeof env === "object" ? env : {}) }),
    "runtime.logger": logger,
    ...(httpServer ? { "runtime.fastify": httpServer } : {})
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

/**
 * The application's capability runtime: the kernel's providers, then each
 * installed package's, then the application's own. A Fastify instance adds HTTP.
 * @param {object} options
 * @param {string} options.appRoot
 * @param {string} [options.profile]
 * @param {ReadonlyArray<object>} [options.providers]
 * @param {Record<string, unknown>} [options.inputs]
 * @param {Record<string, any>} [options.config]
 * @param {Record<string, unknown>} [options.env]
 * @param {RuntimeLogger} options.logger The application's logger, which features and actions log through.
 * @param {RuntimeFastify} [options.fastify] Absent when the application serves no HTTP.
 */
async function createInstalledRuntime({
  appRoot,
  profile = "",
  providers = [],
  inputs = {},
  config = {},
  env = {},
  logger,
  fastify
}) {
  if (!appRoot || typeof appRoot !== "string") {
    throw new TypeError("createInstalledRuntime requires appRoot.");
  }
  // readable-check: allow method-probe - input validation: every feature and action logs through the application's logger
  if (!RUNTIME_LOGGER_METHODS.every((method) => typeof logger?.[method] === "function")) {
    throw new TypeError("createInstalledRuntime requires a logger with debug(), info(), warn() and error().");
  }

  // readable-check: allow method-probe - input validation: the application passes its own Fastify instance
  if (fastify && (typeof fastify.route !== "function" || typeof fastify.addHook !== "function")) {
    throw new TypeError("createInstalledRuntime requires a Fastify instance when it serves HTTP.");
  }

  const httpServer = fastify || null;
  const inputCapabilities = normalizeInputCapabilities({ inputs, config, env, logger, httpServer, appRoot });
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
      ActionProvider,
      ...(httpServer ? [HttpProvider, BootstrapProvider] : [])
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

  if (httpServer) {
    httpServer.addHook("onClose", async () => {
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
