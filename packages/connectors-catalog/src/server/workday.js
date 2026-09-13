import { workdayDefinition, workdayRestEndpoint } from "../shared/workday.js";
import { jsonOperation } from "./jsonOperation.js";
import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { ConnectorError } from "@jskit-ai/connectors-core/server";

function workersUrl(settings) {
  const { host, prefix = "", tenant } = workdayRestEndpoint(settings.restApiEndpoint);
  return `https://${host}${prefix}/api/staffing/v7/${tenant}/workers`;
}
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const worker = (value) => object(value) && /^[a-f0-9]{32}$/u.test(value.id) && typeof value.descriptor === "string" &&
  (value.workerId === undefined || typeof value.workerId === "string");
const pageFields = {
  limit: { type: "integer", min: 1, max: 100, defaultTo: 20 },
  offset: { type: "integer", min: 0, max: Number.MAX_SAFE_INTEGER, defaultTo: 0 }
};
const organizationRecord = (value) => object(value) && typeof value.id === "string" && value.id.length > 0 &&
  typeof value.descriptor === "string";
const organizationPage = (value) => object(value) && !value.error && !value.errors && Number.isSafeInteger(value.total) && value.total >= 0 &&
  Array.isArray(value.data) && value.data.length <= 100 && value.data.every(organizationRecord);
function organizationRead(part) {
  const schema = createSchema({
    id: { type: "string", required: true, maxLength: 256, noTrim: true,
      validator: value => /^([0-9a-f]{32}|Organization_Reference_ID=\S+)$/u.test(value) || "Use a Workday organization ID or Organization_Reference_ID=value." },
    ...(part ? pageFields : {})
  });
  return {
    scopes: [],
    request(input, settings) {
      const { id, ...query } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      const url = new URL(`${workersUrl(settings).replace(/\/workers$/u, "/supervisoryOrganizations")}/${encodeURIComponent(id)}${part ? `/${part}` : ""}`);
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
      return { method: "GET", url: url.href };
    },
    validateResult: part ? organizationPage : organizationRecord
  };
}
const workdayId = { type: "string", minLength: 32, maxLength: 32,
  validator: value => /^[a-f0-9]{32}$/u.test(value) || "Use the returned Workday ID." };
const dateField = { type: "string", noTrim: true,
  validator: value => /^\d{4}-\d{2}-\d{2}$/u.test(value) && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value || "Use a valid YYYY-MM-DD date." };
function absenceRead(kind) {
  const schema = createSchema(kind === "statuses" ? {} : {
    ...pageFields,
    worker: { ...workdayId, required: true },
    ...(kind === "balances" ? { category: workdayId, effective: dateField } : {
      fromDate: dateField, toDate: dateField,
      status: { type: "array", validator: values => values.length > 0 && values.length <= 20 || "Choose 1–20 statuses.", items: workdayId },
      timeOffType: { type: "array", validator: values => values.length > 0 && values.length <= 100 || "Choose 1–100 time-off types.", items: workdayId }
    })
  });
  return {
    scopes: [],
    request(input, settings) {
      const { worker: workerId, ...query } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      if (query.fromDate && query.toDate && query.fromDate > query.toDate) {
        throw new ConnectorError("connector_input_invalid", "The start date must not follow the end date.", { statusCode: 422 });
      }
      const { host, prefix = "", tenant } = workdayRestEndpoint(settings.restApiEndpoint);
      const path = kind === "statuses" ? "values/timeOff/status/" : kind === "balances" ? "balances" : `workers/${workerId}/timeOffDetails`;
      const url = new URL(`https://${host}${prefix}/api/absenceManagement/v5/${tenant}/${path}`);
      if (kind === "balances") url.searchParams.set("worker", workerId);
      for (const [key, value] of Object.entries(query)) {
        for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(item));
      }
      return { method: "GET", url: url.href };
    },
    validateResult(value) {
      return object(value) && !value.error && !value.errors && Number.isSafeInteger(value.total) && value.total >= 0 &&
        Array.isArray(value.data) && value.data.length <= 100 && value.data.every(row =>
          kind === "statuses" ? organizationRecord(row) : object(row) && Number.isFinite(row.quantity) && object(row.unit) &&
            (kind === "balances" ? object(row.absencePlan) : typeof row.date === "string" && object(row.status)));
    }
  };
}
const reportSegment = { type: "string", required: true, minLength: 1, maxLength: 256, noTrim: true,
  validator: value => !/[\\/\s%?#\u0000-\u001f]/u.test(value) && value !== "." && value !== ".." || "Copy the report URL's owner/name segment without separators or escaping." };
const reportSchema = createSchema({
  owner: reportSegment, report: reportSegment,
  prompts: { type: "array", validator: values => values.length <= 50 || "Use at most 50 report prompts.",
    items: { type: "object", schema: createSchema({
      name: { type: "string", required: true, minLength: 1, maxLength: 256,
        validator: value => /^[A-Za-z_][A-Za-z0-9_.-]*(?:!WID)?$/u.test(value) && value.toLowerCase() !== "format" || "Use a report prompt XML alias, optionally ending !WID; format is fixed." },
      value: { type: "string", required: true, maxLength: 4096, noTrim: true }
    }) }
  }
});
const workdayProvider = Object.freeze({
  ...workdayDefinition,
  // Workday's captured confidential registration issues a secret when PKCE is disabled.
  oauthPkce: false,
  oauth: (settings) => ({ issuer: new URL(settings.authorizationEndpoint).origin,
    authorization_endpoint: settings.authorizationEndpoint, token_endpoint: settings.tokenEndpoint }),
  apiOrigins: (settings) => [new URL(settings.restApiEndpoint).origin],
  checkOperation: "workers.me",
  operations: {
    "reports.read": {
      scopes: [],
      request(input, settings) {
        const { owner, report, prompts = [] } = validateSchemaPayload({ schema: reportSchema, mode: "replace" }, input, { statusCode: 422 });
        const { host, tenant } = workdayRestEndpoint(settings.restApiEndpoint);
        const url = new URL(`https://${host}/ccx/service/customreport2/${tenant}/${encodeURIComponent(owner)}/${encodeURIComponent(report)}`);
        const names = new Set();
        for (const { name, value } of prompts) {
          if (names.has(name)) throw new ConnectorError("connector_input_invalid", "Supply each report prompt once; join multi-instance WIDs with !.", { statusCode: 422 });
          names.add(name); url.searchParams.set(name, value);
        }
        url.searchParams.set("format", "json");
        if (url.href.length > 16384) throw new ConnectorError("connector_input_invalid", "Use a smaller report prompt request.", { statusCode: 422 });
        return { method: "GET", url: url.href };
      },
      validateResult: result => object(result) && !result.error && !result.errors && Array.isArray(result.Report_Entry) && result.Report_Entry.every(object)
    },
    "timeOff.balances": absenceRead("balances"),
    "timeOff.details": absenceRead("details"),
    "timeOff.statuses": absenceRead("statuses"),
    "organizations.list": jsonOperation((settings) => workersUrl(settings).replace(/\/workers$/u, "/supervisoryOrganizations"), {
      ...pageFields, includeInactive: { type: "boolean" }
    }, organizationPage),
    "organizations.get": organizationRead(""),
    "organizations.members": organizationRead("members"),
    "organizations.orgChart": organizationRead("orgChart"),
    "workers.me": jsonOperation((settings) => `${workersUrl(settings)}/me`, {}, worker),
    "workers.list": jsonOperation(workersUrl, {
      limit: { type: "integer", min: 1, max: 100, defaultTo: 20 },
      offset: { type: "integer", min: 0, max: Number.MAX_SAFE_INTEGER, defaultTo: 0 },
      search: { type: "string", minLength: 1, maxLength: 512, noTrim: true },
      includeTerminatedWorkers: { type: "boolean" }, filterByOrgVisibility: { type: "boolean" }
    }, (result) => object(result) && !result.error && !result.errors && Number.isSafeInteger(result.total) && result.total >= 0 &&
      Array.isArray(result.data) && result.data.length <= 100 && result.data.every(worker))
  }
});
export { workdayProvider };
