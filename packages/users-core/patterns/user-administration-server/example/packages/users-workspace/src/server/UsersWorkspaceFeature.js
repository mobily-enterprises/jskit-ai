import { defineCrudFeature } from "@jskit-ai/crud-core/server/defineCrudFeature";
import { WORKSPACE_CRUD_SCOPE } from "@jskit-ai/workspaces-core/server/support/workspaceCrud";
import { userCrud } from "../shared/userCrud.js";

// users-core owns the users table; this feature serves the administration
// CRUD contract on a workspace's admin surface through its owner's
// repository. The routes are a workspace's, so they resolve the caller's
// workspace and check its crud.users.* permissions.
const UsersWorkspaceFeature = defineCrudFeature({
  crud: userCrud,
  ownerRepository: "users.profiles",
  visibility: "workspace",
  id: "app.users-workspace",
  capability: "app.users-workspace",
  surface: "admin",
  relativePath: "/users",
  scope: WORKSPACE_CRUD_SCOPE
});

export { UsersWorkspaceFeature };
