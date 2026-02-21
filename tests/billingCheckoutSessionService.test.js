import assert from "node:assert/strict";
import test from "node:test";

import { createService as createCheckoutSessionService } from "../server/modules/billing/checkoutSession.service.js";

function createRepositoryWithRow(initialRow) {
  const state = {
    row: {
      ...initialRow
    }
  };

  function cloneRow() {
    return state.row ? { ...state.row } : null;
  }

  return {
    state,
    async upsertCheckoutSessionByOperationKey(payload) {
      state.row = {
        ...(state.row || {}),
        ...payload
      };
      return cloneRow();
    },
    async findCheckoutSessionByProviderOperationKey({ operationKey }) {
      if (!state.row) {
        return null;
      }

      return String(state.row.operationKey || "") === String(operationKey || "") ? cloneRow() : null;
    },
    async findCheckoutSessionByProviderSessionId({ providerCheckoutSessionId }) {
      if (!state.row) {
        return null;
      }

      return String(state.row.providerCheckoutSessionId || "") === String(providerCheckoutSessionId || "")
        ? cloneRow()
        : null;
    },
    async listCheckoutSessionsForEntity() {
      return state.row ? [cloneRow()] : [];
    },
    async lockCheckoutSessionsForEntity() {
      return state.row ? [cloneRow()] : [];
    },
    async updateCheckoutSessionById(id, patch) {
      if (!state.row || Number(state.row.id) !== Number(id)) {
        return null;
      }

      state.row = {
        ...state.row,
        ...patch
      };

      return cloneRow();
    }
  };
}

test("checkout session service expires session by operation key fallback when provider session id is newly discovered", async () => {
  const repository = createRepositoryWithRow({
    id: 1,
    billableEntityId: 25,
    provider: "stripe",
    providerCheckoutSessionId: null,
    idempotencyRowId: 7,
    operationKey: "op_checkout_1",
    status: "open",
    expiresAt: null,
    lastProviderEventCreatedAt: null,
    lastProviderEventId: null
  });

  const service = createCheckoutSessionService({
    billingRepository: repository
  });

  const updated = await service.markCheckoutSessionExpiredOrAbandoned({
    providerCheckoutSessionId: "cs_live_123",
    operationKey: "op_checkout_1",
    reason: "expired",
    providerEventCreatedAt: new Date("2026-02-20T06:00:00.000Z"),
    providerEventId: "evt_123",
    provider: "stripe"
  });

  assert.equal(updated.status, "expired");
  assert.equal(updated.providerCheckoutSessionId, "cs_live_123");
  assert.equal(updated.lastProviderEventId, "evt_123");
});

test("checkout session recovery hold updates never shorten an existing hold expiry", async () => {
  const repository = createRepositoryWithRow({
    id: 2,
    billableEntityId: 25,
    provider: "stripe",
    providerCheckoutSessionId: null,
    idempotencyRowId: 8,
    operationKey: "op_checkout_2",
    status: "recovery_verification_pending",
    expiresAt: new Date("2026-02-20T10:00:00.000Z"),
    lastProviderEventCreatedAt: null,
    lastProviderEventId: null
  });

  const service = createCheckoutSessionService({
    billingRepository: repository
  });

  const updated = await service.markCheckoutSessionRecoveryVerificationPending({
    operationKey: "op_checkout_2",
    idempotencyRowId: 8,
    holdExpiresAt: new Date("2026-02-20T09:00:00.000Z"),
    providerEventCreatedAt: new Date("2026-02-20T08:30:00.000Z"),
    providerEventId: "evt_456",
    billableEntityId: 25,
    provider: "stripe"
  });

  assert.equal(new Date(updated.expiresAt).toISOString(), "2026-02-20T10:00:00.000Z");
  assert.equal(updated.lastProviderEventId, "evt_456");
});

test("checkout session service preserves terminal lifecycle state during blocking upsert attempts", async () => {
  const repository = createRepositoryWithRow({
    id: 3,
    billableEntityId: 44,
    provider: "stripe",
    providerCheckoutSessionId: "cs_terminal",
    idempotencyRowId: 9,
    operationKey: "op_terminal_1",
    providerCustomerId: "cus_terminal",
    status: "completed_reconciled",
    expiresAt: null,
    lastProviderEventCreatedAt: null,
    lastProviderEventId: null
  });

  const service = createCheckoutSessionService({
    billingRepository: repository
  });

  const result = await service.upsertBlockingCheckoutSession({
    billableEntityId: 44,
    provider: "stripe",
    providerCheckoutSessionId: "cs_terminal",
    idempotencyRowId: 9,
    operationKey: "op_terminal_1",
    providerCustomerId: "cus_terminal",
    status: "open",
    checkoutUrl: "https://stripe.example/checkout/cs_terminal",
    expiresAt: new Date("2026-02-20T12:00:00.000Z")
  });

  assert.equal(result.status, "completed_reconciled");
  assert.equal(repository.state.row.status, "completed_reconciled");
});

test("checkout session completion projection persists provider customer correlation", async () => {
  const repository = createRepositoryWithRow({
    id: 4,
    billableEntityId: 55,
    provider: "stripe",
    providerCheckoutSessionId: "cs_customer_link",
    idempotencyRowId: 11,
    operationKey: "op_customer_link",
    providerCustomerId: null,
    providerSubscriptionId: null,
    status: "open",
    expiresAt: null,
    lastProviderEventCreatedAt: null,
    lastProviderEventId: null
  });

  const service = createCheckoutSessionService({
    billingRepository: repository
  });

  const updated = await service.markCheckoutSessionCompletedPendingSubscription({
    providerCheckoutSessionId: "cs_customer_link",
    operationKey: "op_customer_link",
    providerCustomerId: "cus_456",
    providerSubscriptionId: "sub_789",
    providerEventCreatedAt: new Date("2026-02-20T07:00:00.000Z"),
    providerEventId: "evt_customer_link",
    billableEntityId: 55,
    provider: "stripe"
  });

  assert.equal(updated.status, "completed_pending_subscription");
  assert.equal(updated.providerCustomerId, "cus_456");
});

test("checkout session service ignores one_off checkout flows when resolving blocking sessions", async () => {
  const repository = createRepositoryWithRow({
    id: 5,
    billableEntityId: 61,
    provider: "stripe",
    providerCheckoutSessionId: "cs_one_off_open",
    idempotencyRowId: 19,
    operationKey: "op_one_off_open",
    providerCustomerId: "cus_one_off",
    providerSubscriptionId: null,
    status: "open",
    expiresAt: new Date("2026-02-20T12:00:00.000Z"),
    metadataJson: {
      checkout_flow: "one_off"
    },
    lastProviderEventCreatedAt: null,
    lastProviderEventId: null
  });

  const service = createCheckoutSessionService({
    billingRepository: repository
  });

  const blocking = await service.getBlockingCheckoutSession({
    billableEntityId: 61,
    now: new Date("2026-02-20T11:30:00.000Z")
  });

  assert.equal(blocking, null);
});
