import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { linkedinDefinition } from "../shared/linkedin.js";
import { jsonOperation } from "./jsonOperation.js";

async function normalizeTokenResponse(response, { grantType }) {
  let value;
  try { value = await response.clone().json(); } catch {
    if (!response.ok) return response;
    throw new ConnectorError("connector_response_invalid", "LinkedIn returned an invalid token response.", { statusCode: 502 });
  }
  if (!response.ok) {
    if (grantType === "refresh_token" && response.status === 400 && value?.error === "invalid_request") {
      throw new ConnectorError("connector_reconnect_required", "Connect this LinkedIn account again.", { statusCode: 401 });
    }
    return response;
  }
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    !Number.isSafeInteger(value.expires_in) || value.expires_in <= 0 ||
    (value.scope !== undefined && (typeof value.scope !== "string" || !/^[^\s]+(?: [^\s]+)*$/u.test(value.scope)))) {
    throw new ConnectorError("connector_response_invalid", "LinkedIn returned an invalid permission grant.", { statusCode: 502 });
  }
  if (value.scope !== undefined && !["openid", "profile"].every((scope) => value.scope.split(" ").includes(scope))) {
    throw new ConnectorError("connector_reconnect_required", "Connect LinkedIn with OpenID and profile permissions.", { statusCode: 401 });
  }
  // LinkedIn documents bearer responses without token_type. Identity tokens are
  // unused: this adapter reads userinfo with the access token, never logs users in.
  delete value.id_token;
  return Response.json({ ...value, token_type: value.token_type === undefined ? "Bearer" : value.token_type }, { status: response.status });
}

const publish = jsonOperation("https://api.linkedin.com/v2/ugcPosts", {
  text: { type: "string", required: true, minLength: 1, maxLength: 3000,
    validator: value => value.trim().length > 0 || "Enter the post text." },
  visibility: { type: "string", required: true, enum: ["PUBLIC", "CONNECTIONS"] }
}, value => /^urn:li:(?:share|ugcPost):[0-9]+$/u.test(value?.id), "POST");

const linkedinProvider = Object.freeze({
  ...linkedinDefinition,
  oauth: {
    issuer: "https://www.linkedin.com",
    authorization_endpoint: "https://www.linkedin.com/oauth/v2/authorization",
    token_endpoint: "https://www.linkedin.com/oauth/v2/accessToken"
  },
  normalizeTokenResponse,
  apiOrigins: ["https://api.linkedin.com"], checkOperation: "profile.read",
  async exchange(address, options, { request, fetchImpl }) {
    if (address !== "https://api.linkedin.com/v2/ugcPosts") return request(address, options);
    const member = await request("https://api.linkedin.com/v2/userinfo", { ...options, method: "GET", body: undefined });
    if (typeof member?.sub !== "string" || !/^[a-zA-Z0-9_-]{1,1024}$/u.test(member.sub))
      throw new ConnectorError("connector_response_invalid", "LinkedIn returned an invalid member identity.", { statusCode: 502 });
    const response = await fetchImpl(address, { ...options, credentials: "omit", redirect: "error",
      headers: { ...options.headers, "Content-Type": "application/json", "X-Restli-Protocol-Version": "2.0.0" },
      body: JSON.stringify({ author: `urn:li:person:${member.sub}`, lifecycleState: "PUBLISHED",
        specificContent: { "com.linkedin.ugc.ShareContent": { shareCommentary: { text: options.body.text }, shareMediaCategory: "NONE" } },
        visibility: { "com.linkedin.ugc.MemberNetworkVisibility": options.body.visibility } }) });
    await response.body?.cancel();
    if (!response.ok) throw Object.assign(new Error("LinkedIn publishing failed."), { status: response.status });
    if (response.status !== 201) throw new ConnectorError("connector_response_invalid", "LinkedIn did not confirm post creation.", { statusCode: 502 });
    return { id: response.headers.get("x-restli-id") };
  },
  operations: {
    "posts.create": { ...publish, scopes: ["w_member_social"] },
    "profile.read": {
      ...jsonOperation("https://api.linkedin.com/v2/userinfo", {}, (value) =>
        typeof value?.sub === "string" && value.sub.length > 0 && value.sub.length <= 1024 &&
        ["name", "given_name", "family_name", "picture", "locale", "email"].every((field) =>
          value[field] === undefined || typeof value[field] === "string") &&
        (value.email_verified === undefined || typeof value.email_verified === "boolean")),
      scopes: ["profile"]
    }
  }
});

export { linkedinProvider };
