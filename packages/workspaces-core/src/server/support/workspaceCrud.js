import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
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

/**
 * The workspace id of a CRUD repository call's context: its workspace, else
 * the workspace the request resolved, else the visibility scope owner, else
 * the workspaceId scope value; null when it carries none.
 * @param {object} [context]
 * @returns {string | null}
 */
function workspaceIdFromContext(context = {}) {
  return normalizeRecordId(
    context.workspace?.id ||
      context.requestMeta?.resolvedWorkspaceContext?.workspace?.id ||
      context.visibilityContext?.scopeOwnerId ||
      context.scopeValues?.workspaceId,
    { fallback: null }
  );
}

export { WORKSPACE_CRUD_SCOPE, workspaceIdFromContext };
