import assert from "node:assert/strict";
import test from "node:test";

import { createService as createBillingService } from "../server/modules/billing/service.js";

function createPhase21Service(overrides = {}) {
  const trxToken = overrides.trxToken || { id: "trx_token" };

  return createBillingService({
    billingRepository: {
      async transaction(action) {
        return action(trxToken);
      },
      async ensureBillableEntity() {
        return {
          id: 7
        };
      },
      async findCurrentSubscriptionForEntity() {
        return null;
      },
      async findPlanById(planId) {
        const numericPlanId = Number(planId);
        if (!Number.isFinite(numericPlanId) || numericPlanId <= 0) {
          return null;
        }
        return {
          id: numericPlanId
        };
      },
      async listEntitlementDefinitions() {
        return [];
      },
      async findEntitlementDefinitionByCode() {
        return null;
      },
      async findEntitlementBalance() {
        return null;
      },
      async recomputeEntitlementBalance() {
        return {
          balance: null
        };
      },
      ...overrides.billingRepository
    },
    billingPolicyService: {
      async resolveBillableEntityForReadRequest() {
        return {
          billableEntity: {
            id: 7
          }
        };
      },
      async resolveBillableEntityForWriteRequest() {
        return {
          billableEntity: {
            id: 7
          }
        };
      },
      ...overrides.billingPolicyService
    },
    billingPricingService: {
      async resolvePhase1SellablePrice() {
        return null;
      },
      ...overrides.billingPricingService
    },
    billingIdempotencyService: {
      ...overrides.billingIdempotencyService
    },
    billingCheckoutOrchestrator: {
      async startCheckout() {
        return {
          ok: true
        };
      },
      ...overrides.billingCheckoutOrchestrator
    },
    billingProviderAdapter: {
      async createBillingPortalSession() {
        return {
          id: "bps_1",
          url: "https://billing.stripe.test/portal"
        };
      },
      async listCustomerPaymentMethods() {
        return {
          paymentMethods: [],
          defaultPaymentMethodId: null
        };
      },
      ...overrides.billingProviderAdapter
    },
    billingRealtimePublishService: {
      async publishWorkspaceBillingLimitsUpdated() {
        return null;
      },
      ...overrides.billingRealtimePublishService
    },
    appPublicUrl: "https://app.example.test",
    providerReplayWindowSeconds: 60 * 60,
    observabilityService: overrides.observabilityService || null
  });
}

test("phase 2.1 getLimitations returns projection-backed limitation rows", async () => {
  const now = new Date("2026-02-21T12:34:56.000Z");
  let recomputeCalls = 0;
  const service = createPhase21Service({
    billingRepository: {
      async listEntitlementDefinitions(query) {
        assert.equal(query.includeInactive, false);
        assert.equal(query.codes, null);
        return [
          {
            id: 71,
            code: "annuity.calculations.monthly",
            entitlementType: "metered_quota",
            enforcementMode: "hard_deny",
            unit: "calculation",
            windowInterval: "month",
            windowAnchor: "calendar_utc"
          }
        ];
      },
      async recomputeEntitlementBalance(payload) {
        recomputeCalls += 1;
        assert.equal(payload.subjectType, "billable_entity");
        assert.equal(payload.subjectId, 7);
        assert.equal(payload.entitlementDefinitionId, 71);
        assert.equal(payload.now.toISOString(), now.toISOString());
        return {
          balance: {
            grantedAmount: 10,
            consumedAmount: 3,
            effectiveAmount: 7,
            hardLimitAmount: 10,
            overLimit: false,
            lockState: "none",
            nextChangeAt: "2026-03-01T00:00:00.000Z",
            windowStartAt: "2026-02-01T00:00:00.000Z",
            windowEndAt: "2026-03-01T00:00:00.000Z",
            lastRecomputedAt: now.toISOString()
          }
        };
      }
    }
  });

  const response = await service.getLimitations({
    request: {
      headers: {}
    },
    user: {
      id: 12
    },
    now
  });

  assert.equal(recomputeCalls, 1);
  assert.equal(response.billableEntity.id, 7);
  assert.equal(response.generatedAt, now.toISOString());
  assert.equal(response.stale, false);
  assert.equal(response.limitations.length, 1);

  const limitation = response.limitations[0];
  assert.equal(limitation.code, "annuity.calculations.monthly");
  assert.equal(limitation.entitlementType, "metered_quota");
  assert.equal(limitation.enforcementMode, "hard_deny");
  assert.equal(limitation.unit, "calculation");
  assert.equal(limitation.windowInterval, "month");
  assert.equal(limitation.windowAnchor, "calendar_utc");
  assert.equal(limitation.grantedAmount, 10);
  assert.equal(limitation.consumedAmount, 3);
  assert.equal(limitation.effectiveAmount, 7);
  assert.equal(limitation.hardLimitAmount, 10);
  assert.equal(limitation.overLimit, false);
  assert.equal(limitation.lockState, "none");
  assert.equal(limitation.nextChangeAt, "2026-03-01T00:00:00.000Z");
  assert.equal(limitation.windowStartAt, "2026-02-01T00:00:00.000Z");
  assert.equal(limitation.windowEndAt, "2026-03-01T00:00:00.000Z");
  assert.equal(limitation.lastRecomputedAt, now.toISOString());
});

test("phase 2.1 getLimitations returns empty limitations when definitions are missing", async () => {
  const now = new Date("2026-02-21T12:35:00.000Z");
  const service = createPhase21Service({
    billingRepository: {
      async listEntitlementDefinitions() {
        return [];
      }
    }
  });

  const response = await service.getLimitations({
    request: {
      headers: {}
    },
    user: {
      id: 12
    },
    now
  });

  assert.equal(response.billableEntity.id, 7);
  assert.equal(response.generatedAt, now.toISOString());
  assert.equal(response.stale, false);
  assert.deepEqual(response.limitations, []);
});

test("phase 2.1 executeWithEntitlementConsumption rejects exhausted metered quota deterministically", async () => {
  let actionCalls = 0;
  const service = createPhase21Service({
    billingRepository: {
      async listEntitlementDefinitions(query) {
        assert.deepEqual(query.codes, ["annuity.calculations.monthly"]);
        return [
          {
            id: 71,
            code: "annuity.calculations.monthly",
            entitlementType: "metered_quota",
            enforcementMode: "hard_deny",
            unit: "calculation",
            windowInterval: "month",
            windowAnchor: "calendar_utc"
          }
        ];
      },
      async recomputeEntitlementBalance() {
        return {
          balance: {
            grantedAmount: 5,
            consumedAmount: 5,
            effectiveAmount: 0,
            hardLimitAmount: 5,
            overLimit: true,
            lockState: "none",
            nextChangeAt: "2026-03-01T00:00:00.000Z",
            windowStartAt: "2026-02-01T00:00:00.000Z",
            windowEndAt: "2026-03-01T00:00:00.000Z",
            lastRecomputedAt: "2026-02-21T12:36:00.000Z"
          }
        };
      }
    }
  });

  await assert.rejects(
    () =>
      service.executeWithEntitlementConsumption({
        request: {
          headers: {}
        },
        user: {
          id: 12
        },
        capability: "annuity.calculate",
        action: async () => {
          actionCalls += 1;
          return {
            ok: true
          };
        },
        now: new Date("2026-02-21T12:36:00.000Z")
      }),
    (error) =>
      Number(error?.statusCode) === 429 &&
      String(error?.code || "") === "BILLING_LIMIT_EXCEEDED" &&
      String(error?.details?.limitationCode || "") === "annuity.calculations.monthly" &&
      Number(error?.details?.remaining) === 0
  );

  assert.equal(actionCalls, 0);
});

test("phase 2.1 executeWithEntitlementConsumption consumes once and publishes post-commit", async () => {
  const now = new Date("2026-02-21T12:37:00.000Z");
  const actionCalls = [];
  const insertCalls = [];
  const realtimeCalls = [];
  let recomputeCalls = 0;
  const trxToken = { id: "trx_42" };
  const service = createPhase21Service({
    trxToken,
    billingRepository: {
      async listEntitlementDefinitions(query, options) {
        assert.deepEqual(query.codes, ["annuity.calculations.monthly"]);
        assert.equal(options.trx, trxToken);
        return [
          {
            id: 71,
            code: "annuity.calculations.monthly",
            entitlementType: "metered_quota",
            enforcementMode: "hard_deny",
            unit: "calculation",
            windowInterval: "month",
            windowAnchor: "calendar_utc"
          }
        ];
      },
      async findEntitlementDefinitionByCode(code, options) {
        assert.equal(code, "annuity.calculations.monthly");
        assert.equal(options.trx, trxToken);
        return {
          id: 71,
          code: "annuity.calculations.monthly"
        };
      },
      async insertEntitlementConsumption(payload, options) {
        insertCalls.push({
          payload,
          options
        });
        return {
          inserted: true,
          consumption: {
            id: 501
          }
        };
      },
      async recomputeEntitlementBalance(payload) {
        recomputeCalls += 1;
        assert.equal(payload.subjectId, 7);
        if (recomputeCalls === 1) {
          return {
            balance: {
              grantedAmount: 5,
              consumedAmount: 0,
              effectiveAmount: 5,
              hardLimitAmount: 5,
              overLimit: false,
              lockState: "none",
              nextChangeAt: "2026-03-01T00:00:00.000Z",
              windowStartAt: "2026-02-01T00:00:00.000Z",
              windowEndAt: "2026-03-01T00:00:00.000Z",
              lastRecomputedAt: now.toISOString()
            }
          };
        }
        return {
          balance: {
            grantedAmount: 5,
            consumedAmount: 1,
            effectiveAmount: 4,
            hardLimitAmount: 5,
            overLimit: false,
            lockState: "none",
            nextChangeAt: "2026-03-01T00:00:00.000Z",
            windowStartAt: "2026-02-01T00:00:00.000Z",
            windowEndAt: "2026-03-01T00:00:00.000Z",
            lastRecomputedAt: now.toISOString()
          }
        };
      }
    },
    billingRealtimePublishService: {
      async publishWorkspaceBillingLimitsUpdated(payload) {
        realtimeCalls.push(payload);
      }
    }
  });

  const response = await service.executeWithEntitlementConsumption({
    request: {
      headers: {
        "x-command-id": "cmd_123",
        "x-client-id": "client_abc"
      }
    },
    user: {
      id: 12
    },
    capability: "annuity.calculate",
    usageEventKey: "usage_evt_1",
    now,
    action: async ({ trx, limitation }) => {
      actionCalls.push({
        trx,
        limitation
      });
      return {
        ok: true
      };
    }
  });

  assert.deepEqual(response, { ok: true });
  assert.equal(actionCalls.length, 1);
  assert.equal(actionCalls[0].trx, trxToken);
  assert.equal(actionCalls[0].limitation.code, "annuity.calculations.monthly");
  assert.equal(insertCalls.length, 1);
  assert.equal(insertCalls[0].options.trx, trxToken);
  assert.equal(insertCalls[0].payload.reasonCode, "annuity.calculate");
  assert.equal(insertCalls[0].payload.dedupeKey, "usage:7:71:usage_evt_1");
  assert.equal(realtimeCalls.length, 1);
  assert.equal(realtimeCalls[0].billableEntityId, 7);
  assert.deepEqual(realtimeCalls[0].changedCodes, ["annuity.calculations.monthly"]);
  assert.equal(realtimeCalls[0].changeSource, "consumption");
  assert.equal(realtimeCalls[0].commandId, "cmd_123");
  assert.equal(realtimeCalls[0].sourceClientId, "client_abc");
  assert.equal(realtimeCalls[0].actorUserId, 12);
});

test("phase 2.1 syncPaymentMethods upserts methods and records sync event", async () => {
  const upsertCalls = [];
  const deactivateCalls = [];
  const syncEvents = [];
  const now = new Date("2026-02-21T13:00:00.000Z");

  const service = createPhase21Service({
    billingRepository: {
      async findCustomerByEntityProvider({ billableEntityId, provider }) {
        assert.equal(billableEntityId, 7);
        assert.equal(provider, "stripe");
        return {
          id: 99,
          providerCustomerId: "cus_123"
        };
      },
      async upsertPaymentMethod(payload) {
        upsertCalls.push(payload);
      },
      async deactivateMissingPaymentMethods(payload) {
        deactivateCalls.push(payload);
      },
      async insertPaymentMethodSyncEvent(payload) {
        syncEvents.push(payload);
      },
      async listPaymentMethodsForEntity() {
        return [
          {
            id: 1,
            billableEntityId: 7,
            billingCustomerId: 99,
            provider: "stripe",
            providerPaymentMethodId: "pm_2",
            type: "card",
            brand: "visa",
            last4: "4242",
            expMonth: 12,
            expYear: 2030,
            isDefault: true,
            status: "active",
            lastProviderSyncedAt: now.toISOString(),
            metadataJson: {},
            createdAt: now.toISOString(),
            updatedAt: now.toISOString()
          }
        ];
      }
    },
    billingProviderAdapter: {
      async listCustomerPaymentMethods({ customerId }) {
        assert.equal(customerId, "cus_123");
        return {
          defaultPaymentMethodId: "pm_2",
          paymentMethods: [
            {
              id: "pm_1",
              type: "card",
              card: {
                brand: "mastercard",
                last4: "4444",
                exp_month: 10,
                exp_year: 2031
              }
            },
            {
              id: "pm_2",
              type: "card",
              card: {
                brand: "visa",
                last4: "4242",
                exp_month: 12,
                exp_year: 2030
              }
            }
          ]
        };
      }
    }
  });

  const response = await service.syncPaymentMethods({
    request: {
      headers: {}
    },
    user: {
      id: 12
    },
    now
  });

  assert.equal(response.syncStatus, "succeeded");
  assert.equal(response.fetchedCount, 2);
  assert.equal(response.paymentMethods.length, 1);
  assert.equal(upsertCalls.length, 2);
  assert.equal(upsertCalls[1].providerPaymentMethodId, "pm_2");
  assert.equal(upsertCalls[1].isDefault, true);
  assert.equal(deactivateCalls.length, 1);
  assert.deepEqual(deactivateCalls[0].keepProviderPaymentMethodIds.sort(), ["pm_1", "pm_2"]);
  assert.equal(syncEvents.length, 1);
  assert.equal(syncEvents[0].status, "succeeded");
});

test("phase 2.1 syncPaymentMethods does not detach methods when provider list is paginated", async () => {
  const deactivateCalls = [];
  const service = createPhase21Service({
    billingRepository: {
      async findCustomerByEntityProvider() {
        return {
          id: 99,
          providerCustomerId: "cus_123"
        };
      },
      async upsertPaymentMethod() {
        return null;
      },
      async deactivateMissingPaymentMethods(payload) {
        deactivateCalls.push(payload);
      },
      async insertPaymentMethodSyncEvent() {
        return null;
      },
      async listPaymentMethodsForEntity() {
        return [];
      }
    },
    billingProviderAdapter: {
      async listCustomerPaymentMethods() {
        return {
          defaultPaymentMethodId: "pm_2",
          hasMore: true,
          paymentMethods: [
            {
              id: "pm_2",
              type: "card",
              card: {
                brand: "visa",
                last4: "4242",
                exp_month: 12,
                exp_year: 2030
              }
            }
          ]
        };
      }
    }
  });

  await service.syncPaymentMethods({
    request: {
      headers: {}
    },
    user: {
      id: 12
    }
  });

  assert.equal(deactivateCalls.length, 0);
});

test("phase 2.2 listTimeline returns paged workspace-friendly activity entries", async () => {
  const repositoryCalls = [];
  const service = createPhase21Service({
    billingRepository: {
      async listBillingActivityEvents(payload) {
        repositoryCalls.push(payload);
        return [
          {
            id: "payment:12",
            source: "payment",
            sourceId: 12,
            status: "succeeded",
            provider: "stripe",
            operationKey: null,
            providerEventId: "evt_1",
            message: null,
            occurredAt: "2026-02-21T10:00:00.000Z"
          },
          {
            id: "idempotency:4",
            source: "idempotency",
            sourceId: 4,
            status: "failed",
            provider: "stripe",
            operationKey: "op_77",
            providerEventId: null,
            message: "Provider timeout",
            occurredAt: "2026-02-21T09:00:00.000Z"
          },
          {
            id: "checkout_session:3",
            source: "checkout_session",
            sourceId: 3,
            status: "open",
            provider: "stripe",
            operationKey: "op_88",
            providerEventId: null,
            message: null,
            occurredAt: "2026-02-21T08:00:00.000Z"
          }
        ];
      }
    }
  });

  const response = await service.listTimeline({
    request: { headers: {} },
    user: { id: 12 },
    query: {
      page: 1,
      pageSize: 2,
      source: "payment"
    }
  });

  assert.equal(repositoryCalls.length, 1);
  assert.equal(repositoryCalls[0].billableEntityId, 7);
  assert.equal(repositoryCalls[0].source, "payment");
  assert.equal(repositoryCalls[0].includeGlobal, false);
  assert.equal(repositoryCalls[0].limit, 3);
  assert.equal(response.entries.length, 2);
  assert.equal(response.entries[0].title, "Payment Succeeded");
  assert.equal(response.entries[1].title, "Request Failed");
  assert.equal(response.entries[1].description, "Provider timeout");
  assert.equal(response.hasMore, true);
});

test("phase 2.2 listTimeline does not cap deep-page fetch limit at 2000", async () => {
  const repositoryCalls = [];
  const service = createPhase21Service({
    billingRepository: {
      async listBillingActivityEvents(payload) {
        repositoryCalls.push(payload);
        return [];
      }
    }
  });

  await service.listTimeline({
    request: { headers: {} },
    user: { id: 12 },
    query: {
      page: 101,
      pageSize: 20
    }
  });

  assert.equal(repositoryCalls.length, 1);
  assert.equal(repositoryCalls[0].limit, 2021);
});
