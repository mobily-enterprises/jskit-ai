import { useJskitText } from "../i18n.js";
import { resolveErrorStatusCode } from "../support/runtimeNormalization.js";

/**
 * Answers invitations from the account page.
 * @param {object} options
 * @param {import("vue").Ref<boolean>} options.invitesAvailable
 * @param {import("vue").Ref<boolean>} options.isResolvingInvite
 * @param {import("vue").Ref<import("../types.js").InviteAction>} options.inviteAction
 * @param {import("../types.js").InviteAction} options.redeemInviteModel
 * @param {{ run: () => Promise<unknown> }} options.redeemInviteCommand
 * @param {import("vue").Ref<import("../types.js").PendingInvite[]>} options.pendingInvites
 * @param {{ pendingInvites: import("../types.js").PendingInvite[] }} options.pendingInvitesModel
 * @param {{ refresh: () => Promise<unknown> }} options.pendingInvitesView
 * @param {(workspaceSlug: string) => Promise<void>} options.openWorkspace
 * @param {(feedback: import("../types.js").WorkspaceFeedback) => void} options.reportAccountFeedback
 */
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
}) {
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

  function accept(invite) {
    return respondToInvite(invite, "accept");
  }

  function refuse(invite) {
    return respondToInvite(invite, "refuse");
  }

  return Object.freeze({
    accept,
    refuse
  });
}

export { createAccountSettingsInvitesRuntime };
