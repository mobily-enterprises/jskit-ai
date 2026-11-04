// The values rewarded's client hands out and receives across files, for its own modules and for the application that
// supplies delivery or asks for an unlock.

/**
 * What a delivery receives for one reward. The workflow always passes all four callbacks.
 * @typedef {object} RewardedLaunch
 * @property {Record<string, unknown>} providerConfig The provider's configuration, opaque to the workflow.
 * @property {() => void} onReady
 * @property {() => Promise<void>} onGranted
 * @property {() => Promise<void>} onClosed
 * @property {() => void} onUnavailable
 */

/**
 * The `client.rewarded-delivery` capability an application supplies.
 * @typedef {object} RewardedDelivery
 * @property {(launch: RewardedLaunch) => Promise<void>} launchReward Settles when the reward's lifecycle ends.
 */

/** @typedef {ReturnType<typeof import("./runtime/rewardedRuntime.js").createRewardedRuntime>} RewardedRuntime The `client.rewarded` capability. */

export {};
