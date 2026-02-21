import assert from "node:assert/strict";
import test from "node:test";

import { createService as createBillingWebhookService } from "../server/modules/billing/webhook.service.js";
import { createService as createStripeWebhookTranslationService } from "../server/modules/billing/providers/stripe/webhookTranslation.service.js";
import { createService as createPaddleWebhookTranslationService } from "../server/modules/billing/providers/paddle/webhookTranslation.service.js";
import { createService as createBillingWebhookTranslationRegistryService } from "../server/modules/billing/providers/shared/webhookTranslationRegistry.service.js";

function createWebhookTranslationRegistry() {
  return createBillingWebhookTranslationRegistryService({
    translators: [createStripeWebhookTranslationService(), createPaddleWebhookTranslationService()],
    defaultProvider: "stripe"
  });
}

function createWebhookService(options = {}) {
  return createBillingWebhookService({
    billingWebhookTranslationRegistryService: createWebhookTranslationRegistry(),
    ...options
  });
}

function createInMemoryWebhookRepository() {
  let nextId = 1;
  const rowsByProviderEventId = new Map();
  const rowsById = new Map();

  function mapRow(row) {
    if (!row) {
      return null;
    }

    return {
      ...row
    };
  }

  return {
    async transaction(work) {
      return work({});
    },
    async findWebhookEventByProviderEventId({ providerEventId }) {
      return mapRow(rowsByProviderEventId.get(String(providerEventId)));
    },
    async insertWebhookEvent(payload) {
      const id = nextId;
      nextId += 1;
      const row = {
        id,
        provider: String(payload.provider || "stripe"),
        providerEventId: String(payload.providerEventId || ""),
        billableEntityId: payload.billableEntityId == null ? null : Number(payload.billableEntityId),
        operationKey: payload.operationKey == null ? null : String(payload.operationKey),
        eventType: String(payload.eventType || ""),
        providerCreatedAt: payload.providerCreatedAt || null,
        status: String(payload.status || "received"),
        receivedAt: payload.receivedAt || null,
        processingStartedAt: payload.processingStartedAt || null,
        processedAt: payload.processedAt || null,
        lastFailedAt: payload.lastFailedAt || null,
        attemptCount: Number(payload.attemptCount || 0),
        payloadJson: payload.payloadJson || {},
        payloadRetentionUntil: payload.payloadRetentionUntil || null,
        errorText: payload.errorText || null
      };

      rowsByProviderEventId.set(row.providerEventId, row);
      rowsById.set(row.id, row);
      return mapRow(row);
    },
    async updateWebhookEventById(id, patch) {
      const current = rowsById.get(Number(id));
      if (!current) {
        return null;
      }

      const next = {
        ...current,
        ...patch
      };
      rowsById.set(next.id, next);
      rowsByProviderEventId.set(next.providerEventId, next);
      return mapRow(next);
    },
    async findCustomerByProviderCustomerId() {
      return null;
    },
    __rows: rowsByProviderEventId
  };
}

test("billing webhook service persists failed webhook event state when projection fails", async () => {
  const billingRepository = createInMemoryWebhookRepository();
  const webhookService = createWebhookService({
    billingRepository,
    billingProviderAdapter: {
      async verifyWebhookEvent() {
        return {
          id: "evt_projection_failure",
          type: "checkout.session.completed",
          created: 1_771_000_000,
          data: {
            object: {
              id: "cs_missing_correlation",
              metadata: {}
            }
          }
        };
      },
      async retrieveCheckoutSession() {
        return null;
      },
      async retrieveSubscription() {
        return null;
      },
      async retrieveInvoice() {
        return null;
      }
    },
    billingCheckoutSessionService: {},
    stripeWebhookEndpointSecret: "whsec_test"
  });

  await assert.rejects(
    () =>
      webhookService.processProviderEvent({
        provider: "stripe",
        rawBody: Buffer.from("{}"),
        signatureHeader: "t=123,v1=abc"
      }),
    /correlation/i
  );

  const failedRow = billingRepository.__rows.get("evt_projection_failure");
  assert.ok(failedRow, "expected webhook row to exist after failed processing");
  assert.equal(failedRow.status, "failed");
  assert.ok(String(failedRow.errorText || "").length > 0);
});

test("billing webhook service captures operation_key correlation on failed events", async () => {
  const billingRepository = createInMemoryWebhookRepository();
  const webhookService = createWebhookService({
    billingRepository,
    billingProviderAdapter: {
      async verifyWebhookEvent() {
        return {
          id: "evt_operation_key_only",
          type: "checkout.session.completed",
          created: 1_771_000_111,
          data: {
            object: {
              id: "cs_operation_key_only",
              metadata: {
                operation_key: "op_test_123"
              }
            }
          }
        };
      },
      async retrieveCheckoutSession() {
        return null;
      },
      async retrieveSubscription() {
        return null;
      },
      async retrieveInvoice() {
        return null;
      }
    },
    billingCheckoutSessionService: {},
    stripeWebhookEndpointSecret: "whsec_test"
  });

  await assert.rejects(
    () =>
      webhookService.processProviderEvent({
        provider: "stripe",
        rawBody: Buffer.from("{}"),
        signatureHeader: "t=123,v1=abc"
      }),
    /correlation/i
  );

  const failedRow = billingRepository.__rows.get("evt_operation_key_only");
  assert.ok(failedRow);
  assert.equal(failedRow.status, "failed");
  assert.equal(failedRow.operationKey, "op_test_123");
});

test("billing webhook service resolves billable entity correlation from customer ownership", async () => {
  const billingRepository = createInMemoryWebhookRepository();
  billingRepository.findCustomerByProviderCustomerId = async ({ providerCustomerId }) => {
    if (providerCustomerId === "cus_owned_77") {
      return {
        billableEntityId: 77
      };
    }
    return null;
  };

  const webhookService = createWebhookService({
    billingRepository,
    billingProviderAdapter: {
      async verifyWebhookEvent() {
        return {
          id: "evt_customer_correlated",
          type: "checkout.session.completed",
          created: 1_771_000_222,
          data: {
            object: {
              id: "cs_customer_correlated",
              customer: "cus_owned_77",
              metadata: {
                operation_key: "op_customer_77"
              }
            }
          }
        };
      },
      async retrieveCheckoutSession() {
        return null;
      },
      async retrieveSubscription() {
        return null;
      },
      async retrieveInvoice() {
        return null;
      }
    },
    billingCheckoutSessionService: {},
    stripeWebhookEndpointSecret: "whsec_test"
  });

  await assert.rejects(
    () =>
      webhookService.processProviderEvent({
        provider: "stripe",
        rawBody: Buffer.from("{}"),
        signatureHeader: "t=123,v1=abc"
      }),
    /findBillableEntityById is not a function|lockEntityAggregate/i
  );

  const failedRow = billingRepository.__rows.get("evt_customer_correlated");
  assert.ok(failedRow);
  assert.equal(failedRow.status, "failed");
  assert.equal(failedRow.billableEntityId, 77);
  assert.equal(failedRow.operationKey, "op_customer_77");
});

test("billing webhook service resolves invoice correlation from customer ownership", async () => {
  const billingRepository = createInMemoryWebhookRepository();
  billingRepository.findCustomerByProviderCustomerId = async ({ providerCustomerId }) => {
    if (providerCustomerId === "cus_invoice_88") {
      return {
        billableEntityId: 88
      };
    }
    return null;
  };

  const webhookService = createWebhookService({
    billingRepository,
    billingProviderAdapter: {
      async verifyWebhookEvent() {
        return {
          id: "evt_invoice_customer_88",
          type: "invoice.paid",
          created: 1_771_000_333,
          data: {
            object: {
              id: "in_customer_88",
              customer: "cus_invoice_88",
              subscription: null,
              metadata: {}
            }
          }
        };
      },
      async retrieveCheckoutSession() {
        return null;
      },
      async retrieveSubscription() {
        return null;
      },
      async retrieveInvoice() {
        return null;
      }
    },
    billingCheckoutSessionService: {},
    stripeWebhookEndpointSecret: "whsec_test"
  });

  await assert.rejects(
    () =>
      webhookService.processProviderEvent({
        provider: "stripe",
        rawBody: Buffer.from("{}"),
        signatureHeader: "t=123,v1=abc"
      }),
    /findBillableEntityById is not a function|correlate invoice/i
  );

  const failedRow = billingRepository.__rows.get("evt_invoice_customer_88");
  assert.ok(failedRow);
  assert.equal(failedRow.status, "failed");
  assert.equal(failedRow.billableEntityId, 88);
});

test("billing webhook service accepts paddle provider events and ignores unsupported types", async () => {
  const billingRepository = createInMemoryWebhookRepository();
  const webhookService = createWebhookService({
    billingRepository,
    billingProviderAdapter: {
      async verifyWebhookEvent() {
        return {
          id: "evt_paddle_ignore",
          type: "notification.created",
          created: 1_771_100_000,
          data: {
            object: {}
          }
        };
      },
      async retrieveCheckoutSession() {
        return null;
      },
      async retrieveSubscription() {
        return null;
      },
      async retrieveInvoice() {
        return null;
      }
    },
    billingCheckoutSessionService: {},
    stripeWebhookEndpointSecret: "whsec_test",
    paddleWebhookEndpointSecret: "pwhsec_test"
  });

  const result = await webhookService.processProviderEvent({
    provider: "paddle",
    rawBody: Buffer.from("{}"),
    signatureHeader: "ts=123;h1=abc"
  });

  assert.deepEqual(result, {
    ignored: true,
    eventId: "evt_paddle_ignore",
    eventType: "notification.created"
  });
});

test("billing webhook service fails closed when canonical provider event id is missing", async () => {
  const billingRepository = createInMemoryWebhookRepository();
  const webhookService = createWebhookService({
    billingRepository,
    billingProviderAdapter: {
      async verifyWebhookEvent() {
        return {
          type: "checkout.session.completed",
          created: 1_771_200_999,
          data: {
            object: {
              id: "cs_missing_event_id",
              metadata: {
                operation_key: "op_missing_event_id",
                billable_entity_id: "77"
              }
            }
          }
        };
      },
      async retrieveCheckoutSession() {
        return null;
      },
      async retrieveSubscription() {
        return null;
      },
      async retrieveInvoice() {
        return null;
      }
    },
    billingCheckoutSessionService: {},
    stripeWebhookEndpointSecret: "whsec_test"
  });

  await assert.rejects(() =>
    webhookService.processProviderEvent({
      provider: "stripe",
      rawBody: Buffer.from("{}"),
      signatureHeader: "t=123,v1=abc"
    })
  );

  assert.equal(
    billingRepository.__rows.size,
    0,
    "expected missing-id events to fail before webhook state is persisted"
  );
});

test("billing webhook service dedupes stored event replays by provider event id", async () => {
  const billingRepository = createInMemoryWebhookRepository();
  const webhookService = createWebhookService({
    billingRepository,
    billingProviderAdapter: {
      async verifyWebhookEvent() {
        return null;
      },
      async retrieveCheckoutSession() {
        return null;
      },
      async retrieveSubscription() {
        return null;
      },
      async retrieveInvoice() {
        return null;
      }
    },
    billingCheckoutSessionService: {},
    stripeWebhookEndpointSecret: "whsec_test"
  });

  const payload = {
    id: "evt_replay_dedupe_1",
    type: "unsupported.synthetic",
    created: 1_771_210_000,
    data: {
      object: {}
    }
  };

  const first = await webhookService.reprocessStoredEvent({
    provider: "stripe",
    eventPayload: payload
  });
  const second = await webhookService.reprocessStoredEvent({
    provider: "stripe",
    eventPayload: payload
  });

  assert.deepEqual(first, {
    duplicate: false,
    eventId: "evt_replay_dedupe_1",
    eventType: "unsupported.synthetic"
  });
  assert.deepEqual(second, {
    duplicate: true,
    eventId: "evt_replay_dedupe_1",
    eventType: "unsupported.synthetic"
  });

  const row = billingRepository.__rows.get("evt_replay_dedupe_1");
  assert.ok(row);
  assert.equal(row.status, "processed");
  assert.equal(row.attemptCount, 1);
});

test("billing webhook service requires signature headers for stripe and paddle providers", async () => {
  const billingRepository = createInMemoryWebhookRepository();
  const webhookService = createWebhookService({
    billingRepository,
    billingProviderAdapter: {
      async verifyWebhookEvent() {
        return null;
      },
      async retrieveCheckoutSession() {
        return null;
      },
      async retrieveSubscription() {
        return null;
      },
      async retrieveInvoice() {
        return null;
      }
    },
    billingCheckoutSessionService: {},
    stripeWebhookEndpointSecret: "whsec_test",
    paddleWebhookEndpointSecret: "pwhsec_test"
  });

  await assert.rejects(
    () =>
      webhookService.processProviderEvent({
        provider: "stripe",
        rawBody: Buffer.from("{}"),
        signatureHeader: ""
      }),
    /Stripe signature header is required/i
  );

  await assert.rejects(
    () =>
      webhookService.processProviderEvent({
        provider: "paddle",
        rawBody: Buffer.from("{}"),
        signatureHeader: ""
      }),
    /Paddle signature header is required/i
  );
});
