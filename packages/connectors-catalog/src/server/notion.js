import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { mcpOperations, exchangeMcp } from "./mcpTransport.js";
import { mcpRegistrationFields, registerMcpClient } from "./mcpRegistration.js";
import { notionDefinition } from "../shared/tokens.js";
import { jsonOperation, validatedOperation } from "./jsonOperation.js";

const identifier = { type: "string", required: true, pattern: "^(?:[a-fA-F0-9]{32}|[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12})$" };
const document = { type: "object", additionalProperties: true,
  validator: value => Buffer.byteLength(JSON.stringify(value)) <= 65536 || "Keep each document below 64 KiB." };
const pagination = { page_size: { type: "integer", min: 1, max: 100, defaultTo: 100 },
  start_cursor: { type: "string", minLength: 1, maxLength: 4096 } };
const listResult = result => result?.object === "list" && Array.isArray(result.results) && typeof result.has_more === "boolean";
const objectResult = object => result => result?.object === object && typeof result.id === "string" && result.id.length > 0;
const children = { type: "array", required: true, minLength: 1, maxLength: 100,
  items: { ...document, required: true }, validator: value => value.length >= 1 && value.length <= 100 && Buffer.byteLength(JSON.stringify(value)) <= 262144 || "Keep blocks below 256 KiB." };
// Notion owns its property/block grammar. Bound documents without inventing a second content schema.
function readObject(collection, object) {
  return validatedOperation({ id: identifier }, ({ id }) => ({ method: "GET", url: `https://api.notion.com/v1/${collection}/${id}` }), objectResult(object));
}

const mcpMetadata = Object.freeze({ issuer: "https://mcp.notion.com",
  authorization_endpoint: "https://mcp.notion.com/authorize", token_endpoint: "https://mcp.notion.com/token",
  registration_endpoint: "https://mcp.notion.com/register" });
const mcpRuntime = Object.freeze({ oauth: mcpMetadata, oauthPkce: true,
  oauthBasicEncoding: undefined, tokenRequestEncoding: undefined, authorizationParameters: {}, oauthHeaders: undefined,
  apiOrigins: ["https://mcp.notion.com"], checkOperation: "tools.list", exchange: exchangeMcp,
  operations: mcpOperations(() => "https://mcp.notion.com/mcp") });
const notionProvider = Object.freeze({
  ...notionDefinition,
  runtimeForSettings: (settings) => settings.connectionType === "mcp" ? mcpRuntime : {},
  oauth: {
    issuer: "https://api.notion.com",
    authorization_endpoint: "https://api.notion.com/v1/oauth/authorize",
    token_endpoint: "https://api.notion.com/v1/oauth/token"
  },
  oauthPkce: false,
  oauthBasicEncoding: "raw",
  tokenRequestEncoding: "json",
  authorizationParameters: { owner: "user" },
  oauthHeaders: () => ({ "Notion-Version": "2026-03-11" }),
  apiOrigins: ["https://api.notion.com"],
  apiKey: { headers: (key) => ({ Authorization: `Bearer ${key}`, "Notion-Version": "2026-03-11" }) },
  checkOperation: "content.search",
  operations: {
    "pages.get": readObject("pages", "page"),
    "databases.get": readObject("databases", "database"),
    "dataSources.get": readObject("data_sources", "data_source"),
    "blocks.list": validatedOperation({ id: identifier, ...pagination }, ({ id, ...query }) => ({ method: "GET",
      url: `https://api.notion.com/v1/blocks/${id}/children?${new URLSearchParams(query)}` }), listResult),
    "dataSources.query": validatedOperation({ id: identifier, ...pagination, filter: document,
      sorts: { type: "array", validator: value => value.length <= 20 || "Use at most 20 sorts.", items: document } }, ({ id, ...body }) => ({ method: "POST",
      url: `https://api.notion.com/v1/data_sources/${id}/query`, body }), listResult),
    "pages.create": validatedOperation({ parentId: identifier, parentType: { type: "string", required: true, enum: ["page_id", "data_source_id"] },
      properties: { ...document, required: true }, children: { ...children, required: false } },
      ({ parentId, parentType, ...body }) => ({ method: "POST", url: "https://api.notion.com/v1/pages",
        body: { parent: { type: parentType, [parentType]: parentId }, ...body } }), objectResult("page")),
    "pages.update": validatedOperation({ id: identifier, properties: { ...document, required: true } },
      ({ id, ...body }) => ({ method: "PATCH", url: `https://api.notion.com/v1/pages/${id}`, body }), objectResult("page")),
    "blocks.append": validatedOperation({ id: identifier, children }, ({ id, ...body }) => ({ method: "PATCH",
      url: `https://api.notion.com/v1/blocks/${id}/children`, body }), listResult),
    "content.search": jsonOperation("https://api.notion.com/v1/search", {
      query: { type: "string", maxLength: 4096 },
      page_size: { type: "integer", min: 1, max: 100, defaultTo: 100 },
      start_cursor: { type: "string", minLength: 1, maxLength: 4096 }
    }, (result) => result?.object === "list" && Array.isArray(result.results) && typeof result.has_more === "boolean", "POST"),
    "identity.read": jsonOperation("https://api.notion.com/v1/users/me", {},
      (result) => result?.object === "user" && typeof result.id === "string" && ["bot", "person"].includes(result.type))
  }
});
const registrationSchema = createSchema(mcpRegistrationFields);
async function registerNotionMcpClient(input, options) {
  const values = validateSchemaPayload({ schema: registrationSchema, mode: "replace" }, input, { statusCode: 422 });
  return registerMcpClient("Notion MCP", mcpMetadata, { ...values, scopes: ["default"] }, options);
}
export { notionProvider, registerNotionMcpClient };
