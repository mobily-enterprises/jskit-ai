// The types of the services connectors-catalog builds, for code that receives them,
// and the contracts of what an application passes them.

/** @typedef {ReturnType<typeof import("./ai.js").createAiConnectionResolver>} AiConnectionResolver */
/** @typedef {ReturnType<typeof import("./google-ads-search.js").createGoogleAdsSearchService>} GoogleAdsSearchService */

/**
 * The application's choice of what to scan for an authorized owner: an
 * immutable source snapshot and its revision, never a path from the browser.
 * @typedef {(owner: import("@jskit-ai/connectors-core/server/types").ConnectionOwner, request: { integrationId: string, signal?: AbortSignal }) => Promise<{ directory: string, revision: string }>} WizScanTargetResolver
 */

export {};
