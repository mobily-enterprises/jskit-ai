import { ConnectorError } from "@jskit-ai/connectors-core/server";

const zohoAuthorizationParameters = Object.freeze({ access_type: "offline", prompt: "consent" });

function zohoOAuthMetadata(accounts) {
  return { issuer: accounts, authorization_endpoint: `${accounts}/oauth/v2/auth`, token_endpoint: `${accounts}/oauth/v2/token` };
}

async function normalizeZohoTokenResponse(response, expectedApiOrigin) {
  let value;
  try { value = await response.clone().json(); } catch { /* handled by OAuth processing */ }
  if (value?.error) {
    return Response.json({ error: value.error === "invalid_code" ? "invalid_grant" : value.error }, { status: 400 });
  }
  if (response.ok && value?.api_domain !== expectedApiOrigin) {
    throw new ConnectorError("connector_response_invalid", "Zoho returned a token for a different data center or environment.", { statusCode: 502 });
  }
  return response;
}

export { zohoAuthorizationParameters, zohoOAuthMetadata, normalizeZohoTokenResponse };
