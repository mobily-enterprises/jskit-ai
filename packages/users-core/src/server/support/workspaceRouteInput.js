import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

function readWorkspaceSlugFromRouteParams(params = {}) {
  const workspaceSlug = normalizeText(params?.workspaceSlug).toLowerCase();
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

export {
  readWorkspaceSlugFromRouteParams,
  buildWorkspaceInputFromRouteParams
};
