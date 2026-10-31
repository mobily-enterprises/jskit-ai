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
 * @property {(input: { session: object, context: object | null, trx: object }) => boolean | Promise<boolean>} authorizeGrant
 *   Answers true when the session's reward may be granted.
 */

export {};
