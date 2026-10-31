import { createRepository as createUserProfilesRepository } from "./common/repositories/userProfilesRepository.js";
import { createRepository as createUserSettingsRepository } from "./common/repositories/userSettingsRepository.js";
import { createService as createAuthProfileSyncService } from "./common/services/authProfileSyncService.js";

// The users' profile and settings records, and the projector that keeps a
// profile in step with the identity that signs in.
/**
 * @param {object} dependencies
 * @param {import("@jskit-ai/json-rest-api-core/server/types").RuntimeJsonRestApi} dependencies.jsonRestApi
 * @param {import("./types.js").UsersExtensions} dependencies.extensions
 */
function createUsersIdentity({ jsonRestApi, extensions }) {
  const repositories = Object.freeze({
    userProfiles: createUserProfilesRepository({ api: jsonRestApi }),
    userSettings: createUserSettingsRepository({ api: jsonRestApi })
  });
  const profileProjector = createAuthProfileSyncService({
    userProfilesRepository: repositories.userProfiles,
    userSettingsRepository: repositories.userSettings,
    resolveLifecycleContributors: extensions.profileSyncLifecycleContributors
  });
  return Object.freeze({ repositories, profileProjector });
}

export { createUsersIdentity };
