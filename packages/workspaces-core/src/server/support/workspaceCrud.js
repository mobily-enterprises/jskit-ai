import { normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { ROUTE_VISIBILITY_WORKSPACE, ROUTE_VISIBILITY_WORKSPACE_USER } from "@jskit-ai/kernel/shared/support/visibility";
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

const WORKSPACE_SCOPE_KINDS = new Set([ROUTE_VISIBILITY_WORKSPACE, ROUTE_VISIBILITY_WORKSPACE_USER]);

/**
 * The visibility scope's owner when the scope is a workspace's. Its kind is
 * the scopeKind, else the visibility. Workspaces' visibility resolver sets a
 * workspace kind, but an application's resolver may add another kind, whose
 * owner is not a workspace id. A hand-built context naming only the owner,
 * with no kind, is a workspace's.
 * @param {{ scopeKind?: string | null, visibility?: string, scopeOwnerId?: unknown }} [visibilityContext]
 */
function workspaceScopeOwnerId(visibilityContext) {
  // data: a context carries no visibility outside a route
  if (!visibilityContext) {
    return null;
  }
  const kind = normalizeText(visibilityContext.scopeKind || visibilityContext.visibility).toLowerCase();
  return !kind || WORKSPACE_SCOPE_KINDS.has(kind) ? visibilityContext.scopeOwnerId : null;
}

/**
 * The workspace id of a CRUD repository call's context: its workspace, else
 * the workspace the request resolved, else the owner of a workspace
 * visibility scope, else the workspaceId scope value; null when it carries none.
 * @param {object} [context]
 * @returns {string | null}
 */
function workspaceIdFromContext(context = {}) {
  return normalizeRecordId(
    context.workspace?.id ||
      context.requestMeta?.resolvedWorkspaceContext?.workspace?.id ||
      workspaceScopeOwnerId(context.visibilityContext) ||
      context.scopeValues?.workspaceId,
    { fallback: null }
  );
}

export { WORKSPACE_CRUD_SCOPE, workspaceIdFromContext };
