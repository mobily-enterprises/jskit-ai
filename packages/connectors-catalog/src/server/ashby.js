import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { ashbyDefinition } from "../shared/tokens.js";
import { jsonOperation } from "./jsonOperation.js";

const text = { type: "string", minLength: 1, maxLength: 256 };
const uuid = { type: "string", required: true,
  pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" };
const page = { limit: { type: "integer", min: 1, max: 100, defaultTo: 25 },
  cursor: { type: "string", minLength: 1, maxLength: 8192 }, syncToken: { type: "string", minLength: 1, maxLength: 8192 } };
const candidate = { name: text, email: { ...text, pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" }, phoneNumber: text };
function response(check) {
  return result => {
    if (result?.success === false) throw new ConnectorError("connector_provider_failed", "Ashby could not complete the operation.", { statusCode: 502 });
    return result?.success === true && check(result);
  };
}
const record = response(result => typeof result.results?.id === "string");
const paged = response(result => Array.isArray(result.results) && typeof result.moreDataAvailable === "boolean" &&
  (!result.moreDataAvailable || typeof result.nextCursor === "string" && result.nextCursor.length > 0) &&
  (result.syncToken === undefined || typeof result.syncToken === "string" && result.syncToken.length > 0));
const call = (endpoint, fields, validate = record) => jsonOperation(`https://api.ashbyhq.com/${endpoint}`, fields, validate, "POST");

const candidateUpdate = call("candidate.update", { candidateId: uuid, ...candidate,
  sendNotifications: { type: "boolean", defaultTo: false } });
const ashbyProvider = Object.freeze({
  ...ashbyDefinition,
  apiOrigins: ["https://api.ashbyhq.com"],
  apiKey: { headers: (key) => {
    if (/[:\s\p{Cc}]/u.test(key)) throw new ConnectorError("connector_binding_missing", "Use the Ashby API key without spaces, control characters or colons.");
    return { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`, Accept: "application/json; version=1" };
  } },
  checkOperation: "jobs.list",
  operations: {
    "jobs.list": call("job.list", page, paged),
    "jobs.get": call("job.info", { id: uuid }),
    "candidates.list": call("candidate.list", page, paged),
    "candidates.get": call("candidate.info", { id: uuid }),
    "candidates.create": call("candidate.create", { ...candidate, name: { ...text, required: true } }),
    "candidates.update": { ...candidateUpdate, request(input) {
      const request = candidateUpdate.request(input);
      if (!["name", "email", "phoneNumber"].some(key => Object.hasOwn(request.body, key))) {
        throw new ConnectorError("connector_input_invalid", "Supply at least one candidate profile change.", { statusCode: 422 });
      }
      return request;
    } },
    "applications.list": call("application.list", { ...page, jobId: { ...uuid, required: false },
      status: { type: "string", enum: ["Hired", "Archived", "Active", "Lead"] }
    }, paged),
    "applications.get": call("application.info", { applicationId: uuid }),
    "applications.create": call("application.create", { candidateId: uuid, jobId: uuid,
      interviewPlanId: { ...uuid, required: false }, interviewStageId: { ...uuid, required: false }
    }),
    "applications.changeStage": call("application.changeStage", { applicationId: uuid, interviewStageId: uuid,
      archiveReasonId: { ...uuid, required: false }
    }),
    "interviewPlans.list": call("interviewPlan.list", { ...page, includeArchived: { type: "boolean", defaultTo: false } }, paged),
    "archiveReasons.list": call("archiveReason.list", { includeArchived: { type: "boolean", defaultTo: false } }, response(result => Array.isArray(result.results))),
    "interviewStages.list": call("interviewStage.list", { interviewPlanId: uuid }, response(result => Array.isArray(result.results)))
  }
});
export { ashbyProvider };
