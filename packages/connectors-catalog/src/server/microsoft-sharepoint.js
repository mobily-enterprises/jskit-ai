import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { microsoftSharePointDefinition } from "../shared/microsoft.js";
import { graphRead, microsoftProvider, driveItemId, pageSize } from "./microsoft.js";
import { microsoftOneDriveProvider } from "./microsoft-onedrive.js";

const siteId = { type: "string", required: true, minLength: 1, maxLength: 512,
  validator: value => /^[A-Za-z0-9.,_-]+$/u.test(value) && value !== "." && value !== ".." || "Use the site's returned ID, not its URL." };
const listId = driveItemId;
const listFields = { type: "object", required: true, additionalProperties: true, validator: value => {
  const entries = Object.entries(value);
  return entries.length > 0 && entries.length <= 100 && JSON.stringify(value).length <= 65536 && entries.every(([key, cell]) =>
    /^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) && (cell === null || ["string", "boolean"].includes(typeof cell) || typeof cell === "number" && Number.isFinite(cell))) || "Use up to 100 internal column names with scalar values (64 KiB maximum).";
} };
const createItemSchema = createSchema({ siteId, listId, fields: listFields });
const updateItemSchema = createSchema({ siteId, listId, itemId: driveItemId, fields: listFields,
  eTag: { type: "string", required: true, minLength: 1, maxLength: 512, validator: value => !/[\r\n]/u.test(value) && value !== "*" || "Use the item's current ETag, not a wildcard." } });
const driveSchema = createSchema({ driveId: driveItemId });
function fileOperation(name, scopes) {
  const source = microsoftOneDriveProvider.operations[name];
  return { ...source, scopes, request(input) {
    const { driveId, ...values } = input || {};
    const valid = validateSchemaPayload({ schema: driveSchema, mode: "replace" }, { driveId }, { statusCode: 422 });
    const result = source.request(values);
    return { ...result, url: result.url.replace("/me/drive/items/", `/drives/${encodeURIComponent(valid.driveId)}/items/`) };
  } };
}
const base = microsoftProvider(microsoftSharePointDefinition, "organizations", "sites.search", {
  "sites.search": graphRead("Sites.Read.All", { search: { type: "string", required: true, minLength: 1, maxLength: 1024 } }, ({ search }) => ({ pathname: "/sites", query: { search } })),
  "libraries.list": graphRead("Sites.Read.All", { siteId }, ({ siteId }) => ({ pathname: `/sites/${encodeURIComponent(siteId)}/drives` })),
  "files.list": graphRead("Sites.Read.All", { driveId: driveItemId, folderId: { ...driveItemId, required: false }, pageSize }, ({ driveId, folderId, pageSize }) => ({ pathname: `/drives/${encodeURIComponent(driveId)}/${folderId ? `items/${encodeURIComponent(folderId)}` : "root"}/children`, query: { $top: pageSize } })),
  "files.get": fileOperation("items.get", ["Sites.Read.All"]),
  "files.upload": fileOperation("files.upload", ["Sites.ReadWrite.All"]),
  "lists.list": graphRead("Sites.Read.All", { siteId }, ({ siteId }) => ({ pathname: `/sites/${encodeURIComponent(siteId)}/lists` })),
  "listItems.list": graphRead("Sites.Read.All", { siteId, listId, pageSize }, ({ siteId, listId, pageSize }) => ({ pathname: `/sites/${encodeURIComponent(siteId)}/lists/${encodeURIComponent(listId)}/items`, query: { $expand: "fields", $top: pageSize } })),
  "listItems.create": { scopes: ["Sites.ReadWrite.All"], validateResult: value => typeof value?.id === "string", request(input) {
    const { siteId, listId, fields } = validateSchemaPayload({ schema: createItemSchema, mode: "replace" }, input, { statusCode: 422 });
    return { method: "POST", url: `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(siteId)}/lists/${encodeURIComponent(listId)}/items`, body: { fields } };
  } },
  "listItems.update": { scopes: ["Sites.ReadWrite.All"], validateResult: value => value !== null && typeof value === "object" && !Array.isArray(value), request(input) {
    const { siteId, listId, itemId, fields, eTag } = validateSchemaPayload({ schema: updateItemSchema, mode: "replace" }, input, { statusCode: 422 });
    return { method: "PATCH", url: `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(siteId)}/lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemId)}/fields`, headers: { "If-Match": eTag }, body: fields };
  } }
});
const microsoftSharePointProvider = Object.freeze({ ...base, exchange: microsoftOneDriveProvider.exchange });
export { microsoftSharePointProvider };
