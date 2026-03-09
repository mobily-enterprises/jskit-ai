import { useUsersWebAccess } from "./useUsersWebAccess.js";

function useUsersWebWorkspaceAccess({
  workspaceSlug = "",
  enabled = true,
  mergePlacementContext = null,
  placementSource = "users-web.workspace-access-view"
} = {}) {
  return useUsersWebAccess({
    workspaceSlug,
    enabled,
    mergePlacementContext,
    placementSource: String(placementSource || "users-web.workspace-access-view")
  });
}

export { useUsersWebWorkspaceAccess };
