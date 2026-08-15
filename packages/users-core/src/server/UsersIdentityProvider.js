import { toDatabaseDateTimeUtc } from "@jskit-ai/database-runtime/shared";
import {
  addResourceIfMissing,
  createJsonRestResourceScopeOptions
} from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";
import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { userProfileResource } from "../shared/resources/userProfileResource.js";
import { userSettingsResource } from "../shared/resources/userSettingsResource.js";
import { createRepository as createUserProfilesRepository } from "./common/repositories/userProfilesRepository.js";
import { createRepository as createUserSettingsRepository } from "./common/repositories/userSettingsRepository.js";
import { createService as createAuthProfileSyncService } from "./common/services/authProfileSyncService.js";

const UsersIdentityProvider = defineProvider({
  id: "users.identity",
  requires: {
    authExtensions: "auth.extensions",
    database: "runtime.database",
    extensions: "users.extensions",
    jsonRestApi: "runtime.json-rest-api"
  },
  provides: {
    identity: "users.identity"
  },
  async setup({ authExtensions, database, extensions, jsonRestApi }) {
    const scopeOptions = {
      writeSerializers: { "datetime-utc": toDatabaseDateTimeUtc }
    };
    await addResourceIfMissing(
      jsonRestApi,
      "userProfiles",
      createJsonRestResourceScopeOptions(userProfileResource, scopeOptions)
    );
    await addResourceIfMissing(
      jsonRestApi,
      "userSettings",
      createJsonRestResourceScopeOptions(userSettingsResource, scopeOptions)
    );
    const repositories = Object.freeze({
      userProfiles: createUserProfilesRepository({ api: jsonRestApi, knex: database.knex }),
      userSettings: createUserSettingsRepository({ api: jsonRestApi, knex: database.knex })
    });
    const profileProjector = createAuthProfileSyncService({
      userProfilesRepository: repositories.userProfiles,
      userSettingsRepository: repositories.userSettings,
      resolveLifecycleContributors: extensions.profileSyncLifecycleContributors
    });
    authExtensions.registerProfileProjector({
      projectorId: "users.profile",
      ...profileProjector
    });
    return {
      identity: Object.freeze({ repositories, profileProjector })
    };
  }
});

export { UsersIdentityProvider };
