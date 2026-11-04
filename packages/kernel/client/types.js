// The types of the capabilities the kernel's client runtime seeds, for the client providers that require them.

/** @typedef {import("vue").App} ClientVueApp The Vue application, `client.vue`. */
/** @typedef {import("vue-router").Router} ClientRouter The application's router, `client.router`. */
/** @typedef {import("pinia").Pinia} ClientPinia The Pinia instance, `client.pinia`. */
/** @typedef {import("@tanstack/vue-query").QueryClient} ClientQueryClient The query client, `client.query`. */
/** @typedef {Readonly<Record<string, string | undefined>>} ClientEnv The client build's environment, `client.env`. */
/** @typedef {ReturnType<typeof import("../shared/surface/runtime.js").createSurfaceRuntime>} ClientSurfaceRuntime The surfaces, `client.surface`. */
/** @typedef {string} ClientSurfaceMode The surface mode the client was built for, `client.surface-mode`. */
/** @typedef {ReturnType<typeof import("./logging.js").createStructuredLogger>} ClientLogger The client's logger, `client.logger`. */
/** @typedef {ReturnType<typeof import("./componentRegistry.js").createClientComponentRegistry>} ClientComponents The component registry, `client.components`. */

// The types of what the kernel's client bootstrap receives and hands out.

/** @typedef {import("vue-router").RouteRecordRaw} ClientRouteRecord A route an application declares. */
/** @typedef {import("./asyncModuleRecovery.d.ts").AsyncModuleRecoveryState} AsyncModuleRecoveryState What the application shows about a module that failed to load; the recovery functions change it in place. */
/** @typedef {Awaited<ReturnType<typeof import("./moduleBootstrap.js").bootClientModules>>} ClientBootstrap What booting the client modules gives the application. */

/**
 * An installed package's client module, as the Vite plugin lists it.
 * @typedef {object} ClientModuleEntry
 * @property {string} packageId
 * @property {Record<string, unknown>} module The package's `./client` exports.
 * @property {object[]} [packageMetadataUiRoutes]
 * @property {object[]} [packageMetadataClientProviders]
 */

/**
 * The shell guard's options.
 * @typedef {object} ShellGuardOptions
 * @property {"yes" | "no"} [webRootAllowed] "no" redirects the web root to the default surface.
 * @property {string} [guardEvaluatorKey] The global key of the application's guard evaluator.
 * @property {string} [authenticatedPolicy]
 * @property {string} [publicPolicy]
 */

/**
 * What a bootstrap hook receives.
 * @typedef {object} ClientBootstrapHookContext
 * @property {ClientVueApp} app
 * @property {ClientRouter} router
 * @property {ClientBootstrap} clientBootstrap
 * @property {ClientSurfaceRuntime} surfaceRuntime
 * @property {ClientSurfaceMode} surfaceMode
 * @property {Record<string, unknown>} env
 * @property {ClientLogger} logger
 * @property {boolean} debugEnabled
 */

export {};
