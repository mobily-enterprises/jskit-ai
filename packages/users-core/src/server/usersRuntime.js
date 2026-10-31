import { USERS_SHARED_API } from "../shared/index.js";
import { createService as createAccountNotificationsService } from "./accountNotifications/accountNotificationsService.js";
import { createService as createAccountPreferencesService } from "./accountPreferences/accountPreferencesService.js";
import { createService as createAccountProfileService } from "./accountProfile/accountProfileService.js";
import { createService as createAvatarService } from "./accountProfile/avatarService.js";
import { createService as createAvatarStorageService } from "./accountProfile/avatarStorageService.js";
import { createService as createAccountSecurityService } from "./accountSecurity/accountSecurityService.js";

// The `users.core` capability: the users' repositories and the account
// services built on them.
/**
 * @param {object} dependencies
 * @param {import("@jskit-ai/auth-core/server/types").AuthService} dependencies.authService
 * @param {import("./types.js").UsersIdentity} dependencies.identity
 * @param {import("@jskit-ai/storage-runtime/server/types").RuntimeStorage} dependencies.storage
 */
function createUsersRuntime({ authService, identity, storage }) {
  const userProfilesRepository = identity.repositories.userProfiles;
  const userSettingsRepository = identity.repositories.userSettings;
  const avatarStorageService = createAvatarStorageService({ storage });
  const avatarService = createAvatarService({ userProfilesRepository, avatarStorageService });
  const accountProfileService = createAccountProfileService({
    authService,
    avatarService,
    userProfilesRepository,
    userSettingsRepository
  });
  const accountPreferencesService = createAccountPreferencesService({
    authService,
    userProfilesRepository,
    userSettingsRepository
  });
  const accountNotificationsService = createAccountNotificationsService({
    authService,
    userProfilesRepository,
    userSettingsRepository
  });
  const accountSecurityService = createAccountSecurityService({
    authService,
    userProfilesRepository,
    userSettingsRepository
  });

  return Object.freeze({
    repositories: Object.freeze({
      userProfiles: userProfilesRepository,
      userSettings: userSettingsRepository
    }),
    services: Object.freeze({
      accountNotifications: accountNotificationsService,
      accountPreferences: accountPreferencesService,
      accountProfile: accountProfileService,
      accountSecurity: accountSecurityService,
      avatar: avatarService,
      profileProjector: identity.profileProjector
    }),
    shared: USERS_SHARED_API
  });
}

export { createUsersRuntime };
