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
    },
    listAiTranscripts(query = {}) {
      const params = new URLSearchParams();
      if (query.page != null) {
        params.set("page", String(query.page));
      }
      if (query.pageSize != null) {
        params.set("pageSize", String(query.pageSize));
      }
      if (query.from) {
        params.set("from", String(query.from));
      }
      if (query.to) {
        params.set("to", String(query.to));
      }
      if (query.status) {
        params.set("status", String(query.status));
      }
      const queryString = params.toString();
      return request(`/api/workspace/ai/transcripts${queryString ? `?${queryString}` : ""}`);
    },
    getAiTranscriptMessages(conversationId, query = {}) {
      const encodedConversationId = encodeURIComponent(String(conversationId || "").trim());
      const params = new URLSearchParams();
      if (query.page != null) {
        params.set("page", String(query.page));
      }
      if (query.pageSize != null) {
        params.set("pageSize", String(query.pageSize));
      }
      const queryString = params.toString();
      return request(
        `/api/workspace/ai/transcripts/${encodedConversationId}/messages${queryString ? `?${queryString}` : ""}`
      );
    },
    exportAiTranscript(conversationId, query = {}) {
      const encodedConversationId = encodeURIComponent(String(conversationId || "").trim());
      const params = new URLSearchParams();
      if (query.from) {
        params.set("from", String(query.from));
      }
      if (query.to) {
        params.set("to", String(query.to));
      }
      if (query.limit != null) {
        params.set("limit", String(query.limit));
      }
      if (query.format) {
        params.set("format", String(query.format));
      }
      const queryString = params.toString();
      return request(`/api/workspace/ai/transcripts/${encodedConversationId}/export${queryString ? `?${queryString}` : ""}`);
    }
  };
}

export { createApi };
