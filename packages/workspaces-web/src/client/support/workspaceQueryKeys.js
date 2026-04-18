import { normalizeQueryToken } from "@jskit-ai/kernel/shared/support/normalize";

function buildWorkspaceQueryKey(kind = "", surfaceId = "", workspaceSlug = "") {
  return [
    "workspaces-web",
    "workspace",
    String(kind || ""),
    normalizeQueryToken(surfaceId),
    normalizeQueryToken(workspaceSlug)
  ];
}

export {
  buildWorkspaceQueryKey
};
