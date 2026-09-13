import { twilioDefinition } from "../shared/twilio.js";
import { jsonOperation } from "./jsonOperation.js";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { createHmac, timingSafeEqual } from "node:crypto";

const origins = {
  us1: "https://api.twilio.com", ie1: "https://api.dublin.ie1.twilio.com", au1: "https://api.sydney.au1.twilio.com"
};
const phone = { type: "string", required: true, pattern: "^\\+[1-9][0-9]{1,14}$" };
const sid = prefix => ({ type: "string", required: true, pattern: `^${prefix}[0-9a-fA-F]{32}$` });
const callbackUrl = { type: "string", maxLength: 2048, validator: value => {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.hash || "Use an HTTPS URL without credentials or a fragment."; }
  catch { return "Use an absolute HTTPS URL."; }
} };
function resourceOperation(resource, method, fields, checkInput) {
  const schema = createSchema(fields);
  return {
    scopes: [],
    request(input, settings) {
      const { resourceSid, ...values } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      checkInput?.(values, settings);
      const url = `${origins[settings.region]}/2010-04-01/Accounts/${settings.accountSid}/${resource}${resourceSid ? `/${resourceSid}` : ""}.json`;
      if (method === "GET") return { method, url };
      return { method, url, headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(values).toString() };
    },
    validateResult: result => new RegExp(`^${resource === "Calls" ? "CA" : "SM"}[0-9a-fA-F]{32}$`, "u").test(result?.sid) &&
      /^AC[0-9a-fA-F]{32}$/u.test(result?.account_sid) && typeof result.status === "string"
  };
}
const twilioProvider = Object.freeze({
  ...twilioDefinition,
  apiOrigins: (settings) => [origins[settings.region]],
  apiKey: { headers: (secret, settings) => ({ Authorization: `Basic ${Buffer.from(`${settings.apiKeySid}:${secret}`).toString("base64")}` }) },
  checkOperation: "calls.list",
  operations: {
    "messages.send": resourceOperation("Messages", "POST", {
      To: phone, From: { ...phone, required: false }, MessagingServiceSid: { ...sid("MG"), required: false },
      Body: { type: "string", required: true, noTrim: true, minLength: 1, maxLength: 1600 }, StatusCallback: callbackUrl
    }, values => {
      if (Boolean(values.From) === Boolean(values.MessagingServiceSid)) throw new ConnectorError("connector_input_invalid", "Choose one sender number or Messaging Service SID.", { statusCode: 422 });
    }),
    "messages.get": resourceOperation("Messages", "GET", { resourceSid: sid("SM") }),
    "calls.create": resourceOperation("Calls", "POST", {
      To: phone, From: phone, Url: callbackUrl,
      Twiml: { type: "string", noTrim: true, minLength: 1, maxLength: 4000 },
      StatusCallback: callbackUrl, Timeout: { type: "integer", min: 5, max: 600, defaultTo: 60 }
    }, values => {
      if (Boolean(values.Url) === Boolean(values.Twiml)) throw new ConnectorError("connector_input_invalid", "Supply either a call-control URL or inline TwiML.", { statusCode: 422 });
    }),
    "calls.get": resourceOperation("Calls", "GET", { resourceSid: sid("CA") }),
    "calls.list": jsonOperation((settings) => `${origins[settings.region]}/2010-04-01/Accounts/${settings.accountSid}/Calls.json`, {
      PageSize: { type: "integer", min: 1, max: 1000, defaultTo: 50 },
      Page: { type: "integer", min: 0, max: 2147483647, defaultTo: 0 },
      PageToken: { type: "string", minLength: 1, maxLength: 4096 },
      To: { type: "string", minLength: 1, maxLength: 256 },
      From: { type: "string", minLength: 1, maxLength: 256 },
      Status: { type: "string", enum: ["queued", "ringing", "in-progress", "canceled", "completed", "failed", "busy", "no-answer"] }
    }, (result) => Array.isArray(result?.calls) && Number.isInteger(result.page) && result.page >= 0 &&
      Number.isInteger(result.page_size) && result.page_size > 0 &&
      (result.next_page_uri === null || typeof result.next_page_uri === "string"))
  }
});
// POST form callbacks only. The caller supplies the exact public URL configured
// at Twilio, never a URL reconstructed from untrusted forwarded headers.
function verifyTwilioRequest({ rawBody, signature, authToken, url, accountSid, contentType }) {
  const reject = () => { throw new ConnectorError("connector_webhook_invalid", "Invalid Twilio callback.", { statusCode: 401 }); };
  if (!(rawBody instanceof Uint8Array) || rawBody.byteLength > 1048576 ||
    typeof signature !== "string" || !/^[A-Za-z0-9+/]{27}=$/u.test(signature) ||
    typeof authToken !== "string" || !authToken ||
    typeof accountSid !== "string" || !/^AC[0-9a-fA-F]{32}$/u.test(accountSid) ||
    typeof url !== "string" || url.length > 4096 ||
    typeof contentType !== "string" || contentType.split(";", 1)[0].trim().toLowerCase() !== "application/x-www-form-urlencoded") reject();
  let form;
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password || parsedUrl.hash) reject();
    form = new URLSearchParams(new TextDecoder("utf-8", { fatal: true }).decode(rawBody));
  } catch { reject(); }
  const names = [...form.keys()];
  // Repeated fields are ambiguous to framework parsers; never silently choose one.
  if (names.length > 256 || new Set(names).size !== names.length) reject();
  const signed = url + names.sort().map(name => name + form.get(name)).join("");
  const expected = createHmac("sha1", authToken).update(signed).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "base64"))) reject();
  if (form.get("AccountSid") !== accountSid) reject();
  return Object.fromEntries(form);
}
export { twilioProvider, verifyTwilioRequest };
