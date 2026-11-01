// The relying party's own types, named once for the modules that share them.

/** @typedef {ReturnType<typeof import("./lib/config.js").resolveOidcConfig>} OidcConfig The relying party's settings, read once from its Env. */
/** @typedef {ReturnType<typeof import("./lib/store.js").createOidcStore>} OidcStore Where the relying party keeps its issuer clients, app sessions and seen logout tokens. */
/** @typedef {ReturnType<typeof import("./lib/issuer.js").createIssuerClient>} OidcIssuerClient The relying party's view of its issuer. */

export {};
