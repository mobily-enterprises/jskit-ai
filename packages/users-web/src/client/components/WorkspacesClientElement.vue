<script setup>
import { computed, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  useWebPlacementContext,
  resolveSurfaceNavigationTargetFromPlacementContext
} from "@jskit-ai/shell-web/client/placement";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import { normalizeWorkspaceList } from "../lib/bootstrap.js";
import { useCommand } from "../composables/useCommand.js";
import { useView } from "../composables/useView.js";
import { usePaths } from "../composables/usePaths.js";
import { useRealtimeQueryInvalidation } from "../composables/useRealtimeQueryInvalidation.js";
import { useWorkspaceSurfaceId } from "../composables/useWorkspaceSurfaceId.js";
import {
  WORKSPACE_SETTINGS_CHANGED_EVENT,
  WORKSPACES_CHANGED_EVENT,
  WORKSPACE_PENDING_INVITATIONS_CHANGED_EVENT
} from "@jskit-ai/users-core/shared/events/usersEvents";
import { USERS_ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/users-core/shared/support/usersVisibility";
import { normalizePendingInvite } from "../composables/accountSettingsRuntimeHelpers.js";

const route = useRoute();
const router = useRouter();
const { context: placementContext } = useWebPlacementContext();
const paths = usePaths();
const errorRuntime = useShellWebErrorRuntime();

const selectingWorkspaceSlug = ref("");
const bootstrapModel = reactive({
  sessionAuthenticated: false,
  tenancyMode: "none",
  workspaceAllowSelfCreate: false,
  workspaceInvitesEnabled: false,
  workspaces: [],
  pendingInvites: []
});
const inviteAction = ref({
  token: "",
  decision: ""
});
const createWorkspaceModel = reactive({
  name: "",
  slug: ""
});
const redeemInviteModel = reactive({
  token: "",
  decision: ""
});
const bootstrapQueryKey = Object.freeze(["users-web", "bootstrap", "__none__"]);
const OWNERSHIP_PUBLIC = USERS_ROUTE_VISIBILITY_PUBLIC;

const bootstrapView = useView({
  ownershipFilter: OWNERSHIP_PUBLIC,
  apiSuffix: "/bootstrap",
  queryKeyFactory: () => bootstrapQueryKey,
  realtime: {
    event: WORKSPACE_SETTINGS_CHANGED_EVENT
  },
  fallbackLoadError: "Unable to load workspaces.",
  model: bootstrapModel,
  mapLoadedToModel: (model, payload = {}) => {
    model.sessionAuthenticated = Boolean(payload?.session?.authenticated);
    model.tenancyMode = String(payload?.tenancy?.mode || "").trim().toLowerCase() || "none";
    model.workspaceAllowSelfCreate = payload?.tenancy?.workspace?.allowSelfCreate === true;
    model.workspaceInvitesEnabled = payload?.app?.features?.workspaceInvites === true;
    model.workspaces = normalizeWorkspaceList(payload?.workspaces);
    model.pendingInvites = model.workspaceInvitesEnabled
      ? (Array.isArray(payload?.pendingInvites) ? payload.pendingInvites : [])
        .map(normalizePendingInvite)
        .filter(Boolean)
      : [];
  }
});

const redeemInviteCommand = useCommand({
  ownershipFilter: OWNERSHIP_PUBLIC,
  apiSuffix: "/workspace/invitations/redeem",
  writeMethod: "POST",
  fallbackRunError: "Unable to respond to invitation.",
  suppressSuccessMessage: true,
  model: redeemInviteModel,
  buildRawPayload: (model) => ({
    token: String(model.token || "").trim(),
    decision: String(model.decision || "").trim().toLowerCase()
  }),
  messages: {
    error: "Unable to respond to invitation."
  }
});

const createWorkspaceCommand = useCommand({
  ownershipFilter: OWNERSHIP_PUBLIC,
  apiSuffix: "/workspaces",
  writeMethod: "POST",
  fallbackRunError: "Unable to create workspace.",
  suppressSuccessMessage: true,
  model: createWorkspaceModel,
  buildRawPayload: (model) => {
    const payload = {
      name: String(model.name || "").trim()
    };
    const slug = String(model.slug || "").trim().toLowerCase();
    if (slug) {
      payload.slug = slug;
    }
    return payload;
  },
  messages: {
    error: "Unable to create workspace."
  }
});

useRealtimeQueryInvalidation({
  event: WORKSPACES_CHANGED_EVENT,
  queryKey: bootstrapQueryKey
});

useRealtimeQueryInvalidation({
  event: WORKSPACE_PENDING_INVITATIONS_CHANGED_EVENT,
  queryKey: bootstrapQueryKey
});

const workspaceItems = computed(() => {
  return Array.isArray(bootstrapModel.workspaces) ? bootstrapModel.workspaces : [];
});

const pendingInvites = computed(() => {
  return Array.isArray(bootstrapModel.pendingInvites) ? bootstrapModel.pendingInvites : [];
});
const workspaceInvitesEnabled = computed(() => bootstrapModel.workspaceInvitesEnabled === true);

const isBootstrapping = computed(() => Boolean(bootstrapView.isLoading.value));
const isRefreshingBootstrap = computed(() => Boolean(bootstrapView.isRefetching.value));
const canCreateWorkspace = computed(() => bootstrapModel.workspaceAllowSelfCreate === true);
const isCreatingWorkspace = computed(() => Boolean(createWorkspaceCommand.isRunning.value));

function reportFeedback({
  message,
  severity = "error",
  channel = "banner",
  dedupeKey = ""
} = {}) {
  const normalizedMessage = String(message || "").trim();
  if (!normalizedMessage) {
    return;
  }

  errorRuntime.report({
    source: "users-web.workspaces-view",
    message: normalizedMessage,
    severity,
    channel,
    dedupeKey: dedupeKey || `users-web.workspaces-view:${severity}:${normalizedMessage}`,
    dedupeWindowMs: 3000
  });
}

const { workspaceSurfaceId } = useWorkspaceSurfaceId({
  route,
  placementContext
});

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

  return paths.page("/", {
    surface: workspaceSurfaceId.value,
    workspaceSlug: normalizedSlug,
    mode: "workspace"
  });
}

async function openWorkspace(workspaceSlug) {
  const normalizedSlug = String(workspaceSlug || "").trim();
  if (!normalizedSlug) {
    return;
  }

  const targetPath = workspaceHomePath(normalizedSlug);
  if (!targetPath) {
    reportFeedback({
      message: "Workspace surface is not configured.",
      severity: "error",
      channel: "banner",
      dedupeKey: "users-web.workspaces-view:workspace-surface-missing"
    });
    return;
  }

  selectingWorkspaceSlug.value = normalizedSlug;

  try {
    const navigationTarget = resolveSurfaceNavigationTargetFromPlacementContext(placementContext.value, {
      path: targetPath,
      surfaceId: workspaceSurfaceId.value
    });
    if (navigationTarget.sameOrigin && router && typeof router.push === "function") {
      await router.push(navigationTarget.href);
    } else if (typeof window === "object" && window?.location && typeof window.location.assign === "function") {
      window.location.assign(navigationTarget.href);
      return;
    } else {
      throw new Error("Workspace navigation is unavailable.");
    }
  } catch (error) {
    reportFeedback({
      message: String(error?.message || "Unable to open workspace."),
      severity: "error",
      channel: "banner",
      dedupeKey: `users-web.workspaces-view:open-workspace:${normalizedSlug}`
    });
  } finally {
    selectingWorkspaceSlug.value = "";
  }
}

async function respondToInvite(invite, decision) {
  if (!workspaceInvitesEnabled.value) {
    return;
  }

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

  try {
    await redeemInviteCommand.run();

    bootstrapModel.pendingInvites = pendingInvites.value.filter((entry) => entry.token !== token);
    await bootstrapView.refresh();

    if (normalizedDecision === "accept") {
      const nextWorkspaceSlug = String(invite?.workspaceSlug || "").trim();
      if (nextWorkspaceSlug) {
        await openWorkspace(nextWorkspaceSlug);
      }
      return;
    }

    reportFeedback({
      message: "Invitation refused.",
      severity: "success",
      channel: "snackbar",
      dedupeKey: `users-web.workspaces-view:invite-refused:${token}`
    });
  } catch (error) {
    reportFeedback({
      message: String(
        error?.message || (normalizedDecision === "accept" ? "Unable to accept invite." : "Unable to refuse invite.")
      ),
      severity: "error",
      channel: "banner",
      dedupeKey: `users-web.workspaces-view:invite-${normalizedDecision}:${token}`
    });
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

async function createWorkspace() {
  if (!canCreateWorkspace.value) {
    return;
  }

  const name = String(createWorkspaceModel.name || "").trim();
  if (!name) {
    reportFeedback({
      message: "Workspace name is required.",
      severity: "error",
      channel: "banner",
      dedupeKey: "users-web.workspaces-view:create-workspace-name-required"
    });
    return;
  }

  try {
    const createdWorkspace = await createWorkspaceCommand.run();
    await bootstrapView.refresh();
    const createdSlug = String(createdWorkspace?.slug || "").trim();
    const autoOpenHandledByWatcher = workspaceItems.value.length === 1 && pendingInvites.value.length < 1;
    if (createdSlug && !autoOpenHandledByWatcher) {
      await openWorkspace(createdSlug);
    }
    createWorkspaceModel.name = "";
    createWorkspaceModel.slug = "";
  } catch (error) {
    reportFeedback({
      message: String(error?.message || "Unable to create workspace."),
      severity: "error",
      channel: "banner",
      dedupeKey: "users-web.workspaces-view:create-workspace-error"
    });
  }
}

watch(
  () => bootstrapView.resource.data.value,
  async (payload) => {
    if (!payload) {
      return;
    }

    if (!bootstrapModel.sessionAuthenticated) {
      const loginTarget = resolveSurfaceNavigationTargetFromPlacementContext(placementContext.value, {
        path: "/auth/login",
        surfaceId: "auth"
      });
      if (loginTarget.sameOrigin && router && typeof router.replace === "function") {
        await router.replace(loginTarget.href);
      } else if (typeof window === "object" && window?.location && typeof window.location.assign === "function") {
        window.location.assign(loginTarget.href);
      }
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
          <v-progress-linear v-if="!isBootstrapping && isRefreshingBootstrap" indeterminate class="mb-4" />
          <v-row>
            <v-col cols="12" :md="workspaceInvitesEnabled ? 6 : 12">
              <template v-if="isBootstrapping">
                <v-skeleton-loader type="text, list-item-avatar-two-line@3" />
              </template>
              <template v-else>
                <div class="text-subtitle-2 mb-2">Your workspaces</div>
                <template v-if="workspaceItems.length === 0">
                  <p class="text-body-1 mb-2">You do not have a workspace yet.</p>
                  <template v-if="canCreateWorkspace">
                    <v-text-field
                      v-model="createWorkspaceModel.name"
                      density="comfortable"
                      label="Workspace name"
                      variant="outlined"
                      hide-details
                      class="mb-2"
                    />
                    <v-text-field
                      v-model="createWorkspaceModel.slug"
                      density="comfortable"
                      label="Slug (optional)"
                      variant="outlined"
                      hide-details
                      class="mb-3"
                    />
                    <v-btn
                      color="primary"
                      variant="tonal"
                      :loading="isCreatingWorkspace"
                      @click="createWorkspace"
                    >
                      Create Workspace
                    </v-btn>
                  </template>
                  <p v-else class="text-body-2 text-medium-emphasis mb-0">
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

            <v-col v-if="workspaceInvitesEnabled" cols="12" md="6">
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
