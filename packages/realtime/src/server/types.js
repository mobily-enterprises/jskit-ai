// The type of the `runtime.realtime` capability, for features that require it, and the
// types realtime's modules share.

/** @typedef {ReturnType<typeof import("./realtimeCapability.js").createRealtimeCapability>} RuntimeRealtime */
/**
 * The rooms an actor's contributed scopes name.
 * @typedef {(actorId: string) => Promise<Set<string>>} ActorRoomsResolver
 */
/** @typedef {ReturnType<typeof import("./realtimeAudience.js").createAudienceContributors>} AudienceContributors */

/**
 * A package that knows which scopes an actor belongs to.
 * @typedef {object} RealtimeAudienceContributor
 * @property {string} id
 * @property {(actorId: string) => unknown} resolveActorScopes Returns, or resolves to, the actor's scopes.
 */

export {};
