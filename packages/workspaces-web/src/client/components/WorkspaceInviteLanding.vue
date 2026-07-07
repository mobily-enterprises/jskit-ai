<template>
  <main class="workspace-invite-landing">
    <v-container class="workspace-invite-landing__container">
      <v-sheet class="workspace-invite-landing__panel" border rounded="lg">
        <div v-if="isLoading" class="workspace-invite-landing__state">
          <v-progress-circular color="primary" indeterminate />
        </div>

        <div v-else-if="loadError" class="workspace-invite-landing__state">
          <h1 class="workspace-invite-landing__title">Invitation unavailable</h1>
          <p class="text-body-2 text-medium-emphasis mb-5">{{ loadError }}</p>
          <v-btn color="primary" variant="tonal" :loading="isRefreshing" @click="refreshInvite">Retry</v-btn>
        </div>

        <div v-else-if="isTerminal" class="workspace-invite-landing__state">
          <h1 class="workspace-invite-landing__title">{{ terminalTitle }}</h1>
          <p class="text-body-2 text-medium-emphasis mb-0">{{ terminalMessage }}</p>
        </div>

        <div v-else class="workspace-invite-landing__content">
          <div class="workspace-invite-landing__header">
            <v-avatar v-if="workspaceAvatarUrl" size="48" :image="workspaceAvatarUrl" />
            <v-avatar v-else size="48" color="primary" variant="tonal">
              {{ workspaceInitial }}
            </v-avatar>
            <div>
              <h1 class="workspace-invite-landing__title">{{ workspaceName }}</h1>
              <p class="text-body-2 text-medium-emphasis mb-0">
                Invitation for {{ inviteEmailLabel }}
              </p>
            </div>
          </div>

          <v-alert v-if="emailMismatch" type="warning" variant="tonal" class="mb-5">
            Sign in with {{ inviteEmailLabel }} to accept this invitation.
          </v-alert>

          <div v-if="!isAuthenticated" class="workspace-invite-landing__actions">
            <v-btn color="primary" :href="registerUrl">Create account</v-btn>
            <v-btn variant="outlined" color="secondary" :href="loginUrl">Sign in</v-btn>
          </div>

          <div v-else class="workspace-invite-landing__actions">
            <v-btn
              color="primary"
              :disabled="emailMismatch || isRedeeming"
              :loading="isRedeeming"
              @click="acceptInvite"
            >
              Accept invitation
            </v-btn>
          </div>

          <p v-if="redeemError" class="text-body-2 text-error mb-0">{{ redeemError }}</p>
        </div>
      </v-sheet>
    </v-container>
  </main>
</template>

<script setup>
import { computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "@jskit-ai/auth-web/client";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import {
  WORKSPACE_INVITATION_RESOLVE_TRANSPORT,
  WORKSPACE_INVITE_REDEEM_TRANSPORT
} from "@jskit-ai/workspaces-core/shared/jsonApiTransports";
import { workspacesWebHttpClient } from "../lib/httpClient.js";

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

const token = computed(() => {
  const value = route.params?.token || route.query?.token || "";
  return String(Array.isArray(value) ? value[0] : value).trim();
});
const invitePath = computed(() => `/invite/${encodeURIComponent(token.value)}`);
const inviteQuery = computed(() => ({ token: token.value }));

const inviteResource = useEndpointResource({
  queryKey: computed(() => ["workspaces-web", "invite-landing", token.value]),
  path: "/api/workspace/invitations/resolve",
  enabled: computed(() => Boolean(token.value)),
  client: workspacesWebHttpClient,
  readQuery: inviteQuery,
  transport: WORKSPACE_INVITATION_RESOLVE_TRANSPORT,
  fallbackLoadError: "Unable to load invitation."
});

const redeemResource = useEndpointResource({
  queryKey: computed(() => ["workspaces-web", "invite-landing", "redeem", token.value]),
  path: "/api/workspace/invitations/redeem",
  enabled: false,
  client: workspacesWebHttpClient,
  writeMethod: "POST",
  transport: WORKSPACE_INVITE_REDEEM_TRANSPORT,
  fallbackSaveError: "Unable to accept invitation."
});

const invite = computed(() => inviteResource.data.value || {});
const workspace = computed(() => invite.value.workspace || {});
const status = computed(() => String(invite.value.status || "").trim().toLowerCase());
const isAuthenticated = computed(() => authStore.authenticated === true);
const authEmail = computed(() => String(authStore.authState?.email || "").trim().toLowerCase());
const inviteEmail = computed(() => String(invite.value.email || "").trim().toLowerCase());
const inviteEmailLabel = computed(() => invite.value.maskedEmail || inviteEmail.value || "the invited email");
const workspaceName = computed(() => String(workspace.value.name || "Workspace invitation").trim());
const workspaceAvatarUrl = computed(() => String(workspace.value.avatarUrl || "").trim());
const workspaceInitial = computed(() => workspaceName.value.slice(0, 1).toUpperCase() || "W");
const isLoading = computed(() => Boolean(inviteResource.isLoading.value));
const isRefreshing = computed(() => Boolean(inviteResource.isFetching.value));
const loadError = computed(() => inviteResource.loadError.value);
const isRedeeming = computed(() => Boolean(redeemResource.isSaving.value));
const redeemError = computed(() => redeemResource.saveError.value);
const isTerminal = computed(() => ["expired", "accepted", "revoked", "not_found"].includes(status.value));
const emailMismatch = computed(() =>
  Boolean(isAuthenticated.value && inviteEmail.value && authEmail.value && inviteEmail.value !== authEmail.value)
);
const terminalTitle = computed(() => {
  if (status.value === "expired") {
    return "Invitation expired";
  }
  if (status.value === "accepted") {
    return "Invitation already accepted";
  }
  if (status.value === "revoked") {
    return "Invitation revoked";
  }
  return "Invitation unavailable";
});
const terminalMessage = computed(() => {
  if (status.value === "expired") {
    return "Ask a workspace admin to send a new invitation.";
  }
  if (status.value === "accepted") {
    return "This invitation has already been used.";
  }
  if (status.value === "revoked") {
    return "This invitation is no longer active.";
  }
  return "The invitation link is invalid or no longer exists.";
});
const loginUrl = computed(() => buildAuthUrl("login"));
const registerUrl = computed(() => buildAuthUrl("register"));

function buildAuthUrl(mode) {
  const params = new URLSearchParams({
    mode,
    returnTo: invitePath.value,
    invitationToken: token.value
  });
  if (inviteEmail.value) {
    params.set("email", inviteEmail.value);
  }
  return `/auth/login?${params.toString()}`;
}

async function refreshInvite() {
  await inviteResource.reload();
}

async function acceptInvite() {
  if (!token.value || emailMismatch.value || isRedeeming.value) {
    return;
  }

  await redeemResource.save({
    token: token.value,
    decision: "accept"
  });
  await authStore.refresh();
  const workspaceSlug = String(workspace.value.slug || "").trim();
  if (workspaceSlug) {
    await router.replace(`/w/${encodeURIComponent(workspaceSlug)}`);
    return;
  }
  await refreshInvite();
}

onMounted(() => {
  void authStore.refresh();
});
</script>

<style scoped>
.workspace-invite-landing {
  min-height: 100vh;
  display: flex;
  align-items: center;
  background: rgb(var(--v-theme-surface));
}

.workspace-invite-landing__container {
  max-width: 560px;
}

.workspace-invite-landing__panel {
  padding: 28px;
  border-radius: 8px;
}

.workspace-invite-landing__state {
  min-height: 180px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
}

.workspace-invite-landing__content {
  display: grid;
  gap: 20px;
}

.workspace-invite-landing__header {
  display: flex;
  align-items: center;
  gap: 16px;
}

.workspace-invite-landing__title {
  font-size: 1.35rem;
  line-height: 1.25;
  font-weight: 650;
  margin: 0 0 4px;
}

.workspace-invite-landing__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

@media (max-width: 600px) {
  .workspace-invite-landing {
    align-items: stretch;
  }

  .workspace-invite-landing__container {
    padding: 0;
  }

  .workspace-invite-landing__panel {
    min-height: 100vh;
    border-radius: 0;
    border-inline: 0;
    padding: 24px;
  }

  .workspace-invite-landing__actions > * {
    flex: 1 1 100%;
  }
}
</style>
