<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { createHttpClient } from "@jskit-ai/http-runtime/client";
import {
  useWebPlacementContext,
  TENANCY_MODE_NONE,
  surfaceRequiresWorkspaceFromPlacementContext,
  resolveSurfaceIdFromPlacementPathname,
  resolveSurfaceWorkspacePathFromPlacementContext,
  extractWorkspaceSlugFromSurfacePathname
} from "@jskit-ai/shell-web/client/placement";

const props = defineProps({
  surface: {
    type: String,
    default: "*"
  },
  allowOnNonWorkspaceSurface: {
    type: Boolean,
    default: false
  },
  targetSurfaceId: {
    type: String,
    default: ""
  }
});

const client = createHttpClient({
  credentials: "include",
  csrf: {
    sessionPath: "/api/session"
  }
});

const loading = ref(false);
const navigatingToWorkspace = ref("");
const errorMessage = ref("");
const authenticated = ref(false);
const activeWorkspace = ref(null);
const workspaces = ref([]);
const route = useRoute();
const router = useRouter();
const { context: placementContext, mergeContext: mergePlacementContext } = useWebPlacementContext();

function resolveBrowserPath() {
  if (typeof window !== "object" || !window || !window.location) {
    return "/";
  }
  const pathname = String(window.location.pathname || "").trim();
  return pathname || "/";
}

function resolveBrowserFullPath() {
  if (typeof window !== "object" || !window || !window.location) {
    return "/";
  }
  const pathname = String(window.location.pathname || "").trim() || "/";
  const search = String(window.location.search || "").trim();
  const hash = String(window.location.hash || "").trim();
  return `${pathname}${search}${hash}`;
}

const currentPath = computed(() => {
  const routePath = String(route?.path || "").trim();
  if (routePath) {
    return routePath;
  }
  return resolveBrowserPath();
});

const currentFullPath = computed(() => {
  const routeFullPath = String(route?.fullPath || "").trim();
  if (routeFullPath) {
    return routeFullPath;
  }
  return resolveBrowserFullPath();
});

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

function normalizeWorkspaces(list) {
  const source = Array.isArray(list) ? list : [];
  return source.map(normalizeWorkspace).filter(Boolean);
}

function normalizePermissions(list) {
  const source = Array.isArray(list) ? list : [];
  return source.map((entry) => String(entry || "").trim()).filter(Boolean);
}

function findWorkspaceBySlug(list, slug) {
  const normalizedSlug = String(slug || "").trim();
  if (!normalizedSlug) {
    return null;
  }

  for (const workspace of list) {
    if (workspace.slug === normalizedSlug) {
      return workspace;
    }
  }

  return null;
}

function applyShellWorkspaceContext({ currentWorkspace, availableWorkspaces, permissions }) {
  mergePlacementContext(
    {
      workspace: currentWorkspace,
      workspaces: availableWorkspaces,
      permissions
    },
    "users-web.workspace-selector"
  );
}

const currentSurfaceId = computed(() => {
  return resolveSurfaceIdFromPlacementPathname(placementContext.value, currentPath.value) || props.surface;
});

const targetSurfaceId = computed(() => String(props.targetSurfaceId || "").trim().toLowerCase());
const workspaceSwitchSurfaceId = computed(() => {
  const normalizedCurrentSurfaceId = String(currentSurfaceId.value || "").trim().toLowerCase();
  if (
    normalizedCurrentSurfaceId &&
    surfaceRequiresWorkspaceFromPlacementContext(placementContext.value, normalizedCurrentSurfaceId)
  ) {
    return normalizedCurrentSurfaceId;
  }
  return targetSurfaceId.value;
});

const routeWorkspaceSlug = computed(() => {
  return String(
      extractWorkspaceSlugFromSurfacePathname(
        placementContext.value,
        currentSurfaceId.value,
        currentPath.value
      ) || ""
  ).trim();
});

function resolveBootstrapApiPath() {
  const workspaceSlug = routeWorkspaceSlug.value;
  if (!workspaceSlug) {
    return "/api/bootstrap";
  }

  const query = new URLSearchParams({
    workspaceSlug
  });
  return `/api/bootstrap?${query.toString()}`;
}

async function refreshWorkspaceState() {
  loading.value = true;
  errorMessage.value = "";

  try {
    const payload = await client.request(resolveBootstrapApiPath(), {
      method: "GET"
    });

    authenticated.value = Boolean(payload?.session?.authenticated);
    const availableWorkspaces = normalizeWorkspaces(payload?.workspaces);
    const currentWorkspace = findWorkspaceBySlug(availableWorkspaces, routeWorkspaceSlug.value);
    const permissions = normalizePermissions(payload?.permissions);

    workspaces.value = availableWorkspaces;
    activeWorkspace.value = currentWorkspace;

    applyShellWorkspaceContext({
      currentWorkspace,
      availableWorkspaces,
      permissions
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

async function navigateToWorkspace(slug) {
  const normalizedSlug = String(slug || "").trim();
  if (!normalizedSlug) {
    return;
  }
  if (navigatingToWorkspace.value) {
    return;
  }
  if (!workspaceSwitchSurfaceId.value) {
    errorMessage.value = "Workspace selector target surface is not configured.";
    return;
  }
  if (!workspaceSwitchSurfaceRequiresWorkspace.value) {
    errorMessage.value = "Workspace selector target surface must require a workspace.";
    return;
  }

  const targetPath = resolveSurfaceWorkspacePathFromPlacementContext(
    placementContext.value,
    workspaceSwitchSurfaceId.value,
    normalizedSlug
  );

  navigatingToWorkspace.value = normalizedSlug;
  errorMessage.value = "";

  try {
    if (currentPath.value !== targetPath) {
      if (router && typeof router.push === "function") {
        await router.push(targetPath);
      } else if (typeof window === "object" && window && window.location) {
        window.location.assign(targetPath);
        return;
      } else {
        throw new Error("Router is unavailable.");
      }
    }

    const nextWorkspace = findWorkspaceBySlug(workspaces.value, normalizedSlug);
    activeWorkspace.value = nextWorkspace;
  } catch (error) {
    const message = String(error?.message || "Unable to switch workspace.").trim();
    errorMessage.value = message;
  } finally {
    navigatingToWorkspace.value = "";
  }
}

const tenancyMode = computed(() => String(placementContext.value?.surfaceConfig?.tenancyMode || "").trim().toLowerCase());
const tenancyAllowsWorkspaceRouting = computed(() => tenancyMode.value !== TENANCY_MODE_NONE);

const surfaceRequiresWorkspace = computed(() =>
  surfaceRequiresWorkspaceFromPlacementContext(placementContext.value, currentSurfaceId.value)
);
const workspaceSwitchSurfaceRequiresWorkspace = computed(() =>
  surfaceRequiresWorkspaceFromPlacementContext(placementContext.value, workspaceSwitchSurfaceId.value)
);
const selectorSurfaceAllowed = computed(() => {
  if (surfaceRequiresWorkspace.value) {
    return true;
  }
  return props.allowOnNonWorkspaceSurface === true;
});

const isVisible = computed(
  () =>
    Boolean(workspaceSwitchSurfaceId.value) &&
    workspaceSwitchSurfaceRequiresWorkspace.value &&
    selectorSurfaceAllowed.value &&
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

watch(
  () => currentFullPath.value,
  () => {
    void refreshWorkspaceState();
  }
);

onMounted(() => {
  void refreshWorkspaceState();
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
        :disabled="Boolean(navigatingToWorkspace)"
        @click="navigateToWorkspace(workspace.slug)"
      >
        <template #prepend>
          <v-avatar size="24" color="primary" variant="tonal">
            <span class="text-caption">{{ String(workspace.name || "W").slice(0, 1).toUpperCase() }}</span>
          </v-avatar>
        </template>
        <template #append>
          <v-progress-circular
            v-if="navigatingToWorkspace === workspace.slug"
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
