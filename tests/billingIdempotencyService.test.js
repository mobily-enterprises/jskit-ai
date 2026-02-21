import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../server/lib/errors.js";
import { BILLING_FAILURE_CODES } from "../server/modules/billing/constants.js";
import { createService as createBillingIdempotencyService } from "../server/modules/billing/idempotency.service.js";

function createRepository(overrides = {}) {
  return {
    async transaction(work) {
      return work({});
    },
    async findIdempotencyByEntityActionClientKey() {
      return null;
    },
    async findIdempotencyById() {
      return null;
    },
    async findPendingCheckoutIdempotencyForEntity() {
      return null;
    },
    async insertIdempotency() {
      throw new Error("not implemented");
    },
    async updateIdempotencyById() {
      return null;
    },
    async listPendingIdempotencyRows() {
      return [];
    },
    ...overrides
  };
}

function createServiceWithRepository(billingRepository) {
  return createBillingIdempotencyService({
    billingRepository,
    operationKeySecret: "op_secret",
    providerIdempotencyKeySecret: "provider_secret"
  });
}

test("recoverPendingRequest does not steal an active pending lease", async () => {
  const now = new Date("2026-02-20T12:00:00.000Z");
  const activeLeaseRow = {
    id: 17,
    status: "pending",
    leaseVersion: 4,
    recoveryAttemptCount: 2,
    pendingLeaseExpiresAt: new Date(now.getTime() + 60_000).toISOString()
  };

  let updateCalls = 0;
  const service = createServiceWithRepository(
    createRepository({
      async findIdempotencyById() {
        return {
          ...activeLeaseRow
        };
      },
      async updateIdempotencyById() {
        updateCalls += 1;
        return null;
      }
    })
  );

  const result = await service.recoverPendingRequest({
    idempotencyRowId: activeLeaseRow.id,
    leaseOwner: "recovery:worker-a",
    now
  });

  assert.equal(result.type, "lease_active");
  assert.equal(result.row.id, activeLeaseRow.id);
  assert.equal(updateCalls, 0);
});

test("claimOrReplay classifies same-key insert race as in_progress_same_key", async () => {
  const now = new Date("2026-02-20T12:30:00.000Z");
  const requestFingerprintHash = "fp_same_key";

  const pendingRow = {
    id: 45,
    status: "pending",
    action: "checkout",
    billableEntityId: 200,
    clientIdempotencyKey: "idem_same_key",
    requestFingerprintHash,
    pendingLeaseExpiresAt: new Date(now.getTime() + 120_000).toISOString()
  };

  let keyLookupCount = 0;
  let pendingCheckoutLookupCount = 0;
  const service = createServiceWithRepository(
    createRepository({
      async findIdempotencyByEntityActionClientKey() {
        keyLookupCount += 1;
        if (keyLookupCount === 1) {
          return null;
        }
        return {
          ...pendingRow
        };
      },
      async insertIdempotency() {
        const error = new Error("duplicate key");
        error.code = "ER_DUP_ENTRY";
        throw error;
      },
      async findPendingCheckoutIdempotencyForEntity() {
        pendingCheckoutLookupCount += 1;
        return null;
      }
    })
  );

  const result = await service.claimOrReplay({
    action: "checkout",
    billableEntityId: 200,
    clientIdempotencyKey: "idem_same_key",
    requestFingerprintHash,
    normalizedRequestJson: {
      action: "checkout",
      billableEntityId: 200
    },
    provider: "stripe",
    now
  });

  assert.equal(result.type, "in_progress_same_key");
  assert.equal(result.row.id, pendingRow.id);
  assert.equal(pendingCheckoutLookupCount, 1);
});

test("claimOrReplay supports payment_link action claims", async () => {
  const now = new Date("2026-02-20T13:00:00.000Z");
  const insertedRows = [];
  const service = createServiceWithRepository(
    createRepository({
      async insertIdempotency(payload) {
        insertedRows.push(payload);
        return {
          id: 700,
          status: "pending",
          action: payload.action,
          billableEntityId: payload.billableEntityId,
          clientIdempotencyKey: payload.clientIdempotencyKey,
          requestFingerprintHash: payload.requestFingerprintHash,
          operationKey: payload.operationKey,
          providerIdempotencyKey: payload.providerIdempotencyKey,
          pendingLeaseExpiresAt: payload.pendingLeaseExpiresAt?.toISOString?.() || payload.pendingLeaseExpiresAt,
          leaseVersion: payload.leaseVersion,
          recoveryAttemptCount: payload.recoveryAttemptCount
        };
      }
    })
  );

  const result = await service.claimOrReplay({
    action: "payment_link",
    billableEntityId: 300,
    clientIdempotencyKey: "idem_payment_link_1",
    requestFingerprintHash: "fp_payment_link_1",
    normalizedRequestJson: {
      action: "payment_link",
      billableEntityId: 300
    },
    provider: "stripe",
    now
  });

  assert.equal(result.type, "claimed");
  assert.equal(result.row.id, 700);
  assert.equal(insertedRows.length, 1);
  assert.equal(insertedRows[0].action, "payment_link");
});

test("claimOrReplay rejects fingerprint mismatches with idempotency_conflict", async () => {
  const now = new Date("2026-02-20T13:15:00.000Z");
  const service = createServiceWithRepository(
    createRepository({
      async findIdempotencyByEntityActionClientKey() {
        return {
          id: 801,
          status: "pending",
          action: "checkout",
          billableEntityId: 42,
          clientIdempotencyKey: "idem_conflict_1",
          requestFingerprintHash: "fp_original",
          pendingLeaseExpiresAt: new Date(now.getTime() + 120_000).toISOString()
        };
      }
    })
  );

  await assert.rejects(
    () =>
      service.claimOrReplay({
        action: "checkout",
        billableEntityId: 42,
        clientIdempotencyKey: "idem_conflict_1",
        requestFingerprintHash: "fp_different",
        normalizedRequestJson: {
          action: "checkout",
          billableEntityId: 42
        },
        provider: "stripe",
        now
      }),
    (error) =>
      error instanceof AppError &&
      Number(error.statusCode) === 409 &&
      String(error.code || "") === BILLING_FAILURE_CODES.IDEMPOTENCY_CONFLICT &&
      String(error.details?.code || "") === BILLING_FAILURE_CODES.IDEMPOTENCY_CONFLICT
  );
});

test("markFailed enforces lease fencing atomically using expected lease version", async () => {
  let updateOptions = null;
  const service = createServiceWithRepository(
    createRepository({
      async updateIdempotencyById(_id, _patch, options) {
        updateOptions = options;
        return null;
      },
      async findIdempotencyById() {
        return {
          id: 77,
          leaseVersion: 9,
          status: "pending"
        };
      }
    })
  );

  await assert.rejects(
    () =>
      service.markFailed({
        idempotencyRowId: 77,
        leaseVersion: 8,
        failureCode: BILLING_FAILURE_CODES.CHECKOUT_PROVIDER_ERROR,
        failureReason: "simulated failure"
      }),
    (error) =>
      error instanceof AppError &&
      Number(error.statusCode) === 409 &&
      String(error.code || "") === "BILLING_LEASE_FENCED"
  );

  assert.equal(Number(updateOptions?.expectedLeaseVersion || 0), 8);
});

test("assertReplayProvenanceCompatible records baseline drift guardrail before mismatch failure", () => {
  const guardrails = [];
  const service = createBillingIdempotencyService({
    billingRepository: createRepository(),
    operationKeySecret: "op_secret",
    providerIdempotencyKeySecret: "provider_secret",
    observabilityService: {
      recordBillingGuardrail(payload) {
        guardrails.push(payload);
      }
    }
  });

  assert.throws(
    () =>
      service.assertReplayProvenanceCompatible({
        idempotencyRow: {
          operationKey: "op_abc",
          billableEntityId: 42,
          providerApiVersion: "2024-06-20",
          providerSdkVersion: "14.25.0"
        },
        runtimeProviderSdkVersion: "15.0.0",
        runtimeProviderApiVersion: "2024-06-20"
      }),
    (error) =>
      error instanceof AppError &&
      Number(error.statusCode) === 409 &&
      String(error.code || "") === BILLING_FAILURE_CODES.CHECKOUT_REPLAY_PROVENANCE_MISMATCH
  );

  assert.deepEqual(guardrails, [
    {
      code: "BILLING_STRIPE_SDK_API_BASELINE_DRIFT",
      operationKey: "op_abc",
      billableEntityId: 42,
      measure: "count",
      value: 1
    },
    {
      code: "BILLING_CHECKOUT_REPLAY_PROVENANCE_MISMATCH",
      operationKey: "op_abc",
      billableEntityId: 42
    }
  ]);
});
