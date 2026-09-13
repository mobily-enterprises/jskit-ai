import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { paddleDefinition } from "../shared/tokens.js";
import { jsonOperation } from "./jsonOperation.js";

const origins = { sandbox: "https://sandbox-api.paddle.com", live: "https://api.paddle.com" };
const webhookUpdateSchema = createSchema({
  notification_setting_id: { type: "string", required: true,
    validator: (value) => /^ntfset_[a-z0-9]{26}$/.test(value) || "Enter a Paddle notification setting ID." },
  description: { type: "string", minLength: 1, maxLength: 500 },
  destination: { type: "string", minLength: 1, maxLength: 2048 },
  active: { type: "boolean" },
  api_version: { type: "integer", min: 1 },
  include_sensitive_fields: { type: "boolean" },
  subscribed_events: { type: "array", items: { type: "string", minLength: 3, maxLength: 100,
    validator: (value) => /^[a-z_]+\.[a-z_]+$/.test(value) || "Use a Paddle event type name." } },
  traffic_source: { type: "string", enum: ["platform", "simulation", "all"] }
});
const paddleProvider = Object.freeze({
  ...paddleDefinition, apiOrigins: Object.values(origins),
  apiKey: { headers: (key) => ({ Authorization: `Bearer ${key}`, "Paddle-Version": "1" }) },
  checkOperation: "products.list",
  async exchange(address, options, { request }) {
    const result = await request(address, options);
    if (new URL(address).pathname.startsWith("/notification-settings/") && result?.data) {
      // Editing a destination must not expose its signing secret to assistant tools.
      const { endpoint_secret_key, ...data } = result.data;
      return { ...result, data };
    }
    return result;
  },
  operations: {
    "checkoutDomains.get": {
      scopes: [], assistantAction: "goLive.check",
      request(input, settings) {
        const { domain_id } = validateSchemaPayload({ schema: createSchema({
          domain_id: { type: "string", required: true,
            validator: (value) => /^chedom_[a-z0-9]{26}$/.test(value) || "Enter a Paddle checkout domain ID." }
        }), mode: "replace" }, input, { statusCode: 422 });
        return { method: "GET", url: `${origins[settings.environment]}/checkout-domains/${domain_id}` };
      },
      validateResult: (result) => /^chedom_[a-z0-9]{26}$/.test(result?.data?.id || "") &&
        typeof result.data.domain === "string" && result.data.domain.length > 0 &&
        ["pending_review", "approved", "rejected", "in_review", "action_required"].includes(result.data.status)
    },
    "webhooks.update": {
      scopes: [],
      request(input, settings) {
        const { notification_setting_id, ...body } = validateSchemaPayload(
          { schema: webhookUpdateSchema, mode: "replace" }, input, { statusCode: 422 });
        if (!Object.keys(body).length) throw new ConnectorError("connector_input_invalid", "Choose at least one notification setting to change.", { statusCode: 422 });
        return { method: "PATCH", url: `${origins[settings.environment]}/notification-settings/${notification_setting_id}`, body };
      },
      validateResult: (result) => /^ntfset_[a-z0-9]{26}$/.test(result?.data?.id || "") && typeof result.data.active === "boolean"
    },
    "products.create": jsonOperation((settings) => `${origins[settings.environment]}/products`, {
      name: { type: "string", required: true, minLength: 1, maxLength: 200 },
      description: { type: "string", maxLength: 2048 },
      tax_category: { type: "string", required: true, enum: ["digital-goods", "ebooks", "implementation-services", "professional-services", "saas", "software-programming-services", "standard", "training-services", "website-hosting"] }
    }, (result) => /^pro_[a-z0-9]{26}$/.test(result?.data?.id || ""), "POST"),
    "prices.create": jsonOperation((settings) => `${origins[settings.environment]}/prices`, {
      product_id: { type: "string", required: true, validator: (value) => /^pro_[a-z0-9]{26}$/.test(value) || "Enter a Paddle product ID." },
      description: { type: "string", required: true, minLength: 2, maxLength: 500 },
      unit_price: { type: "object", required: true, schema: createSchema({
        amount: { type: "string", required: true, validator: (value) => /^\d+$/.test(value) || "Enter an integer amount in the currency's smallest unit." },
        currency_code: { type: "string", required: true, validator: (value) => /^[A-Z]{3}$/.test(value) || "Enter a three-letter currency code supported by Paddle." }
      }) },
      billing_cycle: { type: "object", schema: createSchema({
        interval: { type: "string", required: true, enum: ["day", "week", "month", "year"] },
        frequency: { type: "integer", required: true, min: 1 }
      }) }
    }, (result) => /^pri_[a-z0-9]{26}$/.test(result?.data?.id || ""), "POST"),

    "products.list": { assistantAction: "api.read", ...jsonOperation((settings) => `${origins[settings.environment]}/products`, {
      per_page: { type: "integer", min: 1, max: 200, defaultTo: 50 },
      after: { type: "string", maxLength: 200 },
      status: { type: "string", enum: ["active", "archived"], defaultTo: "active" }
    }, (result) => Array.isArray(result?.data) && Boolean(result.meta?.pagination)
      && typeof result.meta.pagination.has_more === "boolean") }
  }
});
export { paddleProvider };
