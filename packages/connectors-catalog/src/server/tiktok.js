import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { tiktokDefinition } from "../shared/tiktok.js";
import { jsonOperation } from "./jsonOperation.js";

const textId = (value) => typeof value === "string" && value.length > 0 && value.length <= 1024 && !/[\p{Cc}]/u.test(value);
const count = (value) => Number.isSafeInteger(value) && value >= 0;

function checkReply(value) {
  const code = value?.error?.code ?? value?.code;
  if (code === "ok") return value;
  if (typeof code !== "string" || !code) throw new ConnectorError("connector_response_invalid", "TikTok returned an invalid response.", { statusCode: 502 });
  if (code === "access_token_invalid") throw new ConnectorError("connector_reconnect_required", "Connect this TikTok account again.", { statusCode: 401 });
  if (["scope_not_authorized", "scope_permission_missed"].includes(code)) {
    throw new ConnectorError("connector_scope_missing", "Connect TikTok with the permission required for this operation.", { statusCode: 403 });
  }
  if (code === "rate_limit_exceeded") throw new ConnectorError("connector_rate_limited", "TikTok's request limit was reached.", { statusCode: 429 });
  throw new ConnectorError("connector_provider_failed", "TikTok could not complete the request.", { statusCode: 502 });
}

function profileOperation(fields, scope, validateUser) {
  return { ...jsonOperation(`https://open.tiktokapis.com/v2/user/info/?fields=${fields.join(",")}`, {},
    (value) => value?.error?.code === "ok" && validateUser(value.data?.user)), scopes: [scope] };
}

const tiktokProvider = Object.freeze({
  ...tiktokDefinition,
  oauth: { issuer: "https://www.tiktok.com", authorization_endpoint: "https://www.tiktok.com/v2/auth/authorize/", token_endpoint: "https://open.tiktokapis.com/v2/oauth/token/" },
  oauthClientIdParameter: "client_key", scopeSeparator: ",",
  validateCallbackUrl: (value) => value.startsWith("https://") && value.length < 512,
  async normalizeTokenResponse(response) {
    let value;
    try { value = await response.clone().json(); } catch {
      if (!response.ok) return response;
      throw new ConnectorError("connector_response_invalid", "TikTok returned an invalid token response.", { statusCode: 502 });
    }
    if (!response.ok) return response;
    if (value?.error) {
      if (value.error === "invalid_grant") throw new ConnectorError("connector_reconnect_required", "Connect this TikTok account again.", { statusCode: 401 });
      throw new ConnectorError("connector_provider_failed", "TikTok could not authorize this connection.", { statusCode: 502 });
    }
    if (!textId(value?.open_id) || !Number.isSafeInteger(value.expires_in) || value.expires_in <= 0 ||
      !Number.isSafeInteger(value.refresh_expires_in) || value.refresh_expires_in <= 0 || !textId(value.refresh_token) ||
      typeof value.scope !== "string" || !/^[^\s,]+(?:,[^\s,]+)*$/u.test(value.scope)) {
      throw new ConnectorError("connector_response_invalid", "TikTok returned an invalid permission grant.", { statusCode: 502 });
    }
    const scopes = value.scope.split(",");
    if (new Set(scopes).size !== scopes.length) throw new ConnectorError("connector_response_invalid", "TikTok returned duplicate permissions.", { statusCode: 502 });
    if (!scopes.includes("user.info.basic")) throw new ConnectorError("connector_scope_missing", "Connect TikTok with basic profile permission.", { statusCode: 403 });
    return response;
  },
  apiOrigins: ["https://open.tiktokapis.com"], checkOperation: "profile.read",
  operations: {
    "profile.read": profileOperation(["open_id", "display_name", "avatar_url"], "user.info.basic", (user) =>
      textId(user?.open_id) && typeof user.display_name === "string" && typeof user.avatar_url === "string"),
    "profile.extended": profileOperation(["username", "bio_description", "profile_deep_link", "is_verified"], "user.info.profile", (user) =>
      ["username", "bio_description", "profile_deep_link"].every((field) => typeof user?.[field] === "string") && typeof user?.is_verified === "boolean"),
    "profile.stats": profileOperation(["follower_count", "following_count", "likes_count", "video_count"], "user.info.stats", (user) =>
      ["follower_count", "following_count", "likes_count", "video_count"].every((field) => count(user?.[field]))),
    "videos.list": {
      ...jsonOperation("https://open.tiktokapis.com/v2/video/list/?fields=id,title,cover_image_url", {
        max_count: { type: "integer", min: 1, max: 20, defaultTo: 10 },
        cursor: { type: "integer", min: 0, max: Number.MAX_SAFE_INTEGER }
      }, (value) => value?.error?.code === "ok" && Array.isArray(value.data?.videos) && value.data.videos.length <= 20 &&
        value.data.videos.every((video) => textId(video?.id) && typeof video.title === "string" && typeof video.cover_image_url === "string") &&
        typeof value.data.has_more === "boolean" && count(value.data.cursor), "POST"),
      scopes: ["video.list"]
    }
  },
  async exchange(address, options, { fetchImpl }) {
    const response = await fetchImpl(address, { ...options, credentials: "omit",
      headers: { ...options.headers, ...(options.body ? { "Content-Type": "application/json" } : {}) },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}) });
    let value;
    try { value = await response.json(); } catch {
      throw new ConnectorError("connector_response_invalid", "TikTok returned an invalid response.", { statusCode: 502 });
    }
    checkReply(value);
    if (!response.ok) throw new ConnectorError("connector_provider_failed", "TikTok could not complete the request.", { statusCode: 502 });
    if (options.body?.max_count !== undefined && value.data?.videos?.length > options.body.max_count) {
      throw new ConnectorError("connector_response_invalid", "TikTok returned too many videos.", { statusCode: 502 });
    }
    return value;
  }
});

export { tiktokProvider };
