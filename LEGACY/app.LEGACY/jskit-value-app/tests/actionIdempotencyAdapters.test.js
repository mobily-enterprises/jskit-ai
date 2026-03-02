import assert from "node:assert/strict";
import test from "node:test";

import { createActionIdempotencyAdapter } from "../server/runtime/actions/idempotencyAdapters.js";

test("action idempotency adapter returns noop behavior", async () => {
  const adapter = createActionIdempotencyAdapter({
    billingIdempotencyService: {
      async claimOrReplay() {
        throw new Error("should not be called");
      }
    }
  });

  const claimResult = await adapter.claimOrReplay({
    definition: {
      id: "workspace.billing.checkout.start"
    }
  });

  assert.deepEqual(claimResult, {
    type: "proceed",
    idempotencyReplay: false,
    claim: null,
    replayResult: null
  });

  await assert.doesNotReject(() =>
    adapter.markSucceeded({
      claim: null
    })
  );
  await assert.doesNotReject(() =>
    adapter.markFailed({
      claim: null
    })
  );
});
