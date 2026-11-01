// The type of the `auth.oidc-issuer` capability, for features that require it.

/** @typedef {Awaited<ReturnType<typeof import("./issuer.js").createOidcIssuer>>} AuthOidcIssuer */

/** @typedef {ReturnType<typeof import("./config.js").resolveHubConfig>} HubConfig The hub's settings, read once from its Env. */
/** @typedef {ReturnType<typeof import("./adapter.js").createKnexAdapterClass>} HubAdapterClass The class the hub and oidc-provider keep short-lived records with. */
/** @typedef {Awaited<ReturnType<typeof import("./hub.js").createHub>>} Hub The collaborators the hub's routes share. */

export {};
