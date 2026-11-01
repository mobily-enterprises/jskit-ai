// The type of the `runtime.realtime` capability, for features that require it, and the
// types realtime's modules share.

/** @typedef {ReturnType<typeof import("./realtimeCapability.js").createRealtimeCapability>} RuntimeRealtime */
/** @typedef {ReturnType<typeof import("./realtimeLogger.js").createRealtimeLogger>} RealtimeLogger The logger realtime logs through. */

/**
 * A package that knows which scopes an actor belongs to.
 * @typedef {object} RealtimeAudienceContributor
 * @property {string} id
 * @property {(actorId: string) => unknown} resolveActorScopes Returns, or resolves to, the actor's scopes.
 */

export {};
