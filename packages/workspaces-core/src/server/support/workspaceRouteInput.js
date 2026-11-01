import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { BOOTSTRAP_PATH } from "@jskit-ai/kernel/shared/surface/paths";

function readWorkspaceSlugFromRouteParams(params = {}) {
  const workspaceSlug = normalizeText(params.workspaceSlug).toLowerCase();
  return workspaceSlug || "";
}

function buildWorkspaceInputFromRouteParams(params = {}) {
  const workspaceSlug = readWorkspaceSlugFromRouteParams(params);
  if (!workspaceSlug) {
    return {};
  }

  return {
    workspaceSlug
  };
}

/**
 * The workspace a request asks for, for code that runs before the workspace action context contributor, such as an
 * auth service decorator: the route's `workspaceSlug` param, else the bootstrap request's `workspaceSlug` query.
 * It reads what the router matched and parsed, never the URL. `{}` when the request names no workspace.
 * @param {{ params?: Record<string, unknown>, query?: Record<string, unknown>, routeOptions?: { url?: string } }} request
 * @returns {{ workspaceSlug?: string }}
 */
function requestedWorkspaceScope(request) {
  const routeInput = buildWorkspaceInputFromRouteParams(request.params || {});
  if (routeInput.workspaceSlug || request.routeOptions?.url !== BOOTSTRAP_PATH) {
    return routeInput;
  }
  return buildWorkspaceInputFromRouteParams({ workspaceSlug: request.query?.workspaceSlug });
}

export {
  readWorkspaceSlugFromRouteParams,
  buildWorkspaceInputFromRouteParams,
  requestedWorkspaceScope
};
