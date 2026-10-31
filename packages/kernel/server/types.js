// The types of the capabilities the kernel provides and the installed runtime
// seeds, for features that require them.

/** @typedef {ReturnType<typeof import("./actions/actionCatalogue.js").createActionCatalogue>} ActionCatalogue */
/** @typedef {ReturnType<typeof import("./runtime/BootstrapProvider.js").createBootstrapRuntime>} RuntimeBootstrap */
/** @typedef {ReturnType<typeof import("./runtime/EventProvider.js").createEventRuntime>} RuntimeEvents */
/** @typedef {ReturnType<typeof import("./http/capabilityHttpRuntime.js").createCapabilityHttpRuntime>} RuntimeHttp */

/** @typedef {string} RuntimeAppRoot The application's root directory. */
/** @typedef {Readonly<Record<string, any>>} RuntimeConfig The application's configuration. */
/** @typedef {Readonly<Record<string, string | undefined>>} RuntimeEnv The process environment the application started with. */
/** @typedef {import("fastify").FastifyInstance} RuntimeFastify */

/**
 * A console-like logger: `console` unless the application supplies its own.
 * @typedef {object} RuntimeLogger
 * @property {(...args: any[]) => void} debug
 * @property {(...args: any[]) => void} info
 * @property {(...args: any[]) => void} warn
 * @property {(...args: any[]) => void} error
 */

export {};
