import { computed, watch } from "vue";
import { hasPermission, normalizePermissionList } from "../lib/permissions.js";
import { useBootstrapQuery } from "./useBootstrapQuery.js";
import { resolveEnabledRef, resolveTextRef } from "./refValueHelpers.js";
import {
  normalizeAccessMode,
  resolveAccessModeEnabled
} from "./scopeHelpers.js";

function asPermissionList(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === undefined || value === null || value === "") {
    return [];
  }

  return [value];
}

function useAccess({
  workspaceSlug = "",
  enabled = true,
  access = "always",
  hasPermissionRequirements = false,
  mergePlacementContext = null,
  placementSource = "users-web.access"
} = {}) {
  const normalizedAccessMode = normalizeAccessMode(access);
  const accessRequired = resolveAccessModeEnabled(normalizedAccessMode, {
    hasPermissionRequirements: hasPermissionRequirements === true
  });
  const normalizedWorkspaceSlug = computed(() => resolveTextRef(workspaceSlug));
  const queryEnabled = computed(() => resolveEnabledRef(enabled) && accessRequired);
  const bootstrap = accessRequired
    ? useBootstrapQuery({
        workspaceSlug: normalizedWorkspaceSlug,
        enabled: queryEnabled
      })
    : null;

  const permissions = computed(() =>
    accessRequired ? normalizePermissionList(bootstrap.query.data.value?.permissions) : []
  );
  const bootstrapError = computed(() => {
    if (!accessRequired) {
      return "";
    }

    const error = bootstrap.query.error.value;
    if (!error) {
      return "";
    }

    return String(error?.message || "Unable to load permissions.").trim();
  });
  const isBootstrapping = computed(() =>
    accessRequired ? Boolean(bootstrap.query.isPending.value || bootstrap.query.isFetching.value) : false
  );

  if (accessRequired && typeof mergePlacementContext === "function") {
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
    if (!accessRequired) {
      return null;
    }

    return bootstrap.query.refetch();
  }

  return Object.freeze({
    accessMode: normalizedAccessMode,
    accessRequired,
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

export { useAccess };
