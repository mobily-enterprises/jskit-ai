import { defineCrudJsonApiFeature } from "@jskit-ai/crud-core/server/defineCrudJsonApiFeature";
import { WORKSPACE_CRUD_SCOPE } from "@jskit-ai/workspaces-core/server/support/workspaceCrud";
import { userCrud } from "../shared/userResource.js";

const UsersWorkspaceFeature = defineCrudJsonApiFeature({
  resource: userCrud,
  id: "app.users-workspace",
  capability: "app.users-workspace",
  surface: "admin",
  ownershipFilter: "workspace",
  relativePath: "/users",
  scope: WORKSPACE_CRUD_SCOPE
});

export { UsersWorkspaceFeature };
