import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { gongDefinition } from "../shared/gong.js";
import { jsonOperation } from "./jsonOperation.js";

const origin = (settings) => new URL(settings.apiBaseUrl).origin;
const cursor = { type: "string", minLength: 1, maxLength: 8192, noTrim: true };
const ids = { type: "array", items: { type: "string", pattern: "^[0-9]{1,20}$" }, validator: value => value.length >= 1 && value.length <= 100 || "Supply between 1 and 100 string IDs." };
const timestamp = { type: "string", validator: value => /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) || "Enter an ISO timestamp including its time zone." };
const callFields = { cursor, fromDateTime: timestamp, toDateTime: timestamp, callIds: ids,
  workspaceId: { type: "string", pattern: "^[0-9]{1,20}$" } };
const recordsValid = value => ["totalRecords", "currentPageSize", "currentPageNumber"].every(key => Number.isInteger(value?.records?.[key]) && value.records[key] >= 0) && (value.records.cursor === undefined || typeof value.records.cursor === "string");
function callOperation(path, field, extensive = false) {
  const schema = createSchema({ ...callFields, ...(extensive ? { includeMedia: { type: "boolean", defaultTo: false } } : {}) });
  return { scopes: [], request(input, settings) {
    if (Array.isArray(input.callIds) && input.callIds.some(id => typeof id !== "string") || input.workspaceId !== undefined && typeof input.workspaceId !== "string") throw new ConnectorError("connector_input_invalid", "Supply Gong IDs as strings to preserve all digits.");
    const { cursor, includeMedia, ...filter } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
    if ((!filter.fromDateTime !== !filter.toDateTime) || (filter.fromDateTime && Date.parse(filter.fromDateTime) >= Date.parse(filter.toDateTime)) || (!filter.callIds && !filter.fromDateTime)) throw new ConnectorError("connector_input_invalid", "Supply call IDs or an ordered timestamp range.");
    const body = { filter, ...(cursor ? { cursor } : {}) };
    if (extensive) body.contentSelector = { context: "Extended", contextTiming: ["Now", "TimeOfCall"], exposedFields: {
      parties: true, content: { brief: true, outline: true, topics: true, keyPoints: true, callOutcome: true },
      interaction: { speakers: true, personInteractionStats: true, questions: true }, media: includeMedia
    } };
    return { method: "POST", url: `${origin(settings)}${path}`, body };
  }, validateResult: value => Array.isArray(value?.[field]) && recordsValid(value) };
}
const date = { type: "string", required: true, validator: value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value || "Enter a valid YYYY-MM-DD date." };
const statsSchema = createSchema({ cursor, fromDate: date, toDate: date, userIds: ids });
const gongProvider = Object.freeze({
  ...gongDefinition,
  apiOrigins: (settings) => [origin(settings)],
  apiKey: { headers: (secret, settings) => ({ Authorization: `Basic ${Buffer.from(`${settings.accessKey}:${secret}`).toString("base64")}` }) },
  checkOperation: "users.list",
  operations: {
    "calls.extensive": callOperation("/v2/calls/extensive", "calls", true),
    "calls.transcripts": callOperation("/v2/calls/transcript", "callTranscripts"),
    "stats.interaction": { scopes: [], request(input, settings) {
      if (Array.isArray(input.userIds) && input.userIds.some(id => typeof id !== "string")) throw new ConnectorError("connector_input_invalid", "Supply Gong IDs as strings to preserve all digits.");
      const { cursor, ...filter } = validateSchemaPayload({ schema: statsSchema, mode: "replace" }, input, { statusCode: 422 });
      if (filter.fromDate >= filter.toDate) throw new ConnectorError("connector_input_invalid", "The end date must follow the start date.");
      return { method: "POST", url: `${origin(settings)}/v2/stats/interaction`, body: { filter, ...(cursor ? { cursor } : {}) } };
    }, validateResult: value => Array.isArray(value?.peopleInteractionStats) && recordsValid(value) },
    "users.list": jsonOperation((settings) => `${origin(settings)}/v2/users`, {
      cursor: { type: "string", minLength: 1, maxLength: 8192 },
      includeAvatars: { type: "boolean", defaultTo: false }
    }, (result) => Array.isArray(result?.users) &&
      ["totalRecords", "currentPageSize", "currentPageNumber"].every((key) => Number.isInteger(result.records?.[key]) && result.records[key] >= 0) &&
      (result.records.cursor === undefined || typeof result.records.cursor === "string"))
  }
});
export { gongProvider };
