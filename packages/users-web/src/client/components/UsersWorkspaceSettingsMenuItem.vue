<script setup>
import {
  computed,
  watch
} from "vue";
import {
  useSurfaceRouteContext
} from "../composables/useSurfaceRouteContext.js";
import { mdiCogOutline } from "@mdi/js";
import {
  hasPermission,
  normalizePermissionList
} from "../lib/permissions.js";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import {
  USERS_BOOTSTRAP_CHANGED_EVENT
} from "@jskit-ai/users-core/shared/events/usersEvents";
import { useBootstrapQuery } from "../composables/useBootstrapQuery.js";
import { usePaths } from "../composables/usePaths.js";
import { matchesCurrentWorkspaceEvent } from "../support/realtimeWorkspace.js";

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

const { placementContext, mergePlacementContext, currentSurfaceId } = useSurfaceRouteContext();
const paths = usePaths();
const hasPlacementPermissions = computed(() => {
  const source = placementContext.value;
  if (!source || typeof source !== "object") {
    return false;
  }
  return Object.hasOwn(source, "permissions");
});

function writeShellPermissions(permissionList) {
  mergePlacementContext(
    {
      permissions: permissionList
    },
    "users-web.workspace-settings-menu"
  );
}

const bootstrapQuery = useBootstrapQuery({
  workspaceSlug: paths.workspaceSlug,
  enabled: computed(() => !hasPlacementPermissions.value)
});
const workspaceSettingsEventsEnabled = computed(() => Boolean(paths.workspaceSlug.value));

function isCurrentWorkspaceEvent({ payload = {} } = {}) {
  return matchesCurrentWorkspaceEvent(payload, paths.workspaceSlug.value);
}

const permissions = computed(() => {
  if (hasPlacementPermissions.value) {
    return normalizePermissionList(placementContext.value?.permissions);
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
  const explicitTo = String(props.to || "").trim();
  if (explicitTo) {
    return explicitTo;
  }

  const explicitSurface = String(props.surface || "").trim().toLowerCase();
  const targetSurfaceId =
    explicitSurface && explicitSurface !== "*"
      ? explicitSurface
      : String(currentSurfaceId.value || "").trim().toLowerCase();

  return paths.page("/workspace/settings", {
    surface: targetSurfaceId,
    mode: "auto"
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

useRealtimeEvent({
  event: USERS_BOOTSTRAP_CHANGED_EVENT,
  enabled: workspaceSettingsEventsEnabled,
  matches: isCurrentWorkspaceEvent,
  onEvent: async () => {
    await bootstrapQuery.query.refetch();
  }
});
</script>

<template>
  <v-list-item
    v-if="canViewWorkspaceSettings && resolvedTo"
    :title="props.label"
    :to="resolvedTo"
    :prepend-icon="props.icon"
  />
</template>
