import billingWebhookRawBodyPlugin from "../fastify/billingWebhookRawBody.plugin.js";
import activityPubRawBodyPlugin from "../fastify/activityPubRawBody.plugin.js";

const FASTIFY_PLUGIN_DEFINITIONS = Object.freeze([
  {
    id: "billingWebhookRawBody",
    async register(app) {
      await app.register(billingWebhookRawBodyPlugin);
    }
  },
  {
    id: "activityPubRawBody",
    async register(app, { repositoryConfig } = {}) {
      await app.register(activityPubRawBodyPlugin, {
        maxPayloadBytes: repositoryConfig?.social?.limits?.inboxMaxPayloadBytes
      });
    }
  }
]);

export { FASTIFY_PLUGIN_DEFINITIONS };
