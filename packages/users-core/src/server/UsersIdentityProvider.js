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
    extensions: "users.extensions",
    jsonRestApi: "runtime.json-rest-api"
  },
  provides: {
    identity: "users.identity",
    profileProjector: "auth.profile.projector"
  },
  /**
   * @param {object} capabilities
   * @param {import("./types.js").UsersExtensions} capabilities.extensions
   * @param {import("@jskit-ai/json-rest-api-core/server/types").RuntimeJsonRestApi} capabilities.jsonRestApi
   */
  async setup({ extensions, jsonRestApi }) {
    const scopeOptions = {
      writeSerializers: { "datetime-utc": toDatabaseDateTimeUtc }
    };
    for (const resource of [userProfileResource, userSettingsResource]) {
      await addResourceIfMissing(jsonRestApi, resource.name, createJsonRestResourceScopeOptions(resource, scopeOptions));
    }
    const identity = createUsersIdentity({ jsonRestApi, extensions });
    return { identity, profileProjector: identity.profileProjector };
  }
});

export { UsersIdentityProvider };
