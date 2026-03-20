import { computed, watch } from "vue";
import { arePermissionListsEqual, hasPermission, normalizePermissionList } from "../lib/permissions.js";
import { useBootstrapQuery } from "./useBootstrapQuery.js";
import { resolveEnabledRef, resolveTextRef } from "./refValueHelpers.js";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { useWebPlacementContext } from "@jskit-ai/shell-web/client/placement";
import { matchesCurrentWorkspaceEvent } from "../support/realtimeWorkspace.js";
import {
  USERS_BOOTSTRAP_CHANGED_EVENT
} from "@jskit-ai/users-core/shared/events/usersEvents";
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
  const { context: placementContext } = useWebPlacementContext();
  const normalizedWorkspaceSlug = computed(() => resolveTextRef(workspaceSlug));
  const hasPlacementBootstrapPermissions = computed(() => {
    const source = placementContext.value;
    if (!source || typeof source !== "object") {
      return false;
    }
    return Object.hasOwn(source, "permissions");
  });
  const placementPermissions = computed(() => normalizePermissionList(placementContext.value?.permissions));
  const queryEnabled = computed(() => resolveEnabledRef(enabled) && accessRequired);
  const bootstrap = accessRequired
    ? useBootstrapQuery({
        workspaceSlug: normalizedWorkspaceSlug,
        enabled: computed(() => queryEnabled.value && !hasPlacementBootstrapPermissions.value)
      })
    : null;

  const permissions = computed(() => {
    if (!accessRequired) {
      return [];
    }
    if (hasPlacementBootstrapPermissions.value) {
      return placementPermissions.value;
    }
    return normalizePermissionList(bootstrap.query.data.value?.permissions);
  });
  const bootstrapError = computed(() => {
    if (!accessRequired || hasPlacementBootstrapPermissions.value) {
      return "";
    }

    const error = bootstrap.query.error.value;
    if (!error) {
      return "";
    }

    return String(error?.message || "Unable to load permissions.").trim();
  });
  const isBootstrapping = computed(() =>
    accessRequired && !hasPlacementBootstrapPermissions.value
      ? Boolean(bootstrap.query.isPending.value || bootstrap.query.isFetching.value)
      : false
  );
  const realtimeEnabled = computed(() =>
    accessRequired && normalizedWorkspaceSlug.value.length > 0
  );

  function isCurrentWorkspaceEvent({ payload = {} } = {}) {
    return matchesCurrentWorkspaceEvent(payload, normalizedWorkspaceSlug.value);
  }

  if (accessRequired && typeof mergePlacementContext === "function") {
    watch(
      permissions,
      (nextPermissions) => {
        const normalizedNextPermissions = normalizePermissionList(nextPermissions);
        const normalizedCurrentPermissions = normalizePermissionList(placementContext.value?.permissions);
        if (arePermissionListsEqual(normalizedNextPermissions, normalizedCurrentPermissions)) {
          return;
        }

        mergePlacementContext(
          {
            permissions: normalizedNextPermissions
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
    if (!accessRequired || hasPlacementBootstrapPermissions.value) {
      return null;
    }

    return bootstrap.query.refetch();
  }

  useRealtimeEvent({
    event: USERS_BOOTSTRAP_CHANGED_EVENT,
    enabled: realtimeEnabled,
    matches: isCurrentWorkspaceEvent,
    onEvent: refreshBootstrap
  });

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
