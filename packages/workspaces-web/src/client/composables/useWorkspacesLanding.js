import { computed, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  useWebPlacementContext,
  resolveSurfaceNavigationTargetFromPlacementContext
} from "@jskit-ai/shell-web/client/placement";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import {
  WORKSPACES_TRANSPORT,
  WORKSPACE_INVITE_REDEEM_TRANSPORT
} from "@jskit-ai/workspaces-core/shared/jsonApiTransports";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { useView } from "@jskit-ai/http-web/client/composables/useView";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import { useRealtimeQueryInvalidation } from "@jskit-ai/http-web/client/composables/useRealtimeQueryInvalidation";
import { assignPageLocation } from "../browser.js";
import { useJskitText } from "../i18n.js";
import { normalizeWorkspaceList } from "../lib/bootstrap.js";
import { readLastWorkspaceSlug, resolveWorkspaceLandingSlug } from "../lib/lastWorkspace.js";
import { readPendingInvites } from "../lib/pendingInvites.js";
import { useWorkspaceSurfaceId } from "./useWorkspaceSurfaceId.js";

const OWNERSHIP_PUBLIC = ROUTE_VISIBILITY_PUBLIC;

/**
 * The Your workspaces page: what the person can open, join or create, and the opening of the last-used or only
 * workspace as soon as that is known.
 */
function useWorkspacesLanding() {
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

  const bootstrapView = useView({
    ownershipFilter: OWNERSHIP_PUBLIC,
    apiSuffix: "/bootstrap",
    queryKeyFactory: () => bootstrapQueryKey,
    realtime: {
      event: "workspace.settings.changed"
    },
    fallbackLoadError: t("jskit.workspaces.workspacesView.loadFailed"),
    model: bootstrapModel,
    mapLoadedToModel: (model, payload) => {
      model.sessionAuthenticated = Boolean(payload?.session?.authenticated);
      model.userId = String(payload?.session?.userId || "");
      model.tenancyMode = String(payload?.tenancy?.mode || "").trim().toLowerCase() || "none";
      model.workspaceAllowSelfCreate = payload?.tenancy?.workspace?.allowSelfCreate === true;
      model.workspaceInvitesEnabled = payload?.app?.features?.workspaceInvites === true;
      model.workspaces = normalizeWorkspaceList(payload?.workspaces);
      model.pendingInvites = readPendingInvites(payload, model.workspaceInvitesEnabled);
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
  }) {
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
      if (navigationTarget.sameOrigin) {
        await router.push(navigationTarget.href);
      } else if (assignPageLocation(navigationTarget.href)) {
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
        if (loginTarget.sameOrigin) {
          await router.replace(loginTarget.href);
        } else {
          assignPageLocation(loginTarget.href);
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

  return {
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
  };
}

export { useWorkspacesLanding };
