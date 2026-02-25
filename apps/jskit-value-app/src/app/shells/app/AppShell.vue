<template>
  <v-app class="bg-background" :style="workspaceThemeStyle">
    <GlobalNetworkActivityBar />

    <template v-if="showApplicationShell">
      <v-app-bar border density="comfortable" elevation="0" class="app-bar bg-surface">
        <v-app-bar-nav-icon
          :disabled="isDesktopPermanentDrawer && !isMobile"
          :aria-label="isDesktopCollapsible ? 'Toggle navigation drawer' : 'Toggle navigation menu'"
          @click="toggleDrawer"
        />

        <v-toolbar-title class="d-flex align-center ga-3 text-subtitle-1 font-weight-bold">
          <span class="accent-pill" :style="{ backgroundColor: activeWorkspaceColor }" />
          {{ destinationTitle }}
        </v-toolbar-title>
        <v-spacer />
        <v-chip size="small" :color="realtimeHealthColor" variant="tonal" class="mr-2">
          {{ realtimeHealthLabel }}
        </v-chip>

        <v-menu location="bottom end" offset="8">
          <template #activator="{ props }">
            <v-badge :model-value="hasUnreadAlerts" :content="unreadAlertsBadge" color="error" location="top end">
              <v-btn
                v-bind="props"
                icon="$menuAlerts"
                variant="text"
                class="mr-1 alert-bell-button"
                :class="{ 'alert-bell-button--blinking': hasUnreadAlerts }"
                aria-label="Open alerts"
              />
            </v-badge>
          </template>

          <v-list density="comfortable" min-width="340">
            <v-list-subheader>Alerts</v-list-subheader>
            <v-list-item v-if="alertsPreviewLoading" title="Loading alerts..." />
            <v-list-item v-else-if="alertsPreviewError" :subtitle="alertsPreviewError">
              <template #title>
                <span>Unable to load alerts.</span>
              </template>
              <template #append>
                <v-btn size="small" variant="text" @click="refreshAlertsPreview">Retry</v-btn>
              </template>
            </v-list-item>
            <v-list-item v-else-if="!alertPreviewEntries.length" title="No alerts yet." />
            <v-list-item
              v-for="alert in alertPreviewEntries"
              :key="alert.id"
              :title="alert.title"
              :subtitle="alert.message || alert.type"
              @click="openAlertFromBell(alert)"
            >
              <template #append>
                <v-chip v-if="isAlertUnread(alert)" size="x-small" color="error" label>New</v-chip>
                <span v-else class="text-caption text-medium-emphasis">{{ formatAlertDateTime(alert.createdAt) }}</span>
              </template>
            </v-list-item>
            <v-divider class="my-1" />
            <v-list-item prepend-icon="$menuAlerts" title="View all alerts" @click="goToAlerts" />
          </v-list>
        </v-menu>

        <v-menu location="bottom end" offset="8">
          <template #activator="{ props }">
            <v-btn v-bind="props" variant="text" class="user-menu-button px-2 text-none" aria-label="Open user menu">
              <v-avatar color="primary" size="32" class="mr-2">
                <v-img v-if="userAvatarUrl" :src="userAvatarUrl" cover />
                <span v-else class="text-caption font-weight-bold">{{ userInitials }}</span>
              </v-avatar>
              <span class="user-menu-name d-inline-block text-truncate text-body-2 font-weight-medium">
                {{ userDisplayName }}
              </span>
            </v-btn>
          </template>

          <v-list density="comfortable" min-width="240">
            <v-list-item prepend-icon="$menuSettings" title="Account settings" @click="goToAccountSettings" />
            <v-list-item prepend-icon="$menuAlerts" title="Alerts" @click="goToAlerts" />
            <v-list-item
              v-if="canOpenAdminSurface"
              prepend-icon="$menuGoToAdmin"
              title="Go to Admin"
              @click="goToAdminSurface"
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
        class="bg-surface"
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
            class="mb-1"
            @click="goToNavigationItem(item)"
          />
        </v-list>
      </v-navigation-drawer>

      <v-main class="app-main-shell">
        <v-container
          fluid
          :class="['mx-auto', 'px-3', 'px-sm-5', isConversationDestination ? 'app-content--conversation' : 'py-4']"
          style="max-width: 1440px"
        >
          <Outlet />
        </v-container>
      </v-main>
    </template>

    <template v-else>
      <Outlet />
    </template>
  </v-app>
</template>

<script>
import { Outlet } from "@tanstack/vue-router";
import GlobalNetworkActivityBar from "../../components/GlobalNetworkActivityBar.vue";
import { useAppShell } from "./useAppShell";

export default {
  name: "AppShell",
  components: {
    Outlet,
    GlobalNetworkActivityBar
  },
  setup() {
    const { layout, user, alerts, navigation, actions } = useAppShell();
    return {
      ...layout,
      ...user,
      ...alerts,
      ...navigation,
      ...actions
    };
  }
};
</script>

<style scoped>
.app-bar {
  border-bottom: 2px solid var(--workspace-color);
}

.accent-pill {
  width: 18px;
  height: 6px;
  border-radius: 999px;
  background-color: var(--workspace-color);
}

.app-main-shell {
  background:
    linear-gradient(180deg, var(--workspace-color-soft), rgba(15, 107, 84, 0) 240px), rgb(var(--v-theme-background));
}

.app-content--conversation {
  display: flex;
  flex-direction: column;
  height: calc(100dvh - var(--v-layout-top, 56px));
  min-height: calc(100dvh - var(--v-layout-top, 56px));
  overflow: hidden;
  padding-top: 0.32rem;
  padding-bottom: 0;
}

.app-content--conversation :deep(.chat-view),
.app-content--conversation :deep(.assistant-view) {
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
}

.user-menu-button {
  min-width: 42px;
}

.user-menu-name {
  max-width: 160px;
  letter-spacing: 0.01em;
}

.alert-bell-button--blinking {
  animation: alert-bell-pulse 1s ease-in-out infinite;
  color: rgb(var(--v-theme-error));
}

@keyframes alert-bell-pulse {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.08);
  }
}

@media (max-width: 760px) {
  .user-menu-name {
    display: none;
  }
}

:deep(.v-navigation-drawer .v-list-item--active) {
  background-color: var(--workspace-color-strong);
}
</style>
