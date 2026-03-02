import { createNoopIdempotencyAdapter } from "@jskit-ai/action-runtime-core/server";

function createActionIdempotencyAdapter() {
  // Billing idempotency is enforced inside billing service methods where request
  // fingerprinting and provider-specific replay semantics are available.
  return createNoopIdempotencyAdapter();
}

export { createActionIdempotencyAdapter };
