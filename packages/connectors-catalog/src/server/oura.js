import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { ouraDefinition } from "../shared/oura.js";
import { jsonOperation } from "./jsonOperation.js";

const date = {
  type: "string",
  validator: (value) => (/^\d{4}-\d{2}-\d{2}$/u.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value) || "Enter a valid date as YYYY-MM-DD."
};
const datetime = { type: "string", validator: value =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) && date.validator(value.slice(0, 10)) === true || "Enter an ISO timestamp with timezone." };
function collection(endpoint, scope = "daily", timed = false) {
  const start = timed ? "start_datetime" : "start_date", end = timed ? "end_datetime" : "end_date";
  const operation = jsonOperation(`https://api.ouraring.com/v2/usercollection/${endpoint}`, {
    [start]: timed ? datetime : date, [end]: timed ? datetime : date,
    next_token: { type: "string", minLength: 1, maxLength: 4096 }
  }, result => Array.isArray(result?.data) && (result.next_token == null || typeof result.next_token === "string"));
  return { ...operation, scopes: [scope], request(input, settings) {
    const request = operation.request(input, settings);
    const query = new URL(request.url).searchParams;
    if (query.has(start) && query.has(end) && Date.parse(query.get(start)) > Date.parse(query.get(end)))
      throw new ConnectorError("connector_input_invalid", "Start must be before or equal to end.", { statusCode: 422 });
    return request;
  } };
}
const ouraProvider = Object.freeze({
  ...ouraDefinition,
  oauth: {
    issuer: "https://cloud.ouraring.com",
    authorization_endpoint: "https://cloud.ouraring.com/oauth/authorize",
    token_endpoint: "https://api.ouraring.com/oauth/token"
  },
  scopesInAuthorizationResponse: true,
  apiOrigins: ["https://api.ouraring.com"], checkOperation: "dailySleep.list",
  operations: {
    "dailySleep.list": collection("daily_sleep"),
    "sleep.list": collection("sleep"),
    "dailyReadiness.list": collection("daily_readiness"),
    "dailyActivity.list": collection("daily_activity"),
    "heartRate.list": collection("heartrate", "heartrate", true),
    "personalInfo.read": {
      ...jsonOperation("https://api.ouraring.com/v2/usercollection/personal_info", {},
        (result) => typeof result?.id === "string" && result.id.length > 0),
      scopes: ["personal", "email"]
    }
  }
});
export { ouraProvider };
