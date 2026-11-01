import { routeParamsValidator, workspaceSlugParamsValidator } from "../common/validators/routeParamsValidator.js";
import { buildWorkspaceInputFromRouteParams } from "./workspaceRouteInput.js";

/**
 * The workspace scope's input: the workspace slug in the request's route params.
 * @param {{ input: { params: Record<string, unknown> } }} request
 */
function workspaceCrudScopeInput(request) {
  return buildWorkspaceInputFromRouteParams(request.input.params);
}

/**
 * The scope a workspace CRUD feature hands defineCrudJsonApiFeature: its routes
 * live under /w/:workspaceSlug, and the workspace slug is the scope's only input.
 * @type {import("@jskit-ai/crud-core/server/types").CrudScope}
 */
const WORKSPACE_CRUD_SCOPE = Object.freeze({
  routeBase: "/w/:workspaceSlug",
  actionInputValidator: workspaceSlugParamsValidator,
  routeParamsValidator,
  inputKeys: Object.freeze(["workspaceSlug"]),
  input: workspaceCrudScopeInput
});

export { WORKSPACE_CRUD_SCOPE };
