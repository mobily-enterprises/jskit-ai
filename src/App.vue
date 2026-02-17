<template>
  <v-app class="app-root" :style="workspaceThemeStyle">
    <template v-if="showApplicationShell">
      <v-app-bar border density="comfortable" elevation="0" class="app-bar">
        <v-app-bar-nav-icon
          :disabled="isDesktopPermanentDrawer && !isMobile"
          :aria-label="isDesktopCollapsible ? 'Toggle navigation drawer' : 'Toggle navigation menu'"
          @click="toggleDrawer"
        />

        <v-menu location="bottom start" offset="8">
          <template #activator="{ props }">
            <v-btn v-bind="props" variant="text" class="workspace-switcher-button">
              <v-avatar :style="workspaceAvatarStyle(workspaceStore.activeWorkspace)" size="28" class="mr-2">
                <v-img v-if="activeWorkspaceAvatarUrl" :src="activeWorkspaceAvatarUrl" cover />
                <span v-else class="text-caption font-weight-bold">{{ activeWorkspaceInitials }}</span>
              </v-avatar>
              <span class="workspace-switcher-label">{{ activeWorkspaceName }}</span>
              <v-chip v-if="pendingInvitesCount > 0" size="x-small" color="warning" label class="ml-2">
                {{ pendingInvitesCount }}?
              </v-chip>
            </v-btn>
          </template>

          <v-list density="comfortable" min-width="320">
            <v-list-subheader>Workspaces</v-list-subheader>
            <v-list-item
              v-for="workspace in workspaceItems"
              :key="workspace.id"
              :title="workspace.name"
              :subtitle="`/${workspace.slug}`"
              :active="workspace.slug === workspaceStore.activeWorkspaceSlug"
              @click="selectWorkspaceFromShell(workspace.slug)"
            >
              <template #prepend>
                <v-avatar :style="workspaceAvatarStyle(workspace)" size="26">
                  <v-img v-if="workspace.avatarUrl" :src="workspace.avatarUrl" cover />
                  <span v-else class="text-caption">{{ workspaceInitials(workspace) }}</span>
                </v-avatar>
              </template>
            </v-list-item>

            <template v-if="pendingInvitesCount > 0">
              <v-divider class="my-1" />
              <v-list-subheader>Invitations</v-list-subheader>
              <v-list-item
                v-for="invite in pendingInvites"
                :key="invite.id"
                :title="invite.workspaceName"
                :subtitle="`Role: ${invite.roleId}`"
                @click="openInviteDialog(invite)"
              >
                <template #prepend>
                  <v-avatar color="warning" size="26">
                    <span class="text-caption font-weight-bold">?</span>
                  </v-avatar>
                </template>
                <template #append>
                  <v-chip size="x-small" color="warning" label>Pending</v-chip>
                </template>
              </v-list-item>
            </template>
          </v-list>
        </v-menu>

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
            <v-list-item title="Back to App" @click="goToAppSurface" />
            <v-list-item
              prepend-icon="$menuHelp"
              title="Help & feedback"
              @click="handleMenuNotice('Help & feedback')"
            />
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

    <v-dialog v-model="inviteDialogVisible" max-width="480">
      <v-card rounded="lg" border>
        <v-card-item>
          <v-card-title class="text-subtitle-1">Workspace invitation</v-card-title>
          <v-card-subtitle>
            {{ inviteDialogInvite?.workspaceName || "" }}
          </v-card-subtitle>
        </v-card-item>
        <v-divider />
        <v-card-text>
          <p class="text-body-2 mb-2">
            Role: <strong>{{ inviteDialogInvite?.roleId || "member" }}</strong>
          </p>
          <p class="text-caption text-medium-emphasis mb-0">
            Expires: {{ formatDateTime(inviteDialogInvite?.expiresAt) }}
          </p>
        </v-card-text>
        <v-divider />
        <v-card-actions class="justify-end pa-4">
          <v-btn variant="text" color="error" :loading="inviteDecisionBusy" @click="respondToInvite('refuse')">Refuse</v-btn>
          <v-btn color="primary" :loading="inviteDecisionBusy" @click="respondToInvite('accept')">Join</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="menuNoticeVisible" location="bottom right" timeout="2600" color="secondary">
      {{ menuNoticeMessage }}
    </v-snackbar>
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
const appSurfacePaths = createSurfacePaths("app");
const DEFAULT_WORKSPACE_COLOR = "#0F6B54";
const WORKSPACE_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

const menuNoticeVisible = ref(false);
const menuNoticeMessage = ref("");
const mobileDrawerOpen = ref(false);
const desktopDrawerOpen = ref(true);
const inviteDialogVisible = ref(false);
const inviteDialogInvite = ref(null);
const inviteDecisionBusy = ref(false);

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
const workspacePath = (suffix = "/") => workspaceStore.workspacePath(suffix);

const appSurfaceTargetPath = computed(() => {
  const activeWorkspaceSlug = String(workspaceStore.activeWorkspaceSlug || "").trim();
  if (activeWorkspaceSlug) {
    return appSurfacePaths.workspaceHomePath(activeWorkspaceSlug);
  }

  return appSurfacePaths.workspacesPath;
});

const navigationItems = computed(() => [
  { title: "Choice 1", to: workspacePath("/"), icon: "$navChoice1" },
  { title: "Choice 2", to: workspacePath("/choice-2"), icon: "$navChoice2" },
  { title: "Workspace", to: workspacePath("/settings"), icon: "$menuSettings" },
  { title: "Back to App", to: appSurfaceTargetPath.value, icon: "$menuProfile", forceReload: true }
]);

const destinationTitle = computed(() => {
  if (currentPath.value.endsWith("/choice-2")) {
    return "Choice 2";
  }
  if (currentPath.value.endsWith("/settings")) {
    return "Settings";
  }
  return "Calculator";
});

const workspaceItems = computed(() => (Array.isArray(workspaceStore.workspaces) ? workspaceStore.workspaces : []));
const pendingInvites = computed(() => (Array.isArray(workspaceStore.pendingInvites) ? workspaceStore.pendingInvites : []));
const pendingInvitesCount = computed(() => pendingInvites.value.length);

const activeWorkspaceName = computed(() => {
  if (workspaceStore.activeWorkspace?.name) {
    return String(workspaceStore.activeWorkspace.name);
  }

  return pendingInvitesCount.value > 0 ? "Workspace invites" : "Workspace";
});

const activeWorkspaceAvatarUrl = computed(() => {
  return workspaceStore.activeWorkspace?.avatarUrl ? String(workspaceStore.activeWorkspace.avatarUrl) : "";
});

const activeWorkspaceInitials = computed(() => {
  const source = String(workspaceStore.activeWorkspace?.name || workspaceStore.activeWorkspace?.slug || "W").trim();
  return source.slice(0, 2).toUpperCase();
});
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

watch(
  () => pendingInvitesCount.value,
  (nextCount, previousCount) => {
    if (!showApplicationShell.value) {
      return;
    }

    if (nextCount > 0 && nextCount > (previousCount || 0)) {
      menuNoticeMessage.value = `You have ${nextCount} pending workspace invite${nextCount === 1 ? "" : "s"}.`;
      menuNoticeVisible.value = true;
    }
  }
);

function workspaceInitials(workspace) {
  const source = String(workspace?.name || workspace?.slug || "W").trim();
  return source.slice(0, 2).toUpperCase();
}

function normalizeWorkspaceColor(value) {
  const normalized = String(value || "").trim();
  if (WORKSPACE_COLOR_PATTERN.test(normalized)) {
    return normalized.toUpperCase();
  }

  return DEFAULT_WORKSPACE_COLOR;
}

function workspaceAvatarStyle(workspace) {
  return {
    backgroundColor: normalizeWorkspaceColor(workspace?.color)
  };
}

function workspaceColorToRgb(color) {
  const normalized = normalizeWorkspaceColor(color).replace(/^#/, "");
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return [red, green, blue];
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  return date.toLocaleString();
}

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

function handleMenuNotice(label) {
  menuNoticeMessage.value = `${label} is not implemented yet in this scaffold.`;
  menuNoticeVisible.value = true;
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

async function goToSettingsTab(section) {
  await goToAccountTab(section);
}

async function goToAppSurface() {
  await hardNavigate(appSurfaceTargetPath.value);
}

async function selectWorkspaceFromShell(workspaceSlug) {
  const slug = String(workspaceSlug || "").trim();
  if (!slug) {
    return;
  }

  if (slug === workspaceStore.activeWorkspaceSlug) {
    return;
  }

  try {
    await workspaceStore.selectWorkspace(slug);
    await navigate({
      to: surfacePaths.value.workspaceHomePath(slug)
    });
  } catch (error) {
    menuNoticeMessage.value = String(error?.message || "Unable to switch workspace.");
    menuNoticeVisible.value = true;
  }
}

function openInviteDialog(invite) {
  inviteDialogInvite.value = invite;
  inviteDialogVisible.value = true;
}

async function respondToInvite(decision) {
  const invite = inviteDialogInvite.value;
  if (!invite?.id) {
    return;
  }

  inviteDecisionBusy.value = true;
  try {
    const result = await workspaceStore.respondToPendingInvite(invite.id, decision);

    if (result?.decision === "accepted" && result?.workspace?.slug) {
      await navigate({
        to: surfacePaths.value.workspaceHomePath(result.workspace.slug)
      });
      menuNoticeMessage.value = `Joined ${result.workspace.name || result.workspace.slug}.`;
      menuNoticeVisible.value = true;
    }

    if (result?.decision === "refused") {
      menuNoticeMessage.value = "Invitation refused.";
      menuNoticeVisible.value = true;
    }

    inviteDialogVisible.value = false;
    inviteDialogInvite.value = null;
  } catch (error) {
    menuNoticeMessage.value = String(error?.message || "Unable to process invitation.");
    menuNoticeVisible.value = true;
  } finally {
    inviteDecisionBusy.value = false;
  }
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

.workspace-switcher-button {
  text-transform: none;
  max-width: 320px;
  border: 1px solid var(--workspace-color-soft);
}

.workspace-switcher-label {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-destination-title {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  margin-left: 8px;
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
