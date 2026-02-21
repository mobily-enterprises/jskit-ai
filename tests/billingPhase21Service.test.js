import assert from "node:assert/strict";
import test from "node:test";

import { createService as createBillingService } from "../server/modules/billing/service.js";

function createPhase21Service(overrides = {}) {
  return createBillingService({
    billingRepository: {
      async ensureBillableEntity() {
        return {
          id: 7
        };
      },
      async findCurrentSubscriptionForEntity() {
        return null;
      },
      async listPlanEntitlementsForPlan() {
        return [];
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
    stripeSdkService: {
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
      ...overrides.stripeSdkService
    },
    appPublicUrl: "https://app.example.test",
    providerReplayWindowSeconds: 60 * 60,
    observabilityService: overrides.observabilityService || null
  });
}

test("phase 2.1 getLimitations resolves quota windows and usage", async () => {
  const now = new Date("2026-02-21T12:34:56.000Z");
  const service = createPhase21Service({
    billingRepository: {
      async findCurrentSubscriptionForEntity(billableEntityId) {
        assert.equal(billableEntityId, 7);
        return {
          id: 21,
          billableEntityId: 7,
          planId: 101
        };
      },
      async listPlanEntitlementsForPlan(planId) {
        assert.equal(planId, 101);
        return [
          {
            id: 1,
            planId,
            code: "api_calls",
            schemaVersion: "entitlement.quota.v1",
            valueJson: {
              limit: 10,
              interval: "month",
              enforcement: "hard"
            }
          },
          {
            id: 2,
            planId,
            code: "priority_support",
            schemaVersion: "entitlement.boolean.v1",
            valueJson: {
              enabled: true
            }
          }
        ];
      },
      async findUsageCounter({ entitlementCode }) {
        if (entitlementCode === "api_calls") {
          return {
            usageCount: 3
          };
        }
        return null;
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
  assert.equal(response.subscription.id, 21);
  assert.equal(response.limitations.length, 2);

  const quota = response.limitations.find((entry) => entry.code === "api_calls");
  assert.ok(quota);
  assert.equal(quota.type, "quota");
  assert.equal(quota.quota.limit, 10);
  assert.equal(quota.quota.used, 3);
  assert.equal(quota.quota.remaining, 7);
  assert.equal(quota.quota.reached, false);
  assert.equal(quota.quota.exceeded, false);
  assert.equal(quota.quota.windowStartAt, "2026-02-01T00:00:00.000Z");
  assert.equal(quota.quota.windowEndAt, "2026-03-01T00:00:00.000Z");
});

test("phase 2.1 getLimitations returns null subscription and empty limitations when unsubscribed", async () => {
  const service = createPhase21Service();

  const response = await service.getLimitations({
    request: {
      headers: {}
    },
    user: {
      id: 12
    },
    now: new Date("2026-02-21T12:35:00.000Z")
  });

  assert.equal(response.billableEntity.id, 7);
  assert.equal(response.subscription, null);
  assert.deepEqual(response.limitations, []);
});

test("phase 2.1 getLimitations maps string_list and quota limitation shapes deterministically", async () => {
  const now = new Date("2026-02-21T12:36:00.000Z");
  const service = createPhase21Service({
    billingRepository: {
      async findCurrentSubscriptionForEntity() {
        return {
          id: 31,
          billableEntityId: 7,
          planId: 401
        };
      },
      async listPlanEntitlementsForPlan(planId) {
        assert.equal(planId, 401);
        return [
          {
            id: 1,
            planId,
            code: "allowed_models",
            schemaVersion: "entitlement.string_list.v1",
            valueJson: {
              values: ["gpt-5-mini", 42, true]
            }
          },
          {
            id: 2,
            planId,
            code: "api_calls",
            schemaVersion: "entitlement.quota.v1",
            valueJson: {
              limit: 2,
              interval: "week",
              enforcement: "soft"
            }
          }
        ];
      },
      async findUsageCounter({ entitlementCode }) {
        if (entitlementCode !== "api_calls") {
          return null;
        }
        return {
          usageCount: 4
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

  const stringList = response.limitations.find((entry) => entry.code === "allowed_models");
  assert.ok(stringList);
  assert.equal(stringList.type, "string_list");
  assert.deepEqual(stringList.values, ["gpt-5-mini", "42", "true"]);

  const quota = response.limitations.find((entry) => entry.code === "api_calls");
  assert.ok(quota);
  assert.equal(quota.type, "quota");
  assert.equal(quota.quota.interval, "week");
  assert.equal(quota.quota.enforcement, "soft");
  assert.equal(quota.quota.limit, 2);
  assert.equal(quota.quota.used, 4);
  assert.equal(quota.quota.remaining, 0);
  assert.equal(quota.quota.reached, true);
  assert.equal(quota.quota.exceeded, true);
  assert.equal(quota.quota.windowStartAt, "2026-02-16T00:00:00.000Z");
  assert.equal(quota.quota.windowEndAt, "2026-02-23T00:00:00.000Z");
});

test("phase 2.1 getLimitations fails closed on invalid entitlement schema payloads", async () => {
  const service = createPhase21Service({
    billingRepository: {
      async findCurrentSubscriptionForEntity() {
        return {
          id: 31,
          billableEntityId: 7,
          planId: 401
        };
      },
      async listPlanEntitlementsForPlan(planId) {
        assert.equal(planId, 401);
        return [
          {
            id: 1,
            planId,
            code: "api_calls",
            schemaVersion: "entitlement.quota.v1",
            valueJson: {
              limit: 10,
              interval: "month"
            }
          }
        ];
      }
    }
  });

  await assert.rejects(
    () =>
      service.getLimitations({
        request: {
          headers: {}
        },
        user: {
          id: 12
        },
        now: new Date("2026-02-21T12:37:00.000Z")
      }),
    (error) =>
      Number(error?.statusCode) === 500 &&
      String(error?.code || "") === "ENTITLEMENT_SCHEMA_INVALID" &&
      String(error?.details?.reason || "") === "invalid_payload"
  );
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
    stripeSdkService: {
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
    stripeSdkService: {
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

test("phase 2.1 recordUsage increments quota counter", async () => {
  const incrementCalls = [];
  const now = new Date("2026-02-21T14:30:00.000Z");
  const service = createPhase21Service({
    billingRepository: {
      async findCurrentSubscriptionForEntity() {
        return {
          id: 50,
          planId: 300
        };
      },
      async listPlanEntitlementsForPlan(planId) {
        assert.equal(planId, 300);
        return [
          {
            id: 1,
            planId,
            code: "api_calls",
            schemaVersion: "entitlement.quota.v1",
            valueJson: {
              limit: 5,
              interval: "day",
              enforcement: "hard"
            }
          }
        ];
      },
      async incrementUsageCounter(payload) {
        incrementCalls.push(payload);
        return {
          usageCount: 4
        };
      }
    }
  });

  const response = await service.recordUsage({
    billableEntityId: 7,
    entitlementCode: "api_calls",
    amount: 2,
    now
  });

  assert.equal(incrementCalls.length, 1);
  assert.equal(incrementCalls[0].amount, 2);
  assert.equal(response.limit, 5);
  assert.equal(response.used, 4);
  assert.equal(response.remaining, 1);
  assert.equal(response.reached, false);
  assert.equal(response.exceeded, false);
  assert.equal(response.windowStartAt, "2026-02-21T00:00:00.000Z");
  assert.equal(response.windowEndAt, "2026-02-22T00:00:00.000Z");
});

test("phase 2.1 enforceLimitAndRecordUsage blocks hard quota overage with deterministic payload", async () => {
  let actionCalls = 0;
  const service = createPhase21Service({
    billingRepository: {
      async findCurrentSubscriptionForEntity() {
        return {
          id: 50,
          planId: 300
        };
      },
      async listPlanEntitlementsForPlan() {
        return [
          {
            id: 1,
            planId: 300,
            code: "projects_created_monthly",
            schemaVersion: "entitlement.quota.v1",
            valueJson: {
              limit: 2,
              interval: "month",
              enforcement: "hard"
            }
          }
        ];
      },
      async findUsageCounter() {
        return {
          usageCount: 2
        };
      },
      async incrementUsageCounter() {
        throw new Error("incrementUsageCounter should not be called when quota check fails.");
      }
    }
  });

  await assert.rejects(
    () =>
      service.enforceLimitAndRecordUsage({
        request: { headers: {} },
        user: { id: 12 },
        capability: "projects.create",
        action: async () => {
          actionCalls += 1;
          return {
            ok: true
          };
        },
        now: new Date("2026-02-21T15:00:00.000Z")
      }),
    (error) =>
      Number(error?.statusCode) === 429 &&
      String(error?.code || "") === "BILLING_LIMIT_EXCEEDED" &&
      String(error?.details?.limitationCode || "") === "projects_created_monthly"
  );

  assert.equal(actionCalls, 0);
});

test("phase 2.1 enforceLimitAndRecordUsage increments usage on success and dedupes retries by usageEventKey", async () => {
  let usageCount = 0;
  const incrementCalls = [];
  const usageEventClaims = [];
  const service = createPhase21Service({
    billingRepository: {
      async findCurrentSubscriptionForEntity() {
        return {
          id: 50,
          planId: 300
        };
      },
      async listPlanEntitlementsForPlan() {
        return [
          {
            id: 1,
            planId: 300,
            code: "projects_created_monthly",
            schemaVersion: "entitlement.quota.v1",
            valueJson: {
              limit: 20,
              interval: "month",
              enforcement: "hard"
            }
          }
        ];
      },
      async findUsageCounter() {
        return {
          usageCount
        };
      },
      async claimUsageEvent(payload) {
        usageEventClaims.push(payload.usageEventKey);
        return {
          claimed: usageEventClaims.length === 1
        };
      },
      async incrementUsageCounter(payload) {
        incrementCalls.push(payload);
        usageCount += Number(payload.amount || 0);
        return {
          usageCount
        };
      }
    }
  });

  const actionCalls = [];
  const first = await service.enforceLimitAndRecordUsage({
    request: { headers: {} },
    user: { id: 12 },
    capability: "projects.create",
    usageEventKey: "usage_evt_1",
    action: async () => {
      actionCalls.push("first");
      return {
        ok: true,
        marker: "first"
      };
    },
    now: new Date("2026-02-21T15:10:00.000Z")
  });
  const second = await service.enforceLimitAndRecordUsage({
    request: { headers: {} },
    user: { id: 12 },
    capability: "projects.create",
    usageEventKey: "usage_evt_1",
    action: async () => {
      actionCalls.push("second");
      return {
        ok: true,
        marker: "second"
      };
    },
    now: new Date("2026-02-21T15:11:00.000Z")
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(actionCalls, ["first", "second"]);
  assert.deepEqual(usageEventClaims, ["usage_evt_1", "usage_evt_1"]);
  assert.equal(incrementCalls.length, 1);
  assert.equal(incrementCalls[0].entitlementCode, "projects_created_monthly");
  assert.equal(usageCount, 1);
});

test("phase 2.1 enforceLimitAndRecordUsage allows action when limitation is not configured by default", async () => {
  const service = createPhase21Service({
    billingRepository: {
      async findCurrentSubscriptionForEntity() {
        return {
          id: 50,
          planId: 300
        };
      },
      async listPlanEntitlementsForPlan() {
        return [];
      },
      async incrementUsageCounter() {
        throw new Error("incrementUsageCounter should not be called when limitation is missing and allow behavior is used.");
      }
    }
  });

  const response = await service.enforceLimitAndRecordUsage({
    request: { headers: {} },
    user: { id: 12 },
    capability: "projects.create",
    action: async () => ({ ok: true })
  });

  assert.deepEqual(response, { ok: true });
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

  const response = await service.listTimeline({
    request: { headers: {} },
    user: { id: 12 },
    query: {
      page: 30,
      pageSize: 100
    }
  });

  assert.equal(repositoryCalls.length, 1);
  assert.equal(repositoryCalls[0].limit, 3001);
  assert.equal(response.entries.length, 0);
  assert.equal(response.hasMore, false);
});
