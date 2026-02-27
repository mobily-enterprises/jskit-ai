function createApi({ request }) {
  return {
    bootstrap() {
      return request("/api/v1/console/bootstrap");
    },
    listRoles() {
      return request("/api/v1/console/roles");
    },
    getSettings() {
      return request("/api/v1/console/settings");
    },
    updateSettings(payload) {
      return request("/api/v1/console/settings", { method: "PATCH", body: payload });
    },
    listMembers() {
      return request("/api/v1/console/members");
    },
    updateMemberRole(memberUserId, payload) {
      const encodedUserId = encodeURIComponent(String(memberUserId || "").trim());
      return request(`/api/v1/console/members/${encodedUserId}/role`, { method: "PATCH", body: payload });
    },
    listInvites() {
      return request("/api/v1/console/invites");
    },
    createInvite(payload) {
      return request("/api/v1/console/invites", { method: "POST", body: payload });
    },
    revokeInvite(inviteId) {
      const encodedInviteId = encodeURIComponent(String(inviteId || "").trim());
      return request(`/api/v1/console/invites/${encodedInviteId}`, { method: "DELETE" });
    },
    listPendingInvites() {
      return request("/api/v1/console/invitations/pending");
    },
    redeemInvite(payload) {
      return request("/api/v1/console/invitations/redeem", { method: "POST", body: payload });
    }
  };
}

export { createApi };
