// The types of the database-backed local auth capabilities, for features that require them.

/** @typedef {ReturnType<typeof import("./lib/dbBackend.js").createLocalDbOwners>["accounts"]} AuthLocalAccounts Local auth's accounts: `auth.local.accounts`. */
/** @typedef {ReturnType<typeof import("./lib/dbBackend.js").createLocalDbOwners>["sessions"]} AuthLocalSessions Local auth's sessions: `auth.local.sessions`. */
/** @typedef {ReturnType<typeof import("./lib/dbBackend.js").createLocalDbOwners>["recovery"]} AuthLocalRecovery Local auth's recovery tokens: `auth.local.recovery`. */

export {};
