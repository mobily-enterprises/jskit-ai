<template>
  <v-app class="app-root" :style="workspaceThemeStyle">
    <template v-if="showApplicationShell">
      <v-app-bar border density="comfortable" elevation="0" class="app-bar">
        <v-app-bar-nav-icon
          :disabled="isDesktopPermanentDrawer && !isMobile"
          :aria-label="isDesktopCollapsible ? 'Toggle navigation drawer' : 'Toggle navigation menu'"
          @click="toggleDrawer"
        />

        <v-toolbar-title class="app-destination-title">
          <span class="accent-pill" :style="{ backgroundColor: activeWorkspaceColor }" />
          {{ destinationTitle }}
        </v-toolbar-title>
        <v-spacer />

        <v-menu location="bottom end" offset="8">
          <template #activator="{ props }">
            <v-btn v-bind="props" variant="text" icon class="user-menu-button" aria-label="Open user menu">
              <v-avatar color="primary" size="32">
                <v-img v-if="userAvatarUrl" :src="userAvatarUrl" cover />
                <span v-else class="text-caption font-weight-bold">{{ userInitials }}</span>
              </v-avatar>
            </v-btn>
          </template>

          <v-list density="comfortable" min-width="240">
            <v-list-item prepend-icon="$menuProfile" title="Profile" @click="goToAccountTab('profile')" />
            <v-list-item prepend-icon="$menuSettings" title="Settings" @click="goToAccountTab('preferences')" />
            <v-list-item v-if="canOpenAdminSurface" title="Go to Admin" @click="goToAdminSurface" />
            <v-divider class="my-1" />
            <v-list-item prepend-icon="$menuLogout" title="Sign out" @click="signOut" />
          </v-list>
        </v-menu>
      </v-app-bar>

      <v-navigation-drawer
        v-model="drawerModel"
        :permanent="!isMobile && isDesktopPermanentDrawer"
        :temporary="isMobile"
        :scrim="isMobile"
        :width="272"
        class="app-drawer"
        border
      >
        <v-list nav density="comfortable" class="pt-2">
          <v-list-item
            v-for="item in navigationItems"
            :key="item.to"
            :title="item.title"
            :prepend-icon="item.icon"
            :active="isCurrentPath(item.to)"
            rounded="lg"
            @click="goToNavigationItem(item)"
          />
        </v-list>
      </v-navigation-drawer>

      <v-main class="app-main-shell">
        <v-container fluid class="app-content px-3 px-sm-5 py-4">
          <Outlet />
        </v-container>
      </v-main>
    </template>

    <template v-else>
      <Outlet />
    </template>
  </v-app>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { Outlet, useNavigate, useRouterState } from "@tanstack/vue-router";
import { useDisplay } from "vuetify";
import { createSurfacePaths, resolveSurfacePaths } from "../shared/routing/surfacePaths.js";
import { api } from "./services/api";
import { useAuthStore } from "./stores/authStore";
import { useWorkspaceStore } from "./stores/workspaceStore";

const DESKTOP_DRAWER_BEHAVIOR = (() => {
  const rawMode = String(import.meta.env.VITE_DESKTOP_DRAWER_BEHAVIOR || "collapsible").toLowerCase();
  return rawMode === "permanent" ? "permanent" : "collapsible";
})();

const authStore = useAuthStore();
const workspaceStore = useWorkspaceStore();
const navigate = useNavigate();
const display = useDisplay();
const currentPath = useRouterState({
  select: (state) => state.location.pathname
});
const surfacePaths = computed(() => resolveSurfacePaths(currentPath.value));
const adminSurfacePaths = createSurfacePaths("admin");
const DEFAULT_WORKSPACE_COLOR = "#0F6B54";
const WORKSPACE_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

const mobileDrawerOpen = ref(false);
const desktopDrawerOpen = ref(true);

const isMobile = computed(() => display.smAndDown.value);
const isDesktopPermanentDrawer = computed(() => DESKTOP_DRAWER_BEHAVIOR === "permanent");
const isDesktopCollapsible = computed(() => !isMobile.value && !isDesktopPermanentDrawer.value);
const showApplicationShell = computed(() => {
  const paths = surfacePaths.value;
  return !(
    currentPath.value === paths.loginPath ||
    currentPath.value === paths.resetPasswordPath ||
    currentPath.value === paths.workspacesPath ||
    currentPath.value === paths.accountSettingsPath
  );
});

function workspacePath(pathname = "/") {
  return surfacePaths.value.workspacePath(workspaceStore.activeWorkspaceSlug, pathname);
}

const memberWorkspaces = computed(() => (Array.isArray(workspaceStore.workspaces) ? workspaceStore.workspaces : []));
const activeWorkspaceHasMembership = computed(
  () => Boolean(workspaceStore.activeWorkspaceSlug) && Boolean(workspaceStore.membership?.roleId)
);
const canOpenAdminSurface = computed(() => activeWorkspaceHasMembership.value);
const activeWorkspaceColor = computed(() => normalizeWorkspaceColor(workspaceStore.activeWorkspace?.color));
const workspaceThemeStyle = computed(() => {
  const [red, green, blue] = workspaceColorToRgb(activeWorkspaceColor.value);
  return {
    "--v-theme-primary": `${red}, ${green}, ${blue}`,
    "--workspace-color": activeWorkspaceColor.value,
    "--workspace-color-soft": `rgba(${red}, ${green}, ${blue}, 0.12)`,
    "--workspace-color-strong": `rgba(${red}, ${green}, ${blue}, 0.24)`
  };
});
const adminSurfaceTargetPath = computed(() => {
  const activeWorkspaceSlug = String(workspaceStore.activeWorkspaceSlug || "").trim();

  if (activeWorkspaceSlug && activeWorkspaceHasMembership.value) {
    return adminSurfacePaths.workspacePath(activeWorkspaceSlug, "/settings");
  }

  if (memberWorkspaces.value.length > 0) {
    return adminSurfacePaths.workspacesPath;
  }

  return adminSurfacePaths.loginPath;
});

const navigationItems = computed(() => {
  const items = [
    { title: "Choice 1", to: workspacePath("/"), icon: "$navChoice1" },
    { title: "Choice 2", to: workspacePath("/choice-2"), icon: "$navChoice2" }
  ];

  if (canOpenAdminSurface.value) {
    items.push({
      title: "Go to Admin",
      to: adminSurfaceTargetPath.value,
      icon: "$menuSettings",
      forceReload: true
    });
  }

  return items;
});

const destinationTitle = computed(() => {
  if (currentPath.value.endsWith("/choice-2")) {
    return "Choice 2";
  }
  return "Customer";
});

const drawerModel = computed({
  get() {
    if (!showApplicationShell.value) {
      return false;
    }
    if (isMobile.value) {
      return mobileDrawerOpen.value;
    }
    if (isDesktopPermanentDrawer.value) {
      return true;
    }
    return desktopDrawerOpen.value;
  },
  set(nextValue) {
    if (!showApplicationShell.value) {
      mobileDrawerOpen.value = false;
      desktopDrawerOpen.value = false;
      return;
    }
    if (isMobile.value) {
      mobileDrawerOpen.value = Boolean(nextValue);
      return;
    }
    if (!isDesktopPermanentDrawer.value) {
      desktopDrawerOpen.value = Boolean(nextValue);
    }
  }
});

const userInitials = computed(() => {
  const source = String(workspaceStore.profileDisplayName || authStore.username || "A").trim();
  return source.slice(0, 2).toUpperCase();
});

const userAvatarUrl = computed(() => workspaceStore.profileAvatarUrl || "");

watch([showApplicationShell, isMobile, isDesktopPermanentDrawer], ([isShellVisible, mobile, permanentDesktop]) => {
  if (!isShellVisible || mobile) {
    mobileDrawerOpen.value = false;
  }
  if (permanentDesktop) {
    desktopDrawerOpen.value = true;
  }
  if (!isShellVisible) {
    desktopDrawerOpen.value = false;
  }
});

watch(
  [showApplicationShell, isMobile],
  ([isShellVisible, mobile], [wasShellVisible]) => {
    if (!isShellVisible || mobile) {
      mobileDrawerOpen.value = false;
    }
    if (isShellVisible && !mobile && !wasShellVisible && !isDesktopPermanentDrawer.value) {
      desktopDrawerOpen.value = true;
    }
  },
  { immediate: true }
);

function toggleDrawer() {
  if (!showApplicationShell.value) {
    return;
  }

  if (isMobile.value) {
    drawerModel.value = !drawerModel.value;
    return;
  }

  if (isDesktopPermanentDrawer.value) {
    return;
  }

  desktopDrawerOpen.value = !desktopDrawerOpen.value;
}

function isCurrentPath(path) {
  return currentPath.value === path;
}

function normalizeWorkspaceColor(value) {
  const normalized = String(value || "").trim();
  if (WORKSPACE_COLOR_PATTERN.test(normalized)) {
    return normalized.toUpperCase();
  }

  return DEFAULT_WORKSPACE_COLOR;
}

function workspaceColorToRgb(color) {
  const normalized = normalizeWorkspaceColor(color).replace(/^#/, "");
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return [red, green, blue];
}

async function goTo(path) {
  const targetPath = String(path || "").trim();
  if (!targetPath) {
    return;
  }

  if (currentPath.value === targetPath) {
    if (isMobile.value) {
      drawerModel.value = false;
    }
    return;
  }

  await navigate({ to: targetPath });
  if (isMobile.value) {
    drawerModel.value = false;
  }
}

async function hardNavigate(path) {
  const targetPath = String(path || "").trim();
  if (!targetPath) {
    return;
  }

  if (typeof window !== "undefined") {
    window.location.assign(targetPath);
    return;
  }

  await navigate({ to: targetPath });
}

async function goToNavigationItem(item) {
  if (item?.forceReload) {
    await hardNavigate(item.to);
    return;
  }

  await goTo(item?.to);
}

async function goToAccountTab(tab) {
  const paths = surfacePaths.value;
  await navigate({
    to: paths.accountSettingsPath,
    search: {
      section: tab,
      returnTo: currentPath.value
    }
  });
}

async function goToAdminSurface() {
  if (!canOpenAdminSurface.value) {
    return;
  }

  await hardNavigate(adminSurfaceTargetPath.value);
}

async function signOut() {
  const paths = surfacePaths.value;
  try {
    await api.logout();
  } finally {
    api.clearCsrfTokenCache();
    authStore.setSignedOut();
    workspaceStore.clearWorkspaceState();
    await authStore.invalidateSession();
    await navigate({ to: paths.loginPath, replace: true });
  }
}
</script>

<style scoped>
.app-root {
  background-color: rgb(var(--v-theme-background));
}

.app-bar {
  background-color: rgb(var(--v-theme-surface));
  border-bottom: 2px solid var(--workspace-color);
}

.app-drawer {
  background-color: rgb(var(--v-theme-surface));
}

.app-destination-title {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.accent-pill {
  width: 18px;
  height: 6px;
  border-radius: 999px;
  background-color: var(--workspace-color);
}

.app-main-shell {
  background: linear-gradient(180deg, var(--workspace-color-soft), rgba(15, 107, 84, 0) 240px),
    rgb(var(--v-theme-background));
}

.app-content {
  max-width: 1440px;
  margin-inline: auto;
}

.user-menu-button {
  min-width: 0;
}

:deep(.v-navigation-drawer .v-list-item) {
  margin-bottom: 4px;
}

:deep(.v-navigation-drawer .v-list-item--active) {
  background-color: var(--workspace-color-strong);
}
</style>
