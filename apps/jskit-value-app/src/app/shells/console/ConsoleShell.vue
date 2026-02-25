<template>
  <v-app class="bg-background">
    <GlobalNetworkActivityBar />

    <template v-if="showApplicationShell">
      <v-app-bar border density="comfortable" elevation="0" class="console-bar bg-surface">
        <v-app-bar-nav-icon
          :disabled="isDesktopPermanentDrawer && !isMobile"
          :aria-label="isDesktopCollapsible ? 'Toggle navigation drawer' : 'Toggle navigation menu'"
          @click="toggleDrawer"
        />

        <v-toolbar-title class="text-subtitle-1 font-weight-bold">{{ destinationTitle }}</v-toolbar-title>
        <v-spacer />

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
              <span class="user-menu-name d-inline-block text-truncate text-body-2 font-weight-medium">
                {{ userDisplayName }}
              </span>
            </v-btn>
          </template>

          <v-list density="comfortable" min-width="220">
            <v-list-item prepend-icon="$menuSettings" title="Account settings" @click="goToAccountSettings" />
            <v-list-item prepend-icon="$menuAlerts" title="Alerts" @click="goToAlerts" />
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
            :active="isNavigationItemActive(item.to)"
            rounded="lg"
            class="mb-1"
            @click="goToNavigationItem(item)"
          />

          <template v-if="aiNavigationItems.length">
            <v-divider v-if="navigationItems.length" class="my-2" />
            <v-list-subheader class="console-nav-section text-uppercase">AI</v-list-subheader>
            <v-list-item
              v-for="item in aiNavigationItems"
              :key="item.to"
              :title="item.title"
              :prepend-icon="item.icon"
              :active="isNavigationItemActive(item.to)"
              rounded="lg"
              class="ms-2"
              @click="goToNavigationItem(item)"
            />
          </template>

          <template v-if="errorNavigationItems.length">
            <v-divider v-if="navigationItems.length || aiNavigationItems.length" class="my-2" />
            <v-list-subheader class="console-nav-section text-uppercase">Errors</v-list-subheader>
            <v-list-item
              v-for="item in errorNavigationItems"
              :key="item.to"
              :title="item.title"
              :prepend-icon="item.icon"
              :active="isNavigationItemActive(item.to)"
              rounded="lg"
              class="ms-2"
              @click="goToNavigationItem(item)"
            />
          </template>

          <template v-if="billingConfigNavigationItems.length || billingReportsNavigationItems.length">
            <v-divider
              v-if="navigationItems.length || aiNavigationItems.length || errorNavigationItems.length"
              class="my-2"
            />
            <template v-if="billingConfigNavigationItems.length">
              <v-list-subheader class="console-nav-section text-uppercase">Billing config</v-list-subheader>
              <v-list-item
                v-for="item in billingConfigNavigationItems"
                :key="item.to"
                :title="item.title"
                :prepend-icon="item.icon"
                :active="isNavigationItemActive(item.to)"
                rounded="lg"
                class="ms-2"
                @click="goToNavigationItem(item)"
              />
            </template>

            <template v-if="billingReportsNavigationItems.length">
              <v-divider v-if="billingConfigNavigationItems.length" class="my-2" />
              <v-list-subheader class="console-nav-section text-uppercase">Billing reports</v-list-subheader>
              <v-list-item
                v-for="item in billingReportsNavigationItems"
                :key="item.to"
                :title="item.title"
                :prepend-icon="item.icon"
                :active="isNavigationItemActive(item.to)"
                rounded="lg"
                class="ms-2"
                @click="goToNavigationItem(item)"
              />
            </template>
          </template>
        </v-list>
      </v-navigation-drawer>

      <v-main class="console-main-shell">
        <v-container fluid class="mx-auto px-3 px-sm-5 py-4" style="max-width: 1280px">
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
import { useConsoleShell } from "./useConsoleShell";

export default {
  name: "ConsoleShell",
  components: {
    Outlet,
    GlobalNetworkActivityBar
  },
  setup() {
    const { layout, user, alerts, permissions, navigation, actions } = useConsoleShell();
    return {
      ...layout,
      ...user,
      ...alerts,
      ...permissions,
      ...navigation,
      ...actions
    };
  }
};
</script>

<style scoped>
.console-bar {
  border-bottom: 2px solid rgba(15, 107, 84, 0.25);
}

.console-main-shell {
  background:
    linear-gradient(180deg, rgba(15, 107, 84, 0.08), rgba(15, 107, 84, 0) 220px), rgb(var(--v-theme-background));
}

.user-menu-button {
  min-width: 42px;
}

.user-menu-name {
  max-width: 180px;
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

:deep(.v-navigation-drawer .v-list-item--active) {
  background-color: rgba(15, 107, 84, 0.15);
}

.console-nav-section {
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}
</style>
