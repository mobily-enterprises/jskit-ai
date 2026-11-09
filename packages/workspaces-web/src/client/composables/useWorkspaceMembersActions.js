import { ref } from "vue";
import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { ROUTE_VISIBILITY_WORKSPACE } from "@jskit-ai/kernel/shared/support/visibility";
import {
  WORKSPACE_INVITES_TRANSPORT,
  WORKSPACE_INVITE_CREATE_TRANSPORT,
  WORKSPACE_MEMBER_ROLE_UPDATE_TRANSPORT,
  WORKSPACE_MEMBERS_TRANSPORT
} from "@jskit-ai/workspaces-core/shared/jsonApiTransports";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import { pageClipboard } from "../browser.js";
import { useJskitText } from "../i18n.js";

const OWNERSHIP_WORKSPACE = ROUTE_VISIBILITY_WORKSPACE;

/**
 * What the members page lets a person do: invite, revoke an invitation, change a member's role, remove a member, and
 * the feedback and progress of each.
 * @param {object} options
 * @param {import("../types.js").MembersAdminForms} options.forms
 * @param {import("vue").Ref<string>} options.workspaceMembersApiPath
 * @param {import("vue").Ref<string>} options.workspaceInvitesApiPath
 * @param {import("vue").Ref<boolean>} options.canInviteMembers
 * @param {import("vue").Ref<boolean>} options.canManageMembers
 * @param {import("vue").Ref<boolean>} options.canRevokeInvites
 * @param {{ reload: () => Promise<unknown> }} options.workspaceMembersList
 * @param {{ reload: () => Promise<unknown> }} options.workspaceInvitesList
 */
function useWorkspaceMembersActions({
  forms,
  workspaceMembersApiPath,
  workspaceInvitesApiPath,
  canInviteMembers,
  canManageMembers,
  canRevokeInvites,
  workspaceMembersList,
  workspaceInvitesList
}) {
  const { t } = useJskitText();
  const inviteFeedback = useUiFeedback();
  const membersFeedback = useUiFeedback();
  const teamFeedback = useUiFeedback();
  const revokeInviteId = ref("");
  const removeMemberUserId = ref("");
  const createdInviteUrl = ref("");
  const createdInviteDeliveryStatus = ref("");
  const isCopyingInviteLink = ref(false);

  function workspaceMembersPath(memberId) {
    const normalizedMemberId = encodeURIComponent(String(memberId || "").trim());
    return `${workspaceMembersApiPath.value}/${normalizedMemberId}`;
  }

  function workspaceInvitePath(inviteId) {
    const encodedInviteId = encodeURIComponent(String(inviteId || ""));
    return `${workspaceInvitesApiPath.value}/${encodedInviteId}`;
  }

  const inviteCreateCommand = useCommand({
    ownershipFilter: OWNERSHIP_WORKSPACE,
    apiSuffix: "/invites",
    runPermissions: ["workspace.members.invite"],
    writeMethod: "POST",
    transport: WORKSPACE_INVITE_CREATE_TRANSPORT,
    fallbackRunError: t("jskit.workspaces.members.createInviteFailed"),
    suppressSuccessMessage: true,
    buildRawPayload: () => ({
      email: forms.invite.email,
      roleSid: forms.invite.roleSid
    }),
    messages: {
      error: t("jskit.workspaces.members.createInviteFailed")
    }
  });

  const revokeInviteCommand = useCommand({
    ownershipFilter: OWNERSHIP_WORKSPACE,
    apiSuffix: "/invites",
    runPermissions: ["workspace.invites.revoke"],
    writeMethod: "DELETE",
    transport: WORKSPACE_INVITES_TRANSPORT,
    fallbackRunError: t("jskit.workspaces.members.revokeInviteFailed"),
    buildCommandOptions: (_parsed, { context }) => {
      return {
        method: "DELETE",
        path: workspaceInvitePath(context?.inviteId)
      };
    },
    messages: {
      success: t("jskit.workspaces.members.inviteRevoked"),
      error: t("jskit.workspaces.members.revokeInviteFailed")
    }
  });

  const memberRoleCommand = useCommand({
    ownershipFilter: OWNERSHIP_WORKSPACE,
    apiSuffix: "/members",
    runPermissions: ["workspace.members.manage"],
    writeMethod: "PATCH",
    transport: WORKSPACE_MEMBER_ROLE_UPDATE_TRANSPORT,
    fallbackRunError: t("jskit.workspaces.members.updateRoleFailed"),
    buildRawPayload: (_model, { context }) => ({
      roleSid: String(context?.roleSid || "").trim().toLowerCase()
    }),
    buildCommandOptions: (_parsed, { context }) => {
      return {
        method: "PATCH",
        path: `${workspaceMembersPath(context?.memberUserId)}/role`
      };
    },
    messages: {
      success: t("jskit.workspaces.members.roleUpdated"),
      error: t("jskit.workspaces.members.updateRoleFailed")
    }
  });

  const memberRemoveCommand = useCommand({
    ownershipFilter: OWNERSHIP_WORKSPACE,
    apiSuffix: "/members",
    runPermissions: ["workspace.members.manage"],
    writeMethod: "DELETE",
    transport: WORKSPACE_MEMBERS_TRANSPORT,
    fallbackRunError: t("jskit.workspaces.members.removeFailed"),
    buildCommandOptions: (_parsed, { context }) => {
      return {
        method: "DELETE",
        path: workspaceMembersPath(context?.memberUserId)
      };
    },
    messages: {
      success: t("jskit.workspaces.members.removed"),
      error: t("jskit.workspaces.members.removeFailed")
    }
  });

  function clearMessages() {
    inviteFeedback.clear();
    membersFeedback.clear();
    teamFeedback.clear();
  }

  function clearProgress() {
    revokeInviteId.value = "";
    removeMemberUserId.value = "";
    createdInviteUrl.value = "";
    createdInviteDeliveryStatus.value = "";
  }

  async function submitInvite() {
    if (inviteCreateCommand.isRunning || !canInviteMembers.value) {
      return;
    }

    inviteFeedback.clear();
    createdInviteUrl.value = "";
    createdInviteDeliveryStatus.value = "";

    try {
      const result = await inviteCreateCommand.run();
      const delivery = result?.inviteDelivery && typeof result.inviteDelivery === "object"
        ? result.inviteDelivery
        : {};
      createdInviteUrl.value = String(result?.inviteUrl || "").trim();
      createdInviteDeliveryStatus.value = String(delivery.status || "").trim().toLowerCase();
      forms.invite.email = "";
      await workspaceInvitesList.reload();
      if (createdInviteDeliveryStatus.value === "sent") {
        inviteFeedback.success(t("jskit.workspaces.members.inviteSent"));
      } else if (createdInviteDeliveryStatus.value === "failed") {
        inviteFeedback.success(t("jskit.workspaces.members.inviteCreatedDeliveryFailed"));
      } else {
        inviteFeedback.success(t("jskit.workspaces.members.inviteCreated"));
      }
    } catch (error) {
      inviteFeedback.error(error, t("jskit.workspaces.members.createInviteFailed"));
    }
  }

  async function copyCreatedInviteLink() {
    const inviteUrl = String(createdInviteUrl.value || "").trim();
    if (!inviteUrl || isCopyingInviteLink.value) {
      return;
    }

    isCopyingInviteLink.value = true;
    try {
      const clipboard = pageClipboard();
      if (!clipboard) {
        inviteFeedback.success(t("jskit.workspaces.members.linkReady"));
        return;
      }

      await clipboard.writeText(inviteUrl);
      inviteFeedback.success(t("jskit.workspaces.members.linkCopied"));
    } catch (error) {
      inviteFeedback.error(error, t("jskit.workspaces.members.copyLinkFailed"));
    } finally {
      isCopyingInviteLink.value = false;
    }
  }

  async function submitRevokeInvite(inviteId) {
    if (revokeInviteCommand.isRunning || !canRevokeInvites.value) {
      return;
    }

    revokeInviteId.value = normalizeRecordId(inviteId, { fallback: "" });
    teamFeedback.clear();

    try {
      await revokeInviteCommand.run({
        inviteId
      });
      await workspaceInvitesList.reload();
      teamFeedback.success(t("jskit.workspaces.members.inviteRevoked"));
    } catch (error) {
      teamFeedback.error(error, t("jskit.workspaces.members.revokeInviteFailed"));
    } finally {
      revokeInviteId.value = "";
    }
  }

  async function submitMemberRoleUpdate(member, roleSid) {
    if (!canManageMembers.value) {
      return;
    }

    membersFeedback.clear();

    try {
      const memberUserId = normalizeRecordId(member?.userId, { fallback: null });
      if (!memberUserId) {
        throw new Error(t("jskit.workspaces.members.memberIdInvalid"));
      }

      await memberRoleCommand.run({
        memberUserId,
        roleSid
      });
      await workspaceMembersList.reload();
      membersFeedback.success(t("jskit.workspaces.members.roleUpdated"));
    } catch (error) {
      membersFeedback.error(error, t("jskit.workspaces.members.updateRoleFailed"));
    }
  }

  async function submitRemoveMember(member) {
    if (memberRemoveCommand.isRunning || !canManageMembers.value) {
      return;
    }

    membersFeedback.clear();

    try {
      const memberUserId = normalizeRecordId(member?.userId, { fallback: null });
      if (!memberUserId) {
        throw new Error(t("jskit.workspaces.members.memberIdInvalid"));
      }

      removeMemberUserId.value = normalizeRecordId(memberUserId, { fallback: "" });
      await memberRemoveCommand.run({
        memberUserId
      });
      await workspaceMembersList.reload();
      membersFeedback.success(t("jskit.workspaces.members.removed"));
    } catch (error) {
      membersFeedback.error(error, t("jskit.workspaces.members.removeFailed"));
    } finally {
      removeMemberUserId.value = "";
    }
  }

  return {
    inviteCreateCommand,
    revokeInviteCommand,
    memberRemoveCommand,
    revokeInviteId,
    removeMemberUserId,
    createdInviteUrl,
    createdInviteDeliveryStatus,
    isCopyingInviteLink,
    clearMessages,
    clearProgress,
    actions: Object.freeze({
      submitInvite,
      copyCreatedInviteLink,
      submitRevokeInvite,
      submitMemberRoleUpdate,
      submitRemoveMember
    })
  };
}

export { useWorkspaceMembersActions };
