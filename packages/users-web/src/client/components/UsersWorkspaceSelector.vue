<script setup>
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  useWebPlacementContext,
  resolveSurfaceIdFromPlacementPathname,
  resolveSurfaceNavigationTargetFromPlacementContext
} from "@jskit-ai/shell-web/client/placement";
import { TENANCY_MODE_NONE } from "@jskit-ai/users-core/shared/tenancyProfile";
import { mdiBriefcaseOutline } from "@mdi/js";
import { findWorkspaceBySlug, normalizeWorkspaceEntry, normalizeWorkspaceList } from "../lib/bootstrap.js";
import { usePaths } from "../composables/usePaths.js";
import {
  resolveSurfaceSwitchTargetsFromPlacementContext,
  surfaceRequiresWorkspaceFromPlacementContext
} from "../lib/workspaceSurfaceContext.js";
import {
  resolveWorkspaceSurfaceIdFromPlacementPathname,
  extractWorkspaceSlugFromSurfacePathname
} from "../lib/workspaceSurfacePaths.js";

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
const { context: placementContext } = useWebPlacementContext();
const paths = usePaths();

function resolveBrowserPath() {
  if (typeof window !== "object" || !window || !window.location) {
    return "/";
  }
  const pathname = String(window.location.pathname || "").trim();
  return pathname || "/";
}

const currentPath = computed(() => {
  const routePath = String(route?.path || "").trim();
  if (routePath) {
    return routePath;
  }
  return resolveBrowserPath();
});

const currentSurfaceId = computed(() => {
  return (
    resolveWorkspaceSurfaceIdFromPlacementPathname(placementContext.value, currentPath.value) ||
    resolveSurfaceIdFromPlacementPathname(placementContext.value, currentPath.value) ||
    props.surface
  );
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

  if (targetSurfaceId.value) {
    return targetSurfaceId.value;
  }

  const targets = resolveSurfaceSwitchTargetsFromPlacementContext(placementContext.value, normalizedCurrentSurfaceId);
  return String(targets.workspaceSurfaceId || "").trim().toLowerCase();
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

const authenticated = computed(() => Boolean(placementContext.value?.auth?.authenticated));
const workspaces = computed(() => normalizeWorkspaceList(placementContext.value?.workspaces));
const activeWorkspace = computed(() => {
  const workspaceFromRoute = findWorkspaceBySlug(workspaces.value, routeWorkspaceSlug.value);
  if (workspaceFromRoute) {
    return workspaceFromRoute;
  }

  return normalizeWorkspaceEntry(placementContext.value?.workspace);
});

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
  if (!targetPath) {
    errorMessage.value = "Workspace selector target surface is not configured.";
    return;
  }
  const navigationTarget = resolveSurfaceNavigationTargetFromPlacementContext(placementContext.value, {
    path: targetPath,
    surfaceId: workspaceSwitchSurfaceId.value
  });

  navigatingToWorkspace.value = normalizedSlug;
  errorMessage.value = "";

  try {
    if (currentPath.value !== targetPath || !navigationTarget.sameOrigin) {
      if (navigationTarget.sameOrigin && router && typeof router.push === "function") {
        await router.push(navigationTarget.href);
      } else if (typeof window === "object" && window && window.location) {
        window.location.assign(navigationTarget.href);
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

function workspaceAvatarStyle(workspace) {
  const color = String(workspace?.color || "").trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    return {};
  }

  return {
    backgroundColor: color
  };
}

</script>

<template>
  <v-menu v-if="isVisible" location="bottom start" offset="8">
    <template #activator="{ props: activatorProps }">
      <v-btn
        v-bind="activatorProps"
        variant="text"
        class="text-none"
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
          <v-avatar size="24" color="primary" variant="tonal" :style="workspaceAvatarStyle(workspace)">
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
