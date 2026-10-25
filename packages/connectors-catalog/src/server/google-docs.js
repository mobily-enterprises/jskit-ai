import { googleDocsDefinition } from "../shared/google.js";
import { googleOperation, googleBatchRequests, googleRead, googleProvider, googleFileVerification, documentId } from "./google.js";
const origin = "https://docs.googleapis.com";
const readScopes = ["documents.readonly", "documents", "drive.readonly", "drive.file", "drive"];
const writable = ["documents", "drive.file", "drive"];
const validDocument = value => typeof value?.documentId === "string" && typeof value.title === "string";
const get = googleRead(readScopes, { documentId }, ({ documentId }) => ({
  url: `${origin}/v1/documents/${encodeURIComponent(documentId)}`, query: { includeTabsContent: true }
}), validDocument);
const base = googleProvider(googleDocsDefinition, origin, "connection.verify", {
  "connection.verify": googleFileVerification(get, "documentId"),
  "documents.get": get,
  "documents.create": googleOperation(writable, { title: { type: "string", required: true, minLength: 1, maxLength: 1024 } },
    body => ({ method: "POST", url: `${origin}/v1/documents`, body }), validDocument),
  "documents.batchUpdate": googleOperation(writable,
    { documentId, requests: { type: "array", required: true }, requiredRevisionId: { type: "string", minLength: 1, maxLength: 1024 } },
    ({ documentId, requests, requiredRevisionId }) => {
      googleBatchRequests(requests, "Google Docs");
      return { method: "POST", url: `${origin}/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`, body: { requests, ...(requiredRevisionId ? { writeControl: { requiredRevisionId } } : {}) } };
    },
    value => typeof value?.documentId === "string" && (value.replies === undefined || Array.isArray(value.replies)))
});
const googleDocsProvider = Object.freeze({ ...base, apiOrigins: [origin, "https://www.googleapis.com"] });
export { googleDocsProvider };
