import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { clayDefinition } from "../shared/tokens.js";
import { jsonOperation } from "./jsonOperation.js";

const endpoint = "https://api.clay.com/public/v0";
const pageSchema = createSchema({
  searchId: { type: "string", required: true, minLength: 1, maxLength: 1024,
    validator: (value) => /^[a-zA-Z0-9_-]+$/u.test(value) || "Use the search ID returned by Clay." },
  limit: { type: "integer", min: 1, max: 500, defaultTo: 20 }
});

const routineId = { type: "string", required: true, minLength: 1, maxLength: 64,
  validator: value => /^[a-zA-Z0-9_:-]+$/u.test(value) || "Use the routine ID from Clay, including function: for custom functions." };
const object = { type: "object", additionalProperties: true };
const array = (items, maximum, minimum = 0) => ({ type: "array", items,
  validator: value => value.length >= minimum && value.length <= maximum || `Use ${minimum}–${maximum} entries.` });
const text = { type: "string", minLength: 1 };

function routineOperation(method, suffix, fields, validateResult) {
  const schema = createSchema({ routineId, ...fields });
  return { scopes: [], request(input) {
    const { routineId: id, ...values } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
    const url = new URL(`${endpoint}/routines/${suffix.replace("{id}", encodeURIComponent(id))}`);
    if (method === "POST") return { method, url: url.href, body: values };
    for (const [key, value] of Object.entries(values)) url.searchParams.set(key, String(value));
    return { method, url: url.href };
  }, validateResult };
}

const clayProvider = Object.freeze({
  ...clayDefinition,
  apiOrigins: ["https://api.clay.com"],
  apiKey: { headers: (key) => ({ "clay-api-key": key }) },
  checkOperation: "identity.read",
  operations: {
    "identity.read": jsonOperation(`${endpoint}/me`, {}, (result) =>
      typeof result?.user?.id === "string" && result.user.id.length > 0 &&
      typeof result?.workspace?.id === "string" && result.workspace.id.length > 0),
    "credits.balance": jsonOperation(`${endpoint}/credits/balance`, {}, result => typeof result?.balance === "number"),
    "searches.reference": jsonOperation(`${endpoint}/search/query-mode/reference`, {}, result => typeof result?.reference === "string"),
    "routines.run": routineOperation("POST", "{id}/run", {
      items: { ...array({ type: "object", schema: createSchema({
        id: { ...text, required: true, maxLength: 64 }, inputs: { ...object, required: true }
      }) }, 100, 1), required: true },
      webhook_id: { ...text, maxLength: 64 }
    }, result => typeof result?.routine_run_id === "string" && result.routine_run_id.length > 0 && result.status === "in_progress"),
    "routines.results": routineOperation("GET", "run/{id}/results", {
      cursor: text, limit: { type: "integer", min: 1, max: 100, defaultTo: 20 }
    }, result => typeof result?.routine_run_id === "string" && typeof result.total === "number" && typeof result.finished === "number" &&
      (result.status === "in_progress" || result.status === "complete" && Array.isArray(result.data))),
    "tables.query": jsonOperation(`${endpoint}/tables/query`, {
      query: { type: "object", required: true, schema: createSchema({
        tables: { ...array({ type: "object", schema: createSchema({ id: { ...text, required: true }, alias: { type: "string" } }) }, 5, 1), required: true },
        field_mode: { type: "string", enum: ["names", "ids"] },
        filter: object, select: array(object, 20), join: array(object, 4),
        group_by: array(text, 5), order_by: array(object, 3)
      }) },
      cursor: text, limit: { type: "integer", min: 1, max: 100, defaultTo: 50 }
    }, result => Array.isArray(result?.data), "POST"),
    "searches.create": jsonOperation(`${endpoint}/search/query-mode`, {
      query: { type: "string", required: true, minLength: 1, maxLength: 16000,
        validator: (value) => value.trim().length > 0 || "Enter a Clay search query." }
    }, (result) => typeof result?.search_id === "string" && result.search_id.length > 0 &&
      ["people", "companies"].includes(result.source_type), "POST"),
    "searches.next": {
      scopes: [],
      request(input) {
        const { searchId, limit } = validateSchemaPayload({ schema: pageSchema, mode: "replace" }, input, { statusCode: 422 });
        return { method: "POST", url: `${endpoint}/search/query-mode/${encodeURIComponent(searchId)}/run`, body: { limit } };
      },
      validateResult: (result) => Array.isArray(result?.data) && typeof result.has_more === "boolean" &&
        ["people", "companies"].includes(result.source_type)
    }
  }
});

export { clayProvider };
