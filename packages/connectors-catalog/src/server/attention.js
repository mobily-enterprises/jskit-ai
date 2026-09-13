import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { attentionDefinition } from "../shared/tokens.js";
import { jsonOperation } from "./jsonOperation.js";

const text = { type: "string", minLength: 1, maxLength: 2000 };
const id = { type: "string", minLength: 1, maxLength: 100, pattern: "^[A-Za-z0-9_-]+$" };
const requiredId = { ...id, required: true };
const ids = { type: "array", items: id, validator: value => value.length <= 100 || "Use at most 100 IDs." };
const bool = { type: "boolean" };
const page = { page: { type: "integer", min: 1, defaultTo: 1 }, size: { type: "integer", min: 1, max: 200, defaultTo: 50 } };
const dateTime = { ...text, validator: value => /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) || "Use an ISO timestamp." };
const list = result => Array.isArray(result?.data);
const record = result => result?.data !== null && typeof result?.data === "object" && !Array.isArray(result.data) && typeof (result.data.uuid ?? result.data.id) === "string";
const conversation = result => result?.type === "conversations" && typeof result.id === "string" && result.attributes !== null && typeof result.attributes === "object" && !Array.isArray(result.attributes);
function operation(method, endpoint, fields, validateResult, prepare = value => value) {
  const schema = createSchema(fields);
  return { scopes: [], request(input) {
    const values = prepare(validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 }));
    const { id: resource, ...body } = values;
    const url = new URL(`https://api.attention.tech/v2/${endpoint.replace("{id}", resource || "")}`);
    if (method === "GET") { for (const [key, value] of Object.entries(body)) url.searchParams.set(key, String(value)); return { method, url: url.href }; }
    if (method === "DELETE") return { method, url: url.href };
    if (!Object.keys(body).length) throw new ConnectorError("connector_input_invalid", "Supply at least one change.", { statusCode: 422 });
    return { method, url: url.href, body };
  }, validateResult };
}
const team = { type: "object", schema: createSchema({ uuid: requiredId, primary: bool }) };
const attentionProvider = Object.freeze({
  ...attentionDefinition,
  apiOrigins: ["https://api.attention.tech"],
  apiKey: { headers: (key) => ({ Authorization: `Bearer ${key}` }) },
  checkOperation: "conversations.list",
  operations: {
    "conversations.get": operation("GET", "conversations/{id}", { id: requiredId, by: { type: "string", enum: ["id", "external_id"] },
      detailedTranscript: { ...bool, defaultTo: true }, "filter[include_internal_participants]": bool,
      "filter[include_zoom_metadata]": bool, "filter[include_import_metadata]": bool }, conversation),
    "conversations.update": operation("PUT", "conversations/{id}", { id: requiredId, title: text, labels: { type: "object", additionalProperties: true } }, conversation),
    "conversations.archive": operation("DELETE", "conversations/{id}", { id: requiredId }, conversation),
    "conversations.import": operation("POST", "conversations/import", {
      mediaURL: { ...text, required: true, validator: value => { try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password || "Use an HTTPS media URL without embedded credentials."; } catch { return "Use an HTTPS media URL."; } } },
      userID: requiredId, applicationName: text, applicationExternalID: id, conversationTitle: text,
      conversationStartedAt: dateTime, opportunityID: id, skipScorecardCalculation: bool,
      skipCRMFieldsCalculation: bool, skipOpportunitiesExport: bool
    }, result => typeof result?.uuid === "string"),
    "snippets.create": operation("POST", "snippets", { user_uuid: requiredId, conversation_id: requiredId,
      internal: { ...bool, required: true }, notify_views: { ...bool, required: true }, title: text, notes: { type: "string", maxLength: 20000 },
      video: { type: "object", required: true, schema: createSchema({ start_time: { type: "number", required: true, min: 0 }, end_time: { type: "number", required: true, min: 0 } }),
        validator: value => value.end_time > value.start_time || "End time must follow start time." }
    }, result => typeof result?.id === "string" && typeof result.url === "string"),
    "analysis.ask": operation("POST", "ask_attention/v2", { conversations_ids: { ...ids, required: true },
      deal_id: { type: "string", required: true, maxLength: 100 }, prompt: { ...text, required: true, maxLength: 20000 }
    }, result => Array.isArray(result) && result.every(item => typeof item?.output === "string" && typeof item.error === "string" && typeof item.conversation_id === "string")),
    "scorecards.list": operation("GET", "scorecards", page, list),
    "scorecards.get": operation("GET", "scorecards/{id}", { id: requiredId }, record),
    "scorecardItems.list": operation("GET", "scorecards/{id}/items", { id: requiredId, ...page }, list),
    "scorecards.summary": operation("POST", "scorecards/summary", { fromDateTime: { ...dateTime, required: true }, toDateTime: { ...dateTime, required: true },
      scorecardUUID: requiredId, scorecardsItemsUUIDs: { ...ids, required: true }, teamUUIDs: { ...ids, required: true }, userUUIDs: { ...ids, required: true }
    }, list, value => { if (Date.parse(value.fromDateTime) >= Date.parse(value.toDateTime)) throw new ConnectorError("connector_input_invalid", "End time must follow start time.", { statusCode: 422 }); return value; }),
    "scorecardResults.create": operation("POST", "createScorecardResult", { scorecard_uuid: requiredId, conversation_uuid: requiredId,
      summary: { ...text, required: true, maxLength: 20000 }, items: { type: "array", required: true,
        items: { type: "object", schema: createSchema({ scorecard_item_uuid: requiredId, numeric_result: { type: "integer" }, description: { ...text, required: true } }) },
        validator: value => value.length > 0 && value.length <= 100 || "Supply 1–100 scoring items." }
    }, result => result?.success === true),
    "users.list": operation("GET", "organizations/users", { teamUUID: id }, list),
    "roles.list": operation("GET", "organizations/roles", {}, list),
    "users.create": operation("POST", "organizations/users", { email: { ...text, required: true, pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" },
      first_name: { ...text, required: true }, last_name: { ...text, required: true }, roleUUID: requiredId,
      seat_type: { type: "string", required: true, enum: ["listener", "recording"] },
      teams: { type: "array", required: true, items: team, validator: value => value.length > 0 && value.length <= 100 || "Supply 1–100 teams." }
    }, record),
    "users.update": operation("PATCH", "organizations/users/{id}", { id: requiredId, firstName: text, lastName: text,
      roleUUID: id, seat_type: { type: "string", enum: ["listener", "recording"] }, teamUUIDsToRemove: ids,
      teamsToAdd: { type: "array", items: team, validator: value => value.length <= 100 || "Use at most 100 teams." }
    }, record),
    "users.delete": operation("DELETE", "organizations/users/{id}", { id: requiredId }, result => result === null || result !== null && typeof result === "object" && !Array.isArray(result) && Object.keys(result).length === 0),
    "teams.list": operation("GET", "organizations/teams", {}, list),
    "teams.create": operation("POST", "organizations/teams", { name: { ...text, required: true }, parentTeamUUID: id }, record),
    "teams.update": operation("PATCH", "organizations/teams/{id}", { id: requiredId, name: text, parentTeamUUID: id }, record),
    "conversations.list": jsonOperation("https://api.attention.tech/v2/conversations/list", {
      page: { type: "integer", min: 1, max: 100000, defaultTo: 1 },
      size: { type: "integer", min: 1, max: 50, defaultTo: 20 },
      "filter[title]": { type: "string", minLength: 1, maxLength: 500 },
      "filter[hide_internal]": { type: "boolean" },
      detailedTranscript: { type: "boolean", defaultTo: false }
    }, (result) => Array.isArray(result?.data) && (result.meta === undefined ||
      result.meta !== null && typeof result.meta === "object" && !Array.isArray(result.meta) &&
      ["totalRecords", "pageCount", "pageNumber", "pageSize"].every((field) => result.meta[field] === undefined ||
        Number.isInteger(result.meta[field]) && result.meta[field] >= 0)))
  }
});
export { attentionProvider };
