import { importPKCS8, SignJWT } from "jose";
import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { firebaseCloudMessagingDefinition, firebaseMessagingScope, firebaseProjectId } from "../shared/firebase-cloud-messaging.js";
import { jsonOperation } from "./jsonOperation.js";

const tokenUrl = "https://oauth2.googleapis.com/token";
const endpoint = ({ projectId }) => `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
const credentialSchema = createSchema({ project_id: firebaseProjectId });
const invalidCredential = () => new ConnectorError("connector_binding_missing", "Use a valid Firebase service-account JSON credential for the default Google API domain.");

async function serviceAccountGrant({ credential, scopes, fetchImpl, signal, now }) {
  let account, key;
  try {
    account = JSON.parse(credential);
    if (account?.type !== "service_account" || account.token_uri !== tokenUrl ||
      (account.universe_domain !== undefined && account.universe_domain !== "googleapis.com") ||
      typeof account.client_email !== "string" || !/^[a-z0-9][a-z0-9._-]*@(?:[a-z0-9-]+\.iam|developer)\.gserviceaccount\.com$/u.test(account.client_email) ||
      typeof account.private_key_id !== "string" || !/^[a-f0-9]{1,128}$/u.test(account.private_key_id) ||
      typeof account.private_key !== "string") throw invalidCredential();
    validateSchemaPayload({ schema: credentialSchema, mode: "replace" }, { project_id: account.project_id });
    key = await importPKCS8(account.private_key, "RS256");
  } catch { throw invalidCredential(); }
  const seconds = Math.floor(now / 1000);
  const assertion = await new SignJWT({ scope: scopes.join(" ") })
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: account.private_key_id })
    .setIssuer(account.client_email).setAudience(tokenUrl).setIssuedAt(seconds).setExpirationTime(seconds + 3600).sign(key);
  signal.throwIfAborted();
  const response = await fetchImpl(tokenUrl, {
    method: "POST", redirect: "error", credentials: "omit", signal,
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString()
  });
  if (response.redirected || (response.status >= 300 && response.status < 400)) {
    throw new ConnectorError("connector_response_invalid", "Google returned an unexpected token redirect.", { statusCode: 502 });
  }
  let value;
  try { value = await response.json(); } catch {
    throw new ConnectorError("connector_response_invalid", "Google returned an invalid token response.", { statusCode: 502 });
  }
  if (!response.ok) {
    const denied = response.status === 401 || ["invalid_grant", "invalid_client"].includes(value?.error);
    throw new ConnectorError(denied ? "connector_reconnect_required" : response.status === 403 ? "connector_permission_denied" : response.status === 429 ? "connector_rate_limited" : "connector_provider_failed",
      "Google could not authorize the service account. Check the credential and project permissions.", { statusCode: denied ? 401 : [403, 429].includes(response.status) ? response.status : 502 });
  }
  return value;
}

const target = { type: "string", noTrim: true, minLength: 1, maxLength: 4096, pattern: "^[^\\s]+$" };
const notification = createSchema({
  title: { type: "string", noTrim: true, maxLength: 1024 }, body: { type: "string", noTrim: true, maxLength: 4096 },
  image: { type: "string", maxLength: 2048, validator: (value) => {
    try { const url = new URL(value); return (url.protocol === "https:" && !url.username && !url.password) || "Use an HTTPS image URL."; } catch { return "Use an HTTPS image URL."; }
  } }
});
const messageSchema = createSchema({
  fid: { ...target, maxLength: 128 }, token: target,
  topic: { ...target, maxLength: 900, pattern: "^[A-Za-z0-9_.~%\\-]+$" },
  condition: { type: "string", noTrim: true, minLength: 1, maxLength: 2048 },
  notification: { type: "object", schema: notification },
  data: { type: "object", additionalProperties: true, validator: (value) => Object.entries(value).every(([key, item]) =>
    key.length > 0 && !["from", "message_type"].includes(key) && !key.startsWith("google.") && !key.startsWith("gcm.notification.") && typeof item === "string") || "Use string values and non-reserved Firebase data keys." }
});
const messageFields = { message: { type: "object", required: true, schema: messageSchema,
  validator: (value) => (["fid", "token", "topic", "condition"].filter((key) => Object.hasOwn(value, key)).length === 1 &&
    ((value.notification && Object.values(value.notification).some(Boolean)) || Object.keys(value.data || {}).length > 0) &&
    new TextEncoder().encode(JSON.stringify(value)).length <= (value.topic || value.condition ? 2048 : 4096)) || "Supply one target and a notification or data payload within the message size limit." } };
const receipt = (value) => typeof value?.name === "string" && /^projects\/[^/\s]+\/messages\/[^/\s]+$/u.test(value.name);
function messageOperation(validateOnly) {
  const operation = jsonOperation(endpoint, messageFields, receipt, "POST");
  return { ...operation, scopes: [firebaseMessagingScope], request(input, settings) {
    const request = operation.request(input, settings);
    return { ...request, body: { ...request.body, validate_only: validateOnly } };
  } };
}
const check = jsonOperation(endpoint, {}, receipt, "POST");
const firebaseCloudMessagingProvider = Object.freeze({
  ...firebaseCloudMessagingDefinition, apiOrigins: ["https://fcm.googleapis.com"], serviceAccountGrant,
  checkOperation: "connection.check",
  operations: {
    "connection.check": { ...check, scopes: [firebaseMessagingScope], request(input, settings) {
      return { ...check.request(input, settings), body: { validate_only: true, message: { topic: "jskit-connection-check", data: { connectionCheck: "true" } } } };
    } },
    "messages.validate": messageOperation(true), "messages.send": messageOperation(false)
  },
  async exchange(address, options, { fetchImpl, settings }) {
    const response = await fetchImpl(address, { ...options, body: JSON.stringify(options.body), credentials: "omit", redirect: "error",
      headers: { ...options.headers, "Content-Type": "application/json" } });
    let result;
    try { result = await response.json(); }
    catch { throw new ConnectorError("connector_response_invalid", "Firebase returned invalid message JSON.", { statusCode: 502 }); }
    if (!response.ok) {
      const details = result?.error?.details;
      const fcmError = Array.isArray(details) ? details.find(detail => detail?.["@type"] === "type.googleapis.com/google.firebase.fcm.v1.FcmError")?.errorCode : undefined;
      if (response.status === 404 && fcmError === "UNREGISTERED" && (options.body.message.token || options.body.message.fid)) {
        throw new ConnectorError("connector_recipient_unregistered", "This Firebase recipient is no longer registered. Remove its association and wait for client registration again.", { statusCode: 410 });
      }
      if (response.status === 400) {
        throw new ConnectorError("connector_message_invalid", "Firebase rejected the message or target. Do not delete a registration unless the payload is known to be valid.", { statusCode: 422 });
      }
      throw Object.assign(new Error("Firebase message request failed."), { status: response.status });
    }
    if (!receipt(result) || !result.name.startsWith(`projects/${settings.projectId}/messages/`)) {
      throw new ConnectorError("connector_response_invalid", "Firebase returned an unexpected message receipt.", { statusCode: 502 });
    }
    return result;
  }
});

export { firebaseCloudMessagingProvider };
