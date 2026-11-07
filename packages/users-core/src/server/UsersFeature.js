import { defineFeature } from "@jskit-ai/kernel/server/features";
import { createAccountNotificationsActions } from "./accountNotifications/accountNotificationsActions.js";
import { registerAccountNotificationsRoutes } from "./accountNotifications/accountNotificationsRoutes.js";
import { createAccountPreferencesActions } from "./accountPreferences/accountPreferencesActions.js";
import { registerAccountPreferencesRoutes } from "./accountPreferences/accountPreferencesRoutes.js";
import { createAccountProfileActions } from "./accountProfile/accountProfileActions.js";
import { registerAccountProfileRoutes } from "./accountProfile/accountProfileRoutes.js";
import { createAccountSecurityActions } from "./accountSecurity/accountSecurityActions.js";
import { registerAccountSecurityRoutes } from "./accountSecurity/accountSecurityRoutes.js";
import { createUsersBootstrapContributor } from "./usersBootstrapContributor.js";
import { createUsersRuntime } from "./usersRuntime.js";

const UsersFeature = defineFeature({
  id: "users.core",
  domain: "settings",
  requires: {
    authService: "auth.service",
    bootstrap: "runtime.bootstrap",
    http: "runtime.http",
    profileProjector: "auth.profile.projector",
    profiles: "users.profiles",
    settings: "users.settings",
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
   * @param {import("@jskit-ai/auth-core/server/types").AuthProfileProjector} capabilities.profileProjector
   * @param {import("./types.js").UsersProfiles} capabilities.profiles
   * @param {import("./types.js").UsersSettings} capabilities.settings
   * @param {import("@jskit-ai/storage-runtime/server/types").RuntimeStorage} capabilities.storage
   * @param {import("@jskit-ai/uploads-runtime/server/types").RuntimeUploads} capabilities.uploads
   */
  setup({ authService, bootstrap, http, profileProjector, profiles, settings, storage, uploads }) {
    const users = createUsersRuntime({ authService, profileProjector, profiles, settings, storage });
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
        userProfilesRepository: profiles,
        userSettingsRepository: settings
      }).contribute
    });
    return { users };
  },
  actions({ users }) {
    return Object.freeze([
      ...createAccountProfileActions({ accountProfileService: users.services.accountProfile }),
      ...createAccountPreferencesActions({ accountPreferencesService: users.services.accountPreferences }),
      ...createAccountNotificationsActions({ accountNotificationsService: users.services.accountNotifications }),
      ...createAccountSecurityActions({ accountSecurityService: users.services.accountSecurity })
    ]);
  }
});

export { UsersFeature };
