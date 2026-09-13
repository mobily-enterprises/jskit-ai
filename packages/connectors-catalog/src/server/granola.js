import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { granolaDefinition } from "../shared/granola.js";
import { jsonOperation } from "./jsonOperation.js";
import { mcpOperations, exchangeMcp } from "./mcpTransport.js";
import { mcpRegistrationFields, registerMcpClient } from "./mcpRegistration.js";

const apiOrigin = "https://public-api.granola.ai";
const noteId = (value) => typeof value === "string" && /^not_[A-Za-z0-9]{14}$/u.test(value);
const folderId = (value) => typeof value === "string" && /^fol_[A-Za-z0-9]{14}$/u.test(value);
const cursorValid = (value) => typeof value === "string" && value.length > 0 && value.length <= 8192 && !/[\s\p{Cc}]/u.test(value);
const cursor = { type: "string", noTrim: true, validator: (value) => cursorValid(value) || "Use the cursor returned by the previous page." };
const date = { type: "string", noTrim: true, validator: (value) => {
  const match = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/u.test(value);
  return match && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().startsWith(value.slice(0, 10)) || "Use a valid YYYY-MM-DD date or UTC timestamp.";
} };
const noteSummary = (value) => noteId(value?.id) && value.object === "note" && (value.title === null || typeof value.title === "string") &&
  typeof value.owner?.email === "string" && typeof value.created_at === "string" && typeof value.updated_at === "string";
const transcriptItem = (value) => typeof value?.text === "string" && typeof value.speaker?.source === "string" &&
  typeof value.start_time === "string" && typeof value.end_time === "string";
const validFolder = (value) => folderId(value?.id) && value.object === "folder" && typeof value.name === "string" &&
  (value.parent_folder_id === null || folderId(value.parent_folder_id));
const validPage = (value, field, itemValid) => typeof value?.hasMore === "boolean" &&
  (value.cursor === null || cursorValid(value.cursor)) && (!value.hasMore || cursorValid(value.cursor)) &&
  Array.isArray(value[field]) && value[field].every(itemValid);

function noteRead(suffix, fields, validateResult) {
  const schema = createSchema({ note_id: { type: "string", required: true, validator: (value) => noteId(value) || "Use the not_ ID returned by notes.list." }, ...fields });
  return {
    scopes: [], validateResult,
    request(input) {
      const { note_id, ...values } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      const url = new URL(`${apiOrigin}/v1/notes/${note_id}${suffix}`);
      for (const [name, value] of Object.entries(values)) url.searchParams.set(name, String(value));
      return { method: "GET", url: url.href };
    }
  };
}

const granolaApiProvider = Object.freeze({
  ...granolaDefinition, apiOrigins: [apiOrigin], checkOperation: "notes.list",
  apiKey: { headers: (key) => {
    if (!key.startsWith("grn_") || key.length <= 4 || /[\s\p{Cc}]/u.test(key)) {
      throw new ConnectorError("connector_binding_missing", "Use the Granola grn_ API key without whitespace or control characters.");
    }
    return { Authorization: `Bearer ${key}` };
  } },
  operations: {
    "notes.list": jsonOperation(`${apiOrigin}/v1/notes`, {
      created_before: date, created_after: date, updated_after: date,
      folder_id: { type: "string", validator: (value) => folderId(value) || "Use a fol_ ID returned by folders.list." },
      cursor, page_size: { type: "integer", min: 1, max: 30, defaultTo: 10 }
    }, (value) => validPage(value, "notes", noteSummary)),
    "folders.list": jsonOperation(`${apiOrigin}/v1/folders`, {
      cursor, page_size: { type: "integer", min: 1, max: 30, defaultTo: 10 }
    }, (value) => validPage(value, "folders", validFolder)),
    "notes.get": noteRead("", { include: { type: "string", enum: ["transcript"] } }, (value) => noteSummary(value) &&
      typeof value.summary_text === "string" && (value.summary_markdown === null || typeof value.summary_markdown === "string") &&
      (value.private_notes_text === null || typeof value.private_notes_text === "string") &&
      (value.private_notes_markdown === null || typeof value.private_notes_markdown === "string") &&
      (value.transcript === null || Array.isArray(value.transcript) && value.transcript.every(transcriptItem))),
    "transcripts.list": noteRead("/transcript", {
      cursor, page_size: { type: "integer", min: 1, max: 100, defaultTo: 50 }
    }, (value) => validPage(value, "transcript", transcriptItem))
  },
  async exchange(address, options, { fetchImpl }) {
    const response = await fetchImpl(address, { ...options, credentials: "omit" });
    if (response.status === 404) throw new ConnectorError("connector_resource_not_found", "The Granola note is unavailable, inaccessible or still being processed.", { statusCode: 404 });
    if (response.status === 413) throw new ConnectorError("connector_response_too_large", "Read the transcript in pages with transcripts.list.", { statusCode: 413 });
    if (!response.ok) throw Object.assign(new Error("Granola request failed."), { status: response.status });
    let value;
    try { value = await response.json(); } catch { /* checked below */ }
    if (response.status !== 200 || !value || typeof value !== "object" || value.error) {
      throw new ConnectorError("connector_response_invalid", "Granola returned an unexpected response.", { statusCode: 502 });
    }
    const url = new URL(address);
    const list = url.pathname === "/v1/notes" ? "notes" : url.pathname === "/v1/folders" ? "folders" : url.pathname.endsWith("/transcript") ? "transcript" : null;
    if (list ? value[list]?.length > Number(url.searchParams.get("page_size")) : value.id !== url.pathname.split("/").at(-1)) {
      throw new ConnectorError("connector_response_invalid", "Granola returned data that does not match this request.", { statusCode: 502 });
    }
    return value;
  }
});

const mcpResource = "https://mcp.granola.ai/mcp";
const oauth = Object.freeze({
  issuer: "https://mcp-auth.granola.ai",
  authorization_endpoint: "https://mcp-auth.granola.ai/oauth2/authorize",
  token_endpoint: "https://mcp-auth.granola.ai/oauth2/token",
  registration_endpoint: "https://mcp-auth.granola.ai/oauth2/register",
  response_types_supported: ["code"], code_challenge_methods_supported: ["S256"]
});
const granolaProvider = Object.freeze({
  ...granolaApiProvider, oauth, oauthResource: mcpResource,
  apiOrigins: [apiOrigin, "https://mcp.granola.ai"],
  checkOperation: (method) => method === "oauth2" ? "tools.list" : "notes.list",
  operations: {
    ...Object.fromEntries(Object.entries(granolaApiProvider.operations).map(([name, operation]) =>
      [name, { ...operation, authenticationMethods: ["api-key"] }])),
    ...Object.fromEntries(Object.entries(mcpOperations(() => mcpResource)).map(([name, operation]) =>
      [name, { ...operation, authenticationMethods: ["oauth2"], scopes: ["openid"] }]))
  },
  exchange(address, options, context) {
    return address === mcpResource ? exchangeMcp(address, options, context) : granolaApiProvider.exchange(address, options, context);
  }
});
const registrationSchema = createSchema(mcpRegistrationFields);

async function registerGranolaClient(input, options) {
  const values = validateSchemaPayload({ schema: registrationSchema, mode: "replace" }, input, { statusCode: 422 });
  return registerMcpClient("Granola", oauth, { ...values, scopes: granolaDefinition.scopes.map((scope) => scope.value) }, options);
}

export { granolaProvider, registerGranolaClient };
