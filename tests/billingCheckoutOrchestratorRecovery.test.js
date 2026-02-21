import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../server/lib/errors.js";
import { BILLING_FAILURE_CODES } from "../server/modules/billing/constants.js";
import { createService as createCheckoutOrchestratorService } from "../server/modules/billing/checkoutOrchestrator.service.js";

test("checkout recovery hash mismatch fails closed and marks idempotency failed", async () => {
  const now = new Date("2026-02-20T13:00:00.000Z");
  const markFailedCalls = [];
  let createCheckoutSessionCalls = 0;

  const orchestrator = createCheckoutOrchestratorService({
    billingRepository: {
      async transaction(work) {
        return work({});
      }
    },
    billingPolicyService: {
      async resolveBillableEntityForWriteRequest() {
        return {
          billableEntity: {
            id: 1
          }
        };
      }
    },
    billingPricingService: {
      async resolvePhase1SellablePrice() {
        return null;
      }
    },
    billingIdempotencyService: {
      async claimOrReplay() {
        return null;
      },
      async recoverPendingRequest() {
        return {
          type: "recovery_leased",
          row: {
            id: 88,
            billableEntityId: 501,
            operationKey: "op_hash_mismatch",
            providerIdempotencyKey: "prov_idem_88",
            providerRequestParamsJson: {
              mode: "subscription",
              metadata: {
                operation_key: "op_hash_mismatch"
              }
            },
            providerRequestHash: "persisted_hash_that_differs",
            providerIdempotencyReplayDeadlineAt: new Date(now.getTime() + 60_000).toISOString(),
            providerCheckoutSessionExpiresAtUpperBound: new Date(now.getTime() + 120_000).toISOString(),
            providerApiVersion: "2024-06-20",
            providerSdkVersion: "14.25.0"
          },
          expectedLeaseVersion: 6
        };
      },
      assertReplayProvenanceCompatible() {},
      async assertProviderRequestHashStable() {
        throw new AppError(409, "Provider request hash mismatch.", {
          code: "BILLING_PROVIDER_REQUEST_HASH_MISMATCH"
        });
      },
      async markFailed(payload) {
        markFailedCalls.push(payload);
        return payload;
      }
    },
    billingCheckoutSessionService: {
      async getBlockingCheckoutSession() {
        return null;
      }
    },
    stripeSdkService: {
      async createCheckoutSession() {
        createCheckoutSessionCalls += 1;
        throw new Error("should not reach provider create when hash mismatch is detected");
      },
      async getSdkProvenance() {
        return {
          providerSdkName: "stripe-node",
          providerSdkVersion: "14.25.0",
          providerApiVersion: "2024-06-20"
        };
      }
    },
    appPublicUrl: "https://app.example.test"
  });

  await assert.rejects(
    () =>
      orchestrator.recoverCheckoutFromPending({
        idempotencyRow: {
          id: 88
        },
        now
      }),
    (error) =>
      error instanceof AppError &&
      Number(error.statusCode) === 409 &&
      String(error.code || "") === BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID
  );

  assert.equal(createCheckoutSessionCalls, 0);
  assert.equal(markFailedCalls.length, 1);
  assert.equal(markFailedCalls[0].idempotencyRowId, 88);
  assert.equal(markFailedCalls[0].leaseVersion, 6);
  assert.equal(markFailedCalls[0].failureCode, BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID);
});
