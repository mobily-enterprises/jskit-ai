// The type of the `runtime.realtime` capability, for features that require it, and the
// types realtime's modules share.

/** @typedef {ReturnType<typeof import("./realtimeCapability.js").createRealtimeCapability>} RuntimeRealtime */
/**
 * The rooms an actor's contributed scopes name.
 * @typedef {(actorId: string) => Promise<Set<string>>} ActorRoomsResolver
 */
/**
 * The rooms each actor's contributed scopes name, every asked actor included.
 * @typedef {(actorIds: string[]) => Promise<Map<string, Set<string>>>} ActorsRoomsResolver
 */
/** @typedef {ReturnType<typeof import("./realtimeAudience.js").createAudienceContributors>} AudienceContributors */
/**
 * The `realtime.audience-scope` capability: the contexts an audience's
 * audienceUsers reads in, one per kind of event scope, derived from
 * RealtimeAudienceScopeFeature's system context.
 * @typedef {object} RealtimeAudienceScope
 * @property {(workspaceId: string) => object} forWorkspace
 * @property {(userId: string) => object} forUser
 * @property {(workspaceId: string, userId: string) => object} forWorkspaceUser
 */

/**
 * A package that knows which scopes actors belong to. It answers for many
 * actors in one call (one query, not one per actor), and a lone actor is asked
 * as a list of one.
 * @typedef {object} RealtimeAudienceContributor
 * @property {string} id
 * @property {(actorIds: string[]) => Map<string, unknown> | Promise<Map<string, unknown>>} resolveActorsScopes
 *   Returns, or resolves to, each actor's scopes by actor id; an actor it leaves out has none.
 */

export {};
