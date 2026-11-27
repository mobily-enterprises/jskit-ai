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
 * @property {string | { key: string, fallback?: string }} [shortLabel] The label in the navigation bar, as `label`;
 *   `label` when empty. A phone's bar gives each destination about 68px, and a label wider than that ends in an ellipsis.
 * @property {string} to
 * @property {string} icon
 * @property {string} surface
 * @property {string} scopedSuffix
 * @property {string} unscopedSuffix
 */

/**
 * The application's design system for JSKIT's views (`@jskit-ai/shell-web/client/ui`): the components a view draws its
 * buttons and dialogs with, and the classes of its text by role. Material 3's unless the application provides its own.
 * @typedef {object} ShellUi
 * @property {import("vue").Component} Button A button: props `emphasis`, `tone`, `size`, `type`, `disabled`, `pending`, `block`, `href`, `icon`; the label in its default slot.
 * @property {import("vue").Component} Dialog A modal dialog: props `open` and `title`, the event `close`; the body in its default slot and the actions in `actions`.
 * @property {Readonly<Record<"title" | "heading" | "subheading" | "strong" | "lead" | "body" | "caption", string>>} text The class names of each text role.
 */

export {};
