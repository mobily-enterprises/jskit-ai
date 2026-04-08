import { USERS_SHARED_API } from "../shared/index.js";
import { bootAccountProfileRoutes } from "./accountProfile/bootAccountProfileRoutes.js";
import { bootAccountPreferencesRoutes } from "./accountPreferences/bootAccountPreferencesRoutes.js";
import { bootAccountNotificationsRoutes } from "./accountNotifications/bootAccountNotificationsRoutes.js";
import { bootAccountSecurityRoutes } from "./accountSecurity/bootAccountSecurityRoutes.js";
import { bootConsoleSettingsRoutes } from "./consoleSettings/bootConsoleSettingsRoutes.js";
import { registerSharedApi } from "./common/registerSharedApi.js";
import { registerCommonRepositories } from "./common/registerCommonRepositories.js";
import { registerUsersCore } from "./registerUsersCore.js";
import { registerUsersBootstrap } from "./registerUsersBootstrap.js";
import { registerAccountPreferences } from "./accountPreferences/registerAccountPreferences.js";
import { registerAccountNotifications } from "./accountNotifications/registerAccountNotifications.js";
import { registerAccountProfile } from "./accountProfile/registerAccountProfile.js";
import { registerAccountSecurity } from "./accountSecurity/registerAccountSecurity.js";
import { registerConsoleSettings } from "./consoleSettings/registerConsoleSettings.js";

class UsersCoreServiceProvider {
  static id = "users.core";

  static dependsOn = ["runtime.server", "runtime.actions", "runtime.database", "runtime.storage", "auth.provider", "runtime.uploads"];

  register(app) {
    registerSharedApi(app, USERS_SHARED_API);
    registerCommonRepositories(app);
    registerUsersCore(app);
    registerUsersBootstrap(app);

    registerAccountProfile(app);
    registerAccountPreferences(app);
    registerAccountNotifications(app);
    registerAccountSecurity(app);
    registerConsoleSettings(app);
  }

  async boot(app) {
    bootAccountProfileRoutes(app);
    bootAccountPreferencesRoutes(app);
    bootAccountNotificationsRoutes(app);
    bootAccountSecurityRoutes(app);
    bootConsoleSettingsRoutes(app);
  }
}

export { UsersCoreServiceProvider };
