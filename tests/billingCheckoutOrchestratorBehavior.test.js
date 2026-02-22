import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../server/lib/errors.js";
import { BILLING_FAILURE_CODES } from "../server/modules/billing/constants.js";
import { createService as createCheckoutOrchestratorService } from "../server/modules/billing/checkoutOrchestrator.service.js";

function createOrchestrator({
  findPlanByCode,
  getBlockingCheckoutSession,
  markFailed,
  createCheckoutSession
} = {}) {
  const state = {
    idempotencyStatus: "pending",
    idempotencyRow: {
      id: 101,
      status: "pending",
      leaseVersion: 1,
      operationKey: "op_101",
      providerIdempotencyKey: "prov_idem_101"
    }
  };

  const markFailedCalls = [];
  const callOrder = [];

  const service = createCheckoutOrchestratorService({
    billingRepository: {
      async transaction(work) {
        return work({});
      },
      async findBillableEntityById() {
        return {
          id: 1
        };
      },
      async lockSubscriptionsForEntity() {
        return [];
      },
      async findCurrentSubscriptionForEntity() {
        return null;
      },
      async findIdempotencyById() {
        return {
          ...state.idempotencyRow,
          status: state.idempotencyStatus
        };
      },
      async findPlanByCode(planCode) {
        callOrder.push(`find_plan:${planCode}`);
        if (typeof findPlanByCode === "function") {
          return findPlanByCode(planCode);
        }

        return {
          id: 11,
          code: "pro_monthly",
          isActive: true
        };
      },
      async findCustomerByEntityProvider() {
        return null;
      },
      async updateIdempotencyById() {
        return {
          id: state.idempotencyRow.id
        };
      }
    },
    billingPolicyService: {
      async resolveBillableEntityForWriteRequest() {
        return {
          billableEntity: {
            id: 1
          }
        };
      }
    },
    billingPricingService: {
      async resolvePhase1SellablePrice() {
        return {
          id: 21,
          providerPriceId: "price_123"
        };
      }
    },
    billingIdempotencyService: {
      async claimOrReplay() {
        callOrder.push("claim_or_replay");
        return {
          type: "claimed",
          row: {
            ...state.idempotencyRow
          }
        };
      },
      async markFailed(payload) {
        if (typeof markFailed === "function") {
          return markFailed(payload, state);
        }

        markFailedCalls.push(payload);
        state.idempotencyStatus = "failed";
        return payload;
      },
      async markSucceeded() {
        state.idempotencyStatus = "succeeded";
        return null;
      }
    },
    billingCheckoutSessionService: {
      async cleanupExpiredBlockingSessions() {
        return null;
      },
      async getBlockingCheckoutSession() {
        if (typeof getBlockingCheckoutSession === "function") {
          return getBlockingCheckoutSession();
        }
        return null;
      },
      async upsertBlockingCheckoutSession() {
        return null;
      },
      async markCheckoutSessionExpiredOrAbandoned() {
        return null;
      }
    },
    billingProviderAdapter: {
      async getSdkProvenance() {
        return {
          providerSdkName: "stripe-node",
          providerSdkVersion: "14.25.0",
          providerApiVersion: "2024-06-20"
        };
      },
      async createCheckoutSession() {
        if (typeof createCheckoutSession === "function") {
          return createCheckoutSession();
        }

        return {
          id: "cs_123",
          status: "open",
          url: "https://checkout.stripe.test/session",
          expires_at: Math.floor(Date.now() / 1000) + 60,
          customer: "cus_123",
          subscription: null,
          metadata: {}
        };
      }
    },
    appPublicUrl: "https://app.example.test"
  });

  return {
    service,
    callOrder,
    markFailedCalls
  };
}

test("checkout orchestrator claims idempotency before deterministic plan validation", async () => {
  const { service, callOrder, markFailedCalls } = createOrchestrator({
    findPlanByCode() {
      return null;
    }
  });

  await assert.rejects(
    () =>
      service.startCheckout({
        request: {
          headers: {}
        },
        user: {
          id: 11
        },
        payload: {
          planCode: "missing_plan",
          successPath: "/billing/success",
          cancelPath: "/billing/cancel"
        },
        clientIdempotencyKey: "idem_missing_plan",
        now: new Date("2026-02-20T16:00:00.000Z")
      }),
    (error) =>
      error instanceof AppError &&
      Number(error.statusCode) === 404 &&
      String(error.code || "") === BILLING_FAILURE_CODES.CHECKOUT_PLAN_NOT_FOUND
  );

  assert.equal(callOrder[0], "claim_or_replay");
  assert.equal(callOrder[1], "find_plan:missing_plan");
  assert.equal(markFailedCalls.length >= 1, true);
  assert.equal(markFailedCalls[0].failureCode, BILLING_FAILURE_CODES.CHECKOUT_PLAN_NOT_FOUND);
});

test("checkout orchestrator includes safe existing session details for checkout_session_open", async () => {
  const { service } = createOrchestrator({
    getBlockingCheckoutSession() {
      return {
        id: 8,
        status: "open",
        providerCheckoutSessionId: "cs_existing_open",
        checkoutUrl: "https://checkout.stripe.test/existing-open"
      };
    }
  });

  await assert.rejects(
    () =>
      service.startCheckout({
        request: {
          headers: {}
        },
        user: {
          id: 11
        },
        payload: {
          planCode: "pro_monthly",
          successPath: "/billing/success",
          cancelPath: "/billing/cancel"
        },
        clientIdempotencyKey: "idem_blocked_open",
        now: new Date("2026-02-20T16:05:00.000Z")
      }),
    (error) =>
      error instanceof AppError &&
      Number(error.statusCode) === 409 &&
      String(error.code || "") === BILLING_FAILURE_CODES.CHECKOUT_SESSION_OPEN &&
      String(error?.details?.providerCheckoutSessionId || "") === "cs_existing_open" &&
      String(error?.details?.checkoutUrl || "") === "https://checkout.stripe.test/existing-open"
  );
});

test("checkout orchestrator persists deterministic Tx A failures for replay", async () => {
  const state = {
    idempotencyRow: null
  };
  let claimCount = 0;
  let markFailedCount = 0;

  const service = createCheckoutOrchestratorService({
    billingRepository: {
      async transaction(work) {
        const snapshot = state.idempotencyRow ? { ...state.idempotencyRow } : null;
        try {
          return await work({});
        } catch (error) {
          state.idempotencyRow = snapshot ? { ...snapshot } : null;
          throw error;
        }
      },
      async findBillableEntityById() {
        return {
          id: 1
        };
      },
      async lockSubscriptionsForEntity() {
        return [];
      },
      async findCurrentSubscriptionForEntity() {
        return null;
      },
      async findIdempotencyById(id) {
        if (!state.idempotencyRow || Number(state.idempotencyRow.id) !== Number(id)) {
          return null;
        }
        return { ...state.idempotencyRow };
      },
      async findPlanByCode() {
        return null;
      },
      async findCustomerByEntityProvider() {
        return null;
      },
      async updateIdempotencyById() {
        return state.idempotencyRow ? { ...state.idempotencyRow } : null;
      }
    },
    billingPolicyService: {
      async resolveBillableEntityForWriteRequest() {
        return {
          billableEntity: {
            id: 1
          }
        };
      }
    },
    billingPricingService: {
      async resolvePhase1SellablePrice() {
        return {
          id: 21,
          providerPriceId: "price_123"
        };
      }
    },
    billingIdempotencyService: {
      async claimOrReplay() {
        claimCount += 1;
        if (!state.idempotencyRow) {
          state.idempotencyRow = {
            id: 301,
            status: "pending",
            leaseVersion: 1,
            operationKey: "op_301",
            providerIdempotencyKey: "prov_idem_301",
            failureCode: null,
            failureReason: null
          };
          return {
            type: "claimed",
            row: { ...state.idempotencyRow }
          };
        }

        if (state.idempotencyRow.status === "failed" || state.idempotencyRow.status === "expired") {
          return {
            type: "replay_terminal",
            row: { ...state.idempotencyRow }
          };
        }

        return {
          type: "in_progress_same_key",
          row: { ...state.idempotencyRow }
        };
      },
      async markFailed(payload) {
        markFailedCount += 1;
        if (!state.idempotencyRow || Number(state.idempotencyRow.id) !== Number(payload.idempotencyRowId)) {
          throw new Error("idempotency row not found in markFailed");
        }
        state.idempotencyRow = {
          ...state.idempotencyRow,
          status: "failed",
          failureCode: payload.failureCode,
          failureReason: payload.failureReason
        };
        return { ...state.idempotencyRow };
      },
      async markSucceeded() {
        return null;
      }
    },
    billingCheckoutSessionService: {
      async cleanupExpiredBlockingSessions() {
        return null;
      },
      async getBlockingCheckoutSession() {
        return null;
      },
      async upsertBlockingCheckoutSession() {
        return null;
      },
      async markCheckoutSessionExpiredOrAbandoned() {
        return null;
      }
    },
    billingProviderAdapter: {
      async getSdkProvenance() {
        return {
          providerSdkName: "stripe-node",
          providerSdkVersion: "14.25.0",
          providerApiVersion: "2024-06-20"
        };
      },
      async createCheckoutSession() {
        throw new Error("provider should never be called for missing plan");
      }
    },
    appPublicUrl: "https://app.example.test"
  });

  const checkoutArgs = {
    request: {
      headers: {}
    },
    user: {
      id: 11
    },
    payload: {
      planCode: "missing_plan",
      successPath: "/billing/success",
      cancelPath: "/billing/cancel"
    },
    clientIdempotencyKey: "idem_missing_plan_replay",
    now: new Date("2026-02-20T16:00:00.000Z")
  };

  await assert.rejects(
    () => service.startCheckout(checkoutArgs),
    (error) =>
      error instanceof AppError &&
      Number(error.statusCode) === 404 &&
      String(error.code || "") === BILLING_FAILURE_CODES.CHECKOUT_PLAN_NOT_FOUND
  );

  await assert.rejects(
    () => service.startCheckout(checkoutArgs),
    (error) =>
      error instanceof AppError &&
      Number(error.statusCode) === 404 &&
      String(error.code || "") === BILLING_FAILURE_CODES.CHECKOUT_PLAN_NOT_FOUND
  );

  assert.equal(claimCount, 2);
  assert.equal(markFailedCount, 1);
});

test("checkout orchestrator deterministic provider rejection marks failure with expected lease version", async () => {
  const { service, markFailedCalls } = createOrchestrator({
    createCheckoutSession() {
      const error = new Error("invalid checkout request");
      error.statusCode = 400;
      throw error;
    }
  });

  await assert.rejects(
    () =>
      service.startCheckout({
        request: {
          headers: {}
        },
        user: {
          id: 11
        },
        payload: {
          planCode: "pro_monthly",
          successPath: "/billing/success",
          cancelPath: "/billing/cancel"
        },
        clientIdempotencyKey: "idem_provider_reject",
        now: new Date("2026-02-20T16:10:00.000Z")
      }),
    (error) =>
      error instanceof AppError &&
      Number(error.statusCode) === 502 &&
      String(error.code || "") === BILLING_FAILURE_CODES.CHECKOUT_PROVIDER_ERROR
  );

  assert.equal(markFailedCalls.length, 1);
  assert.equal(markFailedCalls[0].failureCode, BILLING_FAILURE_CODES.CHECKOUT_PROVIDER_ERROR);
  assert.equal(markFailedCalls[0].leaseVersion, 1);
});

test("checkout orchestrator returns request_in_progress when provider rejection finalization is lease fenced", async () => {
  const { service } = createOrchestrator({
    createCheckoutSession() {
      const error = new Error("invalid checkout request");
      error.statusCode = 400;
      throw error;
    },
    markFailed() {
      throw new AppError(409, "Billing idempotency lease has changed.", {
        code: "BILLING_LEASE_FENCED"
      });
    }
  });

  await assert.rejects(
    () =>
      service.startCheckout({
        request: {
          headers: {}
        },
        user: {
          id: 11
        },
        payload: {
          planCode: "pro_monthly",
          successPath: "/billing/success",
          cancelPath: "/billing/cancel"
        },
        clientIdempotencyKey: "idem_provider_reject_fenced",
        now: new Date("2026-02-20T16:11:00.000Z")
      }),
    (error) =>
      error instanceof AppError &&
      Number(error.statusCode) === 409 &&
      String(error.code || "") === BILLING_FAILURE_CODES.REQUEST_IN_PROGRESS
  );
});

test("checkout orchestrator supports one_off checkout without requiring plan lookup", async () => {
  let createCheckoutParams = null;

  const service = createCheckoutOrchestratorService({
    billingRepository: {
      async transaction(work) {
        return work({});
      },
      async findBillableEntityById() {
        return {
          id: 1
        };
      },
      async lockSubscriptionsForEntity() {
        return [];
      },
      async lockCheckoutSessionsForEntity() {
        return [];
      },
      async findCurrentSubscriptionForEntity() {
        return {
          id: 500,
          isCurrent: true,
          status: "active"
        };
      },
      async findIdempotencyById() {
        return {
          id: 601,
          leaseVersion: 1,
          status: "pending",
          operationKey: "op_one_off_601"
        };
      },
      async findCustomerByEntityProvider() {
        return null;
      },
      async updateIdempotencyById() {
        return {
          id: 601
        };
      }
    },
    billingPolicyService: {
      async resolveBillableEntityForWriteRequest() {
        return {
          billableEntity: {
            id: 1
          }
        };
      }
    },
    billingPricingService: {
      deploymentCurrency: "USD",
      async resolvePhase1SellablePrice() {
        throw new Error("phase1 price resolver should not be called for one_off");
      }
    },
    billingIdempotencyService: {
      async claimOrReplay() {
        return {
          type: "claimed",
          row: {
            id: 601,
            leaseVersion: 1,
            operationKey: "op_one_off_601",
            providerIdempotencyKey: "prov_idem_one_off_601"
          }
        };
      },
      async markFailed() {
        return null;
      },
      async markSucceeded() {
        return null;
      }
    },
    billingCheckoutSessionService: {
      async upsertBlockingCheckoutSession() {
        return null;
      },
      async markCheckoutSessionExpiredOrAbandoned() {
        return null;
      },
      async getBlockingCheckoutSession() {
        return null;
      },
      async cleanupExpiredBlockingSessions() {
        return null;
      }
    },
    billingProviderAdapter: {
      async getSdkProvenance() {
        return {
          providerSdkName: "stripe-node",
          providerSdkVersion: "14.25.0",
          providerApiVersion: "2024-06-20"
        };
      },
      async createCheckoutSession({ params }) {
        createCheckoutParams = params;
        return {
          id: "cs_one_off_1",
          status: "open",
          url: "https://checkout.stripe.test/cs_one_off_1",
          expires_at: Math.floor(Date.now() / 1000) + 300,
          customer: "cus_1",
          subscription: null,
          metadata: params.metadata || {}
        };
      }
    },
    appPublicUrl: "https://app.example.test"
  });

  const response = await service.startCheckout({
    request: {
      headers: {}
    },
    user: {
      id: 11
    },
    payload: {
      checkoutType: "one_off",
      oneOff: {
        name: "Migration support",
        amountMinor: 9900,
        quantity: 1,
        currency: "usd"
      },
      successPath: "/billing/success",
      cancelPath: "/billing/cancel"
    },
    clientIdempotencyKey: "idem_one_off_1",
    now: new Date("2026-02-20T16:30:00.000Z")
  });

  assert.ok(createCheckoutParams);
  assert.equal(createCheckoutParams.mode, "payment");
  assert.equal(response.checkoutType, "one_off");
  assert.equal(response.checkoutSession.providerCheckoutSessionId, "cs_one_off_1");
});

test("checkout orchestrator resolves one core plan price for subscription checkout", async () => {
  let capturedPlan = null;
  let createCheckoutParams = null;

  const service = createCheckoutOrchestratorService({
    billingRepository: {
      async transaction(work) {
        return work({});
      },
      async findBillableEntityById() {
        return {
          id: 1
        };
      },
      async lockSubscriptionsForEntity() {
        return [];
      },
      async lockCheckoutSessionsForEntity() {
        return [];
      },
      async findCurrentSubscriptionForEntity() {
        return null;
      },
      async findIdempotencyById() {
        return {
          id: 701,
          leaseVersion: 1,
          status: "pending",
          operationKey: "op_sub_core_price_701"
        };
      },
      async findPlanByCode() {
        return {
          id: 88,
          code: "pro_monthly",
          isActive: true
        };
      },
      async findCustomerByEntityProvider() {
        return {
          id: 11,
          providerCustomerId: "cus_sub_1"
        };
      },
      async updateIdempotencyById() {
        return {
          id: 701
        };
      }
    },
    billingPolicyService: {
      async resolveBillableEntityForWriteRequest() {
        return {
          billableEntity: {
            id: 1
          }
        };
      }
    },
    billingPricingService: {
      deploymentCurrency: "USD",
      async resolvePlanCheckoutPrice({ plan }) {
        capturedPlan = plan;
        return {
          providerPriceId: "price_base_1",
          usageType: "licensed"
        };
      },
      async resolvePhase1SellablePrice() {
        throw new Error("resolvePhase1SellablePrice should not be called when resolvePlanCheckoutPrice is available.");
      }
    },
    billingIdempotencyService: {
      async claimOrReplay() {
        return {
          type: "claimed",
          row: {
            id: 701,
            leaseVersion: 1,
            operationKey: "op_sub_core_price_701",
            providerIdempotencyKey: "prov_idem_sub_core_price_701"
          }
        };
      },
      async markFailed() {
        return null;
      },
      async markSucceeded() {
        return null;
      }
    },
    billingCheckoutSessionService: {
      async upsertBlockingCheckoutSession() {
        return null;
      },
      async markCheckoutSessionExpiredOrAbandoned() {
        return null;
      },
      async getBlockingCheckoutSession() {
        return null;
      },
      async cleanupExpiredBlockingSessions() {
        return null;
      }
    },
    billingProviderAdapter: {
      async getSdkProvenance() {
        return {
          providerSdkName: "stripe-node",
          providerSdkVersion: "14.25.0",
          providerApiVersion: "2024-06-20"
        };
      },
      async createCheckoutSession({ params }) {
        createCheckoutParams = params;
        return {
          id: "cs_sub_core_price_1",
          status: "open",
          url: "https://checkout.stripe.test/cs_sub_core_price_1",
          expires_at: Math.floor(Date.now() / 1000) + 300,
          customer: "cus_sub_1",
          subscription: null,
          metadata: params.metadata || {}
        };
      }
    },
    appPublicUrl: "https://app.example.test"
  });

  const response = await service.startCheckout({
    request: {
      headers: {}
    },
    user: {
      id: 11
    },
    payload: {
      planCode: "pro_monthly",
      successPath: "/billing/success",
      cancelPath: "/billing/cancel"
    },
    clientIdempotencyKey: "idem_sub_core_price_1",
    now: new Date("2026-02-20T16:40:00.000Z")
  });

  assert.equal(capturedPlan?.code, "pro_monthly");
  assert.ok(createCheckoutParams);
  assert.equal(createCheckoutParams.mode, "subscription");
  assert.deepEqual(createCheckoutParams.line_items, [
    {
      price: "price_base_1",
      quantity: 1
    }
  ]);
  assert.equal(response.checkoutType, "subscription");
});
