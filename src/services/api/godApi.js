function createApi({ request }) {
  return {
    bootstrap() {
      return request("/api/god/bootstrap");
    },
    listRoles() {
      return request("/api/god/roles");
    },
    listMembers() {
      return request("/api/god/members");
    },
    updateMemberRole(memberUserId, payload) {
      const encodedUserId = encodeURIComponent(String(memberUserId || "").trim());
      return request(`/api/god/members/${encodedUserId}/role`, { method: "PATCH", body: payload });
    },
    listInvites() {
      return request("/api/god/invites");
    },
    createInvite(payload) {
      return request("/api/god/invites", { method: "POST", body: payload });
    },
    revokeInvite(inviteId) {
      const encodedInviteId = encodeURIComponent(String(inviteId || "").trim());
      return request(`/api/god/invites/${encodedInviteId}`, { method: "DELETE" });
    },
    listPendingInvites() {
      return request("/api/god/invitations/pending");
    },
    redeemInvite(payload) {
      return request("/api/god/invitations/redeem", { method: "POST", body: payload });
    }
  };
}

export { createApi };
