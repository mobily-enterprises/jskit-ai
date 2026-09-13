import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { googleSlidesDefinition } from "../shared/google.js";
import { googleRead, googleProvider, googleFileVerification, documentId } from "./google.js";
const origin = "https://slides.googleapis.com";
const readScopes = ["presentations.readonly", "presentations", "drive.readonly", "drive.file", "drive"];
const writable = ["presentations", "drive.file", "drive"].map(scope => `https://www.googleapis.com/auth/${scope}`);
const validPresentation = value => typeof value?.presentationId === "string" && typeof value.title === "string";
const get = googleRead(readScopes, { presentationId: documentId }, ({ presentationId }) => ({
  url: `${origin}/v1/presentations/${encodeURIComponent(presentationId)}`
}), validPresentation);
const pageId = { ...documentId, validator: value => /^[a-zA-Z0-9_][a-zA-Z0-9_:-]*$/.test(value) || "Enter a slide object ID, not its URL." };
const create = createSchema({ title: { type: "string", required: true, minLength: 1, maxLength: 1024 } });
const batch = createSchema({ presentationId: documentId, requests: { type: "array", required: true }, requiredRevisionId: { type: "string", minLength: 1, maxLength: 1024 } });
const base = googleProvider(googleSlidesDefinition, origin, "connection.verify", {
  "connection.verify": googleFileVerification(get, "presentationId"),
  "presentations.get": get,
  "presentations.create": { scopes: writable, validateResult: validPresentation, request(input) {
    return { method: "POST", url: `${origin}/v1/presentations`, body: validateSchemaPayload({ schema: create, mode: "replace" }, input, { statusCode: 422 }) };
  } },
  "presentations.batchUpdate": { scopes: writable,
    validateResult: value => typeof value?.presentationId === "string" && (value.replies === undefined || Array.isArray(value.replies)),
    request(input) {
      const { presentationId, requests, requiredRevisionId } = validateSchemaPayload({ schema: batch, mode: "replace" }, input, { statusCode: 422 });
      if (!requests.length || requests.length > 100 || Buffer.byteLength(JSON.stringify(requests)) > 1048576 || requests.some(request => !request || typeof request !== "object" || Array.isArray(request) || Object.keys(request).length !== 1 || !/^[a-zA-Z][a-zA-Z0-9]+$/.test(Object.keys(request)[0]) || !Object.values(request)[0] || typeof Object.values(request)[0] !== "object" || Array.isArray(Object.values(request)[0]))) throw Object.assign(new Error("Supply 1–100 native Slides request objects, one operation per object, within 1 MiB."), { statusCode: 422 });
      return { method: "POST", url: `${origin}/v1/presentations/${encodeURIComponent(presentationId)}:batchUpdate`, body: { requests, ...(requiredRevisionId ? { writeControl: { requiredRevisionId } } : {}) } };
    }
  },
  "pages.get": googleRead(readScopes, { presentationId: documentId, pageObjectId: pageId }, ({ presentationId, pageObjectId }) => ({ url: `${origin}/v1/presentations/${encodeURIComponent(presentationId)}/pages/${encodeURIComponent(pageObjectId)}` }), value => typeof value?.objectId === "string"),
  "pages.getThumbnail": googleRead(readScopes, { presentationId: documentId, pageObjectId: pageId, size: { type: "string", enum: ["SMALL", "MEDIUM", "LARGE"] } }, ({ presentationId, pageObjectId, size }) => ({ url: `${origin}/v1/presentations/${encodeURIComponent(presentationId)}/pages/${encodeURIComponent(pageObjectId)}/thumbnail`, query: { "thumbnailProperties.mimeType": "PNG", "thumbnailProperties.thumbnailSize": size } }), value => {
    if (typeof value?.contentUrl !== "string" || !Number.isFinite(value.width) || !Number.isFinite(value.height) || value.width <= 0 || value.height <= 0) return false;
    try { const url = new URL(value.contentUrl); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
  })
});
const googleSlidesProvider = Object.freeze({ ...base, apiOrigins: [origin, "https://www.googleapis.com"] });
export { googleSlidesProvider };
