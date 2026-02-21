import assert from "node:assert/strict";
import test from "node:test";

import { createService as createRemediationWorkerService } from "../server/modules/billing/remediationWorker.service.js";

function createRemediationFixture({
  updateRemediationByLease,
  cancelSubscription,
  recordBillingGuardrail,
  provider = "stripe"
} = {}) {
  const billingRepository = {
    async leaseNextRemediation() {
      return null;
    },
    async updateRemediationByLease(params) {
      return updateRemediationByLease ? updateRemediationByLease(params) : null;
    }
  };

  const billingProviderAdapter = {
    provider,
    async cancelSubscription(payload) {
      if (cancelSubscription) {
        return cancelSubscription(payload);
      }
      return null;
    }
  };

  const observabilityService = recordBillingGuardrail
    ? {
        recordBillingGuardrail
      }
    : null;

  return createRemediationWorkerService({
    billingRepository,
    billingProviderAdapter,
    observabilityService
  });
}

test("remediation worker fails closed when remediation provider does not match active adapter provider", async () => {
  const cancelCalls = [];
  const service = createRemediationFixture({
    provider: "stripe",
    updateRemediationByLease(params) {
      if (Object.keys(params.patch || {}).length < 1) {
        return {
          id: 71,
          leaseVersion: 2,
          provider: "paddle",
          duplicateProviderSubscriptionId: "sub_paddle_71",
          attemptCount: 0
        };
      }

      return {
        id: 71,
        leaseVersion: 3,
        status: "succeeded"
      };
    },
    async cancelSubscription(payload) {
      cancelCalls.push(payload);
    }
  });

  await assert.rejects(
    () =>
      service.runCancelDuplicateSubscription({
        remediationId: 71,
        leaseVersion: 2
      }),
    (error) => Number(error?.statusCode || 0) === 409 && String(error?.code || "") === "BILLING_PROVIDER_MISMATCH"
  );

  assert.equal(cancelCalls.length, 0);
});

test("remediation worker dead-letters retries when max attempt threshold is reached", async () => {
  const guardrailCalls = [];
  const updateCalls = [];
  const now = new Date("2026-02-21T09:00:00.000Z");

  const service = createRemediationFixture({
    updateRemediationByLease(params) {
      updateCalls.push(params);
      if (Object.keys(params.patch || {}).length < 1) {
        return {
          id: 91,
          leaseVersion: 4,
          attemptCount: 5,
          provider: "stripe",
          duplicateProviderSubscriptionId: "sub_dead_letter_91"
        };
      }

      return {
        id: 91,
        leaseVersion: 5,
        status: params.patch.status,
        attemptCount: params.patch.attemptCount,
        resolvedAt: params.patch.resolvedAt
      };
    },
    recordBillingGuardrail(payload) {
      guardrailCalls.push(payload);
    }
  });

  const result = await service.retryOrDeadLetterRemediation({
    remediationId: 91,
    leaseVersion: 4,
    error: new Error("provider unavailable"),
    now
  });

  assert.equal(result.status, "dead_letter");
  assert.equal(result.attemptCount, 6);
  assert.equal(updateCalls.length, 2);
  assert.equal(updateCalls[1].patch.status, "dead_letter");
  assert.deepEqual(guardrailCalls, [
    {
      code: "BILLING_REMEDIATION_DEAD_LETTER",
      measure: "attempt_count",
      value: 6
    }
  ]);
});

test("remediation worker retry path fails closed when lease is fenced during state patch", async () => {
  const guardrailCalls = [];
  const service = createRemediationFixture({
    updateRemediationByLease(params) {
      if (Object.keys(params.patch || {}).length < 1) {
        return {
          id: 101,
          leaseVersion: 9,
          attemptCount: 2,
          provider: "stripe",
          duplicateProviderSubscriptionId: "sub_retry_lease_101"
        };
      }

      return null;
    },
    recordBillingGuardrail(payload) {
      guardrailCalls.push(payload);
    }
  });

  await assert.rejects(
    () =>
      service.retryOrDeadLetterRemediation({
        remediationId: 101,
        leaseVersion: 9,
        error: new Error("retry race"),
        now: new Date("2026-02-21T09:30:00.000Z")
      }),
    (error) =>
      Number(error?.statusCode || 0) === 409 && String(error?.code || "") === "BILLING_REMEDIATION_LEASE_FENCED"
  );

  assert.deepEqual(guardrailCalls, [
    {
      code: "BILLING_REMEDIATION_LEASE_FENCED",
      measure: "count",
      value: 1
    }
  ]);
});
