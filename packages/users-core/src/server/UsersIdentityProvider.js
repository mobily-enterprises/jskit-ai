import { defineFeature } from "@jskit-ai/kernel/server/features";
import { USERS_IDENTITY_TABLES, createUsersIdentity } from "./usersIdentity.js";

// The users and user_settings tables' one owner. Other features reach them
// through the repositories it provides, never through the tables.
const UsersIdentityProvider = defineFeature({
  id: "users.identity",
  owns: USERS_IDENTITY_TABLES,
  requires: {
    extensions: "users.extensions"
  },
  provides: {
    profiles: "users.profiles",
    settings: "users.settings",
    profileProjector: "auth.profile.projector"
  },
  /**
   * @param {object} capabilities
   * @param {import("./types.js").UsersExtensions} capabilities.extensions
   * @param {import("./types.js").UsersResources} capabilities.resources
   */
  setup({ extensions, resources }) {
    return createUsersIdentity({ resources, extensions });
  }
});

export { UsersIdentityProvider };
