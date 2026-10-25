import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { validatedOperation } from "./jsonOperation.js";

const oauth = Object.freeze({
  issuer: "https://accounts.google.com",
  authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  token_endpoint: "https://oauth2.googleapis.com/token"
});
const googleScope = (name) => name.startsWith("https:") ? name : `https://www.googleapis.com/auth/${name}`;
const documentId = { type: "string", required: true, minLength: 1, maxLength: 1024, validator: (value) => /^[a-zA-Z0-9_-]+$/u.test(value) || "Enter the document ID from its URL." };
const pageToken = { type: "string", minLength: 1, maxLength: 4096 };

// Request builders report rejected input as the caller's mistake, not a provider outage.
const inputInvalid = (message, statusCode = 422) => new ConnectorError("connector_input_invalid", message, { statusCode });
const nativeRequest = request => request && typeof request === "object" && !Array.isArray(request) && Object.keys(request).length === 1 &&
  /^[a-zA-Z][a-zA-Z0-9]+$/.test(Object.keys(request)[0]) && Boolean(Object.values(request)[0]) &&
  typeof Object.values(request)[0] === "object" && !Array.isArray(Object.values(request)[0]);
// Docs, Slides and Sheets batchUpdate share one limit: 1-100 single-operation request objects within 1 MiB.
function googleBatchRequests(requests, product) {
  if (!requests.length || requests.length > 100 || Buffer.byteLength(JSON.stringify(requests)) > 1048576 || !requests.every(nativeRequest)) {
    throw inputInvalid(`Supply 1–100 native ${product} request objects, one operation per object, within 1 MiB.`);
  }
  return requests;
}

function googleOperation(scopes, fields, request, validateResult) {
  return validatedOperation(fields, request, validateResult, scopes.map(googleScope));
}

function googleRead(scopes, fields, destination, validateResult) {
  const schema = createSchema(fields);
  return {
    scopes: scopes.map(googleScope), validateResult,
    request(input) {
      const params = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      const { url: address, query = {} } = destination(params);
      const url = new URL(address);
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(item));
        }
      }
      return { method: "GET", url: url.href };
    }
  };
}

function googleProvider(definition, origin, checkOperation, operations) {
  return Object.freeze({
    ...definition, oauth, apiOrigins: [origin],
    authorizationParameters: { access_type: "offline", prompt: "consent" },
    checkOperation, operations
  });
}
function googleFileVerification(get, field) {
  const schema = createSchema({ [field]: { ...documentId, required: false } });
  return {
    scopes: get.scopes,
    request(input = {}) {
      const params = validateSchemaPayload({ schema, mode: "replace" }, { ...input, ...(input[field] === "" ? { [field]: undefined } : {}) }, { statusCode: 422 });
      if (params[field]) return get.request(params);
      return { method: "GET", url: "https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id)&q=trashed%3Dfalse" };
    },
    validateResult: value => get.validateResult(value) || Array.isArray(value?.files)
  };
}
export { googleScope, googleOperation, googleBatchRequests, inputInvalid, googleRead, googleProvider, googleFileVerification, documentId, pageToken };
