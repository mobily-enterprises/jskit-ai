import { computed, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  useWebPlacementContext,
  resolveSurfaceNavigationTargetFromPlacementContext
} from "@jskit-ai/shell-web/client/placement";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import { useView } from "@jskit-ai/users-web/client/composables/useView";
import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { WORKSPACE_INVITE_REDEEM_TRANSPORT } from "@jskit-ai/workspaces-core/shared/jsonApiTransports";
import { useWorkspaceSurfaceId } from "../composables/useWorkspaceSurfaceId.js";
import { createAccountSettingsInvitesRuntime } from "./accountSettingsInvitesRuntime.js";

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
    roleSid: String(entry.roleSid || "member").trim().toLowerCase() || "member",
    status: String(entry.status || "pending").trim().toLowerCase() || "pending",
    expiresAt: String(entry.expiresAt || "").trim()
  };
}

function useAccountSettingsInvitesSectionRuntime() {
  const route = useRoute();
  const router = useRouter();
  const { context: placementContext } = useWebPlacementContext();
  const errorRuntime = useShellWebErrorRuntime();
  const paths = usePaths();

  const pendingInvitesQueryKey = ["workspaces-web", "account-settings", "pending-invites"];
  const pendingInvitesModel = reactive({
    pendingInvites: [],
    workspaceInvitesEnabled: false
  });
  const inviteAction = ref({
    token: "",
    decision: ""
  });
  const redeemInviteModel = reactive({
    token: "",
    decision: ""
  });

  function reportAccountFeedback({
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
      source: "workspaces-web.account-settings-invites",
      message: normalizedMessage,
      severity,
      channel,
      dedupeKey: dedupeKey || `workspaces-web.account-settings-invites:${severity}:${normalizedMessage}`,
      dedupeWindowMs: 3000
    });
  }

  const pendingInvitesView = useView({
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    apiSuffix: "/bootstrap",
    queryKeyFactory: () => pendingInvitesQueryKey,
    realtime: {
      event: "workspace.invitations.pending.changed"
    },
    fallbackLoadError: "Unable to load invitations.",
    model: pendingInvitesModel,
    mapLoadedToModel: (model, payload = {}) => {
      model.workspaceInvitesEnabled = payload?.app?.features?.workspaceInvites === true;
      model.pendingInvites = model.workspaceInvitesEnabled
        ? (Array.isArray(payload?.pendingInvites) ? payload.pendingInvites : [])
          .map(normalizePendingInvite)
          .filter(Boolean)
        : [];
    }
  });

  const redeemInviteCommand = useCommand({
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    apiSuffix: "/workspace/invitations/redeem",
    writeMethod: "POST",
    transport: WORKSPACE_INVITE_REDEEM_TRANSPORT,
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

  const invitesAvailable = computed(() => pendingInvitesModel.workspaceInvitesEnabled === true);
  const loadingInvites = computed(() => Boolean(pendingInvitesView.isLoading));
  const refreshingInvites = computed(() => Boolean(pendingInvitesView.isRefetching));
  const pendingInvites = computed(() =>
    Array.isArray(pendingInvitesModel.pendingInvites) ? pendingInvitesModel.pendingInvites : []
  );
  const isResolvingInvite = computed(() => Boolean(redeemInviteCommand.isRunning.value));

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

  async function openWorkspace(workspaceSlug) {
    const targetPath = workspaceHomePath(workspaceSlug);
    if (!targetPath) {
      reportAccountFeedback({
        message: "Workspace surface is not configured.",
        severity: "error",
        channel: "banner",
        dedupeKey: "workspaces-web.account-settings-invites:workspace-surface-missing"
      });
      return;
    }

    try {
      const navigationTarget = resolveSurfaceNavigationTargetFromPlacementContext(placementContext.value, {
        path: targetPath,
        surfaceId: workspaceSurfaceId.value
      });
      if (navigationTarget.sameOrigin) {
        await router.push(navigationTarget.href);
      } else if (typeof window === "object" && window?.location && typeof window.location.assign === "function") {
        window.location.assign(navigationTarget.href);
      } else {
        throw new Error("Cross-origin navigation is unavailable in this environment.");
      }
    } catch (error) {
      reportAccountFeedback({
        message: String(error?.message || "Unable to open workspace."),
        severity: "error",
        channel: "banner",
        dedupeKey: `workspaces-web.account-settings-invites:open-workspace:${String(workspaceSlug || "").trim()}`
      });
    }
  }

  const invitesRuntime = createAccountSettingsInvitesRuntime({
    invitesAvailable,
    isResolvingInvite,
    inviteAction,
    redeemInviteModel,
    redeemInviteCommand,
    pendingInvites,
    pendingInvitesModel,
    pendingInvitesView,
    openWorkspace,
    reportAccountFeedback
  });

  return Object.freeze({
    isAvailable: invitesAvailable,
    items: pendingInvites,
    isLoading: loadingInvites,
    isRefetching: refreshingInvites,
    isResolving: isResolvingInvite,
    action: inviteAction,
    accept(invite) {
      return invitesRuntime.accept(invite);
    },
    refuse(invite) {
      return invitesRuntime.refuse(invite);
    }
  });
}

export { useAccountSettingsInvitesSectionRuntime };
