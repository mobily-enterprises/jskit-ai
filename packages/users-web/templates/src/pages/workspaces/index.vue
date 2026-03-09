<script setup>
import { computed, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  useWebPlacementContext,
  resolveSurfaceIdFromPlacementPathname,
  resolveSurfaceSwitchTargetsFromPlacementContext,
  resolveSurfaceWorkspacePathFromPlacementContext,
  surfaceRequiresWorkspaceFromPlacementContext
} from "@jskit-ai/shell-web/client/placement";
import {
  USERS_WEB_QUERY_KEYS,
  normalizeWorkspaceList,
  useGlobalCommand,
  useGlobalView
} from "@jskit-ai/users-web/client";

const route = useRoute();
const router = useRouter();
const { context: placementContext } = useWebPlacementContext();

const message = ref("");
const messageType = ref("error");
const selectingWorkspaceSlug = ref("");
const bootstrapModel = reactive({
  sessionAuthenticated: false,
  workspaces: [],
  pendingInvites: []
});
const inviteAction = ref({
  token: "",
  decision: ""
});
const redeemInviteModel = reactive({
  token: "",
  decision: ""
});

const bootstrapView = useGlobalView({
  apiSuffix: "/bootstrap",
  queryKeyFactory: () => USERS_WEB_QUERY_KEYS.bootstrap(""),
  fallbackLoadError: "Unable to load workspaces.",
  model: bootstrapModel,
  mapLoadedToModel: (model, payload = {}) => {
    model.sessionAuthenticated = Boolean(payload?.session?.authenticated);
    model.workspaces = normalizeWorkspaceList(payload?.workspaces);
    model.pendingInvites = (Array.isArray(payload?.pendingInvites) ? payload.pendingInvites : [])
      .map(normalizePendingInvite)
      .filter(Boolean);
  }
});

const redeemInviteCommand = useGlobalCommand({
  apiSuffix: "/workspace/invitations/redeem",
  writeMethod: "POST",
  fallbackRunError: "Unable to respond to invitation.",
  model: redeemInviteModel,
  buildRawPayload: (model) => ({
    token: String(model.token || "").trim(),
    decision: String(model.decision || "").trim().toLowerCase()
  }),
  messages: {
    success: "",
    error: "Unable to respond to invitation."
  }
});

const workspaceItems = computed(() => {
  return Array.isArray(bootstrapModel.workspaces) ? bootstrapModel.workspaces : [];
});

const pendingInvites = computed(() => {
  return Array.isArray(bootstrapModel.pendingInvites) ? bootstrapModel.pendingInvites : [];
});

const isBootstrapping = computed(() => Boolean(bootstrapView.isLoading.value));

function resolveCurrentPathname() {
  const routePath = String(route?.path || "").trim();
  if (routePath) {
    return routePath;
  }

  if (typeof window === "object" && window?.location?.pathname) {
    return String(window.location.pathname);
  }

  return "/";
}

const currentSurfaceId = computed(() => {
  return resolveSurfaceIdFromPlacementPathname(placementContext.value, resolveCurrentPathname());
});

const workspaceSurfaceId = computed(() => {
  const surfaceId = String(currentSurfaceId.value || "").trim().toLowerCase();
  if (surfaceId && surfaceRequiresWorkspaceFromPlacementContext(placementContext.value, surfaceId)) {
    return surfaceId;
  }

  const targets = resolveSurfaceSwitchTargetsFromPlacementContext(placementContext.value, surfaceId);
  return String(targets.workspaceSurfaceId || "").trim().toLowerCase();
});

function normalizePendingInvite(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const id = Number(entry.id);
  const workspaceId = Number(entry.workspaceId);
  if (!Number.isInteger(id) || id < 1 || !Number.isInteger(workspaceId) || workspaceId < 1) {
    return null;
  }

  const workspaceSlug = String(entry.workspaceSlug || "").trim();
  if (!workspaceSlug) {
    return null;
  }

  const token = String(entry.token || "").trim();
  if (!token) {
    return null;
  }

  return {
    id,
    token,
    workspaceId,
    workspaceSlug,
    workspaceName: String(entry.workspaceName || workspaceSlug).trim() || workspaceSlug,
    workspaceAvatarUrl: String(entry.workspaceAvatarUrl || "").trim(),
    roleId: String(entry.roleId || "member").trim().toLowerCase() || "member",
    status: String(entry.status || "pending").trim().toLowerCase() || "pending",
    expiresAt: String(entry.expiresAt || "").trim()
  };
}

function workspaceInitials(workspace) {
  const source = String(workspace?.name || workspace?.slug || "W").trim();
  return source.slice(0, 2).toUpperCase();
}

function workspaceAvatarStyle(workspace) {
  const color = String(workspace?.color || "").trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    return {};
  }

  return {
    backgroundColor: color
  };
}

function workspaceHomePath(workspaceSlug) {
  const normalizedSlug = String(workspaceSlug || "").trim();
  if (!normalizedSlug || !workspaceSurfaceId.value) {
    return "";
  }

  return resolveSurfaceWorkspacePathFromPlacementContext(
    placementContext.value,
    workspaceSurfaceId.value,
    normalizedSlug
  );
}

async function openWorkspace(workspaceSlug) {
  const normalizedSlug = String(workspaceSlug || "").trim();
  if (!normalizedSlug) {
    return;
  }

  const targetPath = workspaceHomePath(normalizedSlug);
  if (!targetPath) {
    messageType.value = "error";
    message.value = "Workspace surface is not configured.";
    return;
  }

  selectingWorkspaceSlug.value = normalizedSlug;
  message.value = "";

  try {
    await router.push(targetPath);
  } catch (error) {
    messageType.value = "error";
    message.value = String(error?.message || "Unable to open workspace.");
  } finally {
    selectingWorkspaceSlug.value = "";
  }
}

async function respondToInvite(invite, decision) {
  const token = String(invite?.token || "").trim();
  const normalizedDecision = String(decision || "").trim().toLowerCase();
  if (!token || (normalizedDecision !== "accept" && normalizedDecision !== "refuse")) {
    return;
  }

  inviteAction.value = {
    token,
    decision: normalizedDecision
  };
  redeemInviteModel.token = token;
  redeemInviteModel.decision = normalizedDecision;
  message.value = "";

  try {
    const response = await redeemInviteCommand.run();

    bootstrapModel.pendingInvites = pendingInvites.value.filter((entry) => entry.token !== token);
    await bootstrapView.refresh();

    if (normalizedDecision === "accept") {
      const nextWorkspaceSlug = String(response?.workspace?.slug || invite?.workspaceSlug || "").trim();
      if (nextWorkspaceSlug) {
        await openWorkspace(nextWorkspaceSlug);
      }
      return;
    }

    messageType.value = "success";
    message.value = "Invitation refused.";
  } catch (error) {
    messageType.value = "error";
    message.value = String(
      error?.message || (normalizedDecision === "accept" ? "Unable to accept invite." : "Unable to refuse invite.")
    );
  } finally {
    inviteAction.value = {
      token: "",
      decision: ""
    };
    redeemInviteModel.token = "";
    redeemInviteModel.decision = "";
  }
}

function acceptInvite(invite) {
  return respondToInvite(invite, "accept");
}

function refuseInvite(invite) {
  return respondToInvite(invite, "refuse");
}

watch(
  () => bootstrapView.resource.data.value,
  async (payload) => {
    if (!payload) {
      return;
    }

    if (!bootstrapModel.sessionAuthenticated) {
      await router.replace("/auth/login");
      return;
    }

    if (workspaceItems.value.length === 1 && pendingInvites.value.length < 1) {
      await openWorkspace(workspaceItems.value[0].slug);
    }
  },
  {
    immediate: true
  }
);

watch(
  () => bootstrapView.loadError.value,
  (nextError) => {
    if (!nextError) {
      return;
    }
    messageType.value = "error";
    message.value = String(nextError || "Unable to load workspaces.");
  }
);
</script>

<template>
  <section class="workspaces-view py-6">
    <v-container class="mx-auto" max-width="860">
      <v-card rounded="lg" border elevation="1">
        <v-card-item>
          <v-card-title class="text-h6">You are logged in</v-card-title>
          <v-card-subtitle>Select a workspace or respond to invitations.</v-card-subtitle>
        </v-card-item>
        <v-divider />

        <v-card-text class="pt-4">
          <v-alert v-if="message" :type="messageType" variant="tonal" class="mb-4">
            {{ message }}
          </v-alert>

          <v-row>
            <v-col cols="12" md="6">
              <template v-if="isBootstrapping">
                <v-skeleton-loader type="text, list-item-avatar-two-line@3" />
              </template>
              <template v-else>
                <div class="text-subtitle-2 mb-2">Your workspaces</div>
                <template v-if="workspaceItems.length === 0">
                  <p class="text-body-1 mb-2">You do not have a workspace yet.</p>
                  <p class="text-body-2 text-medium-emphasis mb-0">
                    Ask an administrator for an invite, or create one after policy is enabled.
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
                          ? `/${workspace.slug} • role: ${workspace.roleId || 'member'}`
                          : `/${workspace.slug} • unavailable on this surface`
                      "
                      class="px-0"
                    >
                      <template #prepend>
                        <v-avatar :style="workspaceAvatarStyle(workspace)" size="28">
                          <v-img v-if="workspace.avatarUrl" :src="workspace.avatarUrl" cover />
                          <span v-else class="text-caption">{{ workspaceInitials(workspace) }}</span>
                        </v-avatar>
                      </template>
                      <template #append>
                        <v-btn
                          color="primary"
                          size="small"
                          variant="tonal"
                          :disabled="!workspace.isAccessible"
                          :loading="selectingWorkspaceSlug === workspace.slug"
                          @click="openWorkspace(workspace.slug)"
                        >
                          {{ workspace.isAccessible ? "Open" : "Unavailable" }}
                        </v-btn>
                      </template>
                    </v-list-item>
                  </v-list>
                </template>
              </template>
            </v-col>

            <v-col cols="12" md="6">
              <template v-if="isBootstrapping">
                <v-skeleton-loader type="text, list-item-two-line@3" />
              </template>
              <template v-else>
                <div class="text-subtitle-2 mb-2">Invitations</div>
                <template v-if="pendingInvites.length === 0">
                  <p class="text-body-2 text-medium-emphasis mb-0">No pending invitations.</p>
                </template>

                <template v-else>
                  <v-list density="comfortable" class="pa-0">
                    <v-list-item
                      v-for="invite in pendingInvites"
                      :key="invite.id"
                      :title="invite.workspaceName"
                      :subtitle="`Role: ${invite.roleId}`"
                      class="px-0"
                    >
                      <template #prepend>
                        <v-avatar color="warning" size="28">
                          <span class="text-caption font-weight-bold">?</span>
                        </v-avatar>
                      </template>
                      <template #append>
                        <div class="d-flex ga-2">
                          <v-btn
                            size="small"
                            variant="text"
                            color="error"
                            :loading="inviteAction.token === invite.token && inviteAction.decision === 'refuse'"
                            @click="refuseInvite(invite)"
                          >
                            Refuse
                          </v-btn>
                          <v-btn
                            size="small"
                            variant="tonal"
                            color="primary"
                            :loading="inviteAction.token === invite.token && inviteAction.decision === 'accept'"
                            @click="acceptInvite(invite)"
                          >
                            Join
                          </v-btn>
                        </div>
                      </template>
                    </v-list-item>
                  </v-list>
                </template>
              </template>
            </v-col>
          </v-row>
        </v-card-text>
      </v-card>
    </v-container>
  </section>
</template>
