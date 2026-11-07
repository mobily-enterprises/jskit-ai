// The types of the rewarded capabilities, for features that require them.

/** @typedef {ReturnType<typeof import("./service.js").createService>} RewardedCore */
/** @typedef {import("@jskit-ai/crud-core/server/types").CrudResourceApi} RewardedProviderConfigs */
/** @typedef {import("@jskit-ai/crud-core/server/types").CrudResourceApi} RewardedRules */
/** @typedef {import("@jskit-ai/crud-core/server/types").CrudResourceApi} RewardedUnlockReceipts */
/** @typedef {import("@jskit-ai/crud-core/server/types").CrudResourceApi} RewardedWatchSessions */

/**
 * The `rewarded.grant-policy` capability the application provides: it decides
 * whether a watch session earns its reward.
 * @typedef {object} RewardedGrantPolicy
 * @property {(input: { session: object, context: object, options: import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions }) => boolean | Promise<boolean>} authorizeGrant
 *   Answers true when the session's reward may be granted. `options` are the grant's call options, inside its
 *   transaction: pass them on to any read the decision needs.
 */

export {};
