<template>
  <v-app class="app-root">
    <template v-if="showApplicationShell">
      <v-app-bar border density="comfortable" elevation="0" class="app-bar">
        <v-app-bar-nav-icon
          :disabled="isDesktopPermanentDrawer && !isMobile"
          :aria-label="isDesktopCollapsible ? 'Toggle navigation drawer' : 'Toggle navigation menu'"
          @click="toggleDrawer"
        />

        <v-toolbar-title class="app-destination-title">
          <span class="accent-pill" />
          {{ destinationTitle }}
        </v-toolbar-title>
        <v-spacer />

        <v-menu location="bottom end" offset="8">
          <template #activator="{ props }">
            <v-btn v-bind="props" variant="text" icon class="user-menu-button" aria-label="Open user menu">
              <v-avatar color="primary" size="32">
                <span class="text-caption font-weight-bold">{{ userInitials }}</span>
              </v-avatar>
            </v-btn>
          </template>

          <v-list density="comfortable" min-width="240">
            <v-list-item prepend-icon="$menuProfile" title="Profile" @click="goToSettingsTab('profile')" />
            <v-list-item prepend-icon="$menuSettings" title="Settings" @click="goToSettingsTab('preferences')" />
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
            @click="goTo(item.to)"
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

    <v-snackbar v-model="menuNoticeVisible" location="bottom right" timeout="2600" color="secondary">
      {{ menuNoticeMessage }}
    </v-snackbar>
  </v-app>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { Outlet, useNavigate, useRouterState } from "@tanstack/vue-router";
import { useDisplay } from "vuetify";
import { api } from "./services/api";
import { useAuthStore } from "./stores/authStore";

const DESKTOP_DRAWER_BEHAVIOR = (() => {
  const rawMode = String(import.meta.env.VITE_DESKTOP_DRAWER_BEHAVIOR || "collapsible").toLowerCase();
  return rawMode === "permanent" ? "permanent" : "collapsible";
})();

const APPLICATION_LAYOUT_EXCLUDE_PATHS = new Set(["/login", "/reset-password"]);

const navigationItems = [
  { title: "Choice 1", to: "/", icon: "$navChoice1" },
  { title: "Choice 2", to: "/choice-2", icon: "$navChoice2" }
];

const authStore = useAuthStore();
const navigate = useNavigate();
const display = useDisplay();
const currentPath = useRouterState({
  select: (state) => state.location.pathname
});

const menuNoticeVisible = ref(false);
const menuNoticeMessage = ref("");
const mobileDrawerOpen = ref(false);
const desktopDrawerOpen = ref(true);

const isMobile = computed(() => display.smAndDown.value);
const isDesktopPermanentDrawer = computed(() => DESKTOP_DRAWER_BEHAVIOR === "permanent");
const isDesktopCollapsible = computed(() => !isMobile.value && !isDesktopPermanentDrawer.value);
const showApplicationShell = computed(() => !APPLICATION_LAYOUT_EXCLUDE_PATHS.has(currentPath.value));
const destinationTitle = computed(() => {
  if (currentPath.value === "/choice-2") {
    return "Choice 2";
  }
  if (currentPath.value === "/settings") {
    return "Settings";
  }
  return "Calculator";
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
  const source = String(authStore.username || "A").trim();
  return source.slice(0, 2).toUpperCase();
});

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

async function goTo(path) {
  if (currentPath.value === path) {
    if (isMobile.value) {
      drawerModel.value = false;
    }
    return;
  }

  await navigate({ to: path });
  if (isMobile.value) {
    drawerModel.value = false;
  }
}

function handleMenuNotice(label) {
  menuNoticeMessage.value = `${label} is not implemented yet in this scaffold.`;
  menuNoticeVisible.value = true;
}

async function goToSettingsTab(tab) {
  await navigate({
    to: "/settings",
    search: {
      tab
    }
  });
}

async function signOut() {
  try {
    await api.logout();
  } finally {
    api.clearCsrfTokenCache();
    authStore.setSignedOut();
    await authStore.invalidateSession();
    await navigate({ to: "/login", replace: true });
  }
}
</script>

<style scoped>
.app-root {
  background-color: rgb(var(--v-theme-background));
}

.app-bar {
  background-color: rgb(var(--v-theme-surface));
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
  background-color: rgb(var(--v-theme-primary));
}

.app-main-shell {
  background: linear-gradient(180deg, rgba(15, 107, 84, 0.06), rgba(15, 107, 84, 0) 240px),
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
  background-color: rgba(0, 104, 74, 0.12);
}
</style>
