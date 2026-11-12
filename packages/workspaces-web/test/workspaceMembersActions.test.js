import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// The commands and feedback stand in for http-web's, so the test sees which reads each action makes afterwards and
// which notice each one shows. `commandResult.value` is what every command answers; `notices` records each notice.
const commandUrl = import.meta.resolve("@jskit-ai/http-web/client/composables/useCommand");
const feedbackUrl = import.meta.resolve("@jskit-ai/http-web/client/composables/useUiFeedback");
const hooks = registerHooks({
  load(url, context, nextLoad) {
    if (url === commandUrl) {
      return {
        format: "module",
        shortCircuit: true,
        source: [
          "export const commandResult = { value: { inviteUrl: '', inviteDelivery: { status: 'sent' } } };",
          "export const useCommand = () => ({ isRunning: false, async run() { return commandResult.value; } });"
        ].join("\n")
      };
    }
    if (url === feedbackUrl) {
      return {
        format: "module",
        shortCircuit: true,
        source: [
          "export const notices = [];",
          "export const useUiFeedback = () => ({",
          "  clear() {},",
          "  success(message) { notices.push({ style: 'success', message }); },",
          "  warning(message) { notices.push({ style: 'warning', message }); },",
          "  error(error) { throw error; }",
          "});"
        ].join("\n")
      };
    }
    return nextLoad(url, context);
  }
});
const { commandResult } = await import(commandUrl);
const { notices } = await import(feedbackUrl);
const { useWorkspaceMembersActions } = await import("../src/client/composables/useWorkspaceMembersActions.js");
hooks.deregister();

const INVITE_URL = "https://app.example.test/invite/token-1";

function membersActions(reads = []) {
  return useWorkspaceMembersActions({
    forms: { invite: { email: "guest@example.test", roleSid: "member" } },
    workspaceMembersApiPath: { value: "/api/w/team/members" },
    workspaceInvitesApiPath: { value: "/api/w/team/invites" },
    canInviteMembers: { value: true },
    canManageMembers: { value: true },
    canRevokeInvites: { value: true },
    workspaceMembersList: { async reload() { reads.push("members"); } },
    workspaceInvitesList: { async reload() { reads.push("invites"); } }
  });
}

test("member and invite actions reload the list they changed, never the static role catalogue", async () => {
  const reads = [];
  const { actions } = membersActions(reads);

  await actions.submitInvite();
  await actions.submitRevokeInvite("5");
  await actions.submitMemberRoleUpdate({ userId: "9" }, "admin");
  await actions.submitRemoveMember({ userId: "9" });

  assert.deepEqual(reads, ["invites", "invites", "members", "members"]);
});

// What the invite notice says for each delivery status the server answers. Only `sent` says an email went out; the
// others leave the link and its Copy button in the panel as the next step.
const INVITE_NOTICES = Object.freeze([
  {
    delivery: { status: "sent", message: "Invite sent." },
    notice: { style: "success", message: "Invite sent." }
  },
  {
    delivery: {
      status: "simulated",
      message: "Test copy: the invitation email was not sent. Copy the invite link to share it.",
      messageCode: "workspaces.invite.simulated"
    },
    notice: {
      style: "success",
      message: "Invite created. This is a test copy, so no email was sent: copy the link to share it."
    }
  },
  {
    delivery: {
      status: "mailer_unconfigured",
      message: "No workspace invite mailer is configured.",
      messageCode: "workspaces.invite.mailerUnconfigured"
    },
    notice: {
      style: "success",
      message: "Invite created. Email isn't set up, so no email was sent: copy the link to share it."
    }
  },
  {
    delivery: { status: "failed", message: "The mail server refused the message." },
    notice: {
      style: "warning",
      message: "Invite created, but email delivery failed. Copy the invite link to share it."
    }
  },
  {
    delivery: { status: "queued", message: "A status this client does not know yet." },
    notice: { style: "success", message: "Invite created. Copy the invite link to share it." }
  }
]);

for (const { delivery, notice } of INVITE_NOTICES) {
  test(`an invite whose delivery is ${delivery.status} shows a ${notice.style} notice of its own and keeps the link`, async () => {
    commandResult.value = { inviteUrl: INVITE_URL, inviteDelivery: delivery };
    notices.length = 0;
    const { actions, createdInviteUrl, createdInviteDeliveryStatus } = membersActions();

    await actions.submitInvite();

    assert.deepEqual(notices, [notice]);
    assert.equal(createdInviteUrl.value, INVITE_URL, "The panel shows the link with its Copy button.");
    assert.equal(createdInviteDeliveryStatus.value, delivery.status);
  });
}

test("an invite answered without a delivery claims no email either", async () => {
  commandResult.value = { inviteUrl: INVITE_URL };
  notices.length = 0;
  const { actions } = membersActions();

  await actions.submitInvite();

  assert.deepEqual(notices, [{ style: "success", message: "Invite created. Copy the invite link to share it." }]);
});
