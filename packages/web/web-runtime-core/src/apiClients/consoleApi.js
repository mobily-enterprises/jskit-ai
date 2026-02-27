function generateIdempotencyKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `idem_${crypto.randomUUID()}`;
  }

  return `idem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function resolveIdempotencyKey(options = {}, { required = false } = {}) {
  const provided = String(options?.idempotencyKey || "").trim();
  if (provided) {
    return provided;
  }
  if (required) {
    return generateIdempotencyKey();
  }
  return "";
}

function buildOptionalIdempotencyHeaders(options = {}, { required = false } = {}) {
  const idempotencyKey = resolveIdempotencyKey(options, {
    required
  });
  if (!idempotencyKey) {
    return {};
  }
  return {
    "Idempotency-Key": idempotencyKey
  };
}

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
    listEntitlementDefinitions(query = {}) {
      const params = new URLSearchParams();
      if (query.includeInactive != null) {
        params.set("includeInactive", String(query.includeInactive));
      }
      if (query.code) {
        params.set("code", String(query.code));
      }
      if (Array.isArray(query.codes)) {
        for (const code of query.codes) {
          const normalizedCode = String(code || "").trim();
          if (!normalizedCode) {
            continue;
          }
          params.append("codes", normalizedCode);
        }
      }
      const queryString = params.toString();
      return request(`/api/v1/console/billing/entitlement-definitions${queryString ? `?${queryString}` : ""}`);
    },
    getEntitlementDefinition(definitionId) {
      const encodedDefinitionId = encodeURIComponent(String(definitionId || "").trim());
      return request(`/api/v1/console/billing/entitlement-definitions/${encodedDefinitionId}`);
    },
    createEntitlementDefinition(payload, options = {}) {
      return request("/api/v1/console/billing/entitlement-definitions", {
        method: "POST",
        body: payload,
        headers: buildOptionalIdempotencyHeaders(options)
      });
    },
    updateEntitlementDefinition(definitionId, payload, options = {}) {
      const encodedDefinitionId = encodeURIComponent(String(definitionId || "").trim());
      return request(`/api/v1/console/billing/entitlement-definitions/${encodedDefinitionId}`, {
        method: "PATCH",
        body: payload,
        headers: buildOptionalIdempotencyHeaders(options)
      });
    },
    deleteEntitlementDefinition(definitionId, payload = {}, options = {}) {
      const encodedDefinitionId = encodeURIComponent(String(definitionId || "").trim());
      return request(`/api/v1/console/billing/entitlement-definitions/${encodedDefinitionId}`, {
        method: "DELETE",
        body: payload,
        headers: buildOptionalIdempotencyHeaders(options, {
          required: true
        })
      });
    },
    archiveBillingPlan(planId, payload = {}, options = {}) {
      const encodedPlanId = encodeURIComponent(String(planId || "").trim());
      return request(`/api/v1/console/billing/plans/${encodedPlanId}/archive`, {
        method: "POST",
        body: payload,
        headers: buildOptionalIdempotencyHeaders(options, {
          required: true
        })
      });
    },
    unarchiveBillingPlan(planId, payload = {}, options = {}) {
      const encodedPlanId = encodeURIComponent(String(planId || "").trim());
      return request(`/api/v1/console/billing/plans/${encodedPlanId}/unarchive`, {
        method: "POST",
        body: payload,
        headers: buildOptionalIdempotencyHeaders(options, {
          required: true
        })
      });
    },
    deleteBillingPlan(planId, payload = {}, options = {}) {
      const encodedPlanId = encodeURIComponent(String(planId || "").trim());
      return request(`/api/v1/console/billing/plans/${encodedPlanId}`, {
        method: "DELETE",
        body: payload,
        headers: buildOptionalIdempotencyHeaders(options, {
          required: true
        })
      });
    },
    archiveBillingProduct(productId, payload = {}, options = {}) {
      const encodedProductId = encodeURIComponent(String(productId || "").trim());
      return request(`/api/v1/console/billing/products/${encodedProductId}/archive`, {
        method: "POST",
        body: payload,
        headers: buildOptionalIdempotencyHeaders(options, {
          required: true
        })
      });
    },
    unarchiveBillingProduct(productId, payload = {}, options = {}) {
      const encodedProductId = encodeURIComponent(String(productId || "").trim());
      return request(`/api/v1/console/billing/products/${encodedProductId}/unarchive`, {
        method: "POST",
        body: payload,
        headers: buildOptionalIdempotencyHeaders(options, {
          required: true
        })
      });
    },
    deleteBillingProduct(productId, payload = {}, options = {}) {
      const encodedProductId = encodeURIComponent(String(productId || "").trim());
      return request(`/api/v1/console/billing/products/${encodedProductId}`, {
        method: "DELETE",
        body: payload,
        headers: buildOptionalIdempotencyHeaders(options, {
          required: true
        })
      });
    },
    listPurchases(query = {}) {
      const params = new URLSearchParams();
      if (query.page != null) {
        params.set("page", String(query.page));
      }
      if (query.pageSize != null) {
        params.set("pageSize", String(query.pageSize));
      }
      if (query.status) {
        params.set("status", String(query.status));
      }
      if (query.provider) {
        params.set("provider", String(query.provider));
      }
      if (query.purchaseKind) {
        params.set("purchaseKind", String(query.purchaseKind));
      }
      if (query.workspaceSlug) {
        params.set("workspaceSlug", String(query.workspaceSlug));
      }
      if (query.billableEntityId != null) {
        params.set("billableEntityId", String(query.billableEntityId));
      }
      if (query.operationKey) {
        params.set("operationKey", String(query.operationKey));
      }
      if (query.providerInvoiceId) {
        params.set("providerInvoiceId", String(query.providerInvoiceId));
      }
      if (query.providerPaymentId) {
        params.set("providerPaymentId", String(query.providerPaymentId));
      }
      const queryString = params.toString();
      return request(`/api/v1/console/billing/purchases${queryString ? `?${queryString}` : ""}`);
    },
    refundPurchase(purchaseId, payload = {}, options = {}) {
      const encodedPurchaseId = encodeURIComponent(String(purchaseId || "").trim());
      return request(`/api/v1/console/billing/purchases/${encodedPurchaseId}/refund`, {
        method: "POST",
        body: payload,
        headers: buildOptionalIdempotencyHeaders(options, {
          required: true
        })
      });
    },
    voidPurchase(purchaseId, payload = {}, options = {}) {
      const encodedPurchaseId = encodeURIComponent(String(purchaseId || "").trim());
      return request(`/api/v1/console/billing/purchases/${encodedPurchaseId}/void`, {
        method: "POST",
        body: payload,
        headers: buildOptionalIdempotencyHeaders(options, {
          required: true
        })
      });
    },
    createPurchaseCorrection(purchaseId, payload = {}, options = {}) {
      const encodedPurchaseId = encodeURIComponent(String(purchaseId || "").trim());
      return request(`/api/v1/console/billing/purchases/${encodedPurchaseId}/corrections`, {
        method: "POST",
        body: payload,
        headers: buildOptionalIdempotencyHeaders(options, {
          required: true
        })
      });
    },
    listPlanAssignments(query = {}) {
      const params = new URLSearchParams();
      if (query.page != null) {
        params.set("page", String(query.page));
      }
      if (query.pageSize != null) {
        params.set("pageSize", String(query.pageSize));
      }
      if (query.billableEntityId != null) {
        params.set("billableEntityId", String(query.billableEntityId));
      }
      if (query.workspaceSlug) {
        params.set("workspaceSlug", String(query.workspaceSlug));
      }
      if (query.status) {
        params.set("status", String(query.status));
      }
      if (query.from) {
        params.set("from", String(query.from));
      }
      if (query.to) {
        params.set("to", String(query.to));
      }
      const queryString = params.toString();
      return request(`/api/v1/console/billing/plan-assignments${queryString ? `?${queryString}` : ""}`);
    },
    createPlanAssignment(payload = {}, options = {}) {
      return request("/api/v1/console/billing/plan-assignments", {
        method: "POST",
        body: payload,
        headers: buildOptionalIdempotencyHeaders(options, {
          required: true
        })
      });
    },
    updatePlanAssignment(assignmentId, payload = {}, options = {}) {
      const encodedAssignmentId = encodeURIComponent(String(assignmentId || "").trim());
      return request(`/api/v1/console/billing/plan-assignments/${encodedAssignmentId}`, {
        method: "PATCH",
        body: payload,
        headers: buildOptionalIdempotencyHeaders(options, {
          required: true
        })
      });
    },
    cancelPlanAssignment(assignmentId, payload = {}, options = {}) {
      const encodedAssignmentId = encodeURIComponent(String(assignmentId || "").trim());
      return request(`/api/v1/console/billing/plan-assignments/${encodedAssignmentId}/cancel`, {
        method: "POST",
        body: payload,
        headers: buildOptionalIdempotencyHeaders(options, {
          required: true
        })
      });
    },
    listSubscriptions(query = {}) {
      const params = new URLSearchParams();
      if (query.page != null) {
        params.set("page", String(query.page));
      }
      if (query.pageSize != null) {
        params.set("pageSize", String(query.pageSize));
      }
      if (query.status) {
        params.set("status", String(query.status));
      }
      if (query.provider) {
        params.set("provider", String(query.provider));
      }
      if (query.workspaceSlug) {
        params.set("workspaceSlug", String(query.workspaceSlug));
      }
      if (query.billableEntityId != null) {
        params.set("billableEntityId", String(query.billableEntityId));
      }
      const queryString = params.toString();
      return request(`/api/v1/console/billing/subscriptions${queryString ? `?${queryString}` : ""}`);
    },
    changeSubscriptionPlan(providerSubscriptionId, payload = {}, options = {}) {
      const encodedSubscriptionId = encodeURIComponent(String(providerSubscriptionId || "").trim());
      return request(`/api/v1/console/billing/subscriptions/${encodedSubscriptionId}/change-plan`, {
        method: "POST",
        body: payload,
        headers: buildOptionalIdempotencyHeaders(options, {
          required: true
        })
      });
    },
    cancelSubscription(providerSubscriptionId, payload = {}, options = {}) {
      const encodedSubscriptionId = encodeURIComponent(String(providerSubscriptionId || "").trim());
      return request(`/api/v1/console/billing/subscriptions/${encodedSubscriptionId}/cancel`, {
        method: "POST",
        body: payload,
        headers: buildOptionalIdempotencyHeaders(options, {
          required: true
        })
      });
    },
    cancelSubscriptionAtPeriodEnd(providerSubscriptionId, payload = {}, options = {}) {
      const encodedSubscriptionId = encodeURIComponent(String(providerSubscriptionId || "").trim());
      return request(`/api/v1/console/billing/subscriptions/${encodedSubscriptionId}/cancel-at-period-end`, {
        method: "POST",
        body: payload,
        headers: buildOptionalIdempotencyHeaders(options, {
          required: true
        })
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
