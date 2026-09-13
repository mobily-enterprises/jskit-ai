import { createSchema } from "json-rest-schema";
import { airtableDefinition } from "../shared/tokens.js";
import { jsonOperation, validatedOperation } from "./jsonOperation.js";

const identifier = { type: "string", required: true, minLength: 1, maxLength: 200,
  pattern: "^[A-Za-z0-9_-]+$" };
const table = { type: "string", required: true, minLength: 1, maxLength: 1000,
  validator: value => ![".", ".."].includes(value) || "Use a table ID or name." };
const name = { type: "string", required: true, minLength: 1, maxLength: 1000 };
const description = { type: "string", maxLength: 20000 };
const fields = { type: "object", required: true, additionalProperties: true,
  validator: value => (Object.keys(value).length > 0 && Object.keys(value).every(key => key.length > 0 && key.length <= 1000)) || "Provide named fields to change." };
const fieldSchema = createSchema({ name, type: { ...name, maxLength: 100 },
  description, options: { type: "object", additionalProperties: true } });
const tableFields = { type: "array", required: true,
  validator: value => (value.length > 0 && value.length <= 500 && new Set(value.map(field => field.name.toLowerCase())).size === value.length) || "Provide 1–500 fields with unique names.",
  items: { type: "object", schema: fieldSchema } };
const tableSchema = createSchema({ name, description, fields: tableFields });
const basePath = baseId => `https://api.airtable.com/v0/meta/bases/${encodeURIComponent(baseId)}/tables`;
const recordPath = (baseId, tableId) => `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(tableId)}`;
const recordResult = result => typeof result?.id === "string" && !!result.fields && typeof result.fields === "object";
const tableResult = result => typeof result?.id === "string" && typeof result.name === "string";

const airtableProvider = Object.freeze({
  ...airtableDefinition, apiOrigins: ["https://api.airtable.com"],
  apiKey: { headers: (key) => ({ Authorization: `Bearer ${key}` }) },
  checkOperation: "bases.list",
  operations: {
    "bases.create": validatedOperation({ name, workspaceId: identifier,
      tables: { type: "array", required: true,
        validator: value => value.length > 0 || "Provide at least one table.",
        items: { type: "object", schema: tableSchema } }
    }, body => ({ method: "POST", url: "https://api.airtable.com/v0/meta/bases", body }),
      result => typeof result?.id === "string" && Array.isArray(result.tables)),
    "tables.list": validatedOperation({ baseId: identifier }, ({ baseId }) => ({ method: "GET", url: basePath(baseId) }),
      result => Array.isArray(result?.tables)),
    "tables.create": validatedOperation({ baseId: identifier, name, description,
      fields: tableFields
    }, ({ baseId, ...body }) => ({ method: "POST", url: basePath(baseId), body }), tableResult),
    "tables.update": validatedOperation({ baseId: identifier, tableId: table, name, description },
      ({ baseId, tableId, ...body }) => ({ method: "PATCH", url: `${basePath(baseId)}/${encodeURIComponent(tableId)}`, body }), tableResult),
    "fields.create": validatedOperation({ baseId: identifier, tableId: identifier,
      field: { type: "object", required: true, schema: fieldSchema } },
      ({ baseId, tableId, field }) => ({ method: "POST", url: `${basePath(baseId)}/${tableId}/fields`, body: field }), tableResult),
    "fields.update": validatedOperation({ baseId: identifier, tableId: identifier, fieldId: identifier, name, description,
      options: { type: "object", additionalProperties: true } },
      ({ baseId, tableId, fieldId, ...body }) => ({ method: "PATCH", url: `${basePath(baseId)}/${tableId}/fields/${fieldId}`, body }), tableResult),
    "records.list": validatedOperation({ baseId: identifier, tableId: table,
      pageSize: { type: "integer", min: 1, max: 100, defaultTo: 100 },
      offset: { type: "string", minLength: 1, maxLength: 4096 },
      view: { type: "string", minLength: 1, maxLength: 1000 },
      filterByFormula: { type: "string", minLength: 1, maxLength: 10000 }
    }, ({ baseId, tableId, ...body }) => ({ method: "POST", url: `${recordPath(baseId, tableId)}/listRecords`, body }),
      result => Array.isArray(result?.records) && (result.offset === undefined || typeof result.offset === "string")),
    "records.create": validatedOperation({ baseId: identifier, tableId: table, fields },
      ({ baseId, tableId, fields }) => ({ method: "POST", url: recordPath(baseId, tableId), body: { fields, typecast: false } }), recordResult),
    "records.update": validatedOperation({ baseId: identifier, tableId: table, recordId: identifier, fields },
      ({ baseId, tableId, recordId, fields }) => ({ method: "PATCH", url: `${recordPath(baseId, tableId)}/${recordId}`, body: { fields, typecast: false } }), recordResult),
    "records.delete": validatedOperation({ baseId: identifier, tableId: table, recordId: identifier },
      ({ baseId, tableId, recordId }) => ({ method: "DELETE", url: `${recordPath(baseId, tableId)}/${recordId}` }),
      result => typeof result?.id === "string" && result.deleted === true),
    "bases.list": jsonOperation("https://api.airtable.com/v0/meta/bases", {
      offset: { type: "string", minLength: 1, maxLength: 4096 }
    }, (result) => Array.isArray(result?.bases) && (result.offset === undefined || typeof result.offset === "string"))
  }
});
export { airtableProvider };
