import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { microsoftExcelDefinition } from "../shared/microsoft.js";
import { graphRead, microsoftProvider, driveItemId, pageSize } from "./microsoft.js";

const sessionId = { type: "string", minLength: 1, maxLength: 1024,
  validator: (value) => /^[^\r\n]+$/u.test(value) || "Use the returned workbook session ID." };
const rangeFields = {
  itemId: driveItemId,
  worksheetId: { type: "string", required: true, minLength: 1, maxLength: 256,
    validator: (value) => /^[^/\\?#'\r\n]+$/u.test(value) || "Use a worksheet ID or name." },
  address: { type: "string", required: true, maxLength: 30,
    validator: (value) => /^[A-Z]{1,3}[1-9][0-9]{0,6}(?::[A-Z]{1,3}[1-9][0-9]{0,6})?$/u.test(value) || "Enter a bounded A1 range, such as A1:B2." },
  sessionId
};
const rangeResult = (value) => typeof value?.address === "string" && Array.isArray(value.values);
function rangeOperation(write) {
  const schema = createSchema({ ...rangeFields, ...(write ? {
    values: { type: "array" }, formulas: { type: "array" }
  } : {}) });
  return { scopes: ["Files.ReadWrite"], validateResult: rangeResult, request(input) {
    const params = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
    const cells = params.address.split(":").map((cell) => {
      const [, letters, row] = /^([A-Z]+)([0-9]+)$/u.exec(cell);
      return { column: [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0), row: Number(row) };
    });
    const first = cells[0], last = cells[1] || first;
    const rows = last.row - first.row + 1, columns = last.column - first.column + 1;
    const bounded = rows > 0 && columns > 0 && rows * columns <= 10000 && last.row <= 1048576 && last.column <= 16384;
    const matrix = (value) => Array.isArray(value) && value.length === rows && value.every((row) =>
      Array.isArray(row) && row.length === columns && row.every((cell) => cell === null ||
        typeof cell === "string" || typeof cell === "boolean" || (typeof cell === "number" && Number.isFinite(cell))));
    const validation = createSchema({ valid: { type: "boolean", required: true,
      validator: (value) => value || "Use at most 10,000 valid cells and exactly matching values or formulas, not both." } });
    validateSchemaPayload({ schema: validation, mode: "replace" }, { valid: bounded && (!write ||
      ((params.values !== undefined) !== (params.formulas !== undefined)) && matrix(params.values ?? params.formulas)) }, { statusCode: 422 });
    return { method: write ? "PATCH" : "GET",
      url: `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(params.itemId)}/workbook/worksheets/${encodeURIComponent(params.worksheetId)}/range(address='${params.address}')`,
      headers: params.sessionId ? { "workbook-session-id": params.sessionId } : {},
      ...(write ? { body: params.values ? { values: params.values } : { formulas: params.formulas } } : {}) };
  } };
}
const createSessionSchema = createSchema({ itemId: driveItemId, persistChanges: { type: "boolean", required: true } });
const closeSessionSchema = createSchema({ itemId: driveItemId, sessionId: { ...sessionId, required: true } });

const microsoftExcelProvider = microsoftProvider(microsoftExcelDefinition, "common", "items.list", {
  "ranges.get": rangeOperation(false),
  "ranges.update": rangeOperation(true),
  "sessions.create": { scopes: ["Files.ReadWrite"],
    validateResult: (value) => typeof value?.id === "string" && value.id.length > 0 && typeof value.persistChanges === "boolean",
    request(input) {
      const { itemId, persistChanges } = validateSchemaPayload({ schema: createSessionSchema, mode: "replace" }, input, { statusCode: 422 });
      return { method: "POST", url: `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(itemId)}/workbook/createSession`, body: { persistChanges } };
    } },
  "sessions.close": { scopes: ["Files.ReadWrite"], request(input) {
    const { itemId, sessionId } = validateSchemaPayload({ schema: closeSessionSchema, mode: "replace" }, input, { statusCode: 422 });
    return { method: "POST", url: `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(itemId)}/workbook/closeSession`, headers: { "workbook-session-id": sessionId } };
  } },
  "items.list": graphRead("Files.Read", { pageSize, folderId: { ...driveItemId, required: false } }, ({ pageSize, folderId }) => ({
    pathname: folderId ? `/me/drive/items/${encodeURIComponent(folderId)}/children` : "/me/drive/root/children",
    query: { $top: pageSize, $select: "id,name,file,folder,webUrl" }
  })),
  "worksheets.list": graphRead("Files.ReadWrite", { itemId: driveItemId }, ({ itemId }) => ({
    pathname: `/me/drive/items/${encodeURIComponent(itemId)}/workbook/worksheets`
  }))
});
export { microsoftExcelProvider };
