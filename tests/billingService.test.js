import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../server/lib/errors.js";
import { toCanonicalJson, toSha256Hex } from "../server/modules/billing/canonicalJson.js";
import { BILLING_FAILURE_CODES } from "../server/modules/billing/constants.js";
import { createService as createBillingService } from "../server/modules/billing/service.js";

function createCatalogProductStub({
  id = 1,
  code = "product_stub",
  providerPriceId = "price_catalog_stub",
  interval = null,
  isActive = true
} = {}) {
  return {
    id,
    code,
    name: code,
    description: null,
    productKind: "one_off",
    price: {
      provider: "stripe",
      providerPriceId,
      providerProductId: "prod_stub",
      interval,
      intervalCount: interval ? 1 : null,
      currency: "USD",
      unitAmountMinor: 1000
    },
    isActive,
    metadataJson: {},
    createdAt: "2026-02-20T00:00:00.000Z",
    updatedAt: "2026-02-20T00:00:00.000Z"
  };
}

function createBaseBillingService(overrides = {}) {
  return createBillingService({
    billingRepository: {
      async listPlans() {
        return [];
      },
      async listPlanEntitlementsForPlan() {
        return [];
      },
      async findCurrentSubscriptionForEntity() {
        return null;
      },
      async findCustomerByEntityProvider() {
        return null;
      },
      async listProducts() {
        return [
          createCatalogProductStub({ id: 1, code: "catalog_1", providerPriceId: "price_catalog_1" }),
          createCatalogProductStub({ id: 2, code: "catalog_612", providerPriceId: "price_catalog_612" }),
          createCatalogProductStub({ id: 3, code: "catalog_633", providerPriceId: "price_catalog_633" })
        ];
      },
      async updateIdempotencyById() {
        return null;
      },
      ...overrides.billingRepository
    },
    billingPolicyService: {
      async resolveBillableEntityForReadRequest() {
        return {
          billableEntity: {
            id: 41
          }
        };
      },
      async resolveBillableEntityForWriteRequest() {
        return {
          billableEntity: {
            id: 41
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
      async claimOrReplay() {
        return {
          type: "replay_succeeded",
          row: {
            responseJson: {
              provider: "stripe",
              portalSession: {
                id: "bps_replay",
                url: "https://billing.stripe.test/replay"
              }
            }
          }
        };
      },
      async recoverPendingRequest() {
        throw new Error("not expected");
      },
      async assertProviderRequestHashStable() {
        return null;
      },
      async markSucceeded() {
        return null;
      },
      async markFailed() {
        return null;
      },
      async markExpired() {
        return null;
      },
      ...overrides.billingIdempotencyService
    },
    billingCheckoutOrchestrator: {
      async startCheckout() {
        throw new Error("not expected");
      },
      ...overrides.billingCheckoutOrchestrator
    },
    billingProviderAdapter: {
      async createPaymentLink() {
        return {
          id: "plink_default",
          url: "https://buy.stripe.test/default",
          active: true
        };
      },
      async createPrice() {
        return {
          id: "price_default"
        };
      },
      async createBillingPortalSession() {
        return {
          id: "bps_default",
          url: "https://billing.stripe.test/default"
        };
      },
      async getSdkProvenance() {
        return {
          providerSdkName: "stripe-node",
          providerSdkVersion: "17.1.0",
          providerApiVersion: "2024-06-20"
        };
      },
      ...overrides.billingProviderAdapter
    },
    appPublicUrl: "https://app.example.test",
    providerReplayWindowSeconds: 82800,
    observabilityService: overrides.observabilityService || null
  });
}

test("billing service listPlans returns plan entries with core price mapping", async () => {
  const service = createBaseBillingService({
    billingRepository: {
      async listPlans() {
        return [
          {
            id: 100,
            code: "pro_monthly",
            name: "Pro",
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
            createdAt: "2026-02-20T00:00:00.000Z",
            updatedAt: "2026-02-20T00:00:00.000Z"
          }
        ];
      },
      async listPlanEntitlementsForPlan() {
        return [];
      }
    }
  });

  const response = await service.listPlans({});

  assert.equal(response.plans.length, 1);
  assert.equal(response.plans[0].code, "pro_monthly");
  assert.equal(response.plans[0].corePrice.providerPriceId, "price_pro_monthly");
});

test("billing service createPortalSession recovers recover_pending idempotency rows", async () => {
  const markSucceededCalls = [];
  const now = new Date("2026-02-20T02:00:00.000Z");
  const replayParams = {
    customer: "cus_123",
    return_url: "https://app.example.test/settings/billing"
  };
  const replayHash = toSha256Hex(toCanonicalJson(replayParams));

  const service = createBaseBillingService({
    billingIdempotencyService: {
      async claimOrReplay() {
        return {
          type: "recover_pending",
          row: {
            id: 88
          }
        };
      },
      async recoverPendingRequest() {
        return {
          type: "recovery_leased",
          row: {
            id: 88,
            providerRequestParamsJson: replayParams,
            providerRequestHash: replayHash,
            providerIdempotencyKey: "prov_idem_123",
            providerIdempotencyReplayDeadlineAt: new Date(now.getTime() + 30_000).toISOString()
          },
          expectedLeaseVersion: 7
        };
      },
      async assertProviderRequestHashStable({ candidateProviderRequestHash }) {
        assert.equal(candidateProviderRequestHash, replayHash);
      },
      async markSucceeded(payload) {
        markSucceededCalls.push(payload);
      }
    },
    billingProviderAdapter: {
      async createBillingPortalSession({ params, idempotencyKey }) {
        assert.deepEqual(params, replayParams);
        assert.equal(idempotencyKey, "prov_idem_123");
        return {
          id: "bps_recovered",
          url: "https://billing.stripe.test/recovered"
        };
      }
    }
  });

  const response = await service.createPortalSession({
    request: {
      headers: {}
    },
    user: {
      id: 11
    },
    payload: {
      returnPath: "/settings/billing"
    },
    clientIdempotencyKey: "idem_123",
    now
  });

  assert.equal(response.provider, "stripe");
  assert.equal(response.portalSession.id, "bps_recovered");
  assert.equal(response.portalSession.url, "https://billing.stripe.test/recovered");
  assert.equal(markSucceededCalls.length, 1);
  assert.equal(markSucceededCalls[0].idempotencyRowId, 88);
  assert.equal(markSucceededCalls[0].leaseVersion, 7);
  assert.equal(markSucceededCalls[0].providerSessionId, "bps_recovered");
});

test("billing service createPortalSession keeps pending state for indeterminate provider outcomes", async () => {
  const markFailedCalls = [];
  const updatedIdempotencyRows = [];
  const now = new Date("2026-02-20T02:30:00.000Z");

  const service = createBaseBillingService({
    billingRepository: {
      async findCurrentSubscriptionForEntity() {
        return {
          id: 501
        };
      },
      async findCustomerByEntityProvider() {
        return {
          providerCustomerId: "cus_portal_123"
        };
      },
      async updateIdempotencyById(id, patch) {
        updatedIdempotencyRows.push({
          id,
          patch
        });
        return {
          id
        };
      }
    },
    billingIdempotencyService: {
      async claimOrReplay() {
        return {
          type: "claimed",
          row: {
            id: 91,
            providerIdempotencyKey: "portal_idem_91"
          }
        };
      },
      async markFailed(payload) {
        markFailedCalls.push(payload);
      }
    },
    billingProviderAdapter: {
      async createBillingPortalSession() {
        const error = new Error("rate limit");
        error.statusCode = 429;
        throw error;
      }
    }
  });

  await assert.rejects(
    () =>
      service.createPortalSession({
        request: {
          headers: {}
        },
        user: {
          id: 11
        },
        payload: {
          returnPath: "/settings/billing"
        },
        clientIdempotencyKey: "idem_429",
        now
      }),
    (error) =>
      error instanceof AppError &&
      Number(error.statusCode) === 409 &&
      String(error.code || "") === BILLING_FAILURE_CODES.REQUEST_IN_PROGRESS
  );

  assert.equal(markFailedCalls.length, 0);
  assert.equal(updatedIdempotencyRows.length, 1);
  assert.equal(updatedIdempotencyRows[0].id, 91);
});

test("billing service portal recovery fails closed when replay deadline is missing", async () => {
  const markFailedCalls = [];
  const now = new Date("2026-02-20T03:00:00.000Z");
  const replayParams = {
    customer: "cus_123",
    return_url: "https://app.example.test/settings/billing"
  };
  const replayHash = toSha256Hex(toCanonicalJson(replayParams));

  const service = createBaseBillingService({
    billingIdempotencyService: {
      async claimOrReplay() {
        return {
          type: "recover_pending",
          row: {
            id: 98
          }
        };
      },
      async recoverPendingRequest() {
        return {
          type: "recovery_leased",
          row: {
            id: 98,
            providerRequestParamsJson: replayParams,
            providerRequestHash: replayHash,
            providerIdempotencyKey: "prov_idem_98",
            providerIdempotencyReplayDeadlineAt: null
          },
          expectedLeaseVersion: 12
        };
      },
      async assertProviderRequestHashStable() {
        return null;
      },
      async markFailed(payload) {
        markFailedCalls.push(payload);
      }
    }
  });

  await assert.rejects(
    () =>
      service.createPortalSession({
        request: {
          headers: {}
        },
        user: {
          id: 11
        },
        payload: {
          returnPath: "/settings/billing"
        },
        clientIdempotencyKey: "idem_missing_deadline",
        now
      }),
    (error) =>
      error instanceof AppError &&
      Number(error.statusCode) === 409 &&
      String(error.code || "") === BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID
  );

  assert.equal(markFailedCalls.length, 1);
  assert.equal(markFailedCalls[0].idempotencyRowId, 98);
  assert.equal(markFailedCalls[0].leaseVersion, 12);
  assert.equal(markFailedCalls[0].failureCode, BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID);
});

test("billing service createPortalSession fails with portal_subscription_required when no subscription exists", async () => {
  const markFailedCalls = [];
  const service = createBaseBillingService({
    billingIdempotencyService: {
      async claimOrReplay() {
        return {
          type: "claimed",
          row: {
            id: 111,
            providerIdempotencyKey: "prov_idem_111"
          }
        };
      },
      async markFailed(payload) {
        markFailedCalls.push(payload);
      }
    }
  });

  await assert.rejects(
    () =>
      service.createPortalSession({
        request: {
          headers: {}
        },
        user: {
          id: 11
        },
        payload: {
          returnPath: "/settings/billing"
        },
        clientIdempotencyKey: "idem_portal_requires_subscription",
        now: new Date("2026-02-20T03:30:00.000Z")
      }),
    (error) =>
      error instanceof AppError &&
      Number(error.statusCode) === 409 &&
      String(error.code || "") === BILLING_FAILURE_CODES.PORTAL_SUBSCRIPTION_REQUIRED
  );

  assert.equal(markFailedCalls.length, 1);
  assert.equal(markFailedCalls[0].idempotencyRowId, 111);
  assert.equal(markFailedCalls[0].failureCode, BILLING_FAILURE_CODES.PORTAL_SUBSCRIPTION_REQUIRED);
});

test("billing service createPortalSession claimed flow preserves lease fencing metadata on success", async () => {
  const markSucceededCalls = [];

  const service = createBaseBillingService({
    billingRepository: {
      async findCurrentSubscriptionForEntity() {
        return {
          id: 611
        };
      },
      async findCustomerByEntityProvider() {
        return {
          providerCustomerId: "cus_lease_611"
        };
      },
      async updateIdempotencyById(id) {
        return {
          id
        };
      }
    },
    billingIdempotencyService: {
      async claimOrReplay() {
        return {
          type: "claimed",
          row: {
            id: 611,
            leaseVersion: 13,
            providerIdempotencyKey: "prov_idem_611"
          }
        };
      },
      async markSucceeded(payload) {
        markSucceededCalls.push(payload);
      }
    },
    billingProviderAdapter: {
      async createBillingPortalSession() {
        return {
          id: "bps_611",
          url: "https://billing.stripe.test/bps_611"
        };
      }
    }
  });

  await service.createPortalSession({
    request: {
      headers: {}
    },
    user: {
      id: 11
    },
    payload: {
      returnPath: "/settings/billing"
    },
    clientIdempotencyKey: "idem_portal_lease",
    now: new Date("2026-02-21T03:40:00.000Z")
  });

  assert.equal(markSucceededCalls.length, 1);
  assert.equal(markSucceededCalls[0].idempotencyRowId, 611);
  assert.equal(markSucceededCalls[0].leaseVersion, 13);
});

test("billing service createPaymentLink supports catalog and ad_hoc line items", async () => {
  const updateCalls = [];
  const markSucceededCalls = [];
  const createdPriceCalls = [];
  const createdPaymentLinkCalls = [];

  const service = createBaseBillingService({
    billingRepository: {
      async updateIdempotencyById(id, patch) {
        updateCalls.push({
          id,
          patch
        });
        return {
          id
        };
      }
    },
    billingIdempotencyService: {
      async claimOrReplay() {
        return {
          type: "claimed",
          row: {
            id: 201,
            operationKey: "op_payment_link_201",
            billableEntityId: 41,
            providerIdempotencyKey: "prov_idem_payment_link_201"
          }
        };
      },
      async markSucceeded(payload) {
        markSucceededCalls.push(payload);
      },
      async markFailed() {
        return null;
      }
    },
    billingProviderAdapter: {
      async createPrice({ params, idempotencyKey }) {
        createdPriceCalls.push({
          params,
          idempotencyKey
        });
        return {
          id: "price_ad_hoc_1"
        };
      },
      async createPaymentLink({ params, idempotencyKey }) {
        createdPaymentLinkCalls.push({
          params,
          idempotencyKey
        });
        return {
          id: "plink_201",
          url: "https://buy.stripe.test/plink_201",
          active: true
        };
      }
    }
  });

  const response = await service.createPaymentLink({
    request: {
      headers: {}
    },
    user: {
      id: 11
    },
    payload: {
      successPath: "/billing/success",
      lineItems: [
        {
          priceId: "price_catalog_1",
          quantity: 2
        },
        {
          name: "Migration package",
          amountMinor: 25000,
          quantity: 1,
          currency: "usd"
        }
      ]
    },
    clientIdempotencyKey: "idem_payment_link_201",
    now: new Date("2026-02-21T06:00:00.000Z")
  });

  assert.equal(response.provider, "stripe");
  assert.equal(response.billableEntityId, 41);
  assert.equal(response.operationKey, "op_payment_link_201");
  assert.equal(response.paymentLink.id, "plink_201");
  assert.equal(createdPriceCalls.length, 1);
  assert.equal(createdPriceCalls[0].idempotencyKey, "prov_idem_payment_link_201:price:1");
  assert.equal(createdPaymentLinkCalls.length, 1);
  assert.deepEqual(createdPaymentLinkCalls[0].params.line_items, [
    {
      price: "price_catalog_1",
      quantity: 2
    },
    {
      price: "price_ad_hoc_1",
      quantity: 1
    }
  ]);
  assert.equal(createdPaymentLinkCalls[0].params.invoice_creation.enabled, true);
  assert.equal(updateCalls.length, 2);
  assert.equal(updateCalls[0].id, 201);
  assert.ok(updateCalls[0].patch.providerIdempotencyReplayDeadlineAt);
  assert.equal(updateCalls[1].id, 201);
  assert.equal(updateCalls[1].patch.providerRequestSchemaVersion, "stripe_payment_link_create_params_v1");
  assert.equal(markSucceededCalls.length, 1);
  assert.equal(markSucceededCalls[0].idempotencyRowId, 201);
  assert.equal(markSucceededCalls[0].providerSessionId, "plink_201");
});

test("billing service createPaymentLink claimed flow preserves lease fencing metadata on success", async () => {
  const markSucceededCalls = [];

  const service = createBaseBillingService({
    billingRepository: {
      async updateIdempotencyById(id) {
        return {
          id
        };
      }
    },
    billingIdempotencyService: {
      async claimOrReplay() {
        return {
          type: "claimed",
          row: {
            id: 612,
            leaseVersion: 21,
            operationKey: "op_payment_link_612",
            billableEntityId: 41,
            providerIdempotencyKey: "prov_idem_payment_link_612"
          }
        };
      },
      async markSucceeded(payload) {
        markSucceededCalls.push(payload);
      }
    },
    billingProviderAdapter: {
      async createPaymentLink() {
        return {
          id: "plink_612",
          url: "https://buy.stripe.test/plink_612",
          active: true
        };
      }
    }
  });

  await service.createPaymentLink({
    request: {
      headers: {}
    },
    user: {
      id: 11
    },
    payload: {
      successPath: "/billing/success",
      lineItems: [
        {
          priceId: "price_catalog_612",
          quantity: 1
        }
      ]
    },
    clientIdempotencyKey: "idem_payment_link_612",
    now: new Date("2026-02-21T07:00:00.000Z")
  });

  assert.equal(markSucceededCalls.length, 1);
  assert.equal(markSucceededCalls[0].idempotencyRowId, 612);
  assert.equal(markSucceededCalls[0].leaseVersion, 21);
});

test("billing service createPaymentLink recovers pending requests by rebuilding provider params", async () => {
  const updateCalls = [];
  const markSucceededCalls = [];

  const service = createBaseBillingService({
    billingRepository: {
      async updateIdempotencyById(id, patch, options = {}) {
        updateCalls.push({
          id,
          patch,
          options
        });
        return {
          id,
          ...patch
        };
      }
    },
    billingIdempotencyService: {
      async claimOrReplay() {
        return {
          type: "recover_pending",
          row: {
            id: 305
          }
        };
      },
      async recoverPendingRequest() {
        return {
          type: "recovery_leased",
          row: {
            id: 305,
            operationKey: "op_payment_link_305",
            billableEntityId: 41,
            providerIdempotencyKey: "prov_idem_payment_link_305",
            providerIdempotencyReplayDeadlineAt: "2026-02-21T08:00:00.000Z",
            providerRequestParamsJson: null,
            providerRequestHash: null,
            normalizedRequestJson: {
              action: "payment_link",
              billableEntityId: 41,
              successPath: "/billing/success",
              lineItems: [
                {
                  type: "ad_hoc",
                  name: "Implementation package",
                  amountMinor: 50000,
                  quantity: 1,
                  currency: "USD"
                }
              ]
            }
          },
          expectedLeaseVersion: 9
        };
      },
      async assertProviderRequestHashStable() {
        return null;
      },
      async markSucceeded(payload) {
        markSucceededCalls.push(payload);
      },
      async markFailed() {
        return null;
      },
      async markExpired() {
        return null;
      }
    },
    billingProviderAdapter: {
      async createPrice() {
        return {
          id: "price_recovered_1"
        };
      },
      async createPaymentLink() {
        return {
          id: "plink_recovered_305",
          url: "https://buy.stripe.test/plink_recovered_305",
          active: true
        };
      }
    }
  });

  const response = await service.createPaymentLink({
    request: {
      headers: {}
    },
    user: {
      id: 11
    },
    payload: {
      successPath: "/billing/success",
      lineItems: [
        {
          name: "Implementation package",
          amountMinor: 50000
        }
      ]
    },
    clientIdempotencyKey: "idem_payment_link_305",
    now: new Date("2026-02-21T06:30:00.000Z")
  });

  assert.equal(response.paymentLink.id, "plink_recovered_305");
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].id, 305);
  assert.equal(Number(updateCalls[0].options.expectedLeaseVersion), 9);
  assert.equal(markSucceededCalls.length, 1);
  assert.equal(markSucceededCalls[0].leaseVersion, 9);
});

test("billing service createPaymentLink maps deterministic provider failures to terminal provider error", async () => {
  const markFailedCalls = [];

  const service = createBaseBillingService({
    billingRepository: {
      async updateIdempotencyById(id) {
        return { id };
      }
    },
    billingIdempotencyService: {
      async claimOrReplay() {
        return {
          type: "claimed",
          row: {
            id: 411,
            operationKey: "op_payment_link_411",
            billableEntityId: 41,
            providerIdempotencyKey: "prov_idem_payment_link_411"
          }
        };
      },
      async markFailed(payload) {
        markFailedCalls.push(payload);
      }
    },
    billingProviderAdapter: {
      async createPaymentLink() {
        throw new AppError(400, "provider payload is invalid", {
          code: "provider_invalid_payload"
        });
      }
    }
  });

  await assert.rejects(
    () =>
      service.createPaymentLink({
        request: {
          headers: {}
        },
        user: {
          id: 11
        },
        payload: {
          successPath: "/billing/success",
          lineItems: [
            {
              priceId: "price_catalog_1",
              quantity: 1
            }
          ]
        },
        clientIdempotencyKey: "idem_payment_link_411",
        now: new Date("2026-02-21T08:00:00.000Z")
      }),
    (error) =>
      Number(error?.statusCode || 0) === 502 &&
      String(error?.code || "") === BILLING_FAILURE_CODES.CHECKOUT_PROVIDER_ERROR
  );

  assert.equal(markFailedCalls.length, 1);
  assert.equal(markFailedCalls[0].idempotencyRowId, 411);
  assert.equal(markFailedCalls[0].failureCode, BILLING_FAILURE_CODES.CHECKOUT_PROVIDER_ERROR);
  assert.equal(markFailedCalls[0].failureReason, "provider payload is invalid");
});

test("billing service createPaymentLink fails closed on local prepare errors instead of returning in-progress", async () => {
  const markFailedCalls = [];

  const service = createBaseBillingService({
    billingRepository: {
      async updateIdempotencyById(id) {
        return { id };
      }
    },
    billingIdempotencyService: {
      async claimOrReplay() {
        return {
          type: "claimed",
          row: {
            id: 512,
            leaseVersion: 3,
            operationKey: "op_payment_link_512",
            billableEntityId: 41,
            providerIdempotencyKey: "prov_idem_payment_link_512"
          }
        };
      },
      async markFailed(payload) {
        markFailedCalls.push(payload);
      }
    },
    billingProviderAdapter: {
      async createPrice() {
        throw new AppError(500, "Provider price creation is not available.");
      },
      async createPaymentLink() {
        return {
          id: "plink_512",
          url: "https://buy.stripe.test/plink_512",
          active: true
        };
      }
    }
  });

  await assert.rejects(
    () =>
      service.createPaymentLink({
        request: {
          headers: {}
        },
        user: {
          id: 11
        },
        payload: {
          successPath: "/billing/success",
          lineItems: [
            {
              name: "Missing createPrice support",
              amountMinor: 2500,
              quantity: 1,
              currency: "USD"
            }
          ]
        },
        clientIdempotencyKey: "idem_payment_link_512",
        now: new Date("2026-02-21T08:30:00.000Z")
      }),
    (error) =>
      Number(error?.statusCode || 0) === 409 &&
      String(error?.code || "") === BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID
  );

  assert.equal(markFailedCalls.length, 1);
  assert.equal(markFailedCalls[0].idempotencyRowId, 512);
  assert.equal(markFailedCalls[0].leaseVersion, 3);
  assert.equal(markFailedCalls[0].failureCode, BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID);
  assert.match(String(markFailedCalls[0].failureReason || ""), /price creation is not available/i);
});

test("billing service createPaymentLink rejects recurring catalog prices for one-off purchases", async () => {
  const service = createBaseBillingService({
    billingRepository: {
      async listProducts() {
        return [
          createCatalogProductStub({
            id: 22,
            code: "topup_bad",
            providerPriceId: "price_topup_bad",
            interval: "month"
          })
        ];
      }
    }
  });

  await assert.rejects(
    () =>
      service.createPaymentLink({
        request: {
          headers: {}
        },
        user: {
          id: 11
        },
        payload: {
          successPath: "/billing/success",
          lineItems: [
            {
              priceId: "price_topup_bad",
              quantity: 1
            }
          ]
        },
        clientIdempotencyKey: "idem_payment_link_recurring_bad",
        now: new Date("2026-02-21T09:30:00.000Z")
      }),
    (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(Number(error.status || error.statusCode || 0), 400);
      assert.equal(String(error.message || ""), "Validation failed.");
      assert.equal(
        String(error?.details?.fieldErrors?.["lineItems[0].priceId"] || "").toLowerCase().includes("recurring"),
        true
      );
      return true;
    }
  );
});

test("billing service payment-link recovery fails closed when rebuilt request is invalid", async () => {
  const markFailedCalls = [];

  const service = createBaseBillingService({
    billingRepository: {
      async updateIdempotencyById(id, patch) {
        return {
          id,
          ...patch
        };
      }
    },
    billingIdempotencyService: {
      async claimOrReplay() {
        return {
          type: "recover_pending",
          row: {
            id: 633
          }
        };
      },
      async recoverPendingRequest() {
        return {
          type: "recovery_leased",
          row: {
            id: 633,
            operationKey: "op_payment_link_633",
            billableEntityId: 41,
            providerIdempotencyKey: "prov_idem_payment_link_633",
            providerIdempotencyReplayDeadlineAt: "2026-02-21T09:00:00.000Z",
            providerRequestParamsJson: null,
            providerRequestHash: null,
            normalizedRequestJson: {
              action: "payment_link",
              billableEntityId: 41,
              successPath: "/billing/success",
              lineItems: []
            }
          },
          expectedLeaseVersion: 5
        };
      },
      async markFailed(payload) {
        markFailedCalls.push(payload);
      },
      async markExpired() {
        return null;
      },
      async assertProviderRequestHashStable() {
        return null;
      }
    },
    billingProviderAdapter: {
      async createPrice() {
        throw new Error("createPrice should not be called for invalid recovery payloads");
      },
      async createPaymentLink() {
        throw new Error("createPaymentLink should not be called for invalid recovery payloads");
      }
    }
  });

  await assert.rejects(
    () =>
      service.createPaymentLink({
        request: {
          headers: {}
        },
        user: {
          id: 11
        },
        payload: {
          successPath: "/billing/success",
          lineItems: [
            {
              priceId: "price_catalog_633",
              quantity: 1
            }
          ]
        },
        clientIdempotencyKey: "idem_payment_link_633",
        now: new Date("2026-02-21T08:40:00.000Z")
      }),
    (error) =>
      Number(error?.statusCode || 0) === 409 &&
      String(error?.code || "") === BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID
  );

  assert.equal(markFailedCalls.length, 1);
  assert.equal(markFailedCalls[0].idempotencyRowId, 633);
  assert.equal(markFailedCalls[0].leaseVersion, 5);
  assert.equal(markFailedCalls[0].failureCode, BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID);
});
