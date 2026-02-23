import assert from "node:assert/strict";
import test from "node:test";

import { createService as createWebhookSubscriptionProjectionService } from "../server/modules/billing/webhookSubscriptionProjection.service.js";

test("subscription projection service projects one_off invoice/payment rows without subscription", async () => {
  const lockCalls = [];
  const upsertPurchaseCalls = [];

  const projectionService = createWebhookSubscriptionProjectionService({
    billingRepository: {
      async findSubscriptionByProviderSubscriptionId() {
        return null;
      },
      async findCustomerByProviderCustomerId() {
        return null;
      },
      async findCustomerByEntityProvider() {
        return null;
      },
      async upsertCustomer(payload) {
        assert.equal(payload.billableEntityId, 77);
        assert.equal(payload.providerCustomerId, "cus_one_off_77");
        return {
          id: 88,
          billableEntityId: 77,
          provider: "stripe",
          providerCustomerId: "cus_one_off_77"
        };
      },
      async upsertBillingPurchase(payload) {
        upsertPurchaseCalls.push(payload);
        return {
          id: 501,
          ...payload
        };
      }
    },
    billingCheckoutSessionService: {},
    billingProviderAdapter: {
      async retrieveSubscription() {
        return null;
      },
      async retrieveInvoice() {
        return null;
      }
    },
    resolveBillableEntityIdFromCustomerId: async () => null,
    lockEntityAggregate: async ({ billableEntityId, operationKey }) => {
      lockCalls.push({
        billableEntityId,
        operationKey
      });
      return {
        idempotencyRow: null
      };
    },
    maybeFinalizePendingCheckoutIdempotency: async () => null
  });

  await projectionService.projectInvoiceAndPayment(
    {
      id: "in_one_off_77",
      subscription: null,
      customer: "cus_one_off_77",
      status: "paid",
      amount_due: 2500,
      amount_paid: 2500,
      amount_remaining: 0,
      currency: "usd",
      created: 1_771_200_000,
      due_date: null,
      payment_intent: "pi_one_off_77",
      status_transitions: {
        paid_at: 1_771_200_100
      },
      metadata: {
        billable_entity_id: "77",
        operation_key: "op_one_off_77"
      }
    },
    {
      trx: {},
      providerCreatedAt: new Date("2026-02-21T07:00:00.000Z"),
      providerEventId: "evt_invoice_paid_one_off_77",
      billingEventId: 321,
      eventType: "invoice.paid",
      billableEntityId: 77
    }
  );

  assert.equal(lockCalls.length, 1);
  assert.equal(lockCalls[0].billableEntityId, 77);
  assert.equal(lockCalls[0].operationKey, "op_one_off_77");

  assert.equal(upsertPurchaseCalls.length, 1);
  assert.equal(upsertPurchaseCalls[0].purchaseKind, "one_off");
  assert.equal(upsertPurchaseCalls[0].providerPaymentId, "pi_one_off_77");
  assert.equal(upsertPurchaseCalls[0].providerInvoiceId, "in_one_off_77");
  assert.equal(upsertPurchaseCalls[0].billingEventId, 321);
  assert.match(String(upsertPurchaseCalls[0].dedupeKey || ""), /^stripe:payment:/);
});

test("subscription projection service reuses canonical purchase dedupe key across duplicate invoice.paid projections", async () => {
  const seenDedupeKeys = new Set();
  let uniquePurchaseWrites = 0;
  let lastDedupeKey = null;

  const projectionService = createWebhookSubscriptionProjectionService({
    billingRepository: {
      async findSubscriptionByProviderSubscriptionId() {
        return null;
      },
      async findCustomerByProviderCustomerId() {
        return {
          id: 88,
          billableEntityId: 77,
          provider: "stripe",
          providerCustomerId: "cus_one_off_77"
        };
      },
      async findCustomerByEntityProvider() {
        return null;
      },
      async upsertCustomer() {
        throw new Error("upsertCustomer should not be called");
      },
      async upsertBillingPurchase(payload) {
        lastDedupeKey = String(payload.dedupeKey || "");
        if (!seenDedupeKeys.has(lastDedupeKey)) {
          seenDedupeKeys.add(lastDedupeKey);
          uniquePurchaseWrites += 1;
        }
        return {
          id: 700,
          ...payload
        };
      }
    },
    billingCheckoutSessionService: {},
    billingProviderAdapter: {
      async retrieveSubscription() {
        return null;
      },
      async retrieveInvoice() {
        return null;
      }
    },
    resolveBillableEntityIdFromCustomerId: async () => null,
    lockEntityAggregate: async () => ({ idempotencyRow: null }),
    maybeFinalizePendingCheckoutIdempotency: async () => null
  });

  const invoicePayload = {
    id: "in_one_off_77",
    subscription: null,
    customer: "cus_one_off_77",
    status: "paid",
    amount_due: 2500,
    amount_paid: 2500,
    amount_remaining: 0,
    currency: "usd",
    created: 1_771_200_000,
    due_date: null,
    payment_intent: "pi_one_off_77",
    status_transitions: {
      paid_at: 1_771_200_100
    },
    metadata: {
      billable_entity_id: "77",
      operation_key: "op_one_off_77"
    }
  };

  await projectionService.projectInvoiceAndPayment(invoicePayload, {
    trx: {},
    providerCreatedAt: new Date("2026-02-21T07:00:00.000Z"),
    providerEventId: "evt_invoice_paid_one_off_77_a",
    billingEventId: 321,
    eventType: "invoice.paid",
    billableEntityId: 77
  });

  await projectionService.projectInvoiceAndPayment(invoicePayload, {
    trx: {},
    providerCreatedAt: new Date("2026-02-21T07:00:01.000Z"),
    providerEventId: "evt_invoice_paid_one_off_77_b",
    billingEventId: 322,
    eventType: "invoice.paid",
    billableEntityId: 77
  });

  assert.equal(uniquePurchaseWrites, 1);
  assert.equal(lastDedupeKey, "stripe:payment:pi_one_off_77");
});

test("subscription projection service classifies invoice.paid as subscription_invoice from modern subscription path", async () => {
  const upsertPurchaseCalls = [];
  const subscriptionLookups = [];

  const projectionService = createWebhookSubscriptionProjectionService({
    billingRepository: {
      async findSubscriptionByProviderSubscriptionId({ providerSubscriptionId }) {
        subscriptionLookups.push(providerSubscriptionId);
        if (providerSubscriptionId !== "sub_modern_77") {
          return null;
        }
        return {
          id: 99,
          billableEntityId: 77,
          billingCustomerId: 88,
          planId: 42,
          provider: "stripe",
          providerSubscriptionId: "sub_modern_77",
          status: "active"
        };
      },
      async findCustomerByProviderCustomerId() {
        return {
          id: 88,
          billableEntityId: 77,
          provider: "stripe",
          providerCustomerId: "cus_77"
        };
      },
      async findCustomerByEntityProvider() {
        return null;
      },
      async findCustomerById(id) {
        if (Number(id) !== 88) {
          return null;
        }
        return {
          id: 88,
          billableEntityId: 77,
          provider: "stripe",
          providerCustomerId: "cus_77"
        };
      },
      async upsertCustomer() {
        throw new Error("upsertCustomer should not be called");
      },
      async findPlanByCheckoutProviderPriceId() {
        return {
          id: 42,
          name: "Intro"
        };
      },
      async upsertBillingPurchase(payload) {
        upsertPurchaseCalls.push(payload);
        return {
          id: 777,
          ...payload
        };
      }
    },
    billingCheckoutSessionService: {},
    billingProviderAdapter: {
      async retrieveSubscription() {
        return null;
      },
      async retrieveInvoice() {
        return null;
      }
    },
    resolveBillableEntityIdFromCustomerId: async () => null,
    lockEntityAggregate: async () => ({ idempotencyRow: null }),
    maybeFinalizePendingCheckoutIdempotency: async () => null
  });

  await projectionService.projectInvoiceAndPayment(
    {
      id: "in_sub_modern_77",
      subscription: null,
      customer: "cus_77",
      status: "paid",
      amount_due: 1000,
      amount_paid: 1000,
      amount_remaining: 0,
      currency: "usd",
      created: 1_771_200_000,
      due_date: null,
      payment_intent: "pi_sub_modern_77",
      billing_reason: "subscription_create",
      parent: {
        subscription_details: {
          subscription: "sub_modern_77"
        }
      },
      lines: {
        data: [
          {
            description: "1 × Intro plan (at $10.00 / month)",
            pricing: {
              price_details: {
                price: "price_intro_77"
              }
            },
            parent: {
              subscription_item_details: {
                subscription: "sub_modern_77"
              }
            }
          }
        ]
      },
      status_transitions: {
        paid_at: 1_771_200_100
      },
      metadata: {
        billable_entity_id: "77",
        operation_key: "op_sub_modern_77"
      }
    },
    {
      trx: {},
      providerCreatedAt: new Date("2026-02-21T07:00:00.000Z"),
      providerEventId: "evt_invoice_paid_sub_modern_77",
      billingEventId: 456,
      eventType: "invoice.paid",
      billableEntityId: 77
    }
  );

  assert.deepEqual(subscriptionLookups, ["sub_modern_77", "sub_modern_77"]);
  assert.equal(upsertPurchaseCalls.length, 1);
  assert.equal(upsertPurchaseCalls[0].purchaseKind, "subscription_invoice");
  assert.equal(upsertPurchaseCalls[0].displayName, "Plan charge - Intro");
  assert.equal(upsertPurchaseCalls[0].metadataJson.subscriptionId, "sub_modern_77");
  assert.equal(upsertPurchaseCalls[0].metadataJson.providerPriceId, "price_intro_77");
});

test("subscription projection service resolves one_off display name from billing product catalog by invoice price", async () => {
  const upsertPurchaseCalls = [];

  const projectionService = createWebhookSubscriptionProjectionService({
    billingRepository: {
      async findSubscriptionByProviderSubscriptionId() {
        return null;
      },
      async findCustomerByProviderCustomerId() {
        return {
          id: 88,
          billableEntityId: 77,
          provider: "stripe",
          providerCustomerId: "cus_one_off_77"
        };
      },
      async findCustomerByEntityProvider() {
        return null;
      },
      async upsertCustomer() {
        throw new Error("upsertCustomer should not be called");
      },
      async listProducts() {
        return [
          {
            id: 1,
            code: "ai_topup",
            name: "AI topup",
            isActive: true,
            price: {
              provider: "stripe",
              providerPriceId: "price_ai_topup_77"
            }
          }
        ];
      },
      async upsertBillingPurchase(payload) {
        upsertPurchaseCalls.push(payload);
        return {
          id: 900,
          ...payload
        };
      }
    },
    billingCheckoutSessionService: {},
    billingProviderAdapter: {
      async retrieveSubscription() {
        return null;
      },
      async retrieveInvoice() {
        return null;
      }
    },
    resolveBillableEntityIdFromCustomerId: async () => null,
    lockEntityAggregate: async () => ({ idempotencyRow: null }),
    maybeFinalizePendingCheckoutIdempotency: async () => null
  });

  await projectionService.projectInvoiceAndPayment(
    {
      id: "in_one_off_product_77",
      subscription: null,
      customer: "cus_one_off_77",
      status: "paid",
      amount_due: 1000,
      amount_paid: 1000,
      amount_remaining: 0,
      currency: "usd",
      created: 1_771_200_000,
      due_date: null,
      payment_intent: "pi_one_off_product_77",
      billing_reason: "manual",
      lines: {
        data: [
          {
            description: "AI credit",
            pricing: {
              price_details: {
                price: "price_ai_topup_77"
              }
            }
          }
        ]
      },
      status_transitions: {
        paid_at: 1_771_200_100
      },
      metadata: {
        billable_entity_id: "77",
        operation_key: "op_one_off_product_77"
      }
    },
    {
      trx: {},
      providerCreatedAt: new Date("2026-02-21T07:00:00.000Z"),
      providerEventId: "evt_invoice_paid_one_off_product_77",
      billingEventId: 654,
      eventType: "invoice.paid",
      billableEntityId: 77
    }
  );

  assert.equal(upsertPurchaseCalls.length, 1);
  assert.equal(upsertPurchaseCalls[0].purchaseKind, "one_off");
  assert.equal(upsertPurchaseCalls[0].displayName, "AI topup");
  assert.equal(upsertPurchaseCalls[0].metadataJson.providerPriceId, "price_ai_topup_77");
});
