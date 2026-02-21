import assert from "node:assert/strict";
import test from "node:test";

import { createService as createOutboxWorkerService } from "../server/modules/billing/outboxWorker.service.js";

function createWorkerFixture({
  updateOutboxJobByLease,
  expireCheckoutSession,
  recordBillingGuardrail
} = {}) {
  const billingRepository = {
    async leaseNextOutboxJob() {
      return null;
    },
    async updateOutboxJobByLease(params) {
      return updateOutboxJobByLease ? updateOutboxJobByLease(params) : null;
    }
  };

  const billingProviderAdapter = {
    async expireCheckoutSession(payload) {
      if (expireCheckoutSession) {
        return expireCheckoutSession(payload);
      }
      return null;
    }
  };

  const observabilityService = recordBillingGuardrail
    ? {
        recordBillingGuardrail
      }
    : null;

  return createOutboxWorkerService({
    billingRepository,
    billingProviderAdapter,
    observabilityService
  });
}

test("outbox worker records orphan checkout cleanup attempt for expire_checkout_session jobs", async () => {
  const guardrailCalls = [];
  const expireCalls = [];
  const updateCalls = [];
  const completedRow = {
    id: 11,
    leaseVersion: 7,
    status: "succeeded"
  };

  const service = createWorkerFixture({
    updateOutboxJobByLease(params) {
      updateCalls.push(params);
      if (Object.keys(params.patch || {}).length < 1) {
        return {
          id: 11,
          leaseVersion: 6,
          jobType: "expire_checkout_session",
          payloadJson: {
            providerCheckoutSessionId: "cs_orphan_123"
          }
        };
      }
      return completedRow;
    },
    async expireCheckoutSession(payload) {
      expireCalls.push(payload);
    },
    recordBillingGuardrail(payload) {
      guardrailCalls.push(payload);
    }
  });

  const result = await service.executeJob({
    jobId: 11,
    leaseVersion: 6
  });

  assert.equal(result, completedRow);
  assert.deepEqual(expireCalls, [
    {
      sessionId: "cs_orphan_123"
    }
  ]);
  assert.deepEqual(guardrailCalls, [
    {
      code: "BILLING_ORPHAN_CHECKOUT_SESSION_CLEANUP_ATTEMPT",
      measure: "count",
      value: 1
    }
  ]);
  assert.equal(updateCalls.length, 2);
});

test("outbox worker records orphan checkout cleanup failure on retry for expire_checkout_session jobs", async () => {
  const guardrailCalls = [];
  const now = new Date("2026-02-21T12:00:00.000Z");

  const service = createWorkerFixture({
    updateOutboxJobByLease(params) {
      if (Object.keys(params.patch || {}).length < 1) {
        return {
          id: 19,
          leaseVersion: 4,
          jobType: "expire_checkout_session",
          payloadJson: {
            providerCheckoutSessionId: "cs_orphan_456"
          },
          attemptCount: 0
        };
      }

      return {
        id: 19,
        leaseVersion: 5,
        status: "failed"
      };
    },
    recordBillingGuardrail(payload) {
      guardrailCalls.push(payload);
    }
  });

  await service.retryOrDeadLetter({
    jobId: 19,
    leaseVersion: 4,
    error: new Error("provider unavailable"),
    now
  });

  assert.deepEqual(guardrailCalls, [
    {
      code: "BILLING_ORPHAN_CHECKOUT_SESSION_CLEANUP_FAILURE",
      measure: "count",
      value: 1
    }
  ]);
});
