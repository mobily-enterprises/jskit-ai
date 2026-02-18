function createWorkspaceApi({ request }) {
  return {
    bootstrap() {
      return request("/api/bootstrap");
    },
    workspaces() {
      return request("/api/workspaces");
    },
    selectWorkspace(payload) {
      return request("/api/workspaces/select", { method: "POST", body: payload });
    },
    pendingWorkspaceInvites() {
      return request("/api/workspace/invitations/pending");
    },
    redeemWorkspaceInvite(payload) {
      return request("/api/workspace/invitations/redeem", { method: "POST", body: payload });
    },
    workspaceSettings() {
      return request("/api/workspace/settings");
    },
    updateWorkspaceSettings(payload) {
      return request("/api/workspace/settings", { method: "PATCH", body: payload });
    },
    workspaceRoles() {
      return request("/api/workspace/roles");
    },
    workspaceMembers() {
      return request("/api/workspace/members");
    },
    updateWorkspaceMemberRole(memberUserId, payload) {
      const encodedUserId = encodeURIComponent(String(memberUserId || "").trim());
      return request(`/api/workspace/members/${encodedUserId}/role`, { method: "PATCH", body: payload });
    },
    workspaceInvites() {
      return request("/api/workspace/invites");
    },
    createWorkspaceInvite(payload) {
      return request("/api/workspace/invites", { method: "POST", body: payload });
    },
    revokeWorkspaceInvite(inviteId) {
      const encodedInviteId = encodeURIComponent(String(inviteId || "").trim());
      return request(`/api/workspace/invites/${encodedInviteId}`, { method: "DELETE" });
    }
  };
}

export { createWorkspaceApi };
