import { workspaceSlugParamsValidator } from "../common/validators/routeParamsValidator.js";
import { buildWorkspaceInputFromRouteParams } from "./workspaceRouteInput.js";
import { resolveWorkspace } from "./resolveWorkspace.js";

function createWorkspaceServerScopeSupport() {
  return Object.freeze({
    available: true,
    paramsValidator: workspaceSlugParamsValidator,
    buildInputFromRouteParams(params = {}) {
      return buildWorkspaceInputFromRouteParams(params);
    },
    resolveWorkspace(context = {}, input = {}) {
      return resolveWorkspace(context, input);
    }
  });
}

export { createWorkspaceServerScopeSupport };
