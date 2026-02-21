import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../server/lib/errors.js";
import { createService as createConsoleService } from "../server/domain/console/services/console.service.js";

function createConsoleServiceHarness({
  billingRepository,
  billingEnabled = true,
  billingProvider = "stripe",
  billingProviderAdapter = null
} = {}) {
  const activeMembership = {
    userId: 1,
    roleId: "devop",
    status: "active"
  };

  return createConsoleService({
    consoleMembershipsRepository: {
      async transaction(work) {
        return work(null);
      },
      async findByUserId(userId) {
        return Number(userId) === 1 ? activeMembership : null;
      },
      async countActiveMembers() {
        return 1;
      },
      async findActiveByRoleId() {
        return activeMembership;
      }
    },
    consoleInvitesRepository: {
      async transaction(work) {
        return work(null);
      },
      async listPendingByEmail() {
        return [];
      }
    },
    consoleRootRepository: {
      async findRootUserId() {
        return 1;
      },
      async assignRootUserIdIfUnset() {
        return 1;
      }
    },
    consoleSettingsRepository: {},
    userProfilesRepository: {},
    billingRepository,
    billingEnabled,
    billingProvider,
    billingProviderAdapter
  });
}

test("console billing events list does not cap deep-page fetch limit at 2000", async () => {
  const repositoryCalls = [];
  const service = createConsoleServiceHarness({
    billingRepository: {
      async listBillingActivityEvents(payload) {
        repositoryCalls.push(payload);
        return [];
      }
    }
  });

  const response = await service.listBillingEvents(
    {
      id: 1,
      email: "devop@example.test"
    },
    {
      page: 26,
      pageSize: 100,
      operationKey: "op_1"
    }
  );

  assert.equal(repositoryCalls.length, 1);
  assert.equal(repositoryCalls[0].limit, 2601);
  assert.equal(repositoryCalls[0].includeGlobal, true);
  assert.equal(repositoryCalls[0].operationKey, "op_1");
  assert.equal(response.entries.length, 0);
  assert.equal(response.hasMore, false);
});

test("console billing plans list returns catalog entries for active provider", async () => {
  const service = createConsoleServiceHarness({
    billingRepository: {
      async listPlans() {
        return [
          {
            id: 11,
            code: "pro_monthly",
            planFamilyCode: "pro",
            version: 1,
            name: "Pro Monthly",
            description: null,
            appliesTo: "workspace",
            pricingModel: "flat",
            isActive: true,
            metadataJson: {},
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
          }
        ];
      },
      async listPlanPricesForPlan(planId, provider) {
        assert.equal(planId, 11);
        assert.equal(provider, "stripe");
        return [
          {
            id: 21,
            planId: 11,
            provider: "stripe",
            billingComponent: "base",
            usageType: "licensed",
            interval: "month",
            intervalCount: 1,
            currency: "USD",
            unitAmountMinor: 4900,
            providerProductId: "prod_pro",
            providerPriceId: "price_pro_monthly",
            isActive: true,
            metadataJson: {},
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
          }
        ];
      },
      async listPlanEntitlementsForPlan(planId) {
        assert.equal(planId, 11);
        return [];
      },
      async transaction(work) {
        return work(null);
      },
      async createPlan() {
        throw new Error("not used");
      },
      async createPlanPrice() {
        throw new Error("not used");
      },
      async upsertPlanEntitlement() {
        throw new Error("not used");
      }
    }
  });

  const response = await service.listBillingPlans({
    id: 1,
    email: "devop@example.test"
  });
  assert.equal(response.provider, "stripe");
  assert.equal(response.plans.length, 1);
  assert.equal(response.plans[0].prices.length, 1);
});

test("console billing plan create inserts plan and base price", async () => {
  const calls = [];
  const service = createConsoleServiceHarness({
    billingProviderAdapter: {
      async retrievePrice({ priceId }) {
        assert.equal(priceId, "price_pro_monthly");
        return {
          id: "price_pro_monthly",
          provider: "stripe",
          productId: "prod_from_stripe",
          productName: "Pro",
          nickname: null,
          currency: "USD",
          unitAmountMinor: 9900,
          interval: "month",
          intervalCount: 1,
          usageType: "licensed",
          active: true
        };
      }
    },
    billingRepository: {
      async transaction(work) {
        return work("trx-1");
      },
      async listPlans() {
        return [];
      },
      async listPlanPricesForPlan(planId, provider, options = {}) {
        calls.push(["listPlanPricesForPlan", planId, provider, options.trx]);
        return [
          {
            id: 41,
            planId,
            provider,
            billingComponent: "base",
            usageType: "licensed",
            interval: "month",
            intervalCount: 1,
            currency: "USD",
            unitAmountMinor: 4900,
            providerProductId: "prod_pro",
            providerPriceId: "price_pro_monthly",
            isActive: true,
            metadataJson: {},
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
          }
        ];
      },
      async listPlanEntitlementsForPlan(planId, options = {}) {
        calls.push(["listPlanEntitlementsForPlan", planId, options.trx]);
        return [];
      },
      async createPlan(payload, options = {}) {
        calls.push(["createPlan", payload.code, payload.planFamilyCode, options.trx]);
        return {
          id: 31,
          code: payload.code,
          planFamilyCode: payload.planFamilyCode,
          version: payload.version,
          name: payload.name,
          description: payload.description || null,
          appliesTo: payload.appliesTo,
          pricingModel: payload.pricingModel,
          isActive: payload.isActive !== false,
          metadataJson: {},
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        };
      },
      async createPlanPrice(payload, options = {}) {
        calls.push([
          "createPlanPrice",
          payload.planId,
          payload.providerPriceId,
          payload.providerProductId,
          payload.currency,
          payload.unitAmountMinor,
          payload.interval,
          payload.intervalCount,
          options.trx
        ]);
        return {
          id: 41,
          ...payload,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        };
      },
      async upsertPlanEntitlement(payload, options = {}) {
        calls.push(["upsertPlanEntitlement", payload.code, options.trx]);
        return {
          id: 51,
          ...payload,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        };
      }
    }
  });

  const response = await service.createBillingPlan(
    {
      id: 1,
      email: "devop@example.test"
    },
        {
          code: "pro_monthly",
          name: "Pro Monthly",
          basePrice: {
            providerPriceId: "price_pro_monthly"
          }
        }
      );

  assert.equal(response.provider, "stripe");
  assert.equal(response.plan.code, "pro_monthly");
  assert.equal(calls.some((entry) => entry[0] === "createPlan"), true);
  const createPlanPriceCall = calls.find((entry) => entry[0] === "createPlanPrice");
  assert.ok(createPlanPriceCall);
  assert.equal(createPlanPriceCall[2], "price_pro_monthly");
  assert.equal(createPlanPriceCall[3], "prod_from_stripe");
  assert.equal(createPlanPriceCall[4], "USD");
  assert.equal(createPlanPriceCall[5], 9900);
  assert.equal(createPlanPriceCall[6], "month");
  assert.equal(createPlanPriceCall[7], 1);
});

test("console billing plan create rejects non-stripe provider price id format", async () => {
  const service = createConsoleServiceHarness({
    billingRepository: {
      async transaction(work) {
        return work("trx-1");
      },
      async listPlans() {
        return [];
      },
      async listPlanPricesForPlan() {
        return [];
      },
      async listPlanEntitlementsForPlan() {
        return [];
      },
      async createPlan() {
        throw new Error("not used");
      },
      async createPlanPrice() {
        throw new Error("not used");
      },
      async upsertPlanEntitlement() {
        throw new Error("not used");
      }
    },
    billingProvider: "stripe"
  });

  await assert.rejects(
    () =>
      service.createBillingPlan(
        {
          id: 1,
          email: "devop@example.test"
        },
        {
          code: "pro_monthly",
          name: "Pro Monthly",
          basePrice: {
            providerPriceId: "10",
            currency: "USD",
            unitAmountMinor: 4900
          }
        }
      ),
    (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.status, 400);
      assert.equal(
        String(error?.details?.fieldErrors?.["basePrice.providerPriceId"] || "").toLowerCase().includes("stripe price id"),
        true
      );
      return true;
    }
  );
});

test("console billing provider prices list delegates to provider adapter", async () => {
  const service = createConsoleServiceHarness({
    billingRepository: {
      async listPlans() {
        return [];
      },
      async listPlanPricesForPlan() {
        return [];
      },
      async listPlanEntitlementsForPlan() {
        return [];
      },
      async transaction(work) {
        return work(null);
      },
      async createPlan() {
        throw new Error("not used");
      },
      async createPlanPrice() {
        throw new Error("not used");
      },
      async upsertPlanEntitlement() {
        throw new Error("not used");
      }
    },
    billingProviderAdapter: {
      async listPrices(payload) {
        assert.equal(payload.limit, 25);
        assert.equal(payload.active, true);
        return [
          {
            id: "price_123",
            provider: "stripe",
            productId: "prod_123",
            productName: "Starter",
            nickname: null,
            currency: "USD",
            unitAmountMinor: 4900,
            interval: "month",
            intervalCount: 1,
            usageType: "licensed",
            active: true
          }
        ];
      }
    }
  });

  const response = await service.listBillingProviderPrices(
    {
      id: 1,
      email: "devop@example.test"
    },
    {
      limit: 25,
      active: true
    }
  );

  assert.equal(response.provider, "stripe");
  assert.equal(response.prices.length, 1);
  assert.equal(response.prices[0].id, "price_123");
});

test("console billing plan price update edits existing price mapping", async () => {
  const calls = [];
  const service = createConsoleServiceHarness({
    billingProviderAdapter: {
      async retrievePrice({ priceId }) {
        assert.equal(priceId, "price_new");
        return {
          id: "price_new",
          provider: "stripe",
          productId: "prod_from_stripe_new",
          productName: "Pro v2",
          nickname: null,
          currency: "USD",
          unitAmountMinor: 14900,
          interval: "month",
          intervalCount: 1,
          usageType: "licensed",
          active: true
        };
      }
    },
    billingRepository: {
      async transaction(work) {
        return work("trx-1");
      },
      async findPlanById(planId, options = {}) {
        calls.push(["findPlanById", planId, options.trx]);
        return {
          id: 11,
          code: "pro_monthly",
          planFamilyCode: "pro",
          version: 1,
          name: "Pro Monthly",
          description: null,
          appliesTo: "workspace",
          pricingModel: "flat",
          isActive: true,
          metadataJson: {},
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        };
      },
      async listPlanPricesForPlan(planId, provider, options = {}) {
        calls.push(["listPlanPricesForPlan", planId, provider, options.trx]);
        return [
          {
            id: 21,
            planId,
            provider,
            billingComponent: "base",
            usageType: "licensed",
            interval: "month",
            intervalCount: 1,
            currency: "USD",
            unitAmountMinor: 4900,
            providerProductId: "prod_pro",
            providerPriceId: "price_old",
            isActive: true,
            metadataJson: {},
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
          }
        ];
      },
      async updatePlanPriceById(priceId, patch, options = {}) {
        calls.push([
          "updatePlanPriceById",
          priceId,
          patch.providerPriceId,
          patch.providerProductId,
          patch.currency,
          patch.unitAmountMinor,
          patch.interval,
          patch.intervalCount,
          options.trx
        ]);
        return {
          id: priceId,
          providerPriceId: patch.providerPriceId
        };
      },
      async listPlanEntitlementsForPlan(planId, options = {}) {
        calls.push(["listPlanEntitlementsForPlan", planId, options.trx]);
        return [];
      },
      async listPlans() {
        return [];
      },
      async createPlan() {
        throw new Error("not used");
      },
      async createPlanPrice() {
        throw new Error("not used");
      },
      async upsertPlanEntitlement() {
        throw new Error("not used");
      }
    }
  });

  const response = await service.updateBillingPlanPrice(
    {
      id: 1,
      email: "devop@example.test"
    },
    {
      planId: 11,
      priceId: 21
    },
    {
      providerPriceId: "price_new"
    }
  );

  assert.equal(response.provider, "stripe");
  assert.equal(response.plan.id, 11);
  const updateCall = calls.find((entry) => entry[0] === "updatePlanPriceById");
  assert.ok(updateCall);
  assert.equal(updateCall[2], "price_new");
  assert.equal(updateCall[3], "prod_from_stripe_new");
  assert.equal(updateCall[4], "USD");
  assert.equal(updateCall[5], 14900);
  assert.equal(updateCall[6], "month");
  assert.equal(updateCall[7], 1);
});
