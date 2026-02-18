function createApi({ request }) {
  return {
    bootstrap() {
      return request("/api/bootstrap");
    },
    list() {
      return request("/api/workspaces");
    },
    select(payload) {
      return request("/api/workspaces/select", { method: "POST", body: payload });
    },
    listPendingInvites() {
      return request("/api/workspace/invitations/pending");
    },
    redeemInvite(payload) {
      return request("/api/workspace/invitations/redeem", { method: "POST", body: payload });
    },
    getSettings() {
      return request("/api/workspace/settings");
    },
    updateSettings(payload) {
      return request("/api/workspace/settings", { method: "PATCH", body: payload });
    },
    listRoles() {
      return request("/api/workspace/roles");
    },
    listMembers() {
      return request("/api/workspace/members");
    },
    updateMemberRole(memberUserId, payload) {
      const encodedUserId = encodeURIComponent(String(memberUserId || "").trim());
      return request(`/api/workspace/members/${encodedUserId}/role`, { method: "PATCH", body: payload });
    },
    listInvites() {
      return request("/api/workspace/invites");
    },
    createInvite(payload) {
      return request("/api/workspace/invites", { method: "POST", body: payload });
    },
    revokeInvite(inviteId) {
      const encodedInviteId = encodeURIComponent(String(inviteId || "").trim());
      return request(`/api/workspace/invites/${encodedInviteId}`, { method: "DELETE" });
    }
  };
}

export { createApi };
