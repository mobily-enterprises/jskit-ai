// The types the assistant runtime's client hands out and receives across its files. Types assistant-core owns are
// imported from `@jskit-ai/assistant-core/client/types` where they are used.

/** @typedef {import("@jskit-ai/realtime/client/types").RealtimeSocket} RealtimeSocket The application's shared realtime socket. */
/** @typedef {ReturnType<typeof import("@jskit-ai/shell-web/client/navigation/useSurfaceRouteContext").useSurfaceRouteContext>} SurfaceRouteContext The current route's surface and placement context. */

/**
 * The shell's web placement runtime (`jskit.shell-web.runtime.web-placement.client`): the members a conversation reads.
 * @typedef {object} PlacementRuntime
 * @property {() => Record<string, any>} getContext The placement context, including the signed-in user.
 * @property {(listener: () => void) => () => void} subscribe Calls the listener when the context changes; returns the unsubscribe.
 */

/**
 * The workspace route scope workspaces-web provides (`jskit.workspaces.web.scope-support`).
 * @typedef {object} WorkspaceScopeSupport
 * @property {boolean} available Whether the application has workspaces.
 * @property {(routeContext: SurfaceRouteContext) => { workspaceSlug: string }} readRouteScope The workspace a route names.
 */

/**
 * The conversation one binding targets, resolved from its options and the route.
 * @typedef {object} ConversationIdentity
 * @property {string} conversationId
 * @property {string} targetSurfaceId
 * @property {string} hostSurfaceId
 * @property {string} workspaceSlug
 * @property {boolean} configured Whether the target surface has an assistant.
 * @property {string} actorKey
 * @property {string} endpoint
 */

/**
 * One view that keeps a retained conversation open.
 * @typedef {object} ConversationReader
 * @property {import("vue").MaybeRefOrGetter<boolean>} active Whether the view is shown; `false` stops it reading.
 * @property {import("vue").MaybeRefOrGetter<boolean | object | null | undefined>} [questions] The view's question options.
 * @property {import("vue").MaybeRefOrGetter<boolean | object | null | undefined>} [goal] `true` when the view reads the goal.
 * @property {(event: object) => unknown} [onEvent] The view's presentation hook. A reader acquired through
 * `runtime.retain()` has none.
 */

/** @typedef {ReturnType<typeof import("./support/subscribeAssistantConversation.js").subscribeAssistantConversation>} ConversationSubscription */
/** @typedef {ReturnType<typeof import("./composables/conversationRuntime.js").createConversationRuntime>} ConversationRuntime */

export {};
