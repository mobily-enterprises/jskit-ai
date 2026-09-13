import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { registerClient } from "@modelcontextprotocol/sdk/client/auth.js";

const mcpRegistrationFields = {
  clientName: { type: "string", required: true, minLength: 1, maxLength: 200 },
  callbackUrl: { type: "string", required: true, validator(value) {
    try {
      const url = new URL(value);
      return (url.protocol === "https:" || url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) &&
        !url.username && !url.password && !url.search && !url.hash || "Use an HTTPS callback or local loopback URL, without credentials, query or fragment.";
    } catch { return "Enter the callback URL served by the assistant host."; }
  } }
};

// Provider wrappers validate input; the trusted setup caller owns authorization and secret storage.
async function registerMcpClient(providerName, metadata, { clientName, callbackUrl, scopes }, { fetchImpl = globalThis.fetch, signal } = {}) {
  const redirectUri = new URL(callbackUrl).href;
  const requestSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15000)]);
  try {
    requestSignal.throwIfAborted();
    const client = await registerClient(metadata.issuer, {
      metadata,
      clientMetadata: { client_name: clientName, redirect_uris: [redirectUri], token_endpoint_auth_method: "client_secret_post",
        grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope: scopes.join(" ") },
      fetchFn: async (address, init) => {
        if (String(address) !== metadata.registration_endpoint) throw new Error("Unexpected registration destination.");
        return fetchImpl(address, { ...init, credentials: "omit", redirect: "error", signal: requestSignal });
      }
    });
    if (typeof client.client_id !== "string" || !client.client_id.trim() || typeof client.client_secret !== "string" || !client.client_secret.trim() ||
      client.token_endpoint_auth_method !== "client_secret_post" || client.redirect_uris?.length !== 1 || client.redirect_uris[0] !== redirectUri ||
      /[\p{Cc}]/u.test(client.client_id + client.client_secret)) throw new Error("Invalid client registration.");
    return { clientId: client.client_id, clientSecret: client.client_secret,
      ...(client.client_secret_expires_at === undefined ? {} : { clientSecretExpiresAt: client.client_secret_expires_at }) };
  } catch {
    if (requestSignal.aborted) throw new ConnectorError("connector_registration_interrupted", "Registration was interrupted. Check the provider before creating another client.");
    throw new ConnectorError("connector_registration_failed", `${providerName} client registration failed. Check the provider before creating another client.`, { statusCode: 502 });
  }
}

export { mcpRegistrationFields, registerMcpClient };
