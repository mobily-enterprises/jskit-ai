import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import billingWebhookRawBodyPlugin from "../server/fastify/billingWebhookRawBody.plugin.js";
import activityPubRawBodyPlugin from "../server/fastify/activityPubRawBody.plugin.js";

test("billing and activitypub raw-body plugins can register together", async () => {
  const app = Fastify();

  await app.register(billingWebhookRawBodyPlugin);
  await app.register(activityPubRawBodyPlugin, {
    maxPayloadBytes: 1024
  });

  assert.equal(app.hasRequestDecorator("rawBody"), true);
  await app.close();
});
