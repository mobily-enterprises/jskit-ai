<script setup>
import { useWorkspacesLanding } from "../composables/useWorkspacesLanding.js";
import { useJskitText } from "../i18n.js";

const { t } = useJskitText();

const {
  selectingWorkspaceSlug,
  inviteAction,
  createWorkspaceModel,
  workspaceItems,
  pendingInvites,
  workspaceInvitesEnabled,
  isBootstrapping,
  isRefreshingBootstrap,
  bootstrapLoadError,
  canCreateWorkspace,
  isCreatingWorkspace,
  openWorkspace,
  acceptInvite,
  refuseInvite,
  createWorkspace,
  refreshBootstrap
} = useWorkspacesLanding();

function workspaceInitials(workspace) {
  const source = String(workspace?.name || workspace?.slug || "W").trim();
  return source.slice(0, 2).toUpperCase();
}

function workspaceOpenLabel(workspace) {
  if (!workspace.isAccessible) {
    return t("jskit.workspaces.workspacesView.unavailable");
  }
  return t(selectingWorkspaceSlug.value === workspace.slug ? "jskit.workspaces.workspacesView.opening" : "jskit.workspaces.workspacesView.open");
}

function isRespondingToInvite(invite, decision) {
  return inviteAction.value.token === invite.token && inviteAction.value.decision === decision;
}
</script>

<template>
  <section class="workspaces-view py-6">
    <v-container class="mx-auto" max-width="860">
      <v-sheet rounded="lg" border class="workspaces-view__panel">
        <header class="workspaces-view__header">
          <h1 class="workspaces-view__title">{{ t("jskit.workspaces.workspacesView.title") }}</h1>
          <p class="text-body-2 text-medium-emphasis mb-0">{{ t("jskit.workspaces.workspacesView.subtitle") }}</p>
        </header>

        <div class="workspaces-view__body">
          <v-row>
            <v-col cols="12" :md="workspaceInvitesEnabled ? 6 : 12">
              <template v-if="isBootstrapping">
                <v-skeleton-loader type="text, list-item-avatar-two-line@3" />
              </template>
              <div v-else-if="bootstrapLoadError" class="workspaces-view__state">
                <h2 class="text-h6 mb-2">{{ t("jskit.workspaces.workspacesView.loadFailedTitle") }}</h2>
                <p class="text-body-2 text-medium-emphasis mb-4">{{ bootstrapLoadError }}</p>
                <v-btn
                  color="primary"
                  variant="tonal"
                  :disabled="isRefreshingBootstrap"
                  @click="refreshBootstrap"
                >
                  {{ t(isRefreshingBootstrap ? "jskit.workspaces.common.retrying" : "jskit.workspaces.common.retry") }}
                </v-btn>
              </div>
              <template v-else>
                <div class="text-subtitle-2 mb-2">{{ t("jskit.workspaces.common.workspaces") }}</div>
                <template v-if="workspaceItems.length === 0">
                  <p class="text-body-1 mb-2">{{ t("jskit.workspaces.workspacesView.noWorkspace") }}</p>
                  <template v-if="canCreateWorkspace">
                    <v-text-field
                      v-model="createWorkspaceModel.name"
                      density="comfortable"
                      :label="t('jskit.workspaces.workspacesView.nameLabel')"
                      variant="outlined"
                      hide-details
                      class="mb-2"
                    />
                    <v-text-field
                      v-model="createWorkspaceModel.slug"
                      density="comfortable"
                      :label="t('jskit.workspaces.workspacesView.slugLabel')"
                      variant="outlined"
                      hide-details
                      class="mb-3"
                    />
                    <v-btn
                      color="primary"
                      variant="tonal"
                      :disabled="isCreatingWorkspace"
                      @click="createWorkspace"
                    >
                      {{ t(isCreatingWorkspace ? "jskit.workspaces.workspacesView.creating" : "jskit.workspaces.workspacesView.create") }}
                    </v-btn>
                  </template>
                  <p v-else class="text-body-2 text-medium-emphasis mb-0">
                    {{ t("jskit.workspaces.workspacesView.askAdministrator") }}
                  </p>
                </template>

                <template v-else>
                  <v-list density="comfortable" class="pa-0">
                    <v-list-item
                      v-for="workspace in workspaceItems"
                      :key="workspace.id"
                      :title="workspace.name"
                      :subtitle="
                        workspace.isAccessible
                          ? t('jskit.workspaces.common.slugAndRole', { slug: workspace.slug, role: workspace.roleLabel || workspace.roleSid || 'member' })
                          : t('jskit.workspaces.workspacesView.unavailableOnSurface', { slug: workspace.slug })
                      "
                      class="px-0"
                    >
                      <template #prepend>
                        <v-avatar color="primary" variant="tonal" size="28">
                          <v-img v-if="workspace.avatarUrl" :src="workspace.avatarUrl" cover />
                          <span v-else class="text-caption">{{ workspaceInitials(workspace) }}</span>
                        </v-avatar>
                      </template>
                      <template #append>
                        <v-btn
                          color="primary"
                          size="small"
                          variant="tonal"
                          :disabled="!workspace.isAccessible || selectingWorkspaceSlug === workspace.slug"
                          @click="openWorkspace(workspace.slug)"
                        >
                          {{ workspaceOpenLabel(workspace) }}
                        </v-btn>
                      </template>
                    </v-list-item>
                  </v-list>
                </template>
              </template>
            </v-col>

            <v-col v-if="workspaceInvitesEnabled" cols="12" md="6">
              <template v-if="isBootstrapping">
                <v-skeleton-loader type="text, list-item-two-line@3" />
              </template>
              <template v-else>
                <div class="text-subtitle-2 mb-2">{{ t("jskit.workspaces.common.invitations") }}</div>
                <template v-if="pendingInvites.length === 0">
                  <p class="text-body-2 text-medium-emphasis mb-0">{{ t("jskit.workspaces.common.noPendingInvitations") }}</p>
                </template>

                <template v-else>
                  <v-list density="comfortable" class="pa-0">
                    <v-list-item
                      v-for="invite in pendingInvites"
                      :key="invite.id"
                      :title="invite.workspaceName"
                      :subtitle="t('jskit.workspaces.common.role', { role: invite.roleLabel || invite.roleSid })"
                      class="px-0"
                    >
                      <template #prepend>
                        <v-avatar color="warning" size="28">
                          <span class="text-caption font-weight-bold">{{ t("jskit.workspaces.common.pendingInviteMark") }}</span>
                        </v-avatar>
                      </template>
                      <template #append>
                        <div class="d-flex ga-2">
                          <v-btn
                            size="small"
                            variant="text"
                            color="error"
                            :disabled="isRespondingToInvite(invite, 'refuse')"
                            @click="refuseInvite(invite)"
                          >
                            {{ t(isRespondingToInvite(invite, "refuse") ? "jskit.workspaces.common.refusing" : "jskit.workspaces.common.refuse") }}
                          </v-btn>
                          <v-btn
                            size="small"
                            variant="tonal"
                            color="primary"
                            :disabled="isRespondingToInvite(invite, 'accept')"
                            @click="acceptInvite(invite)"
                          >
                            {{ t(isRespondingToInvite(invite, "accept") ? "jskit.workspaces.common.joining" : "jskit.workspaces.common.join") }}
                          </v-btn>
                        </div>
                      </template>
                    </v-list-item>
                  </v-list>
                </template>
              </template>
            </v-col>
          </v-row>
        </div>
      </v-sheet>
    </v-container>
  </section>
</template>

<style scoped>
.workspaces-view__panel {
  overflow: hidden;
}

.workspaces-view__header {
  padding: 1rem 1rem 0;
}

.workspaces-view__title {
  font-size: clamp(1.35rem, 2vw, 1.85rem);
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: 1.15;
  margin: 0 0 0.35rem;
}

.workspaces-view__body {
  padding: 1rem;
}

.workspaces-view__state {
  margin-inline: auto;
  max-width: 30rem;
  padding: 2rem 1rem;
  text-align: center;
}

.workspaces-view__body :deep(.v-btn) {
  min-height: 48px;
}

@media (max-width: 640px) {
  .workspaces-view {
    padding-block: 0.75rem !important;
  }
}
</style>
