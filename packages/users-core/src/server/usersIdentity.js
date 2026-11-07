import { createRepository as createUserProfilesRepository } from "./common/repositories/userProfilesRepository.js";
import { createRepository as createUserSettingsRepository } from "./common/repositories/userSettingsRepository.js";
import { createService as createAuthProfileSyncService } from "./common/services/authProfileSyncService.js";

/**
 * The users' profile and settings records (`users.profiles`, `users.settings`),
 * and the projector that keeps a profile in step with the identity that signs
 * in (`auth.profile.projector`).
 * @param {object} dependencies
 * @param {import("@jskit-ai/resource-runtime/server/types").RuntimeJsonRestApi} dependencies.jsonRestApi
 * @param {import("./types.js").UsersExtensions} dependencies.extensions
 */
function createUsersIdentity({ jsonRestApi, extensions }) {
  const settings = createUserSettingsRepository({ api: jsonRestApi });
  const profiles = createUserProfilesRepository({ api: jsonRestApi, userSettings: settings });
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

export { createUsersIdentity };
