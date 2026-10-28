<script setup>
import { computed, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  useWebPlacementContext,
  resolveSurfaceNavigationTargetFromPlacementContext
} from "@jskit-ai/shell-web/client/placement";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import { normalizeWorkspaceList } from "../lib/bootstrap.js";
import { readLastWorkspaceSlug, resolveWorkspaceLandingSlug } from "../lib/lastWorkspace.js";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import {
  WORKSPACES_TRANSPORT,
  WORKSPACE_INVITE_REDEEM_TRANSPORT
} from "@jskit-ai/workspaces-core/shared/jsonApiTransports";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { useView } from "@jskit-ai/http-web/client/composables/useView";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import { useRealtimeQueryInvalidation } from "@jskit-ai/http-web/client/composables/useRealtimeQueryInvalidation";
import { useWorkspaceSurfaceId } from "../composables/useWorkspaceSurfaceId.js";
import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { useJskitText } from "../i18n.js";

function normalizePendingInvite(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const id = normalizeRecordId(entry.id, { fallback: null });
  const workspaceId = normalizeRecordId(entry.workspaceId, { fallback: null });
  if (!id || !workspaceId) {
    return null;
  }

  const workspaceSlug = String(entry.workspaceSlug || "").trim();
  const token = String(entry.token || "").trim();
  if (!workspaceSlug || !token) {
    return null;
  }

  return {
    id,
    token,
    workspaceId,
    workspaceSlug,
    workspaceName: String(entry.workspaceName || workspaceSlug).trim() || workspaceSlug,
    workspaceAvatarUrl: String(entry.workspaceAvatarUrl || "").trim(),
    roleSid: String(entry.roleSid || "member").trim().toLowerCase() || "member",
    roleLabel: typeof entry.roleLabel === "string" ? entry.roleLabel.trim() : "",
    status: String(entry.status || "pending").trim().toLowerCase() || "pending",
    expiresAt: String(entry.expiresAt || "").trim()
  };
}

const { t, errorMessage } = useJskitText();
const route = useRoute();
const router = useRouter();
const { context: placementContext } = useWebPlacementContext();
const paths = usePaths();
const errorRuntime = useShellWebErrorRuntime();

const selectingWorkspaceSlug = ref("");
const bootstrapModel = reactive({
  sessionAuthenticated: false,
  userId: "",
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
const bootstrapQueryKey = Object.freeze(["workspaces-web", "bootstrap", "__none__"]);
const OWNERSHIP_PUBLIC = ROUTE_VISIBILITY_PUBLIC;

const bootstrapView = useView({
  ownershipFilter: OWNERSHIP_PUBLIC,
  apiSuffix: "/bootstrap",
  queryKeyFactory: () => bootstrapQueryKey,
  realtime: {
    event: "workspace.settings.changed"
  },
  fallbackLoadError: t("jskit.workspaces.workspacesView.loadFailed"),
  model: bootstrapModel,
  mapLoadedToModel: (model, payload = {}) => {
    model.sessionAuthenticated = Boolean(payload?.session?.authenticated);
    model.userId = String(payload?.session?.userId || "");
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
  transport: WORKSPACE_INVITE_REDEEM_TRANSPORT,
  fallbackRunError: t("jskit.workspaces.common.respondToInvitationFailed"),
  suppressSuccessMessage: true,
  model: redeemInviteModel,
  buildRawPayload: (model) => ({
    token: String(model.token || "").trim(),
    decision: String(model.decision || "").trim().toLowerCase()
  }),
  messages: {
    error: t("jskit.workspaces.common.respondToInvitationFailed")
  }
});

const createWorkspaceCommand = useCommand({
  ownershipFilter: OWNERSHIP_PUBLIC,
  apiSuffix: "/workspaces",
  writeMethod: "POST",
  transport: WORKSPACES_TRANSPORT,
  fallbackRunError: t("jskit.workspaces.workspacesView.createFailed"),
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
    error: t("jskit.workspaces.workspacesView.createFailed")
  }
});

useRealtimeQueryInvalidation({
  event: "workspaces.changed",
  queryKey: bootstrapQueryKey
});

useRealtimeQueryInvalidation({
  event: "workspace.invitations.pending.changed",
  queryKey: bootstrapQueryKey
});

const workspaceItems = computed(() => {
  return Array.isArray(bootstrapModel.workspaces) ? bootstrapModel.workspaces : [];
});

const pendingInvites = computed(() => {
  return Array.isArray(bootstrapModel.pendingInvites) ? bootstrapModel.pendingInvites : [];
});
const workspaceInvitesEnabled = computed(() => bootstrapModel.workspaceInvitesEnabled === true);

const isBootstrapping = computed(() => Boolean(bootstrapView.isLoading));
const isRefreshingBootstrap = computed(() => Boolean(bootstrapView.isRefetching));
const bootstrapLoadError = computed(() => String(bootstrapView.loadError || "").trim());
const canCreateWorkspace = computed(() => bootstrapModel.workspaceAllowSelfCreate === true);
const isCreatingWorkspace = computed(() => Boolean(createWorkspaceCommand.isRunning));

function reportFeedback({
  message,
  severity = "error",
  channel = "",
  dedupeKey = ""
} = {}) {
  const normalizedMessage = String(message || "").trim();
  if (!normalizedMessage) {
    return;
  }

  errorRuntime.report({
    source: "workspaces-web.workspaces-view",
    message: normalizedMessage,
    intent: "action-feedback",
    severity,
    channel,
    dedupeKey: dedupeKey || `workspaces-web.workspaces-view:${severity}:${normalizedMessage}`,
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

function workspaceHomePath(workspaceSlug) {
  const normalizedSlug = String(workspaceSlug || "").trim();
  if (!normalizedSlug || !workspaceSurfaceId.value) {
    return "";
  }

  return paths.page("/", {
    surface: workspaceSurfaceId.value,
    params: {
      workspaceSlug: normalizedSlug
    }
  });
}

function resolveLandingSlug() {
  return resolveWorkspaceLandingSlug({
    workspaces: workspaceItems.value,
    pendingInvites: pendingInvites.value,
    lastWorkspaceSlug: readLastWorkspaceSlug(bootstrapModel.userId)
  });
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

async function openWorkspace(workspaceSlug) {
  const normalizedSlug = String(workspaceSlug || "").trim();
  if (!normalizedSlug) {
    return;
  }

  const targetPath = workspaceHomePath(normalizedSlug);
  if (!targetPath) {
    reportFeedback({
      message: t("jskit.workspaces.common.surfaceNotConfigured"),
      severity: "error",
      dedupeKey: "workspaces-web.workspaces-view:workspace-surface-missing"
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
      throw new Error(t("jskit.workspaces.workspacesView.navigationUnavailable"));
    }
  } catch (error) {
    reportFeedback({
      message: errorMessage(error, t("jskit.workspaces.common.openWorkspaceFailed")),
      severity: "error",
      dedupeKey: `workspaces-web.workspaces-view:open-workspace:${normalizedSlug}`
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
      message: t("jskit.workspaces.common.invitationRefused"),
      severity: "success",
      dedupeKey: `workspaces-web.workspaces-view:invite-refused:${token}`
    });
  } catch (error) {
    reportFeedback({
      message: errorMessage(error, t(normalizedDecision === "accept" ? "jskit.workspaces.workspacesView.acceptFailed" : "jskit.workspaces.workspacesView.refuseFailed")),
      severity: "error",
      dedupeKey: `workspaces-web.workspaces-view:invite-${normalizedDecision}:${token}`
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
      message: t("jskit.workspaces.workspacesView.nameRequired"),
      severity: "error",
      dedupeKey: "workspaces-web.workspaces-view:create-workspace-name-required"
    });
    return;
  }

  try {
    const createdWorkspace = await createWorkspaceCommand.run();
    await bootstrapView.refresh();
    const createdSlug = String(createdWorkspace?.slug || "").trim();
    const autoOpenHandledByWatcher = Boolean(resolveLandingSlug());
    if (createdSlug && !autoOpenHandledByWatcher) {
      await openWorkspace(createdSlug);
    }
    createWorkspaceModel.name = "";
    createWorkspaceModel.slug = "";
  } catch (error) {
    reportFeedback({
      message: errorMessage(error, t("jskit.workspaces.workspacesView.createFailed")),
      severity: "error",
      dedupeKey: "workspaces-web.workspaces-view:create-workspace-error"
    });
  }
}

async function refreshBootstrap() {
  return bootstrapView.refresh();
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

    const landingSlug = resolveLandingSlug();
    if (landingSlug) {
      await openWorkspace(landingSlug);
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
