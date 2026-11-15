import { userProfileTableResource } from "../shared/resources/userProfileResource.js";
import { userSettingsTableResource } from "../shared/resources/userSettingsResource.js";
import { createRepository as createUserProfilesRepository } from "./common/repositories/userProfilesRepository.js";
import { createRepository as createUserSettingsRepository } from "./common/repositories/userSettingsRepository.js";
import { createService as createAuthProfileSyncService } from "./common/services/authProfileSyncService.js";

// The users and user_settings tables, which users.identity owns.
const USERS_IDENTITY_TABLES = Object.freeze([userProfileTableResource, userSettingsTableResource]);

/**
 * The users' profile and settings records (`users.profiles`, `users.settings`),
 * and the projector that keeps a profile in step with the identity that signs
 * in (`auth.profile.projector`).
 * @param {object} dependencies
 * @param {import("./types.js").UsersResources} dependencies.resources The handles of the users and user_settings tables.
 * @param {import("./types.js").UsersExtensions} dependencies.extensions
 */
function createUsersIdentity({ resources, extensions }) {
  const settings = createUserSettingsRepository({ userSettings: resources.userSettings });
  const profiles = createUserProfilesRepository({ userProfiles: resources.userProfiles, userSettings: settings });
  const profileProjector = createAuthProfileSyncService({
    userProfilesRepository: profiles,
    userSettingsRepository: settings,
    resolveLifecycleContributors: extensions.profileSyncLifecycleContributors
  });
  return Object.freeze({
    profiles,
    settings,
    profileProjector
  });
}

export { USERS_IDENTITY_TABLES, createUsersIdentity };
