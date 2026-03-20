import { computed } from "vue";
import { hasPermission, normalizePermissionList } from "../lib/permissions.js";
import { resolveEnabledRef, resolveTextRef } from "./refValueHelpers.js";
import {
  normalizeAccessMode,
  resolveAccessModeEnabled
} from "./scopeHelpers.js";
import { useWebPlacementContext } from "@jskit-ai/shell-web/client/placement";

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
  hasPermissionRequirements = false
} = {}) {
  const normalizedAccessMode = normalizeAccessMode(access);
  const accessRequired = resolveAccessModeEnabled(normalizedAccessMode, {
    hasPermissionRequirements: hasPermissionRequirements === true
  });
  const { context: placementContext } = useWebPlacementContext();
  const normalizedWorkspaceSlug = computed(() => resolveTextRef(workspaceSlug));
  const queryEnabled = computed(() => resolveEnabledRef(enabled) && accessRequired);
  const hasPlacementBootstrapPermissions = computed(() => {
    const source = placementContext.value;
    if (!source || typeof source !== "object") {
      return false;
    }
    return Object.hasOwn(source, "permissions");
  });
  const placementPermissions = computed(() => normalizePermissionList(placementContext.value?.permissions));
  const permissions = computed(() => {
    if (!queryEnabled.value || !hasPlacementBootstrapPermissions.value) {
      return [];
    }
    return placementPermissions.value;
  });
  const bootstrapError = computed(() => {
    if (!queryEnabled.value || hasPlacementBootstrapPermissions.value) {
      return "";
    }
    return "Permissions are unavailable in placement context.";
  });
  const isBootstrapping = computed(() => queryEnabled.value && !hasPlacementBootstrapPermissions.value);

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
    return null;
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
