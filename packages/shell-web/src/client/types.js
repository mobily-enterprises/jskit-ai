// The values shell-web's client hands out and receives across files, for its own modules and for the packages that use
// the shell.

/** @typedef {ReturnType<typeof import("./error/runtime.js").createErrorRuntime>} ShellErrorRuntime The error runtime. */
/** @typedef {ReturnType<typeof import("./error/store.js").createErrorPresentationStore>} ShellErrorPresentationStore What the error host shows. */
/** @typedef {ReturnType<typeof import("./placement/runtime.js").createWebPlacementRuntime>} WebPlacementRuntime The placement runtime. */
/** @typedef {ReturnType<typeof import("./asyncModuleRecovery/runtime.js").createShellAsyncModuleRecoveryRuntime>} ShellAsyncModuleRecoveryRuntime Offers a reload when an application module fails to load. */
/** @typedef {ReturnType<typeof import("./requestRecovery/runtime.js").createShellRequestRecoveryRuntime>} ShellRequestRecoveryRuntime Offers a retry or a reload when a request cannot reach the server. */
/** @typedef {ReturnType<typeof import("./runtime/bootstrapRuntime.js").createShellBootstrapRuntime>} ShellBootstrapRuntime Fetches and applies the bootstrap payload. */
/** @typedef {ReturnType<typeof import("./runtime/refreshRuntime.js").createShellRefreshRuntime>} ShellRefreshRuntime Refreshes the bootstrap payload and the active queries. */
/** @typedef {ReturnType<typeof import("./bootstrap/bootstrapPayloadHandlerRegistry.js").createBootstrapPayloadHandlerRegistry>} BootstrapPayloadHandlerRegistry The bootstrap payload handlers. */
/** @typedef {ReturnType<typeof import("./navigation/useSurfaceRouteContext.js").useSurfaceRouteContext>} SurfaceRouteContext The current route and the surface it is on. */

/**
 * The part of the optional `client.realtime` capability the shell reads.
 * @typedef {object} ShellRealtime
 * @property {(listener: (buildId: string) => void) => () => void} onServedClientBuild Calls the listener with each client build a server names; returns the unsubscribe.
 */

/**
 * What `useShellLayoutState()` reads from a layout's props.
 * @typedef {object} ShellLayoutStateProps
 * @property {string} [surface] The surface, when the layout names one instead of following the route.
 * @property {string | { key: string, fallback?: string }} [surfaceLabel] A message key, `{ key, fallback }` or plain text.
 */

/**
 * The props of a surface-aware menu or tab link.
 * @typedef {object} ShellNavigationLinkProps
 * @property {string | { key: string, fallback?: string }} label A message key, `{ key, fallback }` or plain text.
 * @property {string} to
 * @property {string} icon
 * @property {string} surface
 * @property {string} scopedSuffix
 * @property {string} unscopedSuffix
 */

export {};
