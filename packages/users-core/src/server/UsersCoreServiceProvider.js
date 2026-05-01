import { USERS_SHARED_API } from "../shared/index.js";
import {
  INTERNAL_JSON_REST_API,
  addResourceIfMissing,
  createJsonRestResourceScopeOptions
} from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";
import { toDatabaseDateTimeUtc } from "@jskit-ai/database-runtime/shared";
import { bootAccountProfileRoutes } from "./accountProfile/bootAccountProfileRoutes.js";
import { bootAccountPreferencesRoutes } from "./accountPreferences/bootAccountPreferencesRoutes.js";
import { bootAccountNotificationsRoutes } from "./accountNotifications/bootAccountNotificationsRoutes.js";
import { bootAccountSecurityRoutes } from "./accountSecurity/bootAccountSecurityRoutes.js";
import { registerSharedApi } from "./common/registerSharedApi.js";
import { registerCommonRepositories } from "./common/registerCommonRepositories.js";
import { registerUsersCore } from "./registerUsersCore.js";
import { registerUsersBootstrap } from "./registerUsersBootstrap.js";
import { registerAccountPreferences } from "./accountPreferences/registerAccountPreferences.js";
import { registerAccountNotifications } from "./accountNotifications/registerAccountNotifications.js";
import { registerAccountProfile } from "./accountProfile/registerAccountProfile.js";
import { registerAccountSecurity } from "./accountSecurity/registerAccountSecurity.js";
import { userProfileResource } from "../shared/resources/userProfileResource.js";
import { userSettingsResource } from "../shared/resources/userSettingsResource.js";

class UsersCoreServiceProvider {
  static id = "users.core";

  static dependsOn = ["runtime.server", "runtime.actions", "runtime.database", "runtime.storage", "auth.provider", "runtime.uploads", "json-rest-api.core"];

  async register(app) {
    registerSharedApi(app, USERS_SHARED_API);
    registerCommonRepositories(app);
    registerUsersCore(app);
    registerUsersBootstrap(app);

    registerAccountProfile(app);
    registerAccountPreferences(app);
    registerAccountNotifications(app);
    registerAccountSecurity(app);
  }

  async boot(app) {
    const api = app.make(INTERNAL_JSON_REST_API);
    const scopeOptions = {
      writeSerializers: {
        "datetime-utc": toDatabaseDateTimeUtc
      }
    };
    await addResourceIfMissing(api, "userProfiles", createJsonRestResourceScopeOptions(userProfileResource, scopeOptions));
    await addResourceIfMissing(api, "userSettings", createJsonRestResourceScopeOptions(userSettingsResource, scopeOptions));
    bootAccountProfileRoutes(app);
    bootAccountPreferencesRoutes(app);
    bootAccountNotificationsRoutes(app);
    bootAccountSecurityRoutes(app);
  }
}

export { UsersCoreServiceProvider };
