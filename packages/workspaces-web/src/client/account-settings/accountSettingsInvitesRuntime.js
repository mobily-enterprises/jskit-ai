import { useJskitText } from "../i18n.js";
import { resolveErrorStatusCode } from "../support/runtimeNormalization.js";

function createAccountSettingsInvitesRuntime({
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
} = {}) {
  const { t, errorMessage } = useJskitText();

  async function respondToInvite(invite, decision) {
    if (!invitesAvailable.value) {
      return;
    }

    const token = String(invite?.token || "").trim();
    const normalizedDecision = String(decision || "").trim().toLowerCase();
    if (!token || (normalizedDecision !== "accept" && normalizedDecision !== "refuse")) {
      return;
    }
    if (isResolvingInvite.value) {
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
      pendingInvitesModel.pendingInvites = pendingInvites.value.filter((entry) => entry.token !== token);
      await pendingInvitesView.refresh();

      if (normalizedDecision === "accept") {
        const nextWorkspaceSlug = String(invite?.workspaceSlug || "").trim();
        if (nextWorkspaceSlug) {
          await openWorkspace(nextWorkspaceSlug);
          return;
        }
      }

      reportAccountFeedback({
        message: t(normalizedDecision === "accept" ? "jskit.workspaces.accountInvites.accepted" : "jskit.workspaces.common.invitationRefused"),
        severity: "success",
        channel: "snackbar",
        dedupeKey: `workspaces-web.account-settings-runtime:invite-${normalizedDecision}:${token}`
      });
    } catch (error) {
      const statusCode = resolveErrorStatusCode(error);
      const fallbackMessage = t(normalizedDecision === "accept" ? "jskit.workspaces.common.acceptInvitationFailed" : "jskit.workspaces.accountInvites.refuseFailed");
      reportAccountFeedback({
        message: statusCode === 404 ? t("jskit.workspaces.accountInvites.noLongerExists") : errorMessage(error, fallbackMessage),
        severity: "error",
        channel: "banner",
        dedupeKey: `workspaces-web.account-settings-runtime:invite-${normalizedDecision}-error:${token}`
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

  return Object.freeze({
    accept(invite) {
      return respondToInvite(invite, "accept");
    },
    refuse(invite) {
      return respondToInvite(invite, "refuse");
    }
  });
}

export { createAccountSettingsInvitesRuntime };
