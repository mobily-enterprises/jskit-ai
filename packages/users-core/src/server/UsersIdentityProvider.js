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
  /**
   * @param {object} capabilities
   * @param {import("@jskit-ai/auth-core/server/types").AuthExtensions} capabilities.authExtensions
   * @param {import("./types.js").UsersExtensions} capabilities.extensions
   * @param {import("@jskit-ai/json-rest-api-core/server/types").RuntimeJsonRestApi} capabilities.jsonRestApi
   */
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
