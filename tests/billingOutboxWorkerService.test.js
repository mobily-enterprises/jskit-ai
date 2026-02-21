import assert from "node:assert/strict";
import test from "node:test";

import { createService as createOutboxWorkerService } from "../server/modules/billing/outboxWorker.service.js";

function createWorkerFixture({
  updateOutboxJobByLease,
  expireCheckoutSession,
  recordBillingGuardrail,
  provider
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
    provider: provider || null,
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

test("outbox worker fails closed when payload provider does not match active adapter provider", async () => {
  const expireCalls = [];
  const service = createWorkerFixture({
    provider: "stripe",
    updateOutboxJobByLease(params) {
      if (Object.keys(params.patch || {}).length < 1) {
        return {
          id: 51,
          leaseVersion: 3,
          jobType: "expire_checkout_session",
          payloadJson: {
            provider: "paddle",
            providerCheckoutSessionId: "txn_paddle_51"
          }
        };
      }

      return {
        id: 51,
        leaseVersion: 4,
        status: "succeeded"
      };
    },
    async expireCheckoutSession(payload) {
      expireCalls.push(payload);
    }
  });

  await assert.rejects(
    () =>
      service.executeJob({
        jobId: 51,
        leaseVersion: 3
      }),
    (error) => Number(error?.statusCode || 0) === 409 && String(error?.code || "") === "BILLING_PROVIDER_MISMATCH"
  );

  assert.equal(expireCalls.length, 0);
});

test("outbox worker dead-letters jobs when retry attempts reach max threshold", async () => {
  const guardrailCalls = [];
  const now = new Date("2026-02-21T13:00:00.000Z");
  const updateCalls = [];

  const service = createWorkerFixture({
    updateOutboxJobByLease(params) {
      updateCalls.push(params);
      if (Object.keys(params.patch || {}).length < 1) {
        return {
          id: 63,
          leaseVersion: 9,
          jobType: "expire_checkout_session",
          payloadJson: {
            providerCheckoutSessionId: "cs_orphan_789"
          },
          attemptCount: 7
        };
      }

      return {
        id: 63,
        leaseVersion: 10,
        status: params.patch.status,
        attemptCount: params.patch.attemptCount,
        finishedAt: params.patch.finishedAt
      };
    },
    recordBillingGuardrail(payload) {
      guardrailCalls.push(payload);
    }
  });

  const result = await service.retryOrDeadLetter({
    jobId: 63,
    leaseVersion: 9,
    error: new Error("provider timeout"),
    now
  });

  assert.equal(result.status, "dead_letter");
  assert.equal(result.attemptCount, 8);
  assert.equal(updateCalls.length, 2);
  assert.equal(updateCalls[1].patch.status, "dead_letter");
  assert.deepEqual(guardrailCalls, [
    {
      code: "BILLING_ORPHAN_CHECKOUT_SESSION_CLEANUP_FAILURE",
      measure: "count",
      value: 1
    },
    {
      code: "BILLING_OUTBOX_DEAD_LETTER",
      measure: "attempt_count",
      value: 8
    }
  ]);
});

test("outbox worker retry path fails closed when lease is fenced during state patch", async () => {
  const guardrailCalls = [];
  const service = createWorkerFixture({
    updateOutboxJobByLease(params) {
      if (Object.keys(params.patch || {}).length < 1) {
        return {
          id: 81,
          leaseVersion: 5,
          jobType: "expire_checkout_session",
          payloadJson: {
            providerCheckoutSessionId: "cs_orphan_lease"
          },
          attemptCount: 0
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
      service.retryOrDeadLetter({
        jobId: 81,
        leaseVersion: 5,
        error: new Error("retry race"),
        now: new Date("2026-02-21T13:30:00.000Z")
      }),
    (error) => Number(error?.statusCode || 0) === 409 && String(error?.code || "") === "BILLING_OUTBOX_LEASE_FENCED"
  );

  assert.deepEqual(guardrailCalls, [
    {
      code: "BILLING_ORPHAN_CHECKOUT_SESSION_CLEANUP_FAILURE",
      measure: "count",
      value: 1
    },
    {
      code: "BILLING_OUTBOX_LEASE_FENCED",
      measure: "count",
      value: 1
    }
  ]);
});
