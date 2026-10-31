import { toDatabaseDateTimeUtc } from "@jskit-ai/database-runtime/shared";
import {
  addResourceIfMissing,
  createJsonRestResourceScopeOptions
} from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";
import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { userProfileResource } from "../shared/resources/userProfileResource.js";
import { userSettingsResource } from "../shared/resources/userSettingsResource.js";
import { createUsersIdentity } from "./usersIdentity.js";

const UsersIdentityProvider = defineProvider({
  id: "users.identity",
  requires: {
    authExtensions: "auth.extensions",
    extensions: "users.extensions",
    jsonRestApi: "runtime.json-rest-api"
  },
  provides: {
    identity: "users.identity"
  },
  async setup({ authExtensions, extensions, jsonRestApi }) {
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
    const identity = createUsersIdentity({ jsonRestApi, extensions });
    authExtensions.registerProfileProjector({
      projectorId: "users.profile",
      ...identity.profileProjector
    });
    return { identity };
  }
});

export { UsersIdentityProvider };
