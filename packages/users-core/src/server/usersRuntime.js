import { USERS_SHARED_API } from "../shared/index.js";
import { createService as createAccountNotificationsService } from "./accountNotifications/accountNotificationsService.js";
import { createService as createAccountPreferencesService } from "./accountPreferences/accountPreferencesService.js";
import { createService as createAccountProfileService } from "./accountProfile/accountProfileService.js";
import { createService as createAvatarService } from "./accountProfile/avatarService.js";
import { createService as createAvatarStorageService } from "./accountProfile/avatarStorageService.js";
import { createService as createAccountSecurityService } from "./accountSecurity/accountSecurityService.js";

/**
 * The `users.core` capability: the account services built on the users'
 * records. The records themselves are `users.profiles` and `users.settings`.
 * @param {object} dependencies
 * @param {import("@jskit-ai/auth-core/server/types").AuthService} dependencies.authService
 * @param {import("@jskit-ai/auth-core/server/types").AuthProfileProjector} dependencies.profileProjector
 * @param {import("./types.js").UsersProfiles} dependencies.profiles
 * @param {import("./types.js").UsersSettings} dependencies.settings
 * @param {import("@jskit-ai/storage-runtime/server/types").RuntimeStorage} dependencies.storage
 */
function createUsersRuntime({
  authService,
  profileProjector,
  profiles: userProfilesRepository,
  settings: userSettingsRepository,
  storage
}) {
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
    services: Object.freeze({
      accountNotifications: accountNotificationsService,
      accountPreferences: accountPreferencesService,
      accountProfile: accountProfileService,
      accountSecurity: accountSecurityService,
      avatar: avatarService,
      profileProjector
    }),
    shared: USERS_SHARED_API
  });
}

export { createUsersRuntime };
