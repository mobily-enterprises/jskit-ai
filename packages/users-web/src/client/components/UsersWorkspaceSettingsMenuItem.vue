<script setup>
import {
  computed,
  watch
} from "vue";
import {
  useWebPlacementContext
} from "@jskit-ai/shell-web/client/placement";
import { mdiCogOutline } from "@mdi/js";
import {
  hasPermission,
  normalizePermissionList
} from "../lib/permissions.js";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import {
  WORKSPACE_SETTINGS_CHANGED_EVENT,
  WORKSPACE_MEMBERS_CHANGED_EVENT
} from "@jskit-ai/users-core/shared/events/usersEvents";
import { useBootstrapQuery } from "../composables/useBootstrapQuery.js";
import { usePaths } from "../composables/usePaths.js";

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
const paths = usePaths();

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
  enabled: true
});
const workspaceSettingsEventsEnabled = computed(() => Boolean(paths.workspaceSlug.value));

function isCurrentWorkspaceEvent({ payload = {} } = {}) {
  const payloadWorkspaceSlug = String(payload?.workspaceSlug || "").trim();
  if (!payloadWorkspaceSlug) {
    return true;
  }

  return payloadWorkspaceSlug === String(paths.workspaceSlug.value || "").trim();
}

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
  const explicitTo = String(props.to || "").trim();
  if (explicitTo) {
    return explicitTo;
  }

  return paths.page("/workspace/settings", {
    surface: props.surface,
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

watch(
  () => placementContext.value?.workspace?.slug,
  () => {
    void bootstrapQuery.query.refetch();
  }
);

useRealtimeEvent({
  event: WORKSPACE_SETTINGS_CHANGED_EVENT,
  enabled: workspaceSettingsEventsEnabled,
  matches: isCurrentWorkspaceEvent,
  onEvent: async () => {
    await bootstrapQuery.query.refetch();
  }
});

useRealtimeEvent({
  event: WORKSPACE_MEMBERS_CHANGED_EVENT,
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
    :title="props.label || undefined"
    :to="resolvedTo || undefined"
    :prepend-icon="props.icon || undefined"
  />
</template>
