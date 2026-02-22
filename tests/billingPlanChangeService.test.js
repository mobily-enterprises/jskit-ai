import assert from "node:assert/strict";
import test from "node:test";

import { createService as createBillingService } from "../server/modules/billing/service.js";

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString();
}

function createFixture(overrides = {}) {
  const now = new Date("2026-02-22T10:00:00.000Z");
  const activePlans =
    overrides.plans || [
      {
        id: 1,
        code: "free",
        name: "Free",
        description: "Free plan",
        appliesTo: "workspace",
        isActive: true,
        corePrice: {
          provider: "stripe",
          providerPriceId: "price_free",
          providerProductId: "prod_free",
          interval: "month",
          intervalCount: 1,
          currency: "USD",
          unitAmountMinor: 0
        }
      },
      {
        id: 2,
        code: "basic",
        name: "Basic",
        description: "Basic plan",
        appliesTo: "workspace",
        isActive: true,
        corePrice: {
          provider: "stripe",
          providerPriceId: "price_basic",
          providerProductId: "prod_basic",
          interval: "month",
          intervalCount: 1,
          currency: "USD",
          unitAmountMinor: 1000
        }
      },
      {
        id: 3,
        code: "pro",
        name: "Pro",
        description: "Pro plan",
        appliesTo: "workspace",
        isActive: true,
        corePrice: {
          provider: "stripe",
          providerPriceId: "price_pro",
          providerProductId: "prod_pro",
          interval: "month",
          intervalCount: 1,
          currency: "USD",
          unitAmountMinor: 5000
        }
      }
    ];

  let currentSubscription = overrides.currentSubscription || null;
  let currentAssignment = overrides.currentAssignment || null;
  let pendingSchedule = overrides.pendingSchedule || null;
  const historyEntries = Array.isArray(overrides.historyEntries) ? [...overrides.historyEntries] : [];
  const updateSubscriptionCalls = [];
  const checkoutCalls = [];

  const billingRepository = {
    async transaction(work) {
      return work({});
    },
    async listPlans() {
      return activePlans;
    },
    async findPlanById(id) {
      return activePlans.find((entry) => Number(entry.id) === Number(id)) || null;
    },
    async findCurrentSubscriptionForEntity() {
      return currentSubscription;
    },
    async findCurrentPlanAssignmentForEntity() {
      return currentAssignment;
    },
    async listPaymentMethodsForEntity() {
      return overrides.paymentMethods || [];
    },
    async replacePendingPlanChangeSchedule(payload) {
      pendingSchedule = {
        id: 81,
        billableEntityId: Number(payload.billableEntityId),
        fromPlanId: payload.fromPlanId == null ? null : Number(payload.fromPlanId),
        targetPlanId: Number(payload.targetPlanId),
        changeKind: String(payload.changeKind || "downgrade"),
        effectiveAt: toIso(payload.effectiveAt),
        status: "pending"
      };
      return pendingSchedule;
    },
    async findPendingPlanChangeScheduleForEntity() {
      return pendingSchedule;
    },
    async cancelPendingPlanChangeScheduleForEntity() {
      if (!pendingSchedule) {
        return null;
      }
      const canceled = {
        ...pendingSchedule,
        status: "canceled"
      };
      pendingSchedule = null;
      return canceled;
    },
    async listPlanChangeHistoryForEntity() {
      return [...historyEntries].reverse();
    },
    async insertPlanChangeHistory(payload) {
      const entry = {
        id: historyEntries.length + 1,
        billableEntityId: Number(payload.billableEntityId),
        fromPlanId: payload.fromPlanId == null ? null : Number(payload.fromPlanId),
        toPlanId: Number(payload.toPlanId),
        changeKind: String(payload.changeKind || ""),
        effectiveAt: toIso(payload.effectiveAt)
      };
      historyEntries.push(entry);
      return entry;
    },
    async upsertSubscription(payload) {
      currentSubscription = {
        ...(currentSubscription || {
          id: 90,
          billableEntityId: Number(payload.billableEntityId),
          billingCustomerId: Number(payload.billingCustomerId),
          provider: String(payload.provider || "stripe"),
          providerSubscriptionId: String(payload.providerSubscriptionId || "sub_test"),
          providerSubscriptionCreatedAt: toIso(payload.providerSubscriptionCreatedAt || now)
        }),
        planId: Number(payload.planId),
        status: String(payload.status || "active"),
        currentPeriodEnd: toIso(payload.currentPeriodEnd || now),
        trialEnd: payload.trialEnd ? toIso(payload.trialEnd) : null,
        canceledAt: payload.canceledAt ? toIso(payload.canceledAt) : null,
        cancelAtPeriodEnd: Boolean(payload.cancelAtPeriodEnd),
        endedAt: payload.endedAt ? toIso(payload.endedAt) : null,
        isCurrent: payload.isCurrent !== false,
        metadataJson: payload.metadataJson || {}
      };
      return currentSubscription;
    },
    async insertPlanAssignment(payload) {
      currentAssignment = {
        id: 52,
        billableEntityId: Number(payload.billableEntityId),
        planId: Number(payload.planId),
        source: String(payload.source || "internal"),
        periodStartAt: toIso(payload.periodStartAt || now),
        periodEndAt: toIso(payload.periodEndAt || now),
        isCurrent: payload.isCurrent !== false
      };
      return currentAssignment;
    },
    async updatePlanChangeScheduleById(id, patch = {}) {
      if (!pendingSchedule || Number(pendingSchedule.id) !== Number(id)) {
        return null;
      }

      pendingSchedule = {
        ...pendingSchedule,
        ...patch,
        effectiveAt: patch.effectiveAt ? toIso(patch.effectiveAt) : pendingSchedule.effectiveAt,
        appliedAt: patch.appliedAt ? toIso(patch.appliedAt) : pendingSchedule.appliedAt || null
      };
      return pendingSchedule;
    }
  };

  const service = createBillingService({
    billingRepository,
    billingPolicyService: {
      async resolveBillableEntityForReadRequest() {
        return {
          billableEntity: {
            id: 41,
            workspaceId: 7,
            ownerUserId: 8
          }
        };
      },
      async resolveBillableEntityForWriteRequest() {
        return {
          billableEntity: {
            id: 41,
            workspaceId: 7,
            ownerUserId: 8
          }
        };
      }
    },
    billingPricingService: {
      deploymentCurrency: "USD",
      async resolvePhase1SellablePrice() {
        return null;
      }
    },
    billingIdempotencyService: {
      async claimOrReplay() {
        return {
          type: "replay_succeeded",
          row: {
            responseJson: {}
          }
        };
      }
    },
    billingCheckoutOrchestrator: {
      async startCheckout(payload) {
        checkoutCalls.push(payload);
        return {
          checkoutSession: {
            checkoutUrl: "https://checkout.example.test/session"
          }
        };
      }
    },
    billingProviderAdapter: {
      provider: "stripe",
      async createBillingPortalSession() {
        return {
          id: "bps_test",
          url: "https://billing.example.test"
        };
      },
      async updateSubscriptionPlan(payload) {
        updateSubscriptionCalls.push(payload);
        return {
          id: "sub_test",
          status: "active",
          current_period_end: Math.floor((now.getTime() + 20 * 24 * 60 * 60 * 1000) / 1000),
          trial_end: null,
          canceled_at: null,
          ended_at: null,
          cancel_at_period_end: false,
          created: Math.floor(now.getTime() / 1000),
          metadata: {}
        };
      },
      ...overrides.billingProviderAdapter
    },
    consoleSettingsRepository: {
      async ensure() {
        return {
          features: {
            billing: {
              paidPlanChangePaymentMethodPolicy: overrides.paymentPolicy || "required_now"
            }
          }
        };
      }
    },
    appPublicUrl: "https://app.example.test"
  });

  return {
    now,
    service,
    historyEntries,
    getCurrentSubscription: () => currentSubscription,
    getPendingSchedule: () => pendingSchedule,
    updateSubscriptionCalls,
    checkoutCalls
  };
}

test("billing plan change service returns plan state with current plan and available targets", async () => {
  const fixture = createFixture({
    currentSubscription: {
      id: 11,
      billableEntityId: 41,
      planId: 2,
      billingCustomerId: 91,
      provider: "stripe",
      providerSubscriptionId: "sub_current",
      status: "active",
      providerSubscriptionCreatedAt: "2026-01-01T00:00:00.000Z",
      currentPeriodEnd: "2026-03-01T00:00:00.000Z",
      trialEnd: null,
      canceledAt: null,
      cancelAtPeriodEnd: false,
      endedAt: null,
      isCurrent: true,
      metadataJson: {}
    }
  });

  const response = await fixture.service.getPlanState({
    request: {},
    user: {
      id: 8
    },
    now: fixture.now
  });

  assert.equal(response.currentPlan.code, "basic");
  assert.equal(response.availablePlans.some((entry) => entry.code === "basic"), false);
  assert.equal(response.availablePlans.some((entry) => entry.code === "pro"), true);
});

test("billing plan change service schedules downgrades at current period end", async () => {
  const fixture = createFixture({
    currentSubscription: {
      id: 11,
      billableEntityId: 41,
      planId: 3,
      billingCustomerId: 91,
      provider: "stripe",
      providerSubscriptionId: "sub_current",
      status: "active",
      providerSubscriptionCreatedAt: "2026-01-01T00:00:00.000Z",
      currentPeriodEnd: "2026-03-01T00:00:00.000Z",
      trialEnd: null,
      canceledAt: null,
      cancelAtPeriodEnd: false,
      endedAt: null,
      isCurrent: true,
      metadataJson: {}
    }
  });

  const response = await fixture.service.requestPlanChange({
    request: {},
    user: {
      id: 8
    },
    payload: {
      planCode: "basic"
    },
    now: fixture.now
  });

  assert.equal(response.mode, "scheduled");
  assert.equal(fixture.getPendingSchedule()?.targetPlanId, 2);
});

test("billing plan change service applies upgrades immediately with provider subscription update", async () => {
  const fixture = createFixture({
    currentSubscription: {
      id: 11,
      billableEntityId: 41,
      planId: 2,
      billingCustomerId: 91,
      provider: "stripe",
      providerSubscriptionId: "sub_current",
      status: "active",
      providerSubscriptionCreatedAt: "2026-01-01T00:00:00.000Z",
      currentPeriodEnd: "2026-03-01T00:00:00.000Z",
      trialEnd: null,
      canceledAt: null,
      cancelAtPeriodEnd: false,
      endedAt: null,
      isCurrent: true,
      metadataJson: {}
    },
    paymentMethods: [
      {
        id: 1,
        isDefault: true
      }
    ]
  });

  const response = await fixture.service.requestPlanChange({
    request: {},
    user: {
      id: 8
    },
    payload: {
      planCode: "pro"
    },
    now: fixture.now
  });

  assert.equal(response.mode, "applied");
  assert.equal(fixture.updateSubscriptionCalls.length, 1);
  assert.equal(fixture.updateSubscriptionCalls[0].providerPriceId, "price_pro");
  assert.equal(fixture.getCurrentSubscription()?.planId, 3);
  assert.equal(fixture.historyEntries.length, 1);
  assert.equal(fixture.historyEntries[0].changeKind, "upgrade_immediate");
});

test("billing plan change service requires checkout for paid target without active subscription", async () => {
  const fixture = createFixture({
    currentSubscription: null,
    paymentPolicy: "allow_without_payment_method"
  });

  const response = await fixture.service.requestPlanChange({
    request: {},
    user: {
      id: 8
    },
    payload: {
      planCode: "pro",
      successPath: "/admin/w/acme/billing?checkout=success",
      cancelPath: "/admin/w/acme/billing?checkout=cancel"
    },
    clientIdempotencyKey: "idem_123",
    now: fixture.now
  });

  assert.equal(response.mode, "checkout_required");
  assert.equal(fixture.checkoutCalls.length, 1);
});

test("billing plan change service cancels pending scheduled downgrade", async () => {
  const fixture = createFixture({
    currentSubscription: {
      id: 11,
      billableEntityId: 41,
      planId: 3,
      billingCustomerId: 91,
      provider: "stripe",
      providerSubscriptionId: "sub_current",
      status: "active",
      providerSubscriptionCreatedAt: "2026-01-01T00:00:00.000Z",
      currentPeriodEnd: "2026-03-01T00:00:00.000Z",
      trialEnd: null,
      canceledAt: null,
      cancelAtPeriodEnd: false,
      endedAt: null,
      isCurrent: true,
      metadataJson: {}
    },
    pendingSchedule: {
      id: 81,
      billableEntityId: 41,
      fromPlanId: 3,
      targetPlanId: 2,
      changeKind: "downgrade",
      effectiveAt: "2026-03-01T00:00:00.000Z",
      status: "pending"
    }
  });

  const response = await fixture.service.cancelPendingPlanChange({
    request: {},
    user: {
      id: 8
    },
    now: fixture.now
  });

  assert.equal(response.canceled, true);
  assert.equal(fixture.getPendingSchedule(), null);
});
