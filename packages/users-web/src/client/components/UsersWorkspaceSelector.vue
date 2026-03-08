<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { createHttpClient } from "@jskit-ai/http-runtime/client";
import {
  useWebPlacementContext,
  surfaceRequiresWorkspaceFromPlacementContext,
  extractWorkspaceSlugFromSurfacePathname
} from "@jskit-ai/shell-web/client/placement";

const props = defineProps({
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

const loading = ref(false);
const selecting = ref("");
const errorMessage = ref("");
const authenticated = ref(false);
const activeWorkspace = ref(null);
const workspaces = ref([]);
const syncingWorkspaceFromRoute = ref(false);
const { context: placementContext, mergeContext: mergePlacementContext } = useWebPlacementContext();
const route = useRoute();

function normalizeWorkspace(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const id = Number(entry.id);
  const slug = String(entry.slug || "").trim();
  if (!Number.isInteger(id) || id < 1 || !slug) {
    return null;
  }

  return Object.freeze({
    id,
    slug,
    name: String(entry.name || slug).trim() || slug,
    color: String(entry.color || "").trim(),
    avatarUrl: String(entry.avatarUrl || "").trim()
  });
}

function applyShellWorkspaceContext(payload = {}) {
  const permissionList = Array.isArray(payload.permissions)
    ? payload.permissions.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];

  mergePlacementContext(
    {
      workspace: payload.activeWorkspace || null,
      workspaces: payload.workspaces || [],
      permissions: permissionList
    },
    "users-web.workspace-selector"
  );
}

async function refreshWorkspaceState() {
  loading.value = true;
  errorMessage.value = "";

  try {
    const payload = await client.request("/api/bootstrap", {
      method: "GET"
    });

    authenticated.value = Boolean(payload?.session?.authenticated);
    activeWorkspace.value = normalizeWorkspace(payload?.activeWorkspace);
    workspaces.value = (Array.isArray(payload?.workspaces) ? payload.workspaces : [])
      .map(normalizeWorkspace)
      .filter(Boolean);

    applyShellWorkspaceContext({
      activeWorkspace: activeWorkspace.value,
      workspaces: workspaces.value,
      permissions: Array.isArray(payload?.permissions) ? payload.permissions : []
    });
  } catch (error) {
    const message = String(error?.message || "").trim();
    if (message) {
      errorMessage.value = message;
    }
  } finally {
    loading.value = false;
  }
}

async function selectWorkspace(slug) {
  const normalizedSlug = String(slug || "").trim();
  if (!normalizedSlug || selecting.value) {
    return;
  }

  selecting.value = normalizedSlug;
  errorMessage.value = "";

  try {
    await client.request("/api/workspaces/select", {
      method: "POST",
      body: {
        workspaceSlug: normalizedSlug
      }
    });

    await refreshWorkspaceState();
  } catch (error) {
    errorMessage.value = String(error?.message || "Unable to switch workspace.").trim();
  } finally {
    selecting.value = "";
  }
}

const tenancyMode = computed(() => String(placementContext.value?.surfaceConfig?.tenancyMode || "").trim().toLowerCase());
const tenancyAllowsWorkspaceRouting = computed(() => tenancyMode.value !== "none");

const surfaceRequiresWorkspace = computed(() =>
  surfaceRequiresWorkspaceFromPlacementContext(placementContext.value, props.surface)
);

const isVisible = computed(
  () =>
    surfaceRequiresWorkspace.value &&
    tenancyAllowsWorkspaceRouting.value &&
    authenticated.value &&
    workspaces.value.length > 0
);

const activeWorkspaceLabel = computed(() => {
  const active = activeWorkspace.value;
  if (active?.name) {
    return active.name;
  }
  return "Workspace";
});

async function syncWorkspaceFromRoutePath() {
  if (syncingWorkspaceFromRoute.value || selecting.value) {
    return;
  }
  if (!surfaceRequiresWorkspace.value || !tenancyAllowsWorkspaceRouting.value || !authenticated.value) {
    return;
  }

  const workspaceSlugFromPath = extractWorkspaceSlugFromSurfacePathname(placementContext.value, props.surface, route.path);
  const normalizedWorkspaceSlug = String(workspaceSlugFromPath || "").trim();
  if (!normalizedWorkspaceSlug) {
    return;
  }
  if (activeWorkspace.value?.slug === normalizedWorkspaceSlug) {
    return;
  }
  if (!workspaces.value.some((workspace) => workspace.slug === normalizedWorkspaceSlug)) {
    return;
  }

  syncingWorkspaceFromRoute.value = true;
  try {
    await selectWorkspace(normalizedWorkspaceSlug);
  } finally {
    syncingWorkspaceFromRoute.value = false;
  }
}

watch(
  () => route.fullPath,
  () => {
    void syncWorkspaceFromRoutePath();
  }
);

watch(
  () => [surfaceRequiresWorkspace.value, tenancyAllowsWorkspaceRouting.value, authenticated.value],
  () => {
    void syncWorkspaceFromRoutePath();
  }
);

onMounted(() => {
  void (async () => {
    await refreshWorkspaceState();
    await syncWorkspaceFromRoutePath();
  })();
});
</script>

<template>
  <v-menu v-if="isVisible" location="bottom start" offset="8">
    <template #activator="{ props: activatorProps }">
      <v-btn
        v-bind="activatorProps"
        variant="text"
        class="text-none"
        :loading="loading"
        prepend-icon="$workspace"
      >
        {{ activeWorkspaceLabel }}
      </v-btn>
    </template>

    <v-list density="comfortable" min-width="280">
      <v-list-subheader>Workspaces</v-list-subheader>
      <v-list-item
        v-for="workspace in workspaces"
        :key="workspace.id"
        :title="workspace.name"
        :subtitle="`/${workspace.slug}`"
        :active="workspace.slug === activeWorkspace?.slug"
        :disabled="Boolean(selecting)"
        @click="selectWorkspace(workspace.slug)"
      >
        <template #prepend>
          <v-avatar size="24" color="primary" variant="tonal">
            <span class="text-caption">{{ String(workspace.name || "W").slice(0, 1).toUpperCase() }}</span>
          </v-avatar>
        </template>
        <template #append>
          <v-progress-circular
            v-if="selecting === workspace.slug"
            indeterminate
            size="16"
            width="2"
          />
        </template>
      </v-list-item>
      <v-list-item v-if="errorMessage" :subtitle="errorMessage" />
    </v-list>
  </v-menu>
</template>
