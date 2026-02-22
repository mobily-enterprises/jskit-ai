function createApi({ request }) {
  return {
    bootstrap() {
      return request("/api/console/bootstrap");
    },
    listRoles() {
      return request("/api/console/roles");
    },
    getSettings() {
      return request("/api/console/settings");
    },
    updateSettings(payload) {
      return request("/api/console/settings", { method: "PATCH", body: payload });
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
    },
    listBrowserErrors(page, pageSize) {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize)
      });
      return request(`/api/console/errors/browser?${params.toString()}`);
    },
    getBrowserError(errorId) {
      const encodedErrorId = encodeURIComponent(String(errorId || "").trim());
      return request(`/api/console/errors/browser/${encodedErrorId}`);
    },
    listServerErrors(page, pageSize) {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize)
      });
      return request(`/api/console/errors/server?${params.toString()}`);
    },
    getServerError(errorId) {
      const encodedErrorId = encodeURIComponent(String(errorId || "").trim());
      return request(`/api/console/errors/server/${encodedErrorId}`);
    },
    listAiTranscripts(query = {}) {
      const params = new URLSearchParams();
      if (query.page != null) {
        params.set("page", String(query.page));
      }
      if (query.pageSize != null) {
        params.set("pageSize", String(query.pageSize));
      }
      if (query.workspaceId != null) {
        params.set("workspaceId", String(query.workspaceId));
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
      return request(`/api/console/ai/transcripts${queryString ? `?${queryString}` : ""}`);
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
        `/api/console/ai/transcripts/${encodedConversationId}/messages${queryString ? `?${queryString}` : ""}`
      );
    },
    exportAiTranscripts(query = {}) {
      const params = new URLSearchParams();
      if (query.workspaceId != null) {
        params.set("workspaceId", String(query.workspaceId));
      }
      if (query.conversationId != null) {
        params.set("conversationId", String(query.conversationId));
      }
      if (query.role) {
        params.set("role", String(query.role));
      }
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
      return request(`/api/console/ai/transcripts/export${queryString ? `?${queryString}` : ""}`);
    },
    listBillingEvents(query = {}) {
      const params = new URLSearchParams();
      if (query.page != null) {
        params.set("page", String(query.page));
      }
      if (query.pageSize != null) {
        params.set("pageSize", String(query.pageSize));
      }
      if (query.workspaceId != null) {
        params.set("workspaceId", String(query.workspaceId));
      }
      if (query.userId != null) {
        params.set("userId", String(query.userId));
      }
      if (query.billableEntityId != null) {
        params.set("billableEntityId", String(query.billableEntityId));
      }
      if (query.operationKey) {
        params.set("operationKey", String(query.operationKey));
      }
      if (query.providerEventId) {
        params.set("providerEventId", String(query.providerEventId));
      }
      if (query.source) {
        params.set("source", String(query.source));
      }
      const queryString = params.toString();
      return request(`/api/console/billing/events${queryString ? `?${queryString}` : ""}`);
    },
    listBillingPlans() {
      return request("/api/console/billing/plans");
    },
    listBillingProviderPrices(query = {}) {
      const params = new URLSearchParams();
      if (query.active != null) {
        params.set("active", String(query.active));
      }
      if (query.limit != null) {
        params.set("limit", String(query.limit));
      }
      const queryString = params.toString();
      return request(`/api/console/billing/provider-prices${queryString ? `?${queryString}` : ""}`);
    },
    createBillingPlan(payload) {
      return request("/api/console/billing/plans", { method: "POST", body: payload });
    },
    updateBillingPlan(planId, payload) {
      const encodedPlanId = encodeURIComponent(String(planId || "").trim());
      return request(`/api/console/billing/plans/${encodedPlanId}`, {
        method: "PATCH",
        body: payload
      });
    },
    simulateServerError(payload) {
      return request("/api/console/simulate/server-error", { method: "POST", body: payload || {} });
    },
    reportBrowserError(payload) {
      return request("/api/console/errors/browser", { method: "POST", body: payload });
    }
  };
}

export { createApi };
