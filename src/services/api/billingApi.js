function generateIdempotencyKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `idem_${crypto.randomUUID()}`;
  }

  return `idem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function resolveIdempotencyKey(options = {}) {
  const provided = String(options.idempotencyKey || "").trim();
  return provided || generateIdempotencyKey();
}

function createApi({ request }) {
  return {
    listPlans() {
      return request("/api/billing/plans");
    },
    listProducts() {
      return request("/api/billing/products");
    },
    getPlanState() {
      return request("/api/billing/plan-state");
    },
    listPaymentMethods() {
      return request("/api/billing/payment-methods");
    },
    syncPaymentMethods() {
      return request("/api/billing/payment-methods/sync", {
        method: "POST"
      });
    },
    getLimitations() {
      return request("/api/billing/limitations");
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
      return request(`/api/billing/timeline${queryString ? `?${queryString}` : ""}`);
    },
    startCheckout(payload, options = {}) {
      return request("/api/billing/checkout", {
        method: "POST",
        body: payload,
        headers: {
          "Idempotency-Key": resolveIdempotencyKey(options)
        }
      });
    },
    requestPlanChange(payload, options = {}) {
      return request("/api/billing/plan-change", {
        method: "POST",
        body: payload,
        headers: {
          "Idempotency-Key": resolveIdempotencyKey(options)
        }
      });
    },
    cancelPendingPlanChange(options = {}) {
      return request("/api/billing/plan-change/cancel", {
        method: "POST",
        headers: {
          "Idempotency-Key": resolveIdempotencyKey(options)
        }
      });
    },
    createPortal(payload, options = {}) {
      return request("/api/billing/portal", {
        method: "POST",
        body: payload,
        headers: {
          "Idempotency-Key": resolveIdempotencyKey(options)
        }
      });
    },
    createPaymentLink(payload, options = {}) {
      return request("/api/billing/payment-links", {
        method: "POST",
        body: payload,
        headers: {
          "Idempotency-Key": resolveIdempotencyKey(options)
        }
      });
    }
  };
}

const __testables = {
  generateIdempotencyKey,
  resolveIdempotencyKey
};

export { createApi, __testables };
