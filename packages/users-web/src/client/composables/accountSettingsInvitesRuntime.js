import { resolveErrorStatusCode } from "./accountSettingsRuntimeHelpers.js";

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
        message: normalizedDecision === "accept" ? "Invitation accepted." : "Invitation refused.",
        severity: "success",
        channel: "snackbar",
        dedupeKey: `users-web.account-settings-runtime:invite-${normalizedDecision}:${token}`
      });
    } catch (error) {
      const statusCode = resolveErrorStatusCode(error);
      const fallbackMessage = normalizedDecision === "accept"
        ? "Unable to accept invitation."
        : "Unable to refuse invitation.";
      reportAccountFeedback({
        message: statusCode === 404
          ? "Invitation no longer exists."
          : String(error?.message || fallbackMessage),
        severity: "error",
        channel: "banner",
        dedupeKey: `users-web.account-settings-runtime:invite-${normalizedDecision}-error:${token}`
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
