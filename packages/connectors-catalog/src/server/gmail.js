import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { gmailDefinition } from "../shared/google.js";
import { googleRead, googleProvider, documentId, pageToken } from "./google.js";
const origin = "https://gmail.googleapis.com";
const read = ["gmail.readonly", "gmail.modify", "gmail.metadata", "https://mail.google.com/"];
const contentScopes = ["gmail.readonly", "gmail.modify", "https://mail.google.com/"];
const composeScopes = ["gmail.compose", "gmail.modify", "https://mail.google.com/"];
const modifyScopes = ["gmail.modify", "https://mail.google.com/"];
const labelScopes = ["gmail.labels", ...modifyScopes];
const messageResult = value => typeof value?.id === "string" && typeof value.threadId === "string";
const draftResult = value => typeof value?.id === "string" && messageResult(value.message);
const rawField = { type: "string", required: true, minLength: 4, maxLength: 14000000, noTrim: true,
  validator: value => /^[A-Za-z0-9_-]+={0,2}$/.test(value) && value.replace(/=+$/, "").length % 4 !== 1 || "Supply base64url-encoded MIME content." };
const labelIds = { type: "array", items: { type: "string", minLength: 1, maxLength: 200 }, validator: value => value.length <= 100 || "Supply no more than 100 labels." };
const listFields = { pageToken, maxResults: { type: "integer", min: 1, max: 500, defaultTo: 100 }, labelIds, includeSpamTrash: { type: "boolean", defaultTo: false } };
function gmailWrite(scopes, fields, destination, validateResult, method = "POST") {
  const schema = createSchema(fields);
  return { scopes: scopes.map(value => value.startsWith("https:") ? value : `https://www.googleapis.com/auth/${value}`), validateResult,
    request(input) {
      const values = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      const { path, body } = destination(values);
      return { method, url: `${origin}/gmail/v1/users/me${path}`, ...(body ? { body } : {}) };
    } };
}
const gmailProvider = Object.freeze({ ...googleProvider(gmailDefinition, origin, "profile.read", {
  "messages.read": googleRead(contentScopes, { id: documentId, format: { type: "string", enum: ["full", "raw"], defaultTo: "full" } }, ({ id, format }) => ({ url: `${origin}/gmail/v1/users/me/messages/${encodeURIComponent(id)}`, query: { format } }), messageResult),
  "messages.search": googleRead(contentScopes, { ...listFields, q: { type: "string", required: true, minLength: 1, maxLength: 4096 } }, query => ({ url: `${origin}/gmail/v1/users/me/messages`, query }), value => Number.isInteger(value?.resultSizeEstimate) && (value.messages === undefined || Array.isArray(value.messages))),
  "attachments.get": googleRead(contentScopes, { messageId: documentId, id: documentId }, ({ messageId, id }) => ({ url: `${origin}/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(id)}` }), value => Number.isInteger(value?.size) && typeof value.data === "string"),
  "messages.send": gmailWrite(["gmail.send", ...composeScopes], { raw: rawField, threadId: { ...documentId, required: false } }, body => ({ path: "/messages/send", body }), messageResult),
  "messages.modify": gmailWrite(modifyScopes, { id: documentId, addLabelIds: labelIds, removeLabelIds: labelIds }, ({ id, ...body }) => {
    if (!body.addLabelIds?.length && !body.removeLabelIds?.length) throw new ConnectorError("connector_input_invalid", "Supply labels to add or remove.");
    return { path: `/messages/${encodeURIComponent(id)}/modify`, body };
  }, messageResult),
  "messages.trash": gmailWrite(modifyScopes, { id: documentId }, ({ id }) => ({ path: `/messages/${encodeURIComponent(id)}/trash` }), messageResult),
  "messages.untrash": gmailWrite(modifyScopes, { id: documentId }, ({ id }) => ({ path: `/messages/${encodeURIComponent(id)}/untrash` }), messageResult),
  "drafts.list": googleRead([...contentScopes, "gmail.compose"], { pageToken, maxResults: listFields.maxResults }, query => ({ url: `${origin}/gmail/v1/users/me/drafts`, query }), value => Number.isInteger(value?.resultSizeEstimate) && (value.drafts === undefined || Array.isArray(value.drafts))),
  "drafts.get": googleRead([...contentScopes, "gmail.compose"], { id: documentId }, ({ id }) => ({ url: `${origin}/gmail/v1/users/me/drafts/${encodeURIComponent(id)}`, query: { format: "full" } }), draftResult),
  "drafts.create": gmailWrite(composeScopes, { raw: rawField, threadId: { ...documentId, required: false } }, message => ({ path: "/drafts", body: { message } }), draftResult),
  "drafts.update": gmailWrite(composeScopes, { id: documentId, raw: rawField, threadId: { ...documentId, required: false } }, ({ id, ...message }) => ({ path: `/drafts/${encodeURIComponent(id)}`, body: { message } }), draftResult, "PUT"),
  "drafts.delete": gmailWrite(composeScopes, { id: documentId }, ({ id }) => ({ path: `/drafts/${encodeURIComponent(id)}` }), value => value === null, "DELETE"),
  "drafts.send": gmailWrite(composeScopes, { id: documentId }, body => ({ path: "/drafts/send", body }), messageResult),
  "labels.list": googleRead([...read, "gmail.labels"], {}, () => ({ url: `${origin}/gmail/v1/users/me/labels` }), value => Array.isArray(value?.labels)),
  "labels.delete": gmailWrite(labelScopes, { id: documentId }, ({ id }) => ({ path: `/labels/${encodeURIComponent(id)}` }), value => value === null, "DELETE"),
  "labels.create": gmailWrite(labelScopes, { name: { type: "string", required: true, minLength: 1, maxLength: 225 } }, body => ({ path: "/labels", body }), value => typeof value?.id === "string" && typeof value.name === "string"),
  "labels.update": gmailWrite(labelScopes, { id: documentId, name: { type: "string", required: true, minLength: 1, maxLength: 225 } }, ({ id, ...body }) => ({ path: `/labels/${encodeURIComponent(id)}`, body }), value => typeof value?.id === "string" && typeof value.name === "string", "PUT"),
  "profile.read": googleRead([...read, "gmail.compose"], {}, () => ({ url: `${origin}/gmail/v1/users/me/profile` }),
    (value) => typeof value?.emailAddress === "string" && Number.isInteger(value.messagesTotal)),
  "messages.list": googleRead(read, {
    pageToken, maxResults: { type: "integer", min: 1, max: 500, defaultTo: 100 },
    labelIds: { type: "array", items: { type: "string", minLength: 1, maxLength: 200 } },
    includeSpamTrash: { type: "boolean", defaultTo: false }
  }, (query) => ({ url: `${origin}/gmail/v1/users/me/messages`, query }),
  (value) => Number.isInteger(value?.resultSizeEstimate) && (value.messages === undefined || Array.isArray(value.messages))),
  "messages.get": googleRead(read, { id: documentId }, ({ id }) => ({
    url: `${origin}/gmail/v1/users/me/messages/${encodeURIComponent(id)}`, query: { format: "metadata" }
  }), (value) => typeof value?.id === "string" && typeof value.threadId === "string")
}), accountLabelFromVerification: (profile) => profile.emailAddress });
export { gmailProvider };
