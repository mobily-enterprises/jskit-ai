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

        <v-menu location="bottom start" offset="8">
          <template #activator="{ props }">
            <v-btn v-bind="props" variant="text" class="workspace-switcher-button text-none">
              <v-avatar :style="workspaceAvatarStyle(workspaceStore.activeWorkspace)" size="28" class="mr-2">
                <v-img v-if="activeWorkspaceAvatarUrl" :src="activeWorkspaceAvatarUrl" cover />
                <span v-else class="text-caption font-weight-bold">{{ activeWorkspaceInitials }}</span>
              </v-avatar>
              <span class="d-inline-block text-truncate" style="max-width: 180px">{{ activeWorkspaceName }}</span>
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

        <v-toolbar-title class="d-flex align-center ga-3 text-subtitle-1 font-weight-bold ms-2">
          <span class="accent-pill" :style="{ backgroundColor: activeWorkspaceColor }" />
          {{ destinationTitle }}
        </v-toolbar-title>
        <v-spacer />
        <v-chip size="small" :color="realtimeHealthColor" variant="tonal" class="mr-2">
          {{ realtimeHealthLabel }}
        </v-chip>

        <v-menu v-if="canOpenWorkspaceControlMenu" location="bottom end" offset="8">
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              icon="$menuSettings"
              variant="text"
              class="mr-1"
              aria-label="Open workspace controls"
            />
          </template>

          <v-list density="comfortable" min-width="220">
            <v-list-item
              prepend-icon="$menuSettings"
              title="Settings"
              :disabled="!canViewWorkspaceSettings"
              @click="goToWorkspaceSettings"
            />
            <v-list-item
              prepend-icon="$menuMonitoring"
              title="Monitoring"
              :disabled="!canViewMonitoring"
              @click="goToWorkspaceMonitoring"
            />
            <v-list-item
              prepend-icon="$menuBilling"
              title="Billing"
              :disabled="!canViewBilling"
              @click="goToWorkspaceBilling"
            />
            <v-list-item
              prepend-icon="$consoleMembers"
              title="Members"
              :disabled="!canViewMembersAdmin"
              @click="goToWorkspaceMembers"
            />
          </v-list>
        </v-menu>

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
            <v-btn
              v-bind="props"
              variant="text"
              class="px-2 text-none"
              style="min-width: 42px"
              aria-label="Open user menu"
            >
              <v-avatar color="primary" size="32" class="mr-2">
                <v-img v-if="userAvatarUrl" :src="userAvatarUrl" cover />
                <span v-else class="text-caption font-weight-bold">{{ userInitials }}</span>
              </v-avatar>
              <span
                class="user-menu-name d-inline-block text-truncate text-body-2 font-weight-medium"
                style="max-width: 160px; letter-spacing: 0.01em"
              >
                {{ userDisplayName }}
              </span>
            </v-btn>
          </template>

          <v-list density="comfortable" min-width="240">
            <v-list-item prepend-icon="$menuSettings" title="Account settings" @click="goToAccountSettings" />
            <v-list-item prepend-icon="$menuAlerts" title="Alerts" @click="goToAlerts" />
            <v-list-item prepend-icon="$menuBackToApp" title="Back to App" @click="goToAppSurface" />
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
          <v-btn variant="text" color="error" :loading="inviteDecisionBusy" @click="respondToInvite('refuse')">
            Refuse
          </v-btn>
          <v-btn color="primary" :loading="inviteDecisionBusy" @click="respondToInvite('accept')">Join</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="menuNoticeVisible" location="bottom right" timeout="2600" color="secondary">
      {{ menuNoticeMessage }}
    </v-snackbar>
  </v-app>
</template>

<script>
import { Outlet } from "@tanstack/vue-router";
import GlobalNetworkActivityBar from "../../components/GlobalNetworkActivityBar.vue";
import { useAdminShell } from "./useAdminShell";

export default {
  name: "AdminShell",
  components: {
    Outlet,
    GlobalNetworkActivityBar
  },
  setup() {
    const { formatters, layout, workspace, user, alerts, navigation, dialogs, feedback, actions } = useAdminShell();
    return {
      ...formatters,
      ...layout,
      ...workspace,
      ...user,
      ...alerts,
      ...navigation,
      ...dialogs,
      ...feedback,
      ...actions
    };
  }
};
</script>

<style scoped>
.app-bar {
  border-bottom: 2px solid var(--workspace-color);
}

.workspace-switcher-button {
  max-width: 320px;
  border: 1px solid var(--workspace-color-soft);
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

@media (max-width: 760px) {
  .user-menu-name {
    display: none;
  }
}

:deep(.v-navigation-drawer .v-list-item--active) {
  background-color: var(--workspace-color-strong);
}
</style>
