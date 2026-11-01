// Supabase auth's own types, named once for the modules that share them.

/** @typedef {ReturnType<typeof import("./config.js").resolveSupabaseConfig>} SupabaseConfig Supabase auth's settings, read once from the app's config and Env. */
/** @typedef {ReturnType<typeof import("./supabaseClients.js").createSupabaseClients>} SupabaseClients New Supabase clients for the app's project. */
/** @typedef {ReturnType<typeof import("./profileMirror.js").createSupabaseProfileMirror>} SupabaseProfileMirror The app profile and actor of each Supabase user. */
/** @typedef {ReturnType<typeof import("./sessions.js").createSupabaseSessions>} SupabaseSessions A request's Supabase session. */
/** @typedef {ReturnType<typeof import("./securityStatus.js").createSupabaseSecurityStatus>} SupabaseSecurityStatus The sign-in methods of the signed-in account. */

/** @typedef {Pick<import("@jskit-ai/users-core/server/types").UserProfilesRepository, "findById" | "findByEmail">} SupabaseUserProfiles The app users dev auth signs in as. */
/** @typedef {Pick<import("@jskit-ai/users-core/server/types").UserSettingsRepository, "ensureForUserId" | "updatePasswordSignInEnabled" | "updatePasswordSetupRequired">} SupabaseUserSettings Whether each user may sign in with a password. */

/**
 * Where each Supabase user's app profile lives, by config.auth.profileMode.
 * @typedef {object} SupabaseProfiles
 * @property {Required<Pick<import("@jskit-ai/auth-core/server/types").AuthProfileProjector, "syncIdentityProfile" | "findByIdentity">>} projector
 *   Makes or finds the app profile of a Supabase user.
 * @property {SupabaseUserProfiles} userProfilesRepository
 * @property {SupabaseUserSettings} userSettingsRepository
 */

export {};
