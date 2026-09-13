import { createHmac, timingSafeEqual } from "node:crypto";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { createSchema } from "json-rest-schema";
import { gatewayApiDefinition } from "../shared/tokens.js";
import { jsonOperation } from "./jsonOperation.js";

const origins = { global: "https://gatewayapi.com", eu: "https://gatewayapi.eu" };
const messagingOrigins = { global: "https://messaging.gatewayapi.com", eu: "https://messaging.gatewayapi.eu" };
const messageFields = {
  sender: { type: "string", required: true, minLength: 3, maxLength: 15,
    validator: value => (/^[0-9]{3,15}$/.test(value) || /^[A-Za-z0-9]{3,11}$/.test(value)) || "Use 3–11 alphanumeric or 3–15 numeric sender characters." },
  recipient: { type: "integer", required: true, min: 1001, max: 999999999999999 },
  message: { type: "string", required: true, minLength: 1, maxLength: 39015 },
  reference: { type: "string", required: true, minLength: 1, maxLength: 256 },
  label: { type: "string", maxLength: 128 },
  priority: { type: "string", enum: ["normal", "urgent"], defaultTo: "normal" }
};
const messageSchema = createSchema(messageFields);
const validReceipt = result => typeof result?.msg_id === "string" && Number.isSafeInteger(result.recipient) && (typeof result.reference === "string" || result.reference === null);
const gatewayApiProvider = Object.freeze({
  ...gatewayApiDefinition, apiOrigins: [...Object.values(origins), ...Object.values(messagingOrigins)],
  apiKey: { headers: (key) => ({ Authorization: `Token ${key}` }) },
  checkOperation: "balance.read",
  operations: {
    "messages.send": jsonOperation(settings => `${messagingOrigins[settings.region]}/mobile/single`, messageFields, validReceipt, "POST"),
    "messages.sendBatch": jsonOperation(settings => `${messagingOrigins[settings.region]}/mobile/multi`, {
      messages: { type: "array", required: true, items: { type: "object", schema: messageSchema },
        validator: value => value.length >= 1 && value.length <= 1000 || "Send 1–1000 messages per batch." }
    }, result => Array.isArray(result?.responses) && result.responses.every(validReceipt), "POST"),
    "balance.read": jsonOperation((settings) => `${origins[settings.region]}/rest/me`, {},
      (result) => Number.isInteger(result?.id) && typeof result.credit === "string" && typeof result.currency === "string")
  }
});
// Call at the application's webhook route before trusting or persisting its body.
function verifyGatewayApiEvent({ rawBody, signature, secret }) {
  if (!(rawBody instanceof Uint8Array) || rawBody.byteLength > 1048576 || typeof secret !== "string" || secret.length < 1 || typeof signature !== "string" || !/^v1=[a-fA-F0-9]{64}$/.test(signature)) {
    throw new ConnectorError("connector_webhook_invalid", "Invalid GatewayAPI webhook signature.");
  }
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature.slice(3), "hex"))) throw new ConnectorError("connector_webhook_invalid", "Invalid GatewayAPI webhook signature.");
  let event;
  try { event = JSON.parse(Buffer.from(rawBody).toString("utf8")); } catch { throw new ConnectorError("connector_webhook_invalid", "Invalid GatewayAPI webhook event."); }
  if (typeof event?.event_id !== "string" || !event.event_id || typeof event.event_type !== "string" || !Number.isFinite(Date.parse(event.timestamp)) || !event.event || typeof event.event !== "object" || Array.isArray(event.event)) {
    throw new ConnectorError("connector_webhook_invalid", "Invalid GatewayAPI webhook event.");
  }
  return event;
}
export { gatewayApiProvider, verifyGatewayApiEvent };
