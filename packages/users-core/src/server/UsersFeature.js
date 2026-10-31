import { defineFeature } from "@jskit-ai/kernel/server/features";
import { USERS_SHARED_API } from "../shared/index.js";
import { createAccountNotificationsActions } from "./accountNotifications/accountNotificationsActions.js";
import { createService as createAccountNotificationsService } from "./accountNotifications/accountNotificationsService.js";
import { registerAccountNotificationsRoutes } from "./accountNotifications/bootAccountNotificationsRoutes.js";
import { createAccountPreferencesActions } from "./accountPreferences/accountPreferencesActions.js";
import { createService as createAccountPreferencesService } from "./accountPreferences/accountPreferencesService.js";
import { registerAccountPreferencesRoutes } from "./accountPreferences/bootAccountPreferencesRoutes.js";
import { createAccountProfileActions } from "./accountProfile/accountProfileActions.js";
import { createService as createAccountProfileService } from "./accountProfile/accountProfileService.js";
import { createService as createAvatarService } from "./accountProfile/avatarService.js";
import { createService as createAvatarStorageService } from "./accountProfile/avatarStorageService.js";
import { registerAccountProfileRoutes } from "./accountProfile/bootAccountProfileRoutes.js";
import { createAccountSecurityActions } from "./accountSecurity/accountSecurityActions.js";
import { createService as createAccountSecurityService } from "./accountSecurity/accountSecurityService.js";
import { registerAccountSecurityRoutes } from "./accountSecurity/bootAccountSecurityRoutes.js";
import { createUsersBootstrapContributor } from "./usersBootstrapContributor.js";

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

const UsersFeature = defineFeature({
  id: "users.core",
  domain: "settings",
  requires: {
    authService: "auth.service",
    bootstrap: "runtime.bootstrap",
    http: "runtime.http",
    identity: "users.identity",
    storage: "runtime.storage",
    uploads: "runtime.uploads"
  },
  provides: {
    users: "users.core"
  },
  /**
   * @param {object} capabilities
   * @param {import("@jskit-ai/auth-core/server/types").AuthService} capabilities.authService
   * @param {import("@jskit-ai/kernel/server/types").RuntimeBootstrap} capabilities.bootstrap
   * @param {import("@jskit-ai/kernel/server/types").RuntimeHttp} capabilities.http
   * @param {import("./types.js").UsersIdentity} capabilities.identity
   * @param {import("@jskit-ai/storage-runtime/server/types").RuntimeStorage} capabilities.storage
   * @param {import("@jskit-ai/uploads-runtime/server/types").RuntimeUploads} capabilities.uploads
   */
  async setup({ authService, bootstrap, http, identity, storage, uploads }) {
    const users = createUsersRuntime({ authService, identity, storage });
    registerAccountProfileRoutes(http.router, {
      accountProfileService: users.services.accountProfile,
      authService,
      uploads
    });
    registerAccountPreferencesRoutes(http.router);
    registerAccountNotificationsRoutes(http.router);
    registerAccountSecurityRoutes(http.router, { authService });
    bootstrap.register({
      id: "users.bootstrap",
      order: 100,
      contribute: createUsersBootstrapContributor({
        authService,
        userProfilesRepository: users.repositories.userProfiles,
        userSettingsRepository: users.repositories.userSettings
      }).contribute
    });
    return { users };
  },
  actions({ users }) {
    return [
      ...createAccountProfileActions({ accountProfileService: users.services.accountProfile }),
      ...createAccountPreferencesActions({ accountPreferencesService: users.services.accountPreferences }),
      ...createAccountNotificationsActions({ accountNotificationsService: users.services.accountNotifications }),
      ...createAccountSecurityActions({ accountSecurityService: users.services.accountSecurity })
    ];
  }
});

export { UsersFeature, createUsersRuntime };
