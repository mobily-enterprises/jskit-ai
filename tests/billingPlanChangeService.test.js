import assert from "node:assert/strict";
import test from "node:test";

import { createService as createBillingService } from "../server/modules/billing/service.js";

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString();
}

function createFixture(overrides = {}) {
  const now = new Date("2026-02-22T10:00:00.000Z");
  function addDays(reference, days) {
    return new Date(new Date(reference).getTime() + days * 24 * 60 * 60 * 1000);
  }
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
  let currentAssignment =
    overrides.currentAssignment ||
    (currentSubscription
      ? {
          id: 52,
          billableEntityId: Number(currentSubscription.billableEntityId || 41),
          planId: Number(currentSubscription.planId),
          source: "internal",
          status: "current",
          periodStartAt: toIso(currentSubscription.providerSubscriptionCreatedAt || now),
          periodEndAt: toIso(currentSubscription.currentPeriodEnd || addDays(now, 30)),
          metadataJson: {}
        }
      : null);
  let nextAssignment = overrides.nextAssignment || null;
  const historyEntries = Array.isArray(overrides.historyEntries) ? [...overrides.historyEntries] : [];
  const updateSubscriptionCalls = [];
  const cancelSubscriptionCalls = [];
  const setSubscriptionCancelAtPeriodEndCalls = [];
  const checkoutCalls = [];
  const providerDetailsByAssignmentId = new Map();

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
    async findUpcomingPlanAssignmentForEntity() {
      return nextAssignment && nextAssignment.status === "upcoming" ? nextAssignment : null;
    },
    async findPlanAssignmentById(id) {
      if (currentAssignment && Number(currentAssignment.id) === Number(id)) {
        return currentAssignment;
      }
      if (nextAssignment && Number(nextAssignment.id) === Number(id)) {
        return nextAssignment;
      }
      return null;
    },
    async updatePlanAssignmentById(id, patch = {}) {
      function applyPatch(assignment) {
        if (!assignment || Number(assignment.id) !== Number(id)) {
          return assignment;
        }
        return {
          ...assignment,
          ...(Object.hasOwn(patch, "planId") ? { planId: Number(patch.planId) } : {}),
          ...(Object.hasOwn(patch, "source") ? { source: String(patch.source || "") } : {}),
          ...(Object.hasOwn(patch, "status") ? { status: String(patch.status || "") } : {}),
          ...(Object.hasOwn(patch, "periodStartAt") ? { periodStartAt: toIso(patch.periodStartAt) } : {}),
          ...(Object.hasOwn(patch, "periodEndAt")
            ? { periodEndAt: patch.periodEndAt == null ? null : toIso(patch.periodEndAt) }
            : {}),
          ...(Object.hasOwn(patch, "metadataJson") ? { metadataJson: patch.metadataJson || {} } : {})
        };
      }

      currentAssignment = applyPatch(currentAssignment);
      nextAssignment = applyPatch(nextAssignment);
      if (nextAssignment && nextAssignment.status === "current") {
        currentAssignment = nextAssignment;
      }
      if (currentAssignment && Number(currentAssignment.id) === Number(id)) {
        return currentAssignment;
      }
      return nextAssignment;
    },
    async listPaymentMethodsForEntity() {
      return overrides.paymentMethods || [];
    },
    async replaceUpcomingPlanAssignmentForEntity(payload) {
      nextAssignment = {
        id: 81,
        billableEntityId: Number(payload.billableEntityId),
        planId: Number(payload.targetPlanId),
        source: String(payload.changeKind || "manual") === "promo_fallback" ? "promo" : "manual",
        status: "upcoming",
        periodStartAt: toIso(payload.effectiveAt),
        periodEndAt:
          Object.hasOwn(payload, "periodEndAt") && payload.periodEndAt == null
            ? null
            : toIso(payload.periodEndAt || addDays(payload.effectiveAt || now, 30)),
        metadataJson: payload.metadataJson || {}
      };
      return nextAssignment;
    },
    async cancelUpcomingPlanAssignmentForEntity() {
      if (!nextAssignment) {
        return null;
      }
      const canceled = {
        ...nextAssignment,
        status: "canceled"
      };
      nextAssignment = null;
      return canceled;
    },
    async listDueUpcomingPlanAssignments({ periodStartAtOrBefore }) {
      if (!nextAssignment || nextAssignment.status !== "upcoming") {
        return [];
      }
      if (new Date(nextAssignment.periodStartAt).getTime() > new Date(periodStartAtOrBefore).getTime()) {
        return [];
      }
      return [nextAssignment];
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
    async findSubscriptionByProviderSubscriptionId() {
      return currentSubscription;
    },
    async insertPlanAssignment(payload) {
      const assignment = {
        id: String(payload.status || "") === "upcoming" ? 81 : 52,
        billableEntityId: Number(payload.billableEntityId),
        planId: Number(payload.planId),
        source: String(payload.source || "internal"),
        status: String(payload.status || (payload.isCurrent === false ? "past" : "current")),
        periodStartAt: toIso(payload.periodStartAt || now),
        periodEndAt:
          Object.hasOwn(payload, "periodEndAt") && payload.periodEndAt == null ? null : toIso(payload.periodEndAt || now),
        metadataJson: payload.metadataJson || {}
      };
      if (assignment.status === "upcoming") {
        nextAssignment = assignment;
        return nextAssignment;
      }
      currentAssignment = assignment;
      return currentAssignment;
    },
    async upsertPlanAssignmentProviderDetails(payload) {
      providerDetailsByAssignmentId.set(Number(payload.billingPlanAssignmentId), { ...payload });
      if (currentSubscription && currentAssignment && Number(currentAssignment.id) === Number(payload.billingPlanAssignmentId)) {
        currentSubscription = {
          ...currentSubscription,
          planId: Number(currentAssignment.planId),
          status: String(payload.providerStatus || currentSubscription.status || "active"),
          currentPeriodEnd: payload.currentPeriodEnd ? toIso(payload.currentPeriodEnd) : currentSubscription.currentPeriodEnd,
          trialEnd: payload.trialEnd ? toIso(payload.trialEnd) : currentSubscription.trialEnd,
          canceledAt: payload.canceledAt ? toIso(payload.canceledAt) : currentSubscription.canceledAt,
          cancelAtPeriodEnd: Boolean(payload.cancelAtPeriodEnd),
          endedAt: payload.endedAt ? toIso(payload.endedAt) : currentSubscription.endedAt,
          metadataJson: payload.metadataJson || currentSubscription.metadataJson || {}
        };
      }
      return payload;
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
      async cancelSubscription(payload) {
        cancelSubscriptionCalls.push(payload);
        return {
          id: String(payload.subscriptionId || "sub_test"),
          status: payload.cancelAtPeriodEnd ? "active" : "canceled",
          current_period_end: Math.floor((now.getTime() + 20 * 24 * 60 * 60 * 1000) / 1000),
          trial_end: null,
          canceled_at: payload.cancelAtPeriodEnd ? null : Math.floor(now.getTime() / 1000),
          ended_at: payload.cancelAtPeriodEnd ? null : Math.floor(now.getTime() / 1000),
          cancel_at_period_end: Boolean(payload.cancelAtPeriodEnd),
          created: Math.floor(now.getTime() / 1000),
          customer: "cus_test",
          metadata: {}
        };
      },
      async setSubscriptionCancelAtPeriodEnd(payload) {
        setSubscriptionCancelAtPeriodEndCalls.push(payload);
        return {
          id: String(payload.subscriptionId || "sub_test"),
          status: "active",
          current_period_end: Math.floor((now.getTime() + 20 * 24 * 60 * 60 * 1000) / 1000),
          trial_end: null,
          canceled_at: null,
          ended_at: null,
          cancel_at_period_end: Boolean(payload.cancelAtPeriodEnd),
          created: Math.floor(now.getTime() / 1000),
          customer: "cus_test",
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
    getCurrentAssignment: () => currentAssignment,
    getNextAssignment: () => nextAssignment,
    getProviderDetailsByAssignmentId: () => new Map(providerDetailsByAssignmentId),
    updateSubscriptionCalls,
    cancelSubscriptionCalls,
    setSubscriptionCancelAtPeriodEndCalls,
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
  assert.equal(response.currentPeriodEndAt, "2026-03-01T00:00:00.000Z");
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
  assert.equal(fixture.getNextAssignment()?.planId, 2);
  assert.equal(fixture.getNextAssignment()?.status, "upcoming");
});

test("billing plan change service schedules free downgrade by toggling provider cancel_at_period_end first", async () => {
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
      planCode: "free"
    },
    now: fixture.now
  });

  assert.equal(response.mode, "scheduled");
  assert.equal(fixture.cancelSubscriptionCalls.length, 1);
  assert.equal(fixture.cancelSubscriptionCalls[0].subscriptionId, "sub_current");
  assert.equal(fixture.cancelSubscriptionCalls[0].cancelAtPeriodEnd, true);
  assert.equal(fixture.setSubscriptionCancelAtPeriodEndCalls.length, 0);
  assert.equal(fixture.getNextAssignment()?.planId, 1);
  assert.equal(fixture.getNextAssignment()?.status, "upcoming");
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
  assert.equal(fixture.getCurrentAssignment()?.planId, 3);
  assert.equal(fixture.historyEntries.length, 1);
  assert.equal(fixture.historyEntries[0].changeKind, "upgrade_immediate");
});

test("billing plan change service allows lateral paid plan change without default payment method", async () => {
  const fixture = createFixture({
    plans: [
      {
        id: 1,
        code: "free",
        name: "Free",
        description: "Free plan",
        appliesTo: "workspace",
        isActive: true,
        corePrice: null
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
        id: 4,
        code: "team",
        name: "Team",
        description: "Team plan",
        appliesTo: "workspace",
        isActive: true,
        corePrice: {
          provider: "stripe",
          providerPriceId: "price_team",
          providerProductId: "prod_team",
          interval: "month",
          intervalCount: 1,
          currency: "USD",
          unitAmountMinor: 1000
        }
      }
    ],
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
    paymentMethods: []
  });

  const response = await fixture.service.requestPlanChange({
    request: {},
    user: {
      id: 8
    },
    payload: {
      planCode: "team"
    },
    now: fixture.now
  });

  assert.equal(response.mode, "applied");
  assert.equal(fixture.updateSubscriptionCalls.length, 1);
  assert.equal(fixture.updateSubscriptionCalls[0].providerPriceId, "price_team");
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
    nextAssignment: {
      id: 81,
      billableEntityId: 41,
      planId: 2,
      source: "manual",
      status: "upcoming",
      periodStartAt: "2026-03-01T00:00:00.000Z",
      periodEndAt: "2026-03-31T00:00:00.000Z",
      metadataJson: {
        changeKind: "downgrade"
      }
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
  assert.equal(fixture.getNextAssignment(), null);
});

test("billing plan change service reinstates provider renewal before canceling pending free downgrade", async () => {
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
      cancelAtPeriodEnd: true,
      endedAt: null,
      isCurrent: true,
      metadataJson: {}
    },
    nextAssignment: {
      id: 81,
      billableEntityId: 41,
      planId: 1,
      source: "manual",
      status: "upcoming",
      periodStartAt: "2026-03-01T00:00:00.000Z",
      periodEndAt: null,
      metadataJson: {
        changeKind: "downgrade"
      }
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
  assert.equal(fixture.setSubscriptionCancelAtPeriodEndCalls.length, 1);
  assert.equal(fixture.setSubscriptionCancelAtPeriodEndCalls[0].subscriptionId, "sub_current");
  assert.equal(fixture.setSubscriptionCancelAtPeriodEndCalls[0].cancelAtPeriodEnd, false);
  assert.equal(fixture.getNextAssignment(), null);
});

test("billing plan change service promotes due upcoming assignment at boundary", async () => {
  const fixture = createFixture({
    currentSubscription: {
      id: 11,
      billableEntityId: 41,
      planId: 3,
      billingCustomerId: 91,
      provider: "stripe",
      providerCustomerId: "cus_91",
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
    nextAssignment: {
      id: 81,
      billableEntityId: 41,
      planId: 2,
      source: "manual",
      status: "upcoming",
      periodStartAt: "2026-02-22T09:00:00.000Z",
      periodEndAt: "2026-03-22T09:00:00.000Z",
      metadataJson: {
        changeKind: "downgrade"
      }
    }
  });

  const result = await fixture.service.processDuePlanChanges({
    now: fixture.now,
    limit: 10
  });

  assert.equal(result.scannedCount, 1);
  assert.equal(result.appliedCount, 1);
  assert.equal(fixture.getCurrentAssignment()?.id, 81);
  assert.equal(fixture.getCurrentAssignment()?.status, "current");
});

test("billing plan change service applies free plan immediately without checkout when no current plan exists", async () => {
  const fixture = createFixture({
    currentSubscription: null,
    currentAssignment: null
  });

  const response = await fixture.service.requestPlanChange({
    request: {},
    user: {
      id: 8
    },
    payload: {
      planCode: "free"
    },
    now: fixture.now
  });

  assert.equal(response.mode, "applied");
  assert.equal(fixture.checkoutCalls.length, 0);
  assert.equal(fixture.getCurrentAssignment()?.planId, 1);
  assert.equal(fixture.getCurrentAssignment()?.periodEndAt, null);
});

test("billing plan change service returns no expiry for current free assignment", async () => {
  const fixture = createFixture({
    currentSubscription: null,
    currentAssignment: {
      id: 52,
      billableEntityId: 41,
      planId: 1,
      source: "internal",
      status: "current",
      periodStartAt: "2026-02-20T00:00:00.000Z",
      periodEndAt: null,
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

  assert.equal(response.currentPlan?.code, "free");
  assert.equal(response.currentPeriodEndAt, null);
});
