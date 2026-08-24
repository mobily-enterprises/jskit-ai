import { defineCrudJsonApiFeature } from "@jskit-ai/crud-core/server/defineCrudJsonApiFeature";
import { buildWorkspaceInputFromRouteParams } from "@jskit-ai/workspaces-core/server/support/workspaceRouteInput";
import { workspaceSlugParamsValidator } from "@jskit-ai/workspaces-core/server/validators/routeParamsValidator";
import { resource } from "../shared/userResource.js";

const UsersWorkspaceFeature = defineCrudJsonApiFeature({
  resource,
  id: "app.users-workspace",
  capability: "app.users-workspace",
  surface: "admin",
  ownershipFilter: "workspace",
  relativePath: "/users",
  scope: {
    routeBase: "/w/:workspaceSlug",
    actionInputValidator: workspaceSlugParamsValidator,
    routeParamsValidator: workspaceSlugParamsValidator,
    inputKeys: ["workspaceSlug"],
    input: (request) => buildWorkspaceInputFromRouteParams(request.input.params)
  }
});

export { UsersWorkspaceFeature };
