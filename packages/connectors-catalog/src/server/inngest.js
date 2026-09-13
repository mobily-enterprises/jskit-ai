import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { inngestDefinition } from "../shared/inngest.js";
import { jsonOperation } from "./jsonOperation.js";

const api = "https://api.inngest.com/v2";
const eventEndpoint = "https://inn.gs/e/";
const pageFields = {
  limit: { type: "integer", min: 1, max: 100, defaultTo: 20 },
  cursor: { type: "string", minLength: 1, maxLength: 4096 }
};
const functionsSchema = createSchema({
  appId: { type: "string", required: true, minLength: 1, maxLength: 255,
    validator: (value) => ![".", ".."].includes(value) && !/[\p{Cc}]/u.test(value) || "Enter a valid Inngest app ID." },
  ...pageFields
});
const eventSchema = createSchema({
  name: { type: "string", required: true, minLength: 1, maxLength: 255,
    validator: (value) => Boolean(value.trim()) && !/[\p{Cc}]/u.test(value) || "Enter an event name without control characters." },
  data: { type: "object", required: true },
  id: { type: "string", minLength: 1, maxLength: 512 },
  ts: { type: "integer", min: 315532800000, max: Number.MAX_SAFE_INTEGER },
  v: { type: "string", minLength: 1, maxLength: 255 },
  user: { type: "object" }
});

function validPage(result) {
  return Array.isArray(result?.data) && result.data.every((item) => typeof item?.id === "string" && item.id.length > 0) &&
    typeof result.page?.hasMore === "boolean" && Number.isInteger(result.page.limit) && result.page.limit >= 1 &&
    (result.page.cursor == null || typeof result.page.cursor === "string");
}

const inngestProvider = Object.freeze({
  ...inngestDefinition,
  apiOrigins: ["https://api.inngest.com", "https://inn.gs"],
  apiKey: { headers: (key) => ({ Authorization: `Bearer ${key}` }) },
  checkOperation: "apps.list",
  async exchange(url, options, { request, resolveReference }) {
    if (url !== eventEndpoint) return request(url, options);
    const { eventKeyRef, branchEnvironment, event } = options.body;
    let key;
    try {
      key = await resolveReference(eventKeyRef);
      if (typeof key !== "string" || !key.trim() || /[\p{Cc}]/u.test(key)) throw new Error("Invalid Event Key.");
    } catch {
      throw new ConnectorError("connector_binding_missing", "The Inngest Event Key binding is missing or invalid.");
    }
    options.signal.throwIfAborted();
    // The Event API uses only the Event Key in its path. Never forward the Signing Key.
    return request(`${eventEndpoint}${encodeURIComponent(key)}`, {
      ...options, body: event,
      headers: { Accept: "application/json", ...(branchEnvironment ? { "x-inngest-env": branchEnvironment } : {}) }
    });
  },
  operations: {
    "apps.list": jsonOperation(`${api}/apps`, { ...pageFields, archived: { type: "boolean", defaultTo: false } }, validPage),
    "functions.list": {
      scopes: [],
      request(input) {
        const { appId, ...query } = validateSchemaPayload({ schema: functionsSchema, mode: "replace" }, input, { statusCode: 422 });
        const url = new URL(`${api}/apps/${encodeURIComponent(appId)}/functions`);
        for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
        return { method: "GET", url: url.href };
      },
      validateResult: validPage
    },
    "events.send": {
      scopes: [],
      request(input, settings) {
        const event = validateSchemaPayload({ schema: eventSchema, mode: "replace" }, input, { statusCode: 422 });
        return { method: "POST", url: eventEndpoint,
          body: { event, eventKeyRef: settings.eventKeyRef, branchEnvironment: settings.branchEnvironment } };
      },
      validateResult(result) {
        if (result?.status === 401) throw new ConnectorError("connector_reconnect_required", "Configure a valid Inngest Event Key and reconnect.", { statusCode: 401 });
        if (result?.status === 403) throw new ConnectorError("connector_permission_denied", "Inngest denied this event.", { statusCode: 403 });
        if (result?.status === 429) throw new ConnectorError("connector_rate_limited", "Inngest's event limit was reached.", { statusCode: 429 });
        return result?.status === 200 && !result.error && Array.isArray(result.ids) && result.ids.length === 1 &&
          result.ids.every((id) => typeof id === "string" && id.length > 0);
      }
    }
  }
});

export { inngestProvider };
