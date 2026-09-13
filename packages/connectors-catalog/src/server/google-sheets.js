import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { googleSheetsDefinition } from "../shared/google.js";
import { googleRead, googleProvider, googleFileVerification, documentId } from "./google.js";
const origin = "https://sheets.googleapis.com";
const scopes = ["spreadsheets.readonly", "spreadsheets", "drive.readonly", "drive.file", "drive"];
const writable = ["spreadsheets", "drive.file", "drive"].map(scope => `https://www.googleapis.com/auth/${scope}`);
const range = { type: "string", required: true, minLength: 1, maxLength: 2048 };
const inputOption = { type: "string", enum: ["RAW", "USER_ENTERED"], default: "RAW" };
const values = { type: "array", required: true };
const validSheet = value => typeof value?.spreadsheetId === "string" && typeof value.properties?.title === "string";
const sheetUrl = id => `${origin}/v4/spreadsheets/${encodeURIComponent(id)}`;
const get = googleRead(scopes, { spreadsheetId: documentId }, ({ spreadsheetId }) => ({ url: sheetUrl(spreadsheetId), query: { includeGridData: false } }), validSheet);
function write(fields, destination, validateResult) {
  const schema = createSchema(fields);
  return { scopes: writable, validateResult, request(input) {
    return destination(validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 }));
  } };
}
function checkValues(rows) {
  if (!rows.length || rows.length > 10000 || rows.some(row => !Array.isArray(row) || row.some(cell => cell !== null && typeof cell !== "string" && typeof cell !== "boolean" && !(typeof cell === "number" && Number.isFinite(cell)))) || rows.reduce((count, row) => count + row.length, 0) > 10000 || Buffer.byteLength(JSON.stringify(rows)) > 1048576) {
    throw Object.assign(new Error("Supply a matrix of at most 10,000 cells and 1 MiB, containing strings, finite numbers, booleans or null."), { statusCode: 422 });
  }
  return rows;
}
const validUpdate = value => typeof value?.spreadsheetId === "string" && typeof value.updatedRange === "string";
const base = googleProvider(googleSheetsDefinition, origin, "connection.verify", {
  "connection.verify": googleFileVerification(get, "spreadsheetId"),
  "spreadsheets.get": get,
  "spreadsheets.create": write({ title: { type: "string", required: true, minLength: 1, maxLength: 1024 } }, ({ title }) => ({ method: "POST", url: `${origin}/v4/spreadsheets`, body: { properties: { title } } }), validSheet),
  "values.get": googleRead(scopes, {
    spreadsheetId: documentId, range,
    valueRenderOption: { type: "string", enum: ["FORMATTED_VALUE", "UNFORMATTED_VALUE", "FORMULA"] },
    dateTimeRenderOption: { type: "string", enum: ["SERIAL_NUMBER", "FORMATTED_STRING"] }
  }, ({ spreadsheetId, range, ...query }) => ({ url: `${sheetUrl(spreadsheetId)}/values/${encodeURIComponent(range)}`, query }), value => typeof value?.range === "string" && (value.values === undefined || Array.isArray(value.values))),
  "values.update": write({ spreadsheetId: documentId, range, values, valueInputOption: inputOption }, ({ spreadsheetId, range, values, valueInputOption = "RAW" }) => ({
    method: "PUT", url: `${sheetUrl(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=${valueInputOption}`,
    body: { range, majorDimension: "ROWS", values: checkValues(values) }
  }), validUpdate),
  "values.append": write({ spreadsheetId: documentId, range, values, valueInputOption: inputOption, insertDataOption: { type: "string", enum: ["INSERT_ROWS", "OVERWRITE"], default: "INSERT_ROWS" } }, ({ spreadsheetId, range, values, valueInputOption = "RAW", insertDataOption = "INSERT_ROWS" }) => ({
    method: "POST", url: `${sheetUrl(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=${valueInputOption}&insertDataOption=${insertDataOption}`,
    body: { range, majorDimension: "ROWS", values: checkValues(values) }
  }), value => typeof value?.spreadsheetId === "string" && validUpdate(value.updates)),
  "values.clear": write({ spreadsheetId: documentId, range }, ({ spreadsheetId, range }) => ({ method: "POST", url: `${sheetUrl(spreadsheetId)}/values/${encodeURIComponent(range)}:clear`, body: {} }), value => typeof value?.spreadsheetId === "string" && typeof value.clearedRange === "string"),
  "values.batchUpdate": write({ spreadsheetId: documentId, data: { type: "array", required: true }, valueInputOption: inputOption }, ({ spreadsheetId, data, valueInputOption = "RAW" }) => {
    const schema = createSchema({ range, values });
    if (!data.length || data.length > 100 || Buffer.byteLength(JSON.stringify(data)) > 1048576) throw Object.assign(new Error("Supply 1–100 ranges within 1 MiB."), { statusCode: 422 });
    const ranges = data.map(value => {
      const parsed = validateSchemaPayload({ schema, mode: "replace" }, value, { statusCode: 422 });
      return { ...parsed, majorDimension: "ROWS", values: checkValues(parsed.values) };
    });
    return { method: "POST", url: `${sheetUrl(spreadsheetId)}/values:batchUpdate`, body: { data: ranges, valueInputOption } };
  }, value => typeof value?.spreadsheetId === "string" && Array.isArray(value.responses)),
  "spreadsheets.batchUpdate": write({ spreadsheetId: documentId, requests: { type: "array", required: true } }, ({ spreadsheetId, requests }) => {
    if (!requests.length || requests.length > 100 || Buffer.byteLength(JSON.stringify(requests)) > 1048576 || requests.some(request => !request || typeof request !== "object" || Array.isArray(request) || Object.keys(request).length !== 1 || !/^[a-zA-Z][a-zA-Z0-9]+$/.test(Object.keys(request)[0]) || !Object.values(request)[0] || typeof Object.values(request)[0] !== "object" || Array.isArray(Object.values(request)[0]))) throw Object.assign(new Error("Supply 1–100 native Sheets request objects, one operation per object, within 1 MiB."), { statusCode: 422 });
    return { method: "POST", url: `${sheetUrl(spreadsheetId)}:batchUpdate`, body: { requests } };
  }, value => typeof value?.spreadsheetId === "string" && (value.replies === undefined || Array.isArray(value.replies)))
});
const googleSheetsProvider = Object.freeze({ ...base, apiOrigins: [origin, "https://www.googleapis.com"] });
export { googleSheetsProvider };
