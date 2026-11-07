// The types of the users capabilities, for features that require them.

/** @typedef {ReturnType<typeof import("./usersRuntime.js").createUsersRuntime>} UsersCore */
/** @typedef {ReturnType<typeof import("./usersExtensions.js").createUsersExtensions>} UsersExtensions */
/**
 * The handles of the tables `users.identity` owns: users (`userProfiles`) and user_settings (`userSettings`).
 * @typedef {{
 *   userProfiles: import("@jskit-ai/resource-runtime/server/types").ResourceHandle,
 *   userSettings: import("@jskit-ai/resource-runtime/server/types").ResourceHandle
 * }} UsersResources
 */
/** @typedef {ReturnType<typeof import("./common/repositories/userProfilesRepository.js").createRepository>} UsersProfiles The users table's records: `users.profiles`. */
/** @typedef {ReturnType<typeof import("./common/repositories/userSettingsRepository.js").createRepository>} UsersSettings The users' settings records: `users.settings`. */

/**
 * The users' profile repository, as the account services receive it.
 * @typedef {ReturnType<typeof import("./common/repositories/userProfilesRepository.js").createRepository>} UserProfilesRepository
 */
/**
 * The users' settings repository, as the account services receive it.
 * @typedef {ReturnType<typeof import("./common/repositories/userSettingsRepository.js").createRepository>} UserSettingsRepository
 */

/**
 * Answers the registered profile synchronization lifecycle contributors, in
 * order: `profileSyncLifecycleContributors` of `users.extensions`.
 * @typedef {UsersExtensions["profileSyncLifecycleContributors"]} ResolveProfileSyncLifecycleContributors
 */

/** @typedef {ReturnType<typeof import("./accountNotifications/accountNotificationsService.js").createService>} AccountNotificationsService The notification settings service: `services.accountNotifications` of `users.core`. */
/** @typedef {ReturnType<typeof import("./accountPreferences/accountPreferencesService.js").createService>} AccountPreferencesService The preferences service: `services.accountPreferences` of `users.core`. */
/** @typedef {ReturnType<typeof import("./accountProfile/accountProfileService.js").createService>} AccountProfileService The profile service: `services.accountProfile` of `users.core`. */
/** @typedef {ReturnType<typeof import("./accountProfile/avatarService.js").createService>} AvatarService The avatar service: `services.avatar` of `users.core`. */
/** @typedef {ReturnType<typeof import("./accountProfile/avatarStorageService.js").createService>} AvatarStorageService The avatar files in `runtime.storage`, as the avatar service receives them. */
/** @typedef {ReturnType<typeof import("./accountSecurity/accountSecurityService.js").createService>} AccountSecurityService The account security service: `services.accountSecurity` of `users.core`. */

export {};
