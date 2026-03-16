<script setup>
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  useWebPlacementContext,
  TENANCY_MODE_NONE,
  surfaceRequiresWorkspaceFromPlacementContext,
  resolveSurfaceIdFromPlacementPathname,
  extractWorkspaceSlugFromSurfacePathname
} from "@jskit-ai/shell-web/client/placement";
import { mdiBriefcaseOutline } from "@mdi/js";
import { useBootstrapQuery } from "../composables/useBootstrapQuery.js";
import { normalizePermissionList } from "../lib/permissions.js";
import {
  findWorkspaceBySlug,
  normalizeWorkspaceList,
  resolvePlacementUserFromBootstrapPayload
} from "../lib/bootstrap.js";
import { usePaths } from "../composables/usePaths.js";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import {
  USERS_BOOTSTRAP_CHANGED_EVENT
} from "@jskit-ai/users-core/shared/events/usersEvents";

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

const navigatingToWorkspace = ref("");
const errorMessage = ref("");
const route = useRoute();
const router = useRouter();
const { context: placementContext, mergeContext: mergePlacementContext } = useWebPlacementContext();
const paths = usePaths();

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

function applyShellWorkspaceContext({ currentWorkspace, availableWorkspaces, permissions, user }) {
  const patch = {
    workspace: currentWorkspace,
    workspaces: availableWorkspaces,
    permissions
  };
  if (user !== undefined) {
    patch.user = user;
  }

  mergePlacementContext(
    patch,
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

const bootstrapQuery = useBootstrapQuery({
  workspaceSlug: routeWorkspaceSlug,
  enabled: true
});

const loading = computed(() => Boolean(bootstrapQuery.query.isPending.value || bootstrapQuery.query.isFetching.value));
const authenticated = computed(() => Boolean(bootstrapQuery.query.data.value?.session?.authenticated));
const workspaces = computed(() => normalizeWorkspaceList(bootstrapQuery.query.data.value?.workspaces));
const activeWorkspace = computed(() => findWorkspaceBySlug(workspaces.value, routeWorkspaceSlug.value));
const activeWorkspaceId = computed(() => Number(activeWorkspace.value?.id || 0));

function isCurrentWorkspaceEvent({ payload = {} } = {}) {
  const currentWorkspaceSlug = String(routeWorkspaceSlug.value || "").trim();
  if (!currentWorkspaceSlug) {
    // Global surfaces (for example "/") do not have a route workspace; selector must refresh on bootstrap changes.
    return true;
  }

  const payloadWorkspaceSlug = String(payload?.workspaceSlug || "").trim();
  if (payloadWorkspaceSlug) {
    return payloadWorkspaceSlug === currentWorkspaceSlug;
  }

  const scope = payload?.scope && typeof payload.scope === "object" ? payload.scope : {};
  const scopeKind = String(scope.kind || "").trim().toLowerCase();
  const scopeId = Number(scope.id || 0);
  if (scopeKind === "workspace" && scopeId > 0) {
    const currentWorkspaceId = Number(activeWorkspaceId.value || 0);
    if (currentWorkspaceId > 0) {
      return scopeId === currentWorkspaceId;
    }
    // Route workspace exists but workspace cache is not resolved yet; prefer refresh over stale UI.
    return true;
  }

  return true;
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

  const targetPath = paths.page("/", {
    surface: workspaceSwitchSurfaceId.value,
    workspaceSlug: normalizedSlug,
    mode: "workspace"
  });

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
  const active = activeWorkspace.value || null;
  if (active?.name) {
    return active.name;
  }
  return "Workspace";
});

watch(
  () => bootstrapQuery.query.data.value,
  (payload) => {
    const availableWorkspaces = normalizeWorkspaceList(payload?.workspaces);
    const currentWorkspace = findWorkspaceBySlug(availableWorkspaces, routeWorkspaceSlug.value);
    const user = resolvePlacementUserFromBootstrapPayload(payload, placementContext.value?.user);
    applyShellWorkspaceContext({
      currentWorkspace,
      availableWorkspaces,
      permissions: normalizePermissionList(payload?.permissions),
      user
    });
  },
  {
    immediate: true
  }
);

watch(
  () => bootstrapQuery.query.error.value,
  (nextError) => {
    if (!nextError) {
      return;
    }
    const message = String(nextError?.message || "").trim();
    if (message) {
      errorMessage.value = message;
    }
  }
);

watch(
  () => currentFullPath.value,
  () => {
    void bootstrapQuery.query.refetch();
  }
);

useRealtimeEvent({
  event: USERS_BOOTSTRAP_CHANGED_EVENT,
  enabled: authenticated,
  matches: isCurrentWorkspaceEvent,
  onEvent: async () => {
    await bootstrapQuery.query.refetch();
  }
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
        :prepend-icon="mdiBriefcaseOutline"
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
