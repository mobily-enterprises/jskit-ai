// The types of the users capabilities, for features that require them.

/** @typedef {ReturnType<typeof import("./usersRuntime.js").createUsersRuntime>} UsersCore */
/** @typedef {ReturnType<typeof import("./usersExtensions.js").createUsersExtensions>} UsersExtensions */
/** @typedef {ReturnType<typeof import("./usersIdentity.js").createUsersIdentity>} UsersIdentity */

// The users' repositories, as the account services receive them.
/** @typedef {ReturnType<typeof import("./common/repositories/userProfilesRepository.js").createRepository>} UserProfilesRepository */
/** @typedef {ReturnType<typeof import("./common/repositories/userSettingsRepository.js").createRepository>} UserSettingsRepository */

export {};
