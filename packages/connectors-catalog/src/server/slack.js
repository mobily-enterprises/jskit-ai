import { createHmac, timingSafeEqual } from "node:crypto";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { slackDefinition } from "../shared/slack.js";
import { jsonOperation } from "./jsonOperation.js";

function checkReply(value) {
  if (value?.ok === true) return value;
  if (value?.ok !== false || typeof value.error !== "string") {
    throw new ConnectorError("connector_response_invalid", "Slack returned an invalid response.", { statusCode: 502 });
  }
  if (["invalid_auth", "not_authed", "token_revoked", "token_expired", "account_inactive", "invalid_refresh_token", "invalid_grant"].includes(value.error)) {
    throw new ConnectorError("connector_reconnect_required", "Connect this Slack account again.", { statusCode: 401 });
  }
  if (["missing_scope", "not_allowed_token_type", "access_denied", "no_permission", "not_in_channel", "restricted_action"].includes(value.error)) {
    throw new ConnectorError("connector_permission_denied", "Slack denied this operation.", { statusCode: 403 });
  }
  if (["ratelimited", "rate_limited"].includes(value.error)) {
    throw new ConnectorError("connector_rate_limited", "Slack's request limit was reached.", { statusCode: 429 });
  }
  if (["invalid_client_id", "bad_client_secret", "bad_redirect_uri"].includes(value.error)) {
    throw new ConnectorError("connector_registration_invalid", "Check the Slack client registration and callback.", { statusCode: 422 });
  }
  throw new ConnectorError("connector_provider_failed", "The Slack request failed. Try again.", { statusCode: 502 });
}

async function normalizeTokenResponse(response, { settings, grantType }) {
  if ([401, 403, 429].includes(response.status)) {
    throw new ConnectorError(
      { 401: "connector_reconnect_required", 403: "connector_permission_denied", 429: "connector_rate_limited" }[response.status],
      "Slack could not authorize this request.", { statusCode: response.status }
    );
  }
  let value;
  try { value = await response.clone().json(); } catch {
    if (!response.ok) return response;
    throw new ConnectorError("connector_response_invalid", "Slack returned an invalid token response.", { statusCode: 502 });
  }
  checkReply(value);
  if (!response.ok) return response;
  const actor = settings.actor || "user";
  const token = grantType === "authorization_code" && actor === "user" ? value.authed_user : value;
  if (token?.token_type !== actor || typeof token.scope !== "string" || !/^[^\s,]+(?:,[^\s,]+)*$/u.test(token.scope)) {
    throw new ConnectorError("connector_response_invalid", "Slack returned a token for the wrong identity or an invalid permission grant.", { statusCode: 502 });
  }
  // Retain exactly one identity; a response may contain both user and bot tokens.
  return Response.json({ access_token: token.access_token, token_type: "Bearer", scope: token.scope,
    ...(token.expires_in !== undefined ? { expires_in: token.expires_in } : {}),
    ...(token.refresh_token !== undefined ? { refresh_token: token.refresh_token } : {})
  });
}

const cursor = { type: "string", minLength: 1, maxLength: 4096 };
const channel = { type: "string", required: true, validator: (value) => /^[CGD][A-Z0-9]+$/u.test(value) || "Use a conversation ID.", maxLength: 100 };
const timestamp = { type: "string", validator: (value) => /^[0-9]+\.[0-9]+$/u.test(value) || "Use a Slack timestamp.", maxLength: 40, noTrim: true };
const listResult = (value) => value?.ok === true && Array.isArray(value.channels) &&
  value.channels.every((channel) => typeof channel?.id === "string" && channel.id.length > 0) &&
  (value.response_metadata === undefined || (value.response_metadata !== null && typeof value.response_metadata === "object" &&
    !Array.isArray(value.response_metadata) && (value.response_metadata.next_cursor === undefined || typeof value.response_metadata.next_cursor === "string")));
const operations = {
  "auth.test": jsonOperation("https://slack.com/api/auth.test", {}, (value) => value?.ok === true &&
    typeof value.team_id === "string" && value.team_id.length > 0 && typeof value.user_id === "string" && value.user_id.length > 0)
};
for (const [name, type, permission] of [
  ["channels.list", "public_channel", "channels:read"],
  ["groups.list", "private_channel", "groups:read"],
  ["directMessages.list", "im", "im:read"],
  ["groupMessages.list", "mpim", "mpim:read"]
]) {
  operations[name] = {
    ...jsonOperation(`https://slack.com/api/conversations.list?types=${type}`, {
      limit: { type: "integer", min: 1, max: 200, defaultTo: 100 }, cursor,
      exclude_archived: { type: "boolean", defaultTo: false }
    }, listResult),
    scopes: [permission]
  };
}

for (const [name, permission] of [["channels.history", "channels:history"], ["groups.history", "groups:history"],
  ["directMessages.history", "im:history"], ["groupMessages.history", "mpim:history"]]) {
  operations[name] = { ...jsonOperation("https://slack.com/api/conversations.history", {
    channel, cursor, limit: { type: "integer", min: 1, max: 15, defaultTo: 15 },
    oldest: timestamp, latest: timestamp, inclusive: { type: "boolean", defaultTo: false }
  }, (value) => value?.ok === true && Array.isArray(value.messages) && value.messages.length <= 15 &&
    value.messages.every((message) => typeof message?.ts === "string" && /^[0-9]+\.[0-9]+$/u.test(message.ts)) &&
    typeof value.has_more === "boolean" && (value.response_metadata === undefined ||
      typeof value.response_metadata?.next_cursor === "string")), scopes: [permission] };
}
operations["users.info"] = { ...jsonOperation("https://slack.com/api/users.info", {
  user: { type: "string", required: true, validator: (value) => /^[UW][A-Z0-9]+$/u.test(value) || "Use a Slack user ID.", maxLength: 100 }
}, (value) => value?.ok === true && typeof value.user?.id === "string" && typeof value.user?.name === "string"), scopes: ["users:read"] };
operations["messages.send"] = { ...jsonOperation("https://slack.com/api/chat.postMessage", {
  channel, text: { type: "string", required: true, minLength: 1, maxLength: 4000, noTrim: true },
  thread_ts: timestamp, unfurl_links: { type: "boolean", defaultTo: false },
  unfurl_media: { type: "boolean", defaultTo: false }
}, (value) => value?.ok === true && typeof value.channel === "string" &&
  typeof value.ts === "string" && /^[0-9]+\.[0-9]+$/u.test(value.ts) &&
  value.message !== null && typeof value.message === "object", "POST"), scopes: ["chat:write"] };

const slackProvider = Object.freeze({
  ...slackDefinition,
  oauth: { issuer: "https://slack.com", authorization_endpoint: "https://slack.com/oauth/v2/authorize", token_endpoint: "https://slack.com/api/oauth.v2.access" },
  scopeSeparator: ",",
  authorizationScopeParameter: ({ actor = "user" } = {}) => actor === "user" ? "user_scope" : "scope",
  normalizeTokenResponse,
  apiOrigins: ["https://slack.com"], checkOperation: "channels.list", operations,
  async exchange(address, options, { request }) {
    return checkReply(await request(address, options));
  }
});
// The app supplies raw bytes before body parsing and binds the expected installation.
function verifySlackRequest({ rawBody, signature, timestamp, secret, contentType, appId, teamId, now = Date.now() }) {
  const reject = () => { throw new ConnectorError("connector_webhook_invalid", "Invalid Slack callback.", { statusCode: 401 }); };
  if (!(rawBody instanceof Uint8Array) || rawBody.byteLength > 1048576 ||
    typeof secret !== "string" || !secret || typeof signature !== "string" || !/^v0=[a-f0-9]{64}$/u.test(signature) ||
    typeof timestamp !== "string" || !/^[0-9]{1,12}$/u.test(timestamp) || !Number.isFinite(now) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300 || typeof appId !== "string" || !appId ||
    typeof teamId !== "string" || !teamId) reject();
  const expected = createHmac("sha256", secret).update(`v0:${timestamp}:`).update(rawBody).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature.slice(3), "hex"))) reject();
  let payload;
  try {
    const body = Buffer.from(rawBody).toString("utf8");
    const mediaType = contentType?.split(";", 1)[0].trim().toLowerCase();
    if (mediaType === "application/json") payload = JSON.parse(body);
    else if (mediaType === "application/x-www-form-urlencoded") {
      const form = new URLSearchParams(body);
      if (form.getAll("payload").length !== 1) reject();
      payload = JSON.parse(form.get("payload"));
    } else reject();
  } catch { reject(); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) reject();
  // URL verification has no installation identity; the signature binds its app secret.
  if (payload.type === "url_verification" && typeof payload.challenge === "string" && payload.challenge.length > 0) return payload;
  if (payload.api_app_id !== appId || (payload.team_id ?? payload.team?.id) !== teamId) reject();
  if (payload.type === "event_callback") {
    if (typeof payload.event_id !== "string" || !payload.event_id || !payload.event ||
      typeof payload.event.type !== "string") reject();
  } else if (["block_actions", "view_submission", "view_closed", "shortcut", "message_action"].includes(payload.type)) {
    if (typeof payload.user?.id !== "string" || !payload.user.id) reject();
  } else reject();
  return payload;
}
export { slackProvider, verifySlackRequest };
