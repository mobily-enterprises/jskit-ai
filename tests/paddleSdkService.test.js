import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { createService as createPaddleSdkService, __testables } from "../server/modules/billing/providers/paddle/sdk.service.js";

test("paddle sdk verifyWebhookEvent validates signature and normalizes event envelope", async () => {
  const service = createPaddleSdkService({
    enabled: true,
    apiKey: "pdl_test_key"
  });

  const payloadJson = {
    event_id: "evt_paddle_1",
    event_type: "subscription.updated",
    occurred_at: "2026-02-21T01:02:03.000Z",
    data: {
      id: "sub_123",
      status: "active",
      custom_data: {
        operation_key: "op_123",
        billable_entity_id: "77"
      }
    }
  };
  const rawBody = Buffer.from(JSON.stringify(payloadJson));
  const timestamp = "1761000000";
  const signedPayload = __testables.buildPaddleSignaturePayload({
    timestamp,
    rawBody: rawBody.toString("utf8")
  });
  const h1 = createHmac("sha256", "whsec_paddle_test").update(signedPayload).digest("hex");

  const event = await service.verifyWebhookEvent({
    rawBody,
    signatureHeader: `ts=${timestamp};h1=${h1}`,
    endpointSecret: "whsec_paddle_test"
  });

  assert.equal(event.id, "evt_paddle_1");
  assert.equal(event.type, "subscription.updated");
  assert.ok(Number.isInteger(event.created) && event.created > 0);
  assert.equal(event.data.object.id, "sub_123");
});

test("paddle sdk verifyWebhookEvent rejects invalid signatures", async () => {
  const service = createPaddleSdkService({
    enabled: true,
    apiKey: "pdl_test_key"
  });

  await assert.rejects(
    () =>
      service.verifyWebhookEvent({
        rawBody: Buffer.from("{}"),
        signatureHeader: "ts=1761000000;h1=invalid",
        endpointSecret: "whsec_paddle_test"
      }),
    /Invalid Paddle signature/
  );
});

test("paddle sdk testables normalize checkout/subscription/invoice payloads", () => {
  const checkout = __testables.normalizeCheckoutSessionFromTransaction({
    id: "txn_1",
    status: "completed",
    checkout: {
      url: "https://pay.paddle.test/t/txn_1",
      expires_at: "2026-02-21T10:00:00.000Z"
    },
    customer_id: "ctm_1",
    subscription_id: "sub_1",
    custom_data: {
      operation_key: "op_1"
    }
  });
  assert.equal(checkout.id, "txn_1");
  assert.equal(checkout.status, "complete");
  assert.equal(checkout.customer, "ctm_1");
  assert.equal(checkout.subscription, "sub_1");
  assert.equal(checkout.metadata.operation_key, "op_1");

  const subscription = __testables.normalizeSubscriptionFromPaddle({
    id: "sub_1",
    status: "active",
    customer_id: "ctm_1",
    started_at: "2026-02-21T00:00:00.000Z",
    next_billed_at: "2026-03-21T00:00:00.000Z",
    items: [
      {
        id: "si_1",
        price_id: "pri_1",
        quantity: 2
      }
    ]
  });
  assert.equal(subscription.id, "sub_1");
  assert.equal(subscription.status, "active");
  assert.equal(subscription.items.data.length, 1);
  assert.equal(subscription.items.data[0].price.id, "pri_1");

  const invoice = __testables.normalizeInvoiceFromTransaction({
    id: "txn_2",
    status: "completed",
    customer_id: "ctm_1",
    subscription_id: "sub_1",
    details: {
      totals: {
        total: "9.99",
        currency_code: "USD"
      }
    }
  });
  assert.equal(invoice.id, "txn_2");
  assert.equal(invoice.status, "paid");
  assert.equal(invoice.total, 999);
  assert.equal(invoice.amount_paid, 999);
});
