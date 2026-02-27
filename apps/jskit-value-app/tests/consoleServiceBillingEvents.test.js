import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "@jskit-ai/server-runtime-core/errors";
import { createConsoleBillingService, resolveBillingProvider } from "@jskit-ai/billing-service-core";
import { createService as createConsoleService } from "@jskit-ai/workspace-console-service-core/services/console";

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
    async listEntitlementDefinitions() {
      return [];
    },
    async findEntitlementDefinitionById() {
      return null;
    },
    async findBillableEntityById() {
      return null;
    },
    async findPlanByCode() {
      return null;
    },
    async findPlanAssignmentById() {
      return null;
    },
    async listPlanAssignmentsForConsole() {
      return [];
    },
    async listSubscriptionsForConsole() {
      return [];
    },
    async insertPlanAssignment() {
      return null;
    },
    async updatePlanAssignmentById() {
      return null;
    },
    async upsertPlanAssignmentProviderDetails() {
      return null;
    },
    async findBillingPurchaseById() {
      return null;
    },
    async listBillingPurchasesForConsole() {
      return [];
    },
    async insertPurchaseAdjustment() {
      return null;
    },
    async findPurchaseAdjustmentByIdempotencyKey() {
      return null;
    },
    async listPurchaseAdjustmentsByPurchaseId() {
      return [];
    },
    async updateBillingPurchaseStatusById() {
      return null;
    },
    async listPlanEntitlementTemplates() {
      return [];
    },
    async replacePlanEntitlementTemplates() {},
    async listProductEntitlementTemplates() {
      return [];
    },
    async replaceProductEntitlementTemplates() {},
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

  const consoleSettingsRepository = {
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
    consoleSettingsRepository,
    userProfilesRepository: {},
    consoleBillingServiceFactory: ({ requirePermission, ensureConsoleSettings }) =>
      createConsoleBillingService({
        requirePermission,
        ensureConsoleSettings,
        consoleSettingsRepository,
        billingEnabled,
        billingRepository,
        billingProviderAdapter,
        activeBillingProvider: resolveBillingProvider(billingProvider)
      })
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
      async listEntitlementDefinitions() {
        return [
          {
            id: 7,
            code: "projects.max",
            name: "Projects Capacity",
            description: "Maximum active projects allowed.",
            entitlementType: "capacity",
            unit: "project",
            windowInterval: null,
            enforcementMode: "hard_deny",
            isActive: true
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
  assert.equal(response.entitlementDefinitions.length, 1);
  assert.equal(response.entitlementDefinitions[0].code, "projects.max");
});

test("console entitlement definitions list returns mapped entries and applies optional filters", async () => {
  const calls = [];
  const service = createConsoleServiceHarness({
    billingRepository: createBillingRepositoryStub({
      async listEntitlementDefinitions(payload) {
        calls.push(payload);
        return [
          {
            id: 9,
            code: "messages.monthly",
            name: "Messages Monthly",
            description: "Monthly quota of messages.",
            entitlementType: "metered_quota",
            unit: "message",
            windowInterval: "month",
            enforcementMode: "hard_deny",
            isActive: true
          }
        ];
      }
    })
  });

  const response = await service.listEntitlementDefinitions(
    {
      id: 1,
      email: "devop@example.test"
    },
    {
      includeInactive: "false",
      codes: "messages.monthly, projects.max"
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].includeInactive, false);
  assert.deepEqual(calls[0].codes, ["messages.monthly", "projects.max"]);
  assert.equal(response.entries.length, 1);
  assert.equal(response.entries[0].id, 9);
  assert.equal(response.entries[0].code, "messages.monthly");
  assert.equal(response.entries[0].windowInterval, "month");
});

test("console entitlement definition get returns one entry by id", async () => {
  const calls = [];
  const service = createConsoleServiceHarness({
    billingRepository: createBillingRepositoryStub({
      async findEntitlementDefinitionById(definitionId) {
        calls.push(definitionId);
        return {
          id: 7,
          code: "projects.max",
          name: "Projects Capacity",
          description: "Maximum active projects allowed.",
          entitlementType: "capacity",
          unit: "project",
          windowInterval: null,
          enforcementMode: "hard_deny",
          isActive: true
        };
      }
    })
  });

  const response = await service.getEntitlementDefinition(
    {
      id: 1,
      email: "devop@example.test"
    },
    {
      definitionId: "7"
    }
  );

  assert.deepEqual(calls, [7]);
  assert.equal(response.definition.id, 7);
  assert.equal(response.definition.code, "projects.max");
});

test("console entitlement definition get validates id and returns deterministic 404", async () => {
  const service = createConsoleServiceHarness({
    billingRepository: createBillingRepositoryStub({
      async findEntitlementDefinitionById() {
        return null;
      }
    })
  });

  await assert.rejects(
    () =>
      service.getEntitlementDefinition(
        {
          id: 1,
          email: "devop@example.test"
        },
        {}
      ),
    (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.status, 400);
      assert.equal(error.details?.fieldErrors?.definitionId, "definitionId is required.");
      return true;
    }
  );

  await assert.rejects(
    () =>
      service.getEntitlementDefinition(
        {
          id: 1,
          email: "devop@example.test"
        },
        {
          definitionId: "404"
        }
      ),
    (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.status, 404);
      assert.equal(error.message, "Entitlement definition not found.");
      return true;
    }
  );
});

test("console purchases list applies filters and paginates with deep fetch limit", async () => {
  const repositoryCalls = [];
  const service = createConsoleServiceHarness({
    billingRepository: createBillingRepositoryStub({
      async listBillingPurchasesForConsole(payload) {
        repositoryCalls.push(payload);
        return Array.from({ length: 21 }, (_entry, index) => ({
          id: index + 1,
          billableEntityId: 81,
          workspaceId: 9,
          provider: "stripe",
          purchaseKind: "one_off",
          status: "confirmed",
          amountMinor: 1000,
          currency: "USD",
          quantity: 1,
          operationKey: `op_${index + 1}`,
          providerPaymentId: `pay_${index + 1}`,
          providerInvoiceId: null,
          displayName: "Credits",
          metadataJson: {},
          purchasedAt: "2026-02-24T00:00:00.000Z"
        }));
      }
    })
  });

  const response = await service.listPurchasesForConsole(
    {
      id: 1,
      email: "devop@example.test"
    },
    {
      page: 2,
      pageSize: 10,
      workspaceSlug: "acme",
      status: "confirmed"
    }
  );

  assert.equal(repositoryCalls.length, 1);
  assert.equal(repositoryCalls[0].limit, 21);
  assert.equal(repositoryCalls[0].workspaceSlug, "acme");
  assert.equal(repositoryCalls[0].status, "confirmed");
  assert.equal(response.entries.length, 10);
  assert.equal(response.page, 2);
  assert.equal(response.pageSize, 10);
  assert.equal(response.hasMore, true);
});

test("console refund purchase updates status and records succeeded adjustment", async () => {
  const adjustmentWrites = [];
  const providerCalls = [];
  const service = createConsoleServiceHarness({
    billingProviderAdapter: {
      async refundPurchase(payload) {
        providerCalls.push(payload);
        return {
          providerReference: "re_91"
        };
      }
    },
    billingRepository: createBillingRepositoryStub({
      async findBillingPurchaseById(id) {
        assert.equal(id, 91);
        return {
          id: 91,
          billableEntityId: 10,
          workspaceId: 20,
          provider: "stripe",
          purchaseKind: "one_off",
          status: "confirmed",
          amountMinor: 1200,
          currency: "USD",
          quantity: 1,
          operationKey: "op_91",
          providerPaymentId: "pay_91",
          providerInvoiceId: null,
          displayName: "Credits",
          metadataJson: {},
          purchasedAt: "2026-02-24T00:00:00.000Z"
        };
      },
      async insertPurchaseAdjustment(payload) {
        adjustmentWrites.push(payload);
        return {
          id: 301,
          purchaseId: 91,
          actionType: payload.actionType,
          status: payload.status,
          amountMinor: payload.amountMinor,
          currency: payload.currency,
          reasonCode: payload.reasonCode,
          providerReference: payload.providerReference || null,
          requestedByUserId: payload.requestedByUserId,
          requestIdempotencyKey: payload.requestIdempotencyKey,
          metadataJson: payload.metadataJson || {},
          createdAt: "2026-02-24T12:00:00.000Z"
        };
      },
      async updateBillingPurchaseStatusById(id, patch) {
        assert.equal(id, 91);
        assert.equal(patch.status, "refunded");
        return {
          id: 91,
          billableEntityId: 10,
          workspaceId: 20,
          provider: "stripe",
          purchaseKind: "one_off",
          status: "refunded",
          amountMinor: 1200,
          currency: "USD",
          quantity: 1,
          operationKey: "op_91",
          providerPaymentId: "pay_91",
          providerInvoiceId: null,
          displayName: "Credits",
          metadataJson: {},
          purchasedAt: "2026-02-24T00:00:00.000Z"
        };
      },
      async listPurchaseAdjustmentsByPurchaseId({ purchaseId }) {
        assert.equal(purchaseId, 91);
        return [
          {
            id: 301,
            purchaseId: 91,
            actionType: "refund",
            status: "succeeded",
            amountMinor: 1200,
            currency: "USD",
            reasonCode: "manual_refund",
            providerReference: "re_91",
            requestedByUserId: 1,
            requestIdempotencyKey: "idem_refund_91",
            metadataJson: {},
            createdAt: "2026-02-24T12:00:00.000Z"
          }
        ];
      }
    })
  });

  const response = await service.refundPurchaseForConsole(
    {
      id: 1,
      email: "devop@example.test"
    },
    {
      purchaseId: "91"
    },
    {
      clientIdempotencyKey: "idem_refund_91",
      reasonCode: "manual_refund"
    }
  );

  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].idempotencyKey, "idem_refund_91");
  assert.equal(adjustmentWrites.length, 1);
  assert.equal(adjustmentWrites[0].status, "succeeded");
  assert.equal(response.purchase.status, "refunded");
  assert.equal(response.adjustment.status, "succeeded");
  assert.equal(response.adjustments.length, 1);
});

test("console refund purchase records failed adjustment for invalid state transition", async () => {
  const adjustmentWrites = [];
  const service = createConsoleServiceHarness({
    billingRepository: createBillingRepositoryStub({
      async findBillingPurchaseById() {
        return {
          id: 102,
          billableEntityId: 10,
          workspaceId: 20,
          provider: "stripe",
          purchaseKind: "one_off",
          status: "voided",
          amountMinor: 990,
          currency: "USD",
          quantity: 1,
          operationKey: "op_102",
          providerPaymentId: "pay_102",
          providerInvoiceId: null,
          displayName: "Credits",
          metadataJson: {},
          purchasedAt: "2026-02-24T00:00:00.000Z"
        };
      },
      async insertPurchaseAdjustment(payload) {
        adjustmentWrites.push(payload);
        return {
          id: 302,
          purchaseId: 102,
          actionType: payload.actionType,
          status: payload.status,
          amountMinor: payload.amountMinor,
          currency: payload.currency,
          reasonCode: payload.reasonCode,
          providerReference: null,
          requestedByUserId: payload.requestedByUserId,
          requestIdempotencyKey: payload.requestIdempotencyKey,
          metadataJson: payload.metadataJson || {},
          createdAt: "2026-02-24T12:00:00.000Z"
        };
      }
    })
  });

  await assert.rejects(
    () =>
      service.refundPurchaseForConsole(
        {
          id: 1,
          email: "devop@example.test"
        },
        {
          purchaseId: "102"
        },
        {
          clientIdempotencyKey: "idem_refund_102"
        }
      ),
    (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.status, 409);
      assert.equal(error.code, "PURCHASE_REFUND_NOT_ALLOWED");
      return true;
    }
  );

  assert.equal(adjustmentWrites.length, 1);
  assert.equal(adjustmentWrites[0].status, "failed");
  assert.equal(adjustmentWrites[0].reasonCode, "refund_not_allowed");
});

test("console purchase mutation rejects idempotency replay when existing action type differs", async () => {
  const service = createConsoleServiceHarness({
    billingRepository: createBillingRepositoryStub({
      async findPurchaseAdjustmentByIdempotencyKey() {
        return {
          id: 410,
          purchaseId: 91,
          actionType: "void",
          status: "succeeded",
          amountMinor: 1200,
          currency: "USD",
          reasonCode: "manual_void",
          providerReference: "void_91",
          requestedByUserId: 1,
          requestIdempotencyKey: "idem_shared_91",
          metadataJson: {},
          createdAt: "2026-02-25T00:00:00.000Z"
        };
      }
    })
  });

  await assert.rejects(
    () =>
      service.refundPurchaseForConsole(
        {
          id: 1,
          email: "devop@example.test"
        },
        {
          purchaseId: "91"
        },
        {
          clientIdempotencyKey: "idem_shared_91"
        }
      ),
    (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.status, 409);
      assert.equal(error.code, "PURCHASE_ADJUSTMENT_DUPLICATE");
      assert.equal(error.details?.existingActionType, "void");
      return true;
    }
  );
});

test("console void purchase updates status and records succeeded adjustment", async () => {
  const adjustmentWrites = [];
  const providerCalls = [];
  const service = createConsoleServiceHarness({
    billingProviderAdapter: {
      async voidPurchase(payload) {
        providerCalls.push(payload);
        return {
          providerReference: "void_120"
        };
      }
    },
    billingRepository: createBillingRepositoryStub({
      async findBillingPurchaseById(id) {
        assert.equal(id, 120);
        return {
          id: 120,
          billableEntityId: 10,
          workspaceId: 20,
          provider: "stripe",
          purchaseKind: "one_off",
          status: "confirmed",
          amountMinor: 2200,
          currency: "USD",
          quantity: 1,
          operationKey: "op_120",
          providerPaymentId: "pay_120",
          providerInvoiceId: null,
          displayName: "Credits",
          metadataJson: {},
          purchasedAt: "2026-02-24T00:00:00.000Z"
        };
      },
      async insertPurchaseAdjustment(payload) {
        adjustmentWrites.push(payload);
        return {
          id: 420,
          purchaseId: 120,
          actionType: payload.actionType,
          status: payload.status,
          amountMinor: payload.amountMinor,
          currency: payload.currency,
          reasonCode: payload.reasonCode,
          providerReference: payload.providerReference || null,
          requestedByUserId: payload.requestedByUserId,
          requestIdempotencyKey: payload.requestIdempotencyKey,
          metadataJson: payload.metadataJson || {},
          createdAt: "2026-02-25T12:00:00.000Z"
        };
      },
      async updateBillingPurchaseStatusById(id, patch) {
        assert.equal(id, 120);
        assert.equal(patch.status, "voided");
        return {
          id: 120,
          billableEntityId: 10,
          workspaceId: 20,
          provider: "stripe",
          purchaseKind: "one_off",
          status: "voided",
          amountMinor: 2200,
          currency: "USD",
          quantity: 1,
          operationKey: "op_120",
          providerPaymentId: "pay_120",
          providerInvoiceId: null,
          displayName: "Credits",
          metadataJson: {},
          purchasedAt: "2026-02-24T00:00:00.000Z"
        };
      },
      async listPurchaseAdjustmentsByPurchaseId({ purchaseId }) {
        assert.equal(purchaseId, 120);
        return [
          {
            id: 420,
            purchaseId: 120,
            actionType: "void",
            status: "succeeded",
            amountMinor: 2200,
            currency: "USD",
            reasonCode: "manual_void",
            providerReference: "void_120",
            requestedByUserId: 1,
            requestIdempotencyKey: "idem_void_120",
            metadataJson: {},
            createdAt: "2026-02-25T12:00:00.000Z"
          }
        ];
      }
    })
  });

  const response = await service.voidPurchaseForConsole(
    {
      id: 1,
      email: "devop@example.test"
    },
    {
      purchaseId: "120"
    },
    {
      clientIdempotencyKey: "idem_void_120",
      reasonCode: "manual_void"
    }
  );

  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].idempotencyKey, "idem_void_120");
  assert.equal(adjustmentWrites.length, 1);
  assert.equal(adjustmentWrites[0].status, "succeeded");
  assert.equal(response.purchase.status, "voided");
  assert.equal(response.adjustment.status, "succeeded");
  assert.equal(response.adjustments.length, 1);
});

test("console correction validation failure records failed adjustment audit row", async () => {
  const adjustmentWrites = [];
  const service = createConsoleServiceHarness({
    billingRepository: createBillingRepositoryStub({
      async findBillingPurchaseById() {
        return {
          id: 130,
          billableEntityId: 10,
          workspaceId: 20,
          provider: "stripe",
          purchaseKind: "one_off",
          status: "confirmed",
          amountMinor: 800,
          currency: "USD",
          quantity: 1,
          operationKey: "op_130",
          providerPaymentId: "pay_130",
          providerInvoiceId: null,
          displayName: "Credits",
          metadataJson: {},
          purchasedAt: "2026-02-24T00:00:00.000Z"
        };
      },
      async insertPurchaseAdjustment(payload) {
        adjustmentWrites.push(payload);
        return {
          id: 430,
          purchaseId: 130,
          actionType: payload.actionType,
          status: payload.status,
          amountMinor: payload.amountMinor,
          currency: payload.currency,
          reasonCode: payload.reasonCode,
          providerReference: payload.providerReference || null,
          requestedByUserId: payload.requestedByUserId,
          requestIdempotencyKey: payload.requestIdempotencyKey,
          metadataJson: payload.metadataJson || {},
          createdAt: "2026-02-25T12:00:00.000Z"
        };
      }
    })
  });

  await assert.rejects(
    () =>
      service.createPurchaseCorrectionForConsole(
        {
          id: 1,
          email: "devop@example.test"
        },
        {
          purchaseId: "130"
        },
        {
          clientIdempotencyKey: "idem_correction_130",
          amountMinor: "not_a_number",
          currency: "USD"
        }
      ),
    (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.status, 400);
      assert.equal(error.details?.fieldErrors?.amountMinor, "amountMinor must be an integer.");
      return true;
    }
  );

  assert.equal(adjustmentWrites.length, 1);
  assert.equal(adjustmentWrites[0].status, "failed");
  assert.equal(adjustmentWrites[0].reasonCode, "correction_amount_invalid");
  assert.equal(adjustmentWrites[0].requestIdempotencyKey, "idem_correction_130");
});

test("console plan assignments list applies filters and paginates with deep fetch limit", async () => {
  const repositoryCalls = [];
  const service = createConsoleServiceHarness({
    billingRepository: createBillingRepositoryStub({
      async listPlanAssignmentsForConsole(payload) {
        repositoryCalls.push(payload);
        return Array.from({ length: 41 }, (_entry, index) => ({
          id: index + 1,
          billableEntityId: 55,
          workspaceId: 9,
          workspaceSlug: "acme",
          planId: 12,
          planCode: "pro_monthly",
          planName: "Pro Monthly",
          source: "manual",
          status: "current",
          periodStartAt: "2026-02-24T00:00:00.000Z",
          periodEndAt: "2026-03-24T00:00:00.000Z",
          provider: "stripe",
          providerSubscriptionId: `sub_${index + 1}`,
          providerStatus: "active",
          currentPeriodEnd: "2026-03-24T00:00:00.000Z",
          cancelAtPeriodEnd: false,
          metadataJson: {},
          createdAt: "2026-02-24T00:00:00.000Z",
          updatedAt: "2026-02-24T00:00:00.000Z"
        }));
      }
    })
  });

  const response = await service.listPlanAssignmentsForConsole(
    {
      id: 1,
      email: "devop@example.test"
    },
    {
      page: 2,
      pageSize: 20,
      workspaceSlug: "acme",
      statuses: "current,upcoming"
    }
  );

  assert.equal(repositoryCalls.length, 1);
  assert.equal(repositoryCalls[0].limit, 41);
  assert.equal(repositoryCalls[0].workspaceSlug, "acme");
  assert.deepEqual(repositoryCalls[0].statuses, ["current", "upcoming"]);
  assert.equal(response.entries.length, 20);
  assert.equal(response.page, 2);
  assert.equal(response.pageSize, 20);
  assert.equal(response.hasMore, true);
});

test("console create plan assignment inserts and returns hydrated assignment projection", async () => {
  const insertCalls = [];
  const service = createConsoleServiceHarness({
    billingRepository: createBillingRepositoryStub({
      async findBillableEntityById(id) {
        assert.equal(id, 88);
        return {
          id: 88
        };
      },
      async findPlanById(id) {
        assert.equal(id, 12);
        return {
          id: 12,
          code: "pro_monthly",
          corePrice: {
            unitAmountMinor: 4900
          }
        };
      },
      async insertPlanAssignment(payload) {
        insertCalls.push(payload);
        return {
          id: 501,
          billableEntityId: payload.billableEntityId,
          planId: payload.planId,
          source: payload.source,
          status: payload.status,
          periodStartAt: payload.periodStartAt.toISOString(),
          periodEndAt: payload.periodEndAt ? payload.periodEndAt.toISOString() : null,
          metadataJson: payload.metadataJson || {},
          createdAt: "2026-02-25T10:00:00.000Z",
          updatedAt: "2026-02-25T10:00:00.000Z"
        };
      },
      async listPlanAssignmentsForConsole(payload) {
        assert.equal(payload.assignmentId, 501);
        return [
          {
            id: 501,
            billableEntityId: 88,
            workspaceId: 17,
            workspaceSlug: "acme",
            planId: 12,
            planCode: "pro_monthly",
            planName: "Pro Monthly",
            source: "manual",
            status: "current",
            periodStartAt: "2026-02-25T10:00:00.000Z",
            periodEndAt: "2026-03-27T10:00:00.000Z",
            provider: "stripe",
            providerSubscriptionId: "sub_501",
            providerStatus: "active",
            currentPeriodEnd: "2026-03-27T10:00:00.000Z",
            cancelAtPeriodEnd: false,
            metadataJson: {
              reason: "manual_override"
            },
            createdAt: "2026-02-25T10:00:00.000Z",
            updatedAt: "2026-02-25T10:00:00.000Z"
          }
        ];
      }
    })
  });

  const response = await service.createPlanAssignmentForConsole(
    {
      id: 1,
      email: "devop@example.test"
    },
    {
      billableEntityId: 88,
      planId: 12,
      source: "manual",
      status: "current",
      metadataJson: {
        reason: "manual_override"
      }
    }
  );

  assert.equal(insertCalls.length, 1);
  assert.equal(insertCalls[0].billableEntityId, 88);
  assert.equal(insertCalls[0].planId, 12);
  assert.equal(insertCalls[0].status, "current");
  assert.equal(response.assignment.id, 501);
  assert.equal(response.assignment.planCode, "pro_monthly");
  assert.equal(response.assignment.workspaceSlug, "acme");
});

test("console cancel-at-period-end subscription mutation updates provider details and returns refreshed projection", async () => {
  const providerCalls = [];
  const upsertCalls = [];
  let callCount = 0;
  const service = createConsoleServiceHarness({
    billingProviderAdapter: {
      async cancelSubscription(payload) {
        providerCalls.push(payload);
        return {
          id: "sub_900",
          status: "active",
          customer: "cus_900",
          current_period_end: Math.floor(new Date("2026-04-01T00:00:00.000Z").getTime() / 1000),
          cancel_at_period_end: true,
          metadata: {
            source: "provider"
          }
        };
      }
    },
    billingRepository: createBillingRepositoryStub({
      async listSubscriptionsForConsole(payload) {
        callCount += 1;
        assert.equal(payload.providerSubscriptionId, "sub_900");
        if (callCount === 1) {
          return [
            {
              provider: "stripe",
              providerSubscriptionId: "sub_900",
              providerCustomerId: "cus_900",
              status: "active",
              providerSubscriptionCreatedAt: "2026-01-01T00:00:00.000Z",
              currentPeriodEnd: "2026-03-01T00:00:00.000Z",
              trialEnd: null,
              canceledAt: null,
              cancelAtPeriodEnd: false,
              endedAt: null,
              assignmentId: 777,
              assignmentStatus: "current",
              assignmentPeriodStartAt: "2026-01-01T00:00:00.000Z",
              assignmentPeriodEndAt: "2026-03-01T00:00:00.000Z",
              billableEntityId: 88,
              workspaceId: 17,
              workspaceSlug: "acme",
              planId: 12,
              planCode: "pro_monthly",
              planName: "Pro Monthly",
              metadataJson: {}
            }
          ];
        }

        return [
          {
            provider: "stripe",
            providerSubscriptionId: "sub_900",
            providerCustomerId: "cus_900",
            status: "active",
            providerSubscriptionCreatedAt: "2026-01-01T00:00:00.000Z",
            currentPeriodEnd: "2026-04-01T00:00:00.000Z",
            trialEnd: null,
            canceledAt: null,
            cancelAtPeriodEnd: true,
            endedAt: null,
            assignmentId: 777,
            assignmentStatus: "current",
            assignmentPeriodStartAt: "2026-01-01T00:00:00.000Z",
            assignmentPeriodEndAt: "2026-04-01T00:00:00.000Z",
            billableEntityId: 88,
            workspaceId: 17,
            workspaceSlug: "acme",
            planId: 12,
            planCode: "pro_monthly",
            planName: "Pro Monthly",
            metadataJson: {
              source: "provider"
            }
          }
        ];
      },
      async upsertPlanAssignmentProviderDetails(payload) {
        upsertCalls.push(payload);
        return payload;
      }
    })
  });

  const response = await service.cancelSubscriptionAtPeriodEndForConsole(
    {
      id: 1,
      email: "devop@example.test"
    },
    {
      providerSubscriptionId: "sub_900"
    },
    {}
  );

  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].subscriptionId, "sub_900");
  assert.equal(providerCalls[0].cancelAtPeriodEnd, true);
  assert.equal(upsertCalls.length, 1);
  assert.equal(upsertCalls[0].cancelAtPeriodEnd, true);
  assert.equal(response.subscription.providerSubscriptionId, "sub_900");
  assert.equal(response.subscription.cancelAtPeriodEnd, true);
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

test("console billing plan create supports free plans without provider price mapping", async () => {
  const calls = [];
  let retrievePriceCalls = 0;
  const service = createConsoleServiceHarness({
    billingProviderAdapter: {
      async retrievePrice() {
        retrievePriceCalls += 1;
        throw new Error("retrievePrice should not be called for free plan create");
      }
    },
    billingRepository: createBillingRepositoryStub({
      async transaction(work) {
        return work("trx-free");
      },
      async createPlan(payload, options = {}) {
        calls.push(["createPlan", payload, options.trx]);
        return {
          id: 32,
          code: payload.code,
          name: payload.name,
          description: payload.description || null,
          appliesTo: payload.appliesTo,
          corePrice: payload.corePrice ?? null,
          isActive: payload.isActive !== false,
          metadataJson: payload.metadataJson || {},
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        };
      },
      async listPlanEntitlementsForPlan() {
        return [];
      },
      async upsertPlanEntitlement() {
        throw new Error("not used");
      }
    })
  });

  const response = await service.createBillingPlan(
    {
      id: 1,
      email: "devop@example.test"
    },
    {
      code: "free",
      name: "Free",
      corePrice: null
    }
  );

  assert.equal(response.provider, "stripe");
  assert.equal(response.plan.code, "free");
  assert.equal(response.plan.corePrice, null);
  assert.equal(retrievePriceCalls, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "createPlan");
  assert.equal(calls[0][1].corePrice, null);
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
