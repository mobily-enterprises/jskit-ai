import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { microsoftOutlookDefinition } from "../shared/microsoft.js";
import { graphRead, microsoftProvider, pageSize } from "./microsoft.js";

const id = { type: "string", required: true, minLength: 1, maxLength: 2048,
  validator: value => /^[A-Za-z0-9_+=-]+$/u.test(value) || "Use the returned Outlook resource ID." };
const text = { type: "string", required: true, minLength: 1, maxLength: 100000, noTrim: true };
const instant = { type: "string", required: true, maxLength: 30,
  validator: value => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) && Number.isFinite(Date.parse(value)) || "Use a UTC ISO timestamp ending in Z." };
const resource = value => typeof value?.id === "string";
function operation(scopes, fields, destination, validateResult = resource) {
  const schema = createSchema(fields);
  return { scopes, validateResult, request(input) {
    return destination(validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 }));
  } };
}
const url = path => `https://graph.microsoft.com/v1.0/me${path}`;

const base = microsoftProvider(microsoftOutlookDefinition, "common", "folders.list", {
  "messages.get": operation(["Mail.Read"], { messageId: id }, ({ messageId }) => ({ method: "GET", url: url(`/messages/${encodeURIComponent(messageId)}`), headers: { Prefer: 'outlook.body-content-type="text"' } }), value => resource(value) && typeof value.body?.content === "string"),
  "attachments.list": graphRead("Mail.Read", { messageId: id }, ({ messageId }) => ({ pathname: `/me/messages/${encodeURIComponent(messageId)}/attachments` })),
  "attachments.get": operation(["Mail.Read"], { messageId: id, attachmentId: id }, ({ messageId, attachmentId }) => ({ method: "GET", url: url(`/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`) }), value => resource(value) && value["@odata.type"] === "#microsoft.graph.fileAttachment" && typeof value.contentBytes === "string" && value.contentBytes.length <= 6666668),
  "messages.setRead": operation(["Mail.ReadWrite"], { messageId: id, isRead: { type: "boolean", required: true } }, ({ messageId, isRead }) => ({ method: "PATCH", url: url(`/messages/${encodeURIComponent(messageId)}`), body: { isRead } })),
  "messages.move": operation(["Mail.ReadWrite"], { messageId: id, destinationId: id }, ({ messageId, destinationId }) => ({ method: "POST", url: url(`/messages/${encodeURIComponent(messageId)}/move`), body: { destinationId } })),
  "messages.send": operation(["Mail.Send"], {
    subject: { ...text, maxLength: 998 }, text,
    to: { type: "array", required: true, validator: value => value.length > 0 && value.length <= 20 && value.every(address => typeof address === "string" && address.length <= 320 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(address)) || "Supply 1–20 recipient email addresses." }
  }, ({ subject, text, to }) => ({ method: "POST", url: url("/sendMail"), body: { message: { subject, body: { contentType: "Text", content: text }, toRecipients: to.map(address => ({ emailAddress: { address } })) }, saveToSentItems: true } }), value => value?.accepted === true),
  "calendars.list": { ...graphRead("Calendars.Read", {}, () => ({ pathname: "/me/calendars" })), scopes: ["Calendars.Read", "Calendars.ReadWrite"] },
  "events.list": { ...graphRead("Calendars.Read", { calendarId: id, pageSize }, ({ calendarId, pageSize }) => ({ pathname: `/me/calendars/${encodeURIComponent(calendarId)}/events`, query: { $top: pageSize } })), scopes: ["Calendars.Read", "Calendars.ReadWrite"] },
  "events.create": operation(["Calendars.ReadWrite"], { calendarId: id, subject: { ...text, maxLength: 255 }, start: instant, end: instant }, ({ calendarId, subject, start, end }) => {
    if (Date.parse(end) <= Date.parse(start)) throw new ConnectorError("connector_input_invalid", "End must follow start.", { statusCode: 422 });
    return { method: "POST", url: url(`/calendars/${encodeURIComponent(calendarId)}/events`), body: { subject, start: { dateTime: start.slice(0, -1), timeZone: "UTC" }, end: { dateTime: end.slice(0, -1), timeZone: "UTC" } } };
  }),
  "folders.list": graphRead("Mail.Read", {
    pageSize, includeHiddenFolders: { type: "boolean", defaultTo: false }
  }, (params) => ({ pathname: "/me/mailFolders", query: {
    $top: params.pageSize, includeHiddenFolders: params.includeHiddenFolders,
    $select: "id,displayName,childFolderCount,unreadItemCount,totalItemCount"
  } })),
  "inbox.list": graphRead("Mail.Read", { pageSize }, (params) => ({
    pathname: "/me/mailFolders/inbox/messages", query: {
      $top: params.pageSize, $select: "id,subject,from,receivedDateTime,isRead"
    }
  }))
});
const microsoftOutlookProvider = Object.freeze({ ...base,
  async exchange(address, options, { request, fetchImpl }) {
    if (new URL(address).pathname !== "/v1.0/me/sendMail") return request(address, options);
    const response = await fetchImpl(address, { ...options, body: JSON.stringify(options.body), headers: { ...options.headers, "Content-Type": "application/json" }, credentials: "omit", redirect: "error" });
    await response.body?.cancel();
    if (response.status !== 202) throw Object.assign(new Error("Outlook did not accept the message."), { status: response.ok ? 502 : response.status });
    return { accepted: true };
  }
});
export { microsoftOutlookProvider };
