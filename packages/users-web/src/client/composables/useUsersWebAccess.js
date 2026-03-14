import { computed, watch } from "vue";
import { hasPermission, normalizePermissionList } from "../lib/permissions.js";
import { useUsersWebBootstrapQuery } from "./useUsersWebBootstrapQuery.js";
import { resolveEnabledRef, resolveTextRef } from "./refValueHelpers.js";

function asPermissionList(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === undefined || value === null || value === "") {
    return [];
  }

  return [value];
}

function useUsersWebAccess({
  workspaceSlug = "",
  enabled = true,
  mergePlacementContext = null,
  placementSource = "users-web.access"
} = {}) {
  const normalizedWorkspaceSlug = computed(() => resolveTextRef(workspaceSlug));
  const queryEnabled = computed(() => resolveEnabledRef(enabled));
  const bootstrap = useUsersWebBootstrapQuery({
    workspaceSlug: normalizedWorkspaceSlug,
    enabled: queryEnabled
  });

  const permissions = computed(() => normalizePermissionList(bootstrap.query.data.value?.permissions));
  const bootstrapError = computed(() => {
    const error = bootstrap.query.error.value;
    if (!error) {
      return "";
    }

    return String(error?.message || "Unable to load permissions.").trim();
  });
  const isBootstrapping = computed(() => Boolean(bootstrap.query.isPending.value || bootstrap.query.isFetching.value));

  if (typeof mergePlacementContext === "function") {
    watch(
      permissions,
      (nextPermissions) => {
        mergePlacementContext(
          {
            permissions: nextPermissions
          },
          String(placementSource || "users-web.access")
        );
      },
      {
        immediate: true
      }
    );
  }

  function can(permission) {
    return hasPermission(permissions.value, permission);
  }

  function canAny(requiredPermissions) {
    const list = asPermissionList(requiredPermissions);
    if (list.length < 1) {
      return true;
    }

    for (const entry of list) {
      if (can(entry)) {
        return true;
      }
    }

    return false;
  }

  function canAll(requiredPermissions) {
    const list = asPermissionList(requiredPermissions);
    if (list.length < 1) {
      return true;
    }

    for (const entry of list) {
      if (!can(entry)) {
        return false;
      }
    }

    return true;
  }

  async function refreshBootstrap() {
    return bootstrap.query.refetch();
  }

  return Object.freeze({
    query: bootstrap.query,
    queryKey: bootstrap.queryKey,
    workspaceSlug: normalizedWorkspaceSlug,
    permissions,
    bootstrapError,
    isBootstrapping,
    can,
    canAny,
    canAll,
    refreshBootstrap
  });
}

export { useUsersWebAccess };
