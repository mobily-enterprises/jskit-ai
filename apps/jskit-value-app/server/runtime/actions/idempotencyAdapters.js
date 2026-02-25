import { createNoopIdempotencyAdapter } from "@jskit-ai/action-runtime-core";

function createActionIdempotencyAdapter({ billingIdempotencyService } = {}) {
  const noopAdapter = createNoopIdempotencyAdapter();

  if (!billingIdempotencyService || typeof billingIdempotencyService.claimOrReplay !== "function") {
    return noopAdapter;
  }

  return {
    ...noopAdapter,
    async claimOrReplay(payload) {
      const definition = payload?.definition;
      const actionId = String(definition?.id || "").trim();
      if (!actionId.startsWith("workspace.billing.")) {
        return noopAdapter.claimOrReplay(payload);
      }

      return noopAdapter.claimOrReplay(payload);
    }
  };
}

export { createActionIdempotencyAdapter };
