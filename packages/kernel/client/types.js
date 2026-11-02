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

export {};
