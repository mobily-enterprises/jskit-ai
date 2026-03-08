<script setup>
import {
  computed,
  onMounted,
  ref,
  watch
} from "vue";
import { useRoute } from "vue-router";
import { createHttpClient } from "@jskit-ai/http-runtime/client";
import {
  useWebPlacementContext,
  resolveSurfaceIdFromPlacementPathname,
  extractWorkspaceSlugFromSurfacePathname
} from "@jskit-ai/shell-web/client/placement";
import {
  hasPermission,
  normalizePermissionList
} from "../lib/permissions.js";
import { resolveWorkspaceAwareMenuTarget } from "../lib/workspaceMenuTarget.js";

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
    default: "mdi-cog-outline"
  },
  surface: {
    type: String,
    default: "*"
  }
});

const client = createHttpClient({
  credentials: "include",
  csrf: {
    sessionPath: "/api/session"
  }
});

const permissions = ref([]);
const loadingPermissions = ref(false);
const route = useRoute();
const { context: placementContext, mergeContext: mergePlacementContext } = useWebPlacementContext();

function readShellPermissions() {
  const context = placementContext.value;
  if (!context || typeof context !== "object") {
    return [];
  }

  return normalizePermissionList(context.permissions);
}

function writeShellPermissions(permissionList) {
  mergePlacementContext(
    {
      permissions: permissionList
    },
    "users-web.workspace-settings-menu"
  );
}

const canViewWorkspaceSettings = computed(() => {
  return (
    hasPermission(permissions.value, "workspace.settings.view") ||
    hasPermission(permissions.value, "workspace.settings.update")
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

async function loadPermissions() {
  if (loadingPermissions.value) {
    return;
  }
  const fromShell = readShellPermissions();
  if (fromShell.length > 0) {
    permissions.value = fromShell;
  }

  loadingPermissions.value = true;
  try {
    const currentSurfaceId = resolveSurfaceIdFromPlacementPathname(placementContext.value, route.path);
    const workspaceSlug = String(
      extractWorkspaceSlugFromSurfacePathname(placementContext.value, currentSurfaceId, route.path) || ""
    ).trim();
    const queryString = workspaceSlug ? `?workspaceSlug=${encodeURIComponent(workspaceSlug)}` : "";

    const payload = await client.request(`/api/bootstrap${queryString}`, {
      method: "GET"
    });
    const normalized = normalizePermissionList(payload?.permissions);
    permissions.value = normalized;
    writeShellPermissions(normalized);
  } catch {
    permissions.value = [];
  } finally {
    loadingPermissions.value = false;
  }
}

watch(
  () => placementContext.value?.permissions,
  (nextValue) => {
    const nextPermissions = normalizePermissionList(nextValue);
    if (nextPermissions.length > 0 || permissions.value.length < 1) {
      permissions.value = nextPermissions;
    }
  },
  {
    immediate: true
  }
);

onMounted(() => {
  void loadPermissions();
});

watch(
  () => route.fullPath,
  () => {
    void loadPermissions();
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
