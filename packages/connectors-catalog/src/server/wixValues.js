import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { createSchema } from "json-rest-schema";
import { isUuid } from "../shared/uuid.js";

// The Wix value checks, fields and record checks the operation groups share.

// Preserve native Wix JSON without silently dropping unsupported values.
function serializeNativeJson(value) {
  return JSON.stringify(value, (key, item) => {
    if (["undefined", "function", "symbol", "bigint"].includes(typeof item) ||
        typeof item === "number" && !Number.isFinite(item)) throw new Error("JSON required");
    return item;
  });
}
// Results are checked against the operation's own request; a different record is reported with what Wix got wrong.
const requestPath = (request, index) => decodeURIComponent(new URL(request.url).pathname.split("/").at(index));
function sameRecord(matches, message, codes) {
  if (!matches) throw new ConnectorError("connector_response_invalid", message, { statusCode: 502, ...codes });
  return true;
}
const cursor = (value) => typeof value === "string" && value.length > 0 && value.length <= 16000 && !/[\p{Cc}]/u.test(value);
const querySchema = createSchema({
  limit: { type: "integer", min: 1, max: 100, defaultTo: 20 },
  cursor: { type: "string", minLength: 1, maxLength: 16000, noTrim: true, validator: (value) => cursor(value) || "Use the returned Wix page cursor." }
});
const contactIdField = { type: "string", required: true, validator: value => isUuid(value) || "Use the contact ID returned by Wix." };
const nativeJsonObjectField = { type: "none", validator: value => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Use a native Wix JSON object.";
  try {
    const json = serializeNativeJson(value);
    return Buffer.byteLength(json) <= 100000 || "Keep native Wix object data within 100KB.";
  } catch { return "Use serializable native Wix JSON data."; }
} };

export { serializeNativeJson, requestPath, sameRecord, cursor, querySchema, contactIdField, nativeJsonObjectField };
