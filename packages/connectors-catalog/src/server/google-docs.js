import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { googleDocsDefinition } from "../shared/google.js";
import { googleRead, googleProvider, googleFileVerification, documentId } from "./google.js";
const origin = "https://docs.googleapis.com";
const readScopes = ["documents.readonly", "documents", "drive.readonly", "drive.file", "drive"];
const writable = ["documents", "drive.file", "drive"].map(scope => `https://www.googleapis.com/auth/${scope}`);
const validDocument = value => typeof value?.documentId === "string" && typeof value.title === "string";
const get = googleRead(readScopes, { documentId }, ({ documentId }) => ({
  url: `${origin}/v1/documents/${encodeURIComponent(documentId)}`, query: { includeTabsContent: true }
}), validDocument);
const create = createSchema({ title: { type: "string", required: true, minLength: 1, maxLength: 1024 } });
const batch = createSchema({ documentId, requests: { type: "array", required: true }, requiredRevisionId: { type: "string", minLength: 1, maxLength: 1024 } });
const base = googleProvider(googleDocsDefinition, origin, "connection.verify", {
  "connection.verify": googleFileVerification(get, "documentId"),
  "documents.get": get,
  "documents.create": {
    scopes: writable, validateResult: validDocument,
    request(input) {
      return { method: "POST", url: `${origin}/v1/documents`, body: validateSchemaPayload({ schema: create, mode: "replace" }, input, { statusCode: 422 }) };
    }
  },
  "documents.batchUpdate": {
    scopes: writable,
    validateResult: value => typeof value?.documentId === "string" && (value.replies === undefined || Array.isArray(value.replies)),
    request(input) {
      const { documentId, requests, requiredRevisionId } = validateSchemaPayload({ schema: batch, mode: "replace" }, input, { statusCode: 422 });
      if (!requests.length || requests.length > 100 || JSON.stringify(requests).length > 1048576 || requests.some(request => !request || typeof request !== "object" || Array.isArray(request) || Object.keys(request).length !== 1 || !/^[a-zA-Z][a-zA-Z0-9]+$/.test(Object.keys(request)[0]) || !Object.values(request)[0] || typeof Object.values(request)[0] !== "object" || Array.isArray(Object.values(request)[0]))) {
        throw Object.assign(new Error("Supply 1–100 Google Docs request objects, one native operation per object, within 1 MiB."), { statusCode: 422 });
      }
      return { method: "POST", url: `${origin}/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`, body: { requests, ...(requiredRevisionId ? { writeControl: { requiredRevisionId } } : {}) } };
    }
  }
});
const googleDocsProvider = Object.freeze({ ...base, apiOrigins: [origin, "https://www.googleapis.com"] });
export { googleDocsProvider };
