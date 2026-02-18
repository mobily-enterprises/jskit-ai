function createApi({ request }) {
  return {
    bootstrap() {
      return request("/api/console/bootstrap");
    },
    listRoles() {
      return request("/api/console/roles");
    },
    listMembers() {
      return request("/api/console/members");
    },
    updateMemberRole(memberUserId, payload) {
      const encodedUserId = encodeURIComponent(String(memberUserId || "").trim());
      return request(`/api/console/members/${encodedUserId}/role`, { method: "PATCH", body: payload });
    },
    listInvites() {
      return request("/api/console/invites");
    },
    createInvite(payload) {
      return request("/api/console/invites", { method: "POST", body: payload });
    },
    revokeInvite(inviteId) {
      const encodedInviteId = encodeURIComponent(String(inviteId || "").trim());
      return request(`/api/console/invites/${encodedInviteId}`, { method: "DELETE" });
    },
    listPendingInvites() {
      return request("/api/console/invitations/pending");
    },
    redeemInvite(payload) {
      return request("/api/console/invitations/redeem", { method: "POST", body: payload });
    }
  };
}

export { createApi };
