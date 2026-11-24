import { ActionProvider } from "../actions/actionProvider.js";
import { createCapabilityRuntime } from "../../shared/capabilities/runtime.js";
import { HttpProvider } from "../http/HttpProvider.js";
import { registerSecurityHeaders } from "../http/securityHeaders.js";
import { registerAppEnvironmentPage } from "../http/appEnvironmentPage.js";
import { registerRedirectHosts } from "../http/redirectHosts.js";
import { assertAppEnvironment, logAppEnvironment } from "../runtime/appEnvironment.js";
import { BootstrapProvider } from "../runtime/BootstrapProvider.js";
import { EventProvider } from "../runtime/EventProvider.js";
import { createHealthRuntime } from "../runtime/healthRuntime.js";
import {
  assertManifestMatchesProviders,
  collectGlobalUiPaths,
  resolveInstalledJskitPackages,
  resolvePackageLoadOrder,
  validatePackageCapabilities
} from "./providerRuntime/packageCatalog.js";
import {
  appendCapabilityProviders,
  loadCapabilityProviders
} from "./providerRuntime/capabilityProviderLoader.js";

/** @typedef {import("../types.js").RuntimeConfig} RuntimeConfig */
/** @typedef {import("../types.js").RuntimeEnv} RuntimeEnv */
/** @typedef {import("../types.js").RuntimeFastify} RuntimeFastify */
/** @typedef {import("../types.js").RuntimeHealth} RuntimeHealth */
/** @typedef {import("../types.js").RuntimeLogger} RuntimeLogger */

const RUNTIME_LOGGER_METHODS = Object.freeze(["debug", "info", "warn", "error"]);

/**
 * The application's own inputs with the capabilities the installed runtime seeds.
 * @param {object} seeds
 * @param {Record<string, unknown>} seeds.inputs
 * @param {RuntimeConfig} seeds.config
 * @param {RuntimeEnv} seeds.env
 * @param {RuntimeLogger} seeds.logger
 * @param {RuntimeHealth} seeds.health
 * @param {RuntimeFastify | null} seeds.httpServer The Fastify instance that serves HTTP, if any.
 * @param {string} seeds.appRoot
 */
function seedInputCapabilities({ inputs, config, env, logger, health, httpServer, appRoot }) {
  return Object.freeze({
    ...inputs,
    "runtime.app-root": appRoot,
    "runtime.config": Object.freeze({ ...config }),
    "runtime.env": Object.freeze({ ...env }),
    "runtime.logger": logger,
    "runtime.health": health,
    ...(httpServer ? { "runtime.fastify": httpServer } : {})
  });
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
 * @typedef {object} InstalledRuntimeOptions
 * @property {string} appRoot
 * @property {string} [profile]
 * @property {ReadonlyArray<object>} [providers] The application's own providers, started after the packages'.
 * @property {Record<string, unknown>} [inputs]
 * @property {RuntimeConfig} [config]
 * @property {RuntimeEnv} [env]
 * @property {RuntimeLogger} logger The application's logger, which features and actions log through.
 * @property {RuntimeFastify} [fastify] Absent when the application serves no HTTP.
 */

/**
 * @typedef {object} InstalledPackages What an application's installed packages give its runtime.
 * @property {ReadonlyArray<string>} packageOrder
 * @property {ReadonlyArray<string>} providerPackageOrder
 * @property {unknown} globalUiPaths
 */

/**
 * The body both installed runtimes share: everything but finding the installed packages' providers, which
 * `addInstalledPackages` does, handing each package's providers to `appendPackage` in load order.
 * @param {string} name The caller's name, for its errors.
 * @param {InstalledRuntimeOptions} options
 * @param {(found: {
 *   inputCapabilities: Record<string, unknown>,
 *   appendPackage: (sourceId: string, providers: ReadonlyArray<object>) => void
 * }) => Promise<InstalledPackages> | InstalledPackages} addInstalledPackages
 */
async function startInstalledRuntime(name, {
  appRoot,
  profile = "",
  providers = [],
  inputs = {},
  config = {},
  env = {},
  logger,
  fastify
}, addInstalledPackages) {
  if (!appRoot || typeof appRoot !== "string") {
    throw new TypeError(`${name} requires appRoot.`);
  }
  // readable-check: allow method-probe - input validation: every feature and action logs through the application's logger
  if (!RUNTIME_LOGGER_METHODS.every((method) => typeof logger?.[method] === "function")) {
    throw new TypeError(`${name} requires a logger with debug(), info(), warn() and error().`);
  }

  // readable-check: allow method-probe - input validation: the application passes its own Fastify instance
  if (fastify && (typeof fastify.route !== "function" || typeof fastify.addHook !== "function")) {
    throw new TypeError(`${name} requires a Fastify instance when it serves HTTP.`);
  }

  assertAppEnvironment(env);
  const httpServer = fastify || null;
  if (httpServer) {
    // Before any provider registers a plugin, so every route and plugin inherits the hooks.
    registerSecurityHeaders(httpServer, { config, env });
    registerAppEnvironmentPage(httpServer, { env });
    registerRedirectHosts(httpServer, { env });
  }
  logAppEnvironment(logger, env);
  const health = createHealthRuntime({ logger });
  const inputCapabilities = seedInputCapabilities({ inputs, config, env, logger, health, httpServer, appRoot });
  const orderedProviders = [];
  const seenProviderIds = new Map();

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

  const installed = await addInstalledPackages({
    inputCapabilities,
    appendPackage: (sourceId, packageProviders) => appendCapabilityProviders({
      providers: packageProviders,
      sourceId,
      seenProviderIds,
      orderedProviders
    })
  });

  appendCapabilityProviders({
    providers,
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
    health,
    packageOrder: Object.freeze([...installed.packageOrder]),
    providerPackageOrder: Object.freeze([...installed.providerPackageOrder]),
    globalUiPaths: installed.globalUiPaths,
    diagnostics: runtime.diagnostics()
  });
}

/**
 * The application's capability runtime: the kernel's providers, then each
 * installed package's, then the application's own. It refuses to start unless `env` names a
 * known APP_ENV (`assertAppEnvironment`). A Fastify instance adds HTTP, the security headers
 * `config.securityHeaders` describes on every response it sends, the APP_ENV in every page it
 * sends, for the shell's environment banner, and a 301 to APP_PUBLIC_URL for a request sent to one
 * of the application's other names (APP_REDIRECT_HOSTS, `registerRedirectHosts`). It logs once where the application runs. The result's
 * `health` runs the health checks providers register (`runtime.health`), for the application's
 * health route.
 * @param {InstalledRuntimeOptions} options
 */
async function createInstalledRuntime(options) {
  const { appRoot, logger } = options;
  return startInstalledRuntime("createInstalledRuntime", options, async ({ inputCapabilities, appendPackage }) => {
    const installedPackages = await resolveInstalledJskitPackages({ appRoot });
    validatePackageCapabilities(installedPackages, {
      builtinProvidersByCapability: builtinCapabilityProviders(inputCapabilities)
    });
    const orderedPackages = resolvePackageLoadOrder(installedPackages);
    const providerPackageOrder = [];
    for (const packageEntry of orderedPackages) {
      const packageProviders = await loadCapabilityProviders({ packageEntry });
      if (packageProviders.length === 0) {
        continue;
      }
      assertManifestMatchesProviders(packageEntry, packageProviders, { logger });
      providerPackageOrder.push(packageEntry.packageId);
      appendPackage(packageEntry.packageId, packageProviders);
    }
    return {
      packageOrder: orderedPackages.map((entry) => entry.packageId),
      providerPackageOrder,
      globalUiPaths: collectGlobalUiPaths(orderedPackages)
    };
  });
}

/**
 * `createInstalledRuntime` for an application whose installed packages' providers were collected when it was
 * built, such as a single-file release bundle that has no node_modules to read: the same runtime, the same
 * APP_ENV check, security headers, environment page tag, other names' redirect, startup line and health runtime, with the build's
 * provider registry in place of reading the installed packages.
 * @param {InstalledRuntimeOptions & { installed: InstalledPackages & { providers: ReadonlyArray<object> } }} options
 *   `installed` is the build's registry: every installed package's providers in load order, and the package order,
 *   provider package order and global UI paths it found.
 */
async function createStaticInstalledRuntime({ installed, ...options }) {
  if (!Array.isArray(installed?.providers) || !Array.isArray(installed.packageOrder) ||
    !Array.isArray(installed.providerPackageOrder)) {
    throw new TypeError(
      "createStaticInstalledRuntime requires installed: the providers, packageOrder and providerPackageOrder its build " +
        "collected."
    );
  }
  return startInstalledRuntime("createStaticInstalledRuntime", options, ({ appendPackage }) => {
    appendPackage("the build's provider registry", installed.providers);
    return installed;
  });
}

export { createInstalledRuntime, createStaticInstalledRuntime };
