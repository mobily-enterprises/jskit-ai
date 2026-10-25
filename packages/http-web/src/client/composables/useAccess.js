import { computed } from "vue";
import { hasPermission, normalizePermissionList } from "../lib/permissions.js";
import { resolveEnabledRef } from "./support/refValueHelpers.js";
import {
  normalizeAccessMode,
  resolveAccessModeEnabled
} from "./support/scopeHelpers.js";
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

// Permissions come only from the web placement context, which the shell fills
// from its bootstrap. Until that context carries a `permissions` key, access is
// awaiting placement permissions and reports them as unavailable.
function useAccess({
  enabled = true,
  access = "always",
  hasPermissionRequirements = false
} = {}) {
  const normalizedAccessMode = normalizeAccessMode(access);
  const accessRequired = resolveAccessModeEnabled(normalizedAccessMode, {
    hasPermissionRequirements: hasPermissionRequirements === true
  });
  const { context: placementContext } = useWebPlacementContext();
  const queryEnabled = computed(() => resolveEnabledRef(enabled) && accessRequired);
  const hasPlacementPermissions = computed(() => {
    const source = placementContext.value;
    if (!source || typeof source !== "object") {
      return false;
    }
    return Object.hasOwn(source, "permissions");
  });
  const placementPermissions = computed(() => normalizePermissionList(placementContext.value?.permissions));
  const permissions = computed(() => {
    if (!queryEnabled.value || !hasPlacementPermissions.value) {
      return [];
    }
    return placementPermissions.value;
  });
  const permissionsUnavailableError = computed(() => {
    if (!queryEnabled.value || hasPlacementPermissions.value) {
      return "";
    }
    return "Permissions are unavailable in placement context.";
  });
  const awaitingPlacementPermissions = computed(() => queryEnabled.value && !hasPlacementPermissions.value);

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

  return Object.freeze({
    accessMode: normalizedAccessMode,
    accessRequired,
    permissions,
    permissionsUnavailableError,
    awaitingPlacementPermissions,
    can,
    canAny,
    canAll
  });
}

export { useAccess };
