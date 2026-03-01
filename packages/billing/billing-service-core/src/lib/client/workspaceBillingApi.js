import { buildOptionalIdempotencyHeaders } from "./idempotencyHeaders.js";

function createApi({ request }) {
  return {
    listPlans() {
      return request("/api/v1/billing/plans");
    },
    listProducts() {
      return request("/api/v1/billing/products");
    },
    listPurchases() {
      return request("/api/v1/billing/purchases");
    },
    getPlanState() {
      return request("/api/v1/billing/plan-state");
    },
    listPaymentMethods() {
      return request("/api/v1/billing/payment-methods");
    },
    syncPaymentMethods() {
      return request("/api/v1/billing/payment-methods/sync", {
        method: "POST"
      });
    },
    setDefaultPaymentMethod(paymentMethodId, payload = {}, options = {}) {
      const encodedPaymentMethodId = encodeURIComponent(String(paymentMethodId || "").trim());
      return request(`/api/v1/billing/payment-methods/${encodedPaymentMethodId}/default`, {
        method: "POST",
        body: payload,
        headers: buildOptionalIdempotencyHeaders(options, {
          required: true
        })
      });
    },
    detachPaymentMethod(paymentMethodId, payload = {}, options = {}) {
      const encodedPaymentMethodId = encodeURIComponent(String(paymentMethodId || "").trim());
      return request(`/api/v1/billing/payment-methods/${encodedPaymentMethodId}/detach`, {
        method: "POST",
        body: payload,
        headers: buildOptionalIdempotencyHeaders(options, {
          required: true
        })
      });
    },
    removePaymentMethod(paymentMethodId, options = {}) {
      const encodedPaymentMethodId = encodeURIComponent(String(paymentMethodId || "").trim());
      return request(`/api/v1/billing/payment-methods/${encodedPaymentMethodId}`, {
        method: "DELETE",
        headers: buildOptionalIdempotencyHeaders(options, {
          required: true
        })
      });
    },
    getLimitations() {
      return request("/api/v1/billing/limitations");
    },
    getTimeline(query = {}) {
      const params = new URLSearchParams();
      if (query.page != null) {
        params.set("page", String(query.page));
      }
      if (query.pageSize != null) {
        params.set("pageSize", String(query.pageSize));
      }
      if (query.source) {
        params.set("source", String(query.source));
      }
      if (query.operationKey) {
        params.set("operationKey", String(query.operationKey));
      }
      if (query.providerEventId) {
        params.set("providerEventId", String(query.providerEventId));
      }
      const queryString = params.toString();
      return request(`/api/v1/billing/timeline${queryString ? `?${queryString}` : ""}`);
    },
    startCheckout(payload, options = {}) {
      return request("/api/v1/billing/checkout", {
        method: "POST",
        body: payload,
        headers: buildOptionalIdempotencyHeaders(options, {
          required: true
        })
      });
    },
    requestPlanChange(payload, options = {}) {
      return request("/api/v1/billing/plan-change", {
        method: "POST",
        body: payload,
        headers: buildOptionalIdempotencyHeaders(options, {
          required: true
        })
      });
    },
    cancelPendingPlanChange(options = {}) {
      return request("/api/v1/billing/plan-change/cancel", {
        method: "POST",
        headers: buildOptionalIdempotencyHeaders(options, {
          required: true
        })
      });
    },
    createPortal(payload, options = {}) {
      return request("/api/v1/billing/portal", {
        method: "POST",
        body: payload,
        headers: buildOptionalIdempotencyHeaders(options, {
          required: true
        })
      });
    },
    createPaymentLink(payload, options = {}) {
      return request("/api/v1/billing/payment-links", {
        method: "POST",
        body: payload,
        headers: buildOptionalIdempotencyHeaders(options, {
          required: true
        })
      });
    }
  };
}

export { createApi };
