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

<script>
import { Outlet } from "@tanstack/vue-router";
import { useAdminShell } from "./useAdminShell";

export default {
  name: "AdminShell",
  components: {
    Outlet
  },
  setup() {
    const { meta, state, actions } = useAdminShell();
    return {
      ...meta,
      ...state,
      ...actions
    };
  }
};
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
