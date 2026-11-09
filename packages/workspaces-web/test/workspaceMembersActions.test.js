import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// The commands and feedback stand in for http-web's, so the test sees which reads each action makes afterwards.
const commandUrl = import.meta.resolve("@jskit-ai/http-web/client/composables/useCommand");
const feedbackUrl = import.meta.resolve("@jskit-ai/http-web/client/composables/useUiFeedback");
const hooks = registerHooks({
  load(url, context, nextLoad) {
    if (url === commandUrl) {
      return {
        format: "module",
        shortCircuit: true,
        source: "export const useCommand = () => ({ isRunning: false, async run() { return { inviteUrl: '', inviteDelivery: { status: 'sent' } }; } });"
      };
    }
    if (url === feedbackUrl) {
      return {
        format: "module",
        shortCircuit: true,
        source: "export const useUiFeedback = () => ({ clear() {}, success() {}, error(error) { throw error; } });"
      };
    }
    return nextLoad(url, context);
  }
});
const { useWorkspaceMembersActions } = await import("../src/client/composables/useWorkspaceMembersActions.js");
hooks.deregister();

test("member and invite actions reload the list they changed, never the static role catalogue", async () => {
  const reads = [];
  const { actions } = useWorkspaceMembersActions({
    forms: { invite: { email: "guest@example.test", roleSid: "member" } },
    workspaceMembersApiPath: { value: "/api/w/team/members" },
    workspaceInvitesApiPath: { value: "/api/w/team/invites" },
    canInviteMembers: { value: true },
    canManageMembers: { value: true },
    canRevokeInvites: { value: true },
    workspaceRolesView: { async refresh() { reads.push("roles"); } },
    workspaceMembersList: { async reload() { reads.push("members"); } },
    workspaceInvitesList: { async reload() { reads.push("invites"); } }
  });

  await actions.submitInvite();
  await actions.submitRevokeInvite("5");
  await actions.submitMemberRoleUpdate({ userId: "9" }, "admin");
  await actions.submitRemoveMember({ userId: "9" });

  assert.deepEqual(reads, ["invites", "invites", "members", "members"]);
});
