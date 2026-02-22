import assert from "node:assert/strict";
import test from "node:test";

import { createService as createWebhookSubscriptionProjectionService } from "../server/modules/billing/webhookSubscriptionProjection.service.js";

test("subscription projection service projects one_off invoice/payment rows without subscription", async () => {
  const lockCalls = [];
  const upsertInvoiceCalls = [];
  const upsertPaymentCalls = [];
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
      async findInvoiceByProviderInvoiceId() {
        return null;
      },
      async upsertInvoice(payload) {
        upsertInvoiceCalls.push(payload);
        return {
          id: 990,
          ...payload
        };
      },
      async findPaymentByProviderPaymentId() {
        return null;
      },
      async upsertPayment(payload) {
        upsertPaymentCalls.push(payload);
        return payload;
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

  assert.equal(upsertInvoiceCalls.length, 1);
  assert.equal(upsertInvoiceCalls[0].subscriptionId, null);
  assert.equal(upsertInvoiceCalls[0].billableEntityId, 77);
  assert.equal(upsertInvoiceCalls[0].billingCustomerId, 88);
  assert.equal(upsertInvoiceCalls[0].providerInvoiceId, "in_one_off_77");

  assert.equal(upsertPaymentCalls.length, 1);
  assert.equal(upsertPaymentCalls[0].invoiceId, 990);
  assert.equal(upsertPaymentCalls[0].providerPaymentId, "pi_one_off_77");
  assert.equal(upsertPaymentCalls[0].status, "paid");

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
      async findInvoiceByProviderInvoiceId() {
        return null;
      },
      async upsertInvoice(payload) {
        return { id: 990, ...payload };
      },
      async findPaymentByProviderPaymentId() {
        return null;
      },
      async upsertPayment(payload) {
        return payload;
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
