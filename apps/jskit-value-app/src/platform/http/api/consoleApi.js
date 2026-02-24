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
    },
    listBrowserErrors(page, pageSize) {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize)
      });
      return request(`/api/v1/console/errors/browser?${params.toString()}`);
    },
    getBrowserError(errorId) {
      const encodedErrorId = encodeURIComponent(String(errorId || "").trim());
      return request(`/api/v1/console/errors/browser/${encodedErrorId}`);
    },
    listServerErrors(page, pageSize) {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize)
      });
      return request(`/api/v1/console/errors/server?${params.toString()}`);
    },
    getServerError(errorId) {
      const encodedErrorId = encodeURIComponent(String(errorId || "").trim());
      return request(`/api/v1/console/errors/server/${encodedErrorId}`);
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
      return request(`/api/v1/console/ai/transcripts${queryString ? `?${queryString}` : ""}`);
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
        `/api/v1/console/ai/transcripts/${encodedConversationId}/messages${queryString ? `?${queryString}` : ""}`
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
      return request(`/api/v1/console/ai/transcripts/export${queryString ? `?${queryString}` : ""}`);
    },
    listBillingEvents(query = {}) {
      const params = new URLSearchParams();
      if (query.page != null) {
        params.set("page", String(query.page));
      }
      if (query.pageSize != null) {
        params.set("pageSize", String(query.pageSize));
      }
      if (query.workspaceSlug) {
        params.set("workspaceSlug", String(query.workspaceSlug));
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
      return request(`/api/v1/console/billing/events${queryString ? `?${queryString}` : ""}`);
    },
    listBillingPlans() {
      return request("/api/v1/console/billing/plans");
    },
    listBillingProducts() {
      return request("/api/v1/console/billing/products");
    },
    getBillingSettings() {
      return request("/api/v1/console/billing/settings");
    },
    updateBillingSettings(payload) {
      return request("/api/v1/console/billing/settings", { method: "PATCH", body: payload });
    },
    listBillingProviderPrices(query = {}) {
      const params = new URLSearchParams();
      if (query.active != null) {
        params.set("active", String(query.active));
      }
      if (query.limit != null) {
        params.set("limit", String(query.limit));
      }
      if (query.target) {
        params.set("target", String(query.target));
      }
      const queryString = params.toString();
      return request(`/api/v1/console/billing/provider-prices${queryString ? `?${queryString}` : ""}`);
    },
    createBillingPlan(payload) {
      return request("/api/v1/console/billing/plans", { method: "POST", body: payload });
    },
    createBillingProduct(payload) {
      return request("/api/v1/console/billing/products", { method: "POST", body: payload });
    },
    updateBillingPlan(planId, payload) {
      const encodedPlanId = encodeURIComponent(String(planId || "").trim());
      return request(`/api/v1/console/billing/plans/${encodedPlanId}`, {
        method: "PATCH",
        body: payload
      });
    },
    updateBillingProduct(productId, payload) {
      const encodedProductId = encodeURIComponent(String(productId || "").trim());
      return request(`/api/v1/console/billing/products/${encodedProductId}`, {
        method: "PATCH",
        body: payload
      });
    },
    simulateServerError(payload) {
      return request("/api/v1/console/simulate/server-error", { method: "POST", body: payload || {} });
    },
    reportBrowserError(payload) {
      return request("/api/v1/console/errors/browser", { method: "POST", body: payload });
    }
  };
}

export { createApi };
