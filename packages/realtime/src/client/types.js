// The values realtime's client hands out and receives across files, for its own modules and for the packages that use
// the application's socket or the `client.realtime` capability.

/**
 * The application's socket as client code uses it: Socket.IO's own, or `NO_REALTIME_SOCKET` in an application without
 * the realtime provider.
 * @typedef {Pick<import("socket.io-client").Socket, "active" | "connected" | "connect" | "disconnect" | "emit" | "timeout" | "on" | "off" | "onAny" | "offAny">} RealtimeSocket
 */

/**
 * What a listener receives for one socket event.
 * @typedef {object} RealtimeEventContext
 * @property {string} event
 * @property {any} payload
 * @property {RealtimeSocket} socket
 */

/**
 * What `useRealtimeEvent()` listens for.
 * @typedef {object} RealtimeEventOptions
 * @property {import("vue").MaybeRef<string>} [event] One event's name; every event when it is `"*"` or empty.
 * @property {import("vue").MaybeRef<boolean>} [enabled]
 * @property {(context: RealtimeEventContext) => boolean} [matches] Only an event this returns true for is handled.
 * @property {(context: RealtimeEventContext) => unknown} onEvent
 */

/**
 * The part of the optional `client.mobile` capability realtime reads.
 * @typedef {object} RealtimeMobile
 * @property {{ available?: boolean }} [adapter]
 */

/** @typedef {ReturnType<typeof import("./RealtimeClientProvider.js").resolveRealtimeClientConfig>} RealtimeClientConfig */

/**
 * The `client.realtime` capability.
 * @typedef {object} RealtimeClient
 * @property {RealtimeClientConfig} config
 * @property {() => void} dispose
 * @property {(vueApp: import("@jskit-ai/kernel/client/types").ClientVueApp) => void} initialize
 * @property {(listener: (buildId: string) => void) => () => void} onServedClientBuild Calls the listener with each client build a server names, and at once with the latest one; returns the unsubscribe.
 * @property {(prepare: () => unknown) => () => void} setBeforeReconnect Sets the step recovery runs before reconnecting; returns the function that removes it.
 * @property {import("socket.io-client").Socket} socket
 */

export {};
