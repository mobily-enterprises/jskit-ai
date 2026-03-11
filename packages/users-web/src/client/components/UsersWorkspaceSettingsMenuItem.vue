<script setup>
import {
  computed,
  watch
} from "vue";
import {
  useWebPlacementContext,
  resolveSurfaceIdFromPlacementPathname,
  extractWorkspaceSlugFromSurfacePathname
} from "@jskit-ai/shell-web/client/placement";
import { mdiCogOutline } from "@mdi/js";
import {
  hasPermission,
  normalizePermissionList
} from "../lib/permissions.js";
import { resolveWorkspaceAwareMenuTarget } from "../lib/workspaceMenuTarget.js";
import { useUsersWebBootstrapQuery } from "../composables/useUsersWebBootstrapQuery.js";

const props = defineProps({
  label: {
    type: String,
    default: "Workspace settings"
  },
  to: {
    type: String,
    default: ""
  },
  icon: {
    type: String,
    default: mdiCogOutline
  },
  surface: {
    type: String,
    default: "*"
  }
});

const { context: placementContext, mergeContext: mergePlacementContext } = useWebPlacementContext();

function readCurrentPath() {
  if (typeof window !== "object" || !window?.location) {
    return "/";
  }

  const pathname = String(window.location.pathname || "").trim();
  return pathname || "/";
}

function writeShellPermissions(permissionList) {
  mergePlacementContext(
    {
      permissions: permissionList
    },
    "users-web.workspace-settings-menu"
  );
}

const currentSurfaceId = computed(() => {
  return resolveSurfaceIdFromPlacementPathname(placementContext.value, readCurrentPath());
});

const workspaceSlug = computed(() => {
  return String(
    extractWorkspaceSlugFromSurfacePathname(placementContext.value, currentSurfaceId.value, readCurrentPath()) || ""
  ).trim();
});

const bootstrapQuery = useUsersWebBootstrapQuery({
  workspaceSlug,
  enabled: true
});

const permissions = computed(() => {
  const shellPermissions = normalizePermissionList(placementContext.value?.permissions);
  if (shellPermissions.length > 0) {
    return shellPermissions;
  }
  return normalizePermissionList(bootstrapQuery.query.data.value?.permissions);
});

const canViewWorkspaceSettings = computed(() => {
  return (
    hasPermission(permissions.value || [], "workspace.settings.view") ||
    hasPermission(permissions.value || [], "workspace.settings.update")
  );
});

const resolvedTo = computed(() => {
  const context = placementContext.value;
  return resolveWorkspaceAwareMenuTarget({
    context,
    surface: props.surface,
    explicitTo: props.to,
    workspaceSuffix: "/workspace/settings",
    nonWorkspaceSuffix: "/workspace/settings"
  });
});

watch(
  () => bootstrapQuery.query.data.value?.permissions,
  (nextValue) => {
    const normalized = normalizePermissionList(nextValue);
    if (normalized.length > 0) {
      writeShellPermissions(normalized);
    }
  }
);

watch(
  () => placementContext.value?.workspace?.slug,
  () => {
    void bootstrapQuery.query.refetch();
  }
);
</script>

<template>
  <v-list-item
    v-if="canViewWorkspaceSettings && resolvedTo"
    :title="props.label || undefined"
    :to="resolvedTo || undefined"
    :prepend-icon="props.icon || undefined"
  />
</template>
