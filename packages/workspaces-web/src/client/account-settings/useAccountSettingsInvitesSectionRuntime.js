import { computed, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  useWebPlacementContext,
  resolveSurfaceNavigationTargetFromPlacementContext
} from "@jskit-ai/shell-web/client/placement";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import { useView } from "@jskit-ai/http-web/client/composables/useView";
import { WORKSPACE_INVITE_REDEEM_TRANSPORT } from "@jskit-ai/workspaces-core/shared/jsonApiTransports";
import { assignPageLocation } from "../browser.js";
import { useWorkspaceSurfaceId } from "../composables/useWorkspaceSurfaceId.js";
import { useJskitText } from "../i18n.js";
import { readPendingInvites } from "../lib/pendingInvites.js";
import { createAccountSettingsInvitesRuntime } from "./accountSettingsInvitesRuntime.js";

/** The account page's invitations: what is pending, and answering it. */
function useAccountSettingsInvitesSectionRuntime() {
  const { t, errorMessage } = useJskitText();
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
  }) {
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
    fallbackLoadError: t("jskit.workspaces.accountInvites.loadFailed"),
    model: pendingInvitesModel,
    mapLoadedToModel: (model, payload) => {
      model.workspaceInvitesEnabled = payload?.app?.features?.workspaceInvites === true;
      model.pendingInvites = readPendingInvites(payload, model.workspaceInvitesEnabled);
    }
  });

  const redeemInviteCommand = useCommand({
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
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

  const invitesAvailable = computed(() => pendingInvitesModel.workspaceInvitesEnabled === true);
  const loadingInvites = computed(() => Boolean(pendingInvitesView.isLoading));
  const refreshingInvites = computed(() => Boolean(pendingInvitesView.isRefetching));
  const pendingInvites = computed(() =>
    Array.isArray(pendingInvitesModel.pendingInvites) ? pendingInvitesModel.pendingInvites : []
  );
  const isResolvingInvite = computed(() => Boolean(redeemInviteCommand.isRunning));

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
        message: t("jskit.workspaces.common.surfaceNotConfigured"),
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
      } else if (!assignPageLocation(navigationTarget.href)) {
        throw new Error(t("jskit.workspaces.accountInvites.crossOriginUnavailable"));
      }
    } catch (error) {
      reportAccountFeedback({
        message: errorMessage(error, t("jskit.workspaces.common.openWorkspaceFailed")),
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

  return {
    isAvailable: invitesAvailable,
    items: pendingInvites,
    isLoading: loadingInvites,
    isRefetching: refreshingInvites,
    isResolving: isResolvingInvite,
    action: inviteAction,
    accept: invitesRuntime.accept,
    refuse: invitesRuntime.refuse
  };
}

export { useAccountSettingsInvitesSectionRuntime };
