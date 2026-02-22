import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../server/lib/errors.js";
import { createService as createConsoleService } from "../server/domain/console/services/console.service.js";

function createBillingRepositoryStub(overrides = {}) {
  return {
    async transaction(work) {
      return work(null);
    },
    async listBillingActivityEvents() {
      return [];
    },
    async listPlans() {
      return [];
    },
    async listProducts() {
      return [];
    },
    async findPlanById() {
      return null;
    },
    async findProductById() {
      return null;
    },
    async listPlanEntitlementsForPlan() {
      return [];
    },
    async createPlan() {
      throw new Error("not used");
    },
    async updatePlanById() {
      throw new Error("not used");
    },
    async createProduct() {
      throw new Error("not used");
    },
    async updateProductById() {
      throw new Error("not used");
    },
    async upsertPlanEntitlement() {
      throw new Error("not used");
    },
    ...overrides
  };
}

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
    consoleSettingsRepository: {
      async ensure() {
        return {
          features: {}
        };
      },
      async update(patch = {}) {
        return {
          features: patch?.features || {}
        };
      }
    },
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
    billingRepository: createBillingRepositoryStub({
      async listBillingActivityEvents(payload) {
        repositoryCalls.push(payload);
        return [];
      }
    })
  });

  const response = await service.listBillingEvents(
    {
      id: 1,
      email: "devop@example.test"
    },
    {
      page: 26,
      pageSize: 100,
      workspaceSlug: "acme",
      operationKey: "op_1"
    }
  );

  assert.equal(repositoryCalls.length, 1);
  assert.equal(repositoryCalls[0].limit, 2601);
  assert.equal(repositoryCalls[0].includeGlobal, true);
  assert.equal(repositoryCalls[0].workspaceSlug, "acme");
  assert.equal(repositoryCalls[0].operationKey, "op_1");
  assert.equal(response.entries.length, 0);
  assert.equal(response.hasMore, false);
});

test("console billing plans list returns catalog entries for active provider", async () => {
  const service = createConsoleServiceHarness({
    billingRepository: createBillingRepositoryStub({
      async listPlans() {
        return [
          {
            id: 11,
            code: "pro_monthly",
            name: "Pro Monthly",
            description: null,
            appliesTo: "workspace",
            corePrice: {
              provider: "stripe",
              providerPriceId: "price_pro_monthly",
              providerProductId: "prod_pro",
              interval: "month",
              intervalCount: 1,
              currency: "USD",
              unitAmountMinor: 4900
            },
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
      }
    })
  });

  const response = await service.listBillingPlans({
    id: 1,
    email: "devop@example.test"
  });
  assert.equal(response.provider, "stripe");
  assert.equal(response.plans.length, 1);
  assert.equal(response.plans[0].corePrice.providerPriceId, "price_pro_monthly");
});

test("console billing products list returns catalog entries for active provider", async () => {
  const service = createConsoleServiceHarness({
    billingRepository: createBillingRepositoryStub({
      async listProducts() {
        return [
          {
            id: 21,
            code: "credits_100",
            name: "100 Credits",
            description: "One-time credit top-up",
            productKind: "credit_topup",
            price: {
              provider: "stripe",
              providerPriceId: "price_credits_100",
              providerProductId: "prod_credits",
              interval: null,
              intervalCount: null,
              currency: "USD",
              unitAmountMinor: 1000
            },
            isActive: true,
            metadataJson: {},
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
          }
        ];
      }
    })
  });

  const response = await service.listBillingProducts({
    id: 1,
    email: "devop@example.test"
  });

  assert.equal(response.provider, "stripe");
  assert.equal(response.products.length, 1);
  assert.equal(response.products[0].price.providerPriceId, "price_credits_100");
});

test("console billing plan create inserts plan and core price mapping", async () => {
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
    billingRepository: createBillingRepositoryStub({
      async transaction(work) {
        return work("trx-1");
      },
      async createPlan(payload, options = {}) {
        calls.push(["createPlan", payload.code, payload.corePrice?.providerPriceId, options.trx]);
        return {
          id: 31,
          code: payload.code,
          name: payload.name,
          description: payload.description || null,
          appliesTo: payload.appliesTo,
          corePrice: payload.corePrice,
          isActive: payload.isActive !== false,
          metadataJson: {},
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        };
      },
      async listPlanEntitlementsForPlan(planId, options = {}) {
        calls.push(["listPlanEntitlementsForPlan", planId, options.trx]);
        return [];
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
    })
  });

  const response = await service.createBillingPlan(
    {
      id: 1,
      email: "devop@example.test"
    },
    {
      code: "pro_monthly",
      name: "Pro Monthly",
      corePrice: {
        providerPriceId: "price_pro_monthly"
      }
    }
  );

  assert.equal(response.provider, "stripe");
  assert.equal(response.plan.code, "pro_monthly");
  const createPlanCall = calls.find((entry) => entry[0] === "createPlan");
  assert.ok(createPlanCall);
  assert.equal(createPlanCall[2], "price_pro_monthly");
});

test("console billing plan create rejects non-stripe provider price id format", async () => {
  const service = createConsoleServiceHarness({
    billingRepository: createBillingRepositoryStub(),
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
          corePrice: {
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
        String(error?.details?.fieldErrors?.["corePrice.providerPriceId"] || "")
          .toLowerCase()
          .includes("stripe price id"),
        true
      );
      return true;
    }
  );
});

test("console billing product create inserts product and provider price mapping", async () => {
  const calls = [];
  const service = createConsoleServiceHarness({
    billingProviderAdapter: {
      async retrievePrice({ priceId }) {
        assert.equal(priceId, "price_credits_100");
        return {
          id: "price_credits_100",
          provider: "stripe",
          productId: "prod_credits",
          productName: "100 Credits",
          nickname: null,
          currency: "USD",
          unitAmountMinor: 1000,
          interval: null,
          intervalCount: null,
          usageType: null,
          active: true
        };
      }
    },
    billingRepository: createBillingRepositoryStub({
      async transaction(work) {
        return work("trx-product-create");
      },
      async createProduct(payload, options = {}) {
        calls.push(["createProduct", payload.code, payload.price?.providerPriceId, options.trx]);
        return {
          id: 41,
          code: payload.code,
          name: payload.name,
          description: payload.description || null,
          productKind: payload.productKind,
          price: payload.price,
          isActive: payload.isActive !== false,
          metadataJson: {},
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        };
      }
    })
  });

  const response = await service.createBillingProduct(
    {
      id: 1,
      email: "devop@example.test"
    },
    {
      code: "credits_100",
      name: "100 Credits",
      productKind: "credit_topup",
      price: {
        providerPriceId: "price_credits_100"
      }
    }
  );

  assert.equal(response.provider, "stripe");
  assert.equal(response.product.code, "credits_100");
  assert.equal(response.product.price.interval, null);
  const createCall = calls.find((entry) => entry[0] === "createProduct");
  assert.ok(createCall);
  assert.equal(createCall[2], "price_credits_100");
});

test("console billing product create rejects recurring Stripe prices", async () => {
  const service = createConsoleServiceHarness({
    billingProviderAdapter: {
      async retrievePrice({ priceId }) {
        assert.equal(priceId, "price_monthly_not_allowed");
        return {
          id: "price_monthly_not_allowed",
          provider: "stripe",
          productId: "prod_monthly",
          productName: "Monthly thing",
          nickname: null,
          currency: "USD",
          unitAmountMinor: 1200,
          interval: "month",
          intervalCount: 1,
          usageType: "licensed",
          active: true
        };
      }
    },
    billingRepository: createBillingRepositoryStub({
      async createProduct() {
        throw new Error("createProduct should not be called for invalid recurring product price");
      }
    })
  });

  await assert.rejects(
    () =>
      service.createBillingProduct(
        {
          id: 1,
          email: "devop@example.test"
        },
        {
          code: "bad_recurring_product",
          name: "Bad recurring product",
          productKind: "one_off",
          price: {
            providerPriceId: "price_monthly_not_allowed"
          }
        }
      ),
    (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.status, 400);
      assert.equal(
        String(error?.details?.fieldErrors?.["price.providerPriceId"] || "")
          .toLowerCase()
          .includes("one-time"),
        true
      );
      return true;
    }
  );
});

test("console billing provider prices list filters by target and delegates to provider adapter", async () => {
  const service = createConsoleServiceHarness({
    billingRepository: createBillingRepositoryStub(),
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
          },
          {
            id: "price_one_time",
            provider: "stripe",
            productId: "prod_one_time",
            productName: "Credits",
            nickname: null,
            currency: "USD",
            unitAmountMinor: 1000,
            interval: null,
            intervalCount: null,
            usageType: null,
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
      active: true,
      target: "product"
    }
  );

  assert.equal(response.provider, "stripe");
  assert.equal(response.prices.length, 1);
  assert.equal(response.prices[0].id, "price_one_time");
});

test("console billing plan update edits existing core price mapping", async () => {
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
    billingRepository: createBillingRepositoryStub({
      async transaction(work) {
        return work("trx-1");
      },
      async findPlanById(planId, options = {}) {
        calls.push(["findPlanById", planId, options.trx]);
        return {
          id: 11,
          code: "pro_monthly",
          name: "Pro Monthly",
          description: null,
          appliesTo: "workspace",
          corePrice: {
            provider: "stripe",
            providerPriceId: "price_old",
            providerProductId: "prod_old",
            interval: "month",
            intervalCount: 1,
            currency: "USD",
            unitAmountMinor: 4900
          },
          isActive: true,
          metadataJson: {},
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        };
      },
      async updatePlanById(planId, patch, options = {}) {
        calls.push(["updatePlanById", planId, patch.corePrice?.providerPriceId, options.trx]);
        return {
          id: planId,
          code: "pro_monthly",
          name: "Pro Monthly",
          description: null,
          appliesTo: "workspace",
          corePrice: patch.corePrice,
          isActive: true,
          metadataJson: {},
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        };
      },
      async listPlanEntitlementsForPlan(planId, options = {}) {
        calls.push(["listPlanEntitlementsForPlan", planId, options.trx]);
        return [];
      }
    })
  });

  const response = await service.updateBillingPlan(
    {
      id: 1,
      email: "devop@example.test"
    },
    {
      planId: 11
    },
    {
      corePrice: {
        providerPriceId: "price_new"
      }
    }
  );

  assert.equal(response.provider, "stripe");
  assert.equal(response.plan.id, 11);
  const updateCall = calls.find((entry) => entry[0] === "updatePlanById");
  assert.ok(updateCall);
  assert.equal(updateCall[2], "price_new");
});

test("console billing plan update edits metadata without changing core price", async () => {
  const calls = [];
  const service = createConsoleServiceHarness({
    billingProviderAdapter: {
      async retrievePrice() {
        throw new Error("retrievePrice should not be called when corePrice is not patched");
      }
    },
    billingRepository: createBillingRepositoryStub({
      async transaction(work) {
        return work("trx-2");
      },
      async findPlanById(planId, options = {}) {
        calls.push(["findPlanById", planId, options.trx]);
        return {
          id: 12,
          code: "pro_monthly",
          name: "Pro Monthly",
          description: "Original description",
          appliesTo: "workspace",
          corePrice: {
            provider: "stripe",
            providerPriceId: "price_existing",
            providerProductId: "prod_existing",
            interval: "month",
            intervalCount: 1,
            currency: "USD",
            unitAmountMinor: 4900
          },
          isActive: true,
          metadataJson: {},
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        };
      },
      async updatePlanById(planId, patch, options = {}) {
        calls.push(["updatePlanById", planId, patch.name, patch.description, patch.isActive, options.trx]);
        return {
          id: planId,
          code: "pro_monthly",
          name: patch.name,
          description: patch.description,
          appliesTo: "workspace",
          corePrice: {
            provider: "stripe",
            providerPriceId: "price_existing",
            providerProductId: "prod_existing",
            interval: "month",
            intervalCount: 1,
            currency: "USD",
            unitAmountMinor: 4900
          },
          isActive: patch.isActive,
          metadataJson: {},
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        };
      },
      async listPlanEntitlementsForPlan(planId, options = {}) {
        calls.push(["listPlanEntitlementsForPlan", planId, options.trx]);
        return [];
      }
    })
  });

  const response = await service.updateBillingPlan(
    {
      id: 1,
      email: "devop@example.test"
    },
    {
      planId: 12
    },
    {
      name: "Pro Monthly Updated",
      description: "Updated description",
      isActive: false
    }
  );

  assert.equal(response.provider, "stripe");
  assert.equal(response.plan.id, 12);
  assert.equal(response.plan.name, "Pro Monthly Updated");
  assert.equal(response.plan.description, "Updated description");
  assert.equal(response.plan.isActive, false);
  const updateCall = calls.find((entry) => entry[0] === "updatePlanById");
  assert.ok(updateCall);
});

test("console billing product update edits existing price mapping", async () => {
  const calls = [];
  const service = createConsoleServiceHarness({
    billingProviderAdapter: {
      async retrievePrice({ priceId }) {
        assert.equal(priceId, "price_setup_fee_new");
        return {
          id: "price_setup_fee_new",
          provider: "stripe",
          productId: "prod_setup_fee",
          productName: "Setup fee",
          nickname: null,
          currency: "USD",
          unitAmountMinor: 2500,
          interval: null,
          intervalCount: null,
          usageType: null,
          active: true
        };
      }
    },
    billingRepository: createBillingRepositoryStub({
      async transaction(work) {
        return work("trx-product-update");
      },
      async findProductById(productId, options = {}) {
        calls.push(["findProductById", productId, options.trx]);
        return {
          id: 13,
          code: "setup_fee",
          name: "Setup fee",
          description: "Original",
          productKind: "setup_fee",
          price: {
            provider: "stripe",
            providerPriceId: "price_setup_fee_old",
            providerProductId: "prod_setup_fee",
            interval: null,
            intervalCount: null,
            currency: "USD",
            unitAmountMinor: 1500
          },
          isActive: true,
          metadataJson: {},
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        };
      },
      async updateProductById(productId, patch, options = {}) {
        calls.push(["updateProductById", productId, patch.price?.providerPriceId, options.trx]);
        return {
          id: productId,
          code: "setup_fee",
          name: "Setup fee",
          description: "Original",
          productKind: "setup_fee",
          price: patch.price,
          isActive: true,
          metadataJson: {},
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        };
      }
    })
  });

  const response = await service.updateBillingProduct(
    {
      id: 1,
      email: "devop@example.test"
    },
    {
      productId: 13
    },
    {
      price: {
        providerPriceId: "price_setup_fee_new"
      }
    }
  );

  assert.equal(response.provider, "stripe");
  assert.equal(response.product.id, 13);
  assert.equal(response.product.price.providerPriceId, "price_setup_fee_new");
  const updateCall = calls.find((entry) => entry[0] === "updateProductById");
  assert.ok(updateCall);
});
