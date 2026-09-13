import { createSchema } from "json-rest-schema";
import { incidentIoDefinition } from "../shared/tokens.js";
import { jsonOperation, validatedOperation } from "./jsonOperation.js";

const id = { type: "string", required: true, minLength: 1, maxLength: 200,
  validator: value => /^[a-zA-Z0-9_-]+$/u.test(value) || "Use the incident.io resource ID, not a URL." };
const text = { type: "string", minLength: 1, maxLength: 20000 };
const optionalId = { ...id, required: false };
const after = { type: "string", minLength: 1, maxLength: 4096 };
const page = max => ({ type: "integer", min: 1, max, defaultTo: 25 });
const result = key => value => typeof value?.[key]?.id === "string";
const address = path => `https://api.incident.io${path}`;
const incidentFields = { name: text, summary: text, severity_id: optionalId, incident_status_id: optionalId };
const followUpFields = { title: { ...text, required: true, maxLength: 1000 }, description: text,
  assignee_id: optionalId, assignee_team_id: optionalId, follow_up_category_id: optionalId, follow_up_priority_option_id: optionalId };
const literal = value => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === 1 && typeof value.literal === "string" && value.literal.length <= 20000;
const attributes = { type: "object", required: true, additionalProperties: true,
  validator: value => Object.keys(value).length <= 250 && Buffer.byteLength(JSON.stringify(value)) <= 100000 &&
    Object.entries(value).every(([key, binding]) => /^[a-zA-Z0-9_-]+$/u.test(key) && binding && typeof binding === "object" && !Array.isArray(binding) &&
      Object.keys(binding).every(field => ["value", "array_value"].includes(field)) &&
      (binding.value === undefined || literal(binding.value)) &&
      (binding.array_value === undefined || Array.isArray(binding.array_value) && binding.array_value.length <= 100 && binding.array_value.every(literal))) ||
    "Use at most 250 attributes with literal string value/array_value bindings, within 100KB." };

const incidentIoProvider = Object.freeze({
  ...incidentIoDefinition, apiOrigins: ["https://api.incident.io"],
  apiKey: { headers: (key) => ({ Authorization: `Bearer ${key}` }) },
  checkOperation: "incidents.list",
  operations: {
    ...Object.fromEntries([
      ["incidents.get", "/v2/incidents", "incident"], ["followUps.get", "/v2/follow_ups", "follow_up"],
      ["alerts.get", "/v2/alerts", "alert"], ["schedules.get", "/v2/schedules", "schedule"],
      ["catalog.get", "/v3/catalog_entries", "catalog_entry"]
    ].map(([name, path, key]) => [name, validatedOperation({ id }, ({ id }) => ({ method: "GET", url: address(`${path}/${id}`) }), result(key))])),
    "incidents.create": validatedOperation({ ...incidentFields, idempotency_key: { ...text, required: true, maxLength: 200 },
      visibility: { type: "string", required: true, enum: ["public", "private"] },
      mode: { type: "string", enum: ["standard", "retrospective", "test", "tutorial"], defaultTo: "standard" }, incident_type_id: optionalId
    }, body => ({ method: "POST", url: address("/v2/incidents"), body }), result("incident")),
    "incidents.update": validatedOperation({ id, incident: { type: "object", required: true, schema: createSchema(incidentFields),
      validator: value => Object.keys(value).length > 0 || "Provide at least one incident field." },
      notify_incident_channel: { type: "boolean", required: true }
    }, ({ id, ...body }) => ({ method: "POST", url: address(`/v2/incidents/${id}/actions/edit`), body }), result("incident")),
    "followUps.list": jsonOperation(address("/v2/follow_ups"), { incident_id: optionalId, assignee_team_id: optionalId,
      incident_mode: { type: "string", enum: ["standard", "retrospective", "test", "tutorial", "stream"] }
    }, value => Array.isArray(value?.follow_ups)),
    "followUps.create": validatedOperation({ ...followUpFields, incident_id: id }, body => ({ method: "POST", url: address("/v2/follow_ups"), body }), result("follow_up")),
    "followUps.update": validatedOperation({ id, ...followUpFields, status: { type: "string", required: true, enum: ["outstanding", "completed", "deleted", "not_doing"] }
    }, ({ id, ...body }) => ({ method: "PUT", url: address(`/v2/follow_ups/${id}`), body }), result("follow_up")),
    "alerts.list": jsonOperation(address("/v2/alerts"), { page_size: page(50), after }, value => Array.isArray(value?.alerts)),
    "alerts.resolve": validatedOperation({ id }, ({ id }) => ({ method: "POST", url: address(`/v2/alerts/${id}/actions/resolve`), body: {} }), result("alert")),
    "schedules.list": jsonOperation(address("/v2/schedules"), { page_size: page(25), after }, value => Array.isArray(value?.schedules)),
    "catalog.types": jsonOperation(address("/v3/catalog_types"), {}, value => Array.isArray(value?.catalog_types)),
    "catalog.list": jsonOperation(address("/v3/catalog_entries"), { catalog_type_id: id, page_size: page(250), after, identifier: text }, value => Array.isArray(value?.catalog_entries)),
    "catalog.create": validatedOperation({ catalog_type_id: id, name: { ...text, required: true, maxLength: 1000 }, external_id: text,
      attribute_values: attributes
    }, body => ({ method: "POST", url: address("/v3/catalog_entries"), body }), result("catalog_entry")),
    "catalog.update": validatedOperation({ id, name: { ...text, required: true, maxLength: 1000 }, external_id: text,
      attribute_values: attributes
    }, ({ id, ...body }) => ({ method: "PUT", url: address(`/v3/catalog_entries/${id}`), body }), result("catalog_entry")),
    "incidents.list": jsonOperation("https://api.incident.io/v2/incidents", {
      page_size: { type: "integer", min: 1, max: 500, defaultTo: 25 },
      after: { type: "string", maxLength: 4096 },
      sort_by: { type: "string", enum: ["created_at_newest_first", "created_at_oldest_first"], defaultTo: "created_at_newest_first" }
    }, (result) => Array.isArray(result?.incidents) && (result.pagination_meta === undefined || Number.isInteger(result.pagination_meta?.page_size)))
  }
});
export { incidentIoProvider };
