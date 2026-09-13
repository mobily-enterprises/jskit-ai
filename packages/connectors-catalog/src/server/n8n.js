import { createSchema } from "json-rest-schema";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { discoverOAuthProtectedResourceMetadata, discoverAuthorizationServerMetadata } from "@modelcontextprotocol/sdk/client/auth.js";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { mcpRegistrationFields, registerMcpClient } from "./mcpRegistration.js";
import { n8nDefinition, validN8nOAuthDiscovery } from "../shared/mcp.js";
import { mcpOperations, exchangeMcp } from "./mcpTransport.js";

const n8nProvider = Object.freeze({
  ...n8nDefinition,
  apiOrigins: (settings) => [new URL(settings.serverUrl).origin],
  oauth: (settings) => {
    const discovery = settings.oauthDiscovery;
    if (!validN8nOAuthDiscovery(discovery) || discovery.resource !== new URL(settings.serverUrl).href) {
      throw new ConnectorError("connector_discovery_required", "Discover OAuth settings for this exact n8n MCP URL before connecting.");
    }
    return discovery.oauth;
  },
  oauthResource: (settings) => new URL(settings.serverUrl).href,
  apiKey: { headers: (token) => ({ Authorization: `Bearer ${token}` }) },
  checkOperation: "tools.list",
  exchange: exchangeMcp,
  operations: mcpOperations((settings) => new URL(settings.serverUrl).href)
});

// The trusted setup host owns outbound-network policy, including private instances.
// Discovery returns public metadata only; it never registers or sends credentials.
async function discoverN8nOAuth({ serverUrl }, { fetchImpl = globalThis.fetch, signal } = {}) {
  const settings = validateSchemaPayload({ schema: n8nDefinition.settingsSchema, mode: "replace" }, { serverUrl }, { statusCode: 422 });
  const resource = new URL(settings.serverUrl).href;
  const requestSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15000)]);
  let permittedOrigin = new URL(resource).origin;
  const fetchFn = async (address, options) => {
    const url = new URL(address);
    if (url.protocol !== "https:" || url.origin !== permittedOrigin || url.username || url.password || url.search || url.hash ||
      !url.pathname.includes("/.well-known/") || options?.method && options.method !== "GET") throw new Error("Invalid discovery destination.");
    requestSignal.throwIfAborted();
    return fetchImpl(url.href, { ...options, method: "GET", credentials: "omit", redirect: "error", signal: requestSignal });
  };
  try {
    const protectedResource = await discoverOAuthProtectedResourceMetadata(resource, undefined, fetchFn);
    if (protectedResource.resource !== resource || protectedResource.authorization_servers?.length !== 1) throw new Error("Ambiguous resource authority.");
    const issuer = new URL(protectedResource.authorization_servers[0]);
    if (issuer.protocol !== "https:" || issuer.username || issuer.password || issuer.search || issuer.hash) throw new Error("Invalid issuer.");
    permittedOrigin = issuer.origin;
    const metadata = await discoverAuthorizationServerMetadata(issuer, { fetchFn });
    const scopes = protectedResource.scopes_supported || metadata?.scopes_supported || [];
    const discovery = { resource, oauth: metadata, scopes: [...scopes] };
    if (metadata?.issuer !== protectedResource.authorization_servers[0] || !validN8nOAuthDiscovery(discovery)) {
      throw new Error("Unsupported n8n OAuth metadata.");
    }
    return discovery;
  } catch {
    if (requestSignal.aborted) throw new ConnectorError("connector_discovery_interrupted", "n8n OAuth discovery was interrupted.");
    throw new ConnectorError("connector_discovery_failed", "n8n OAuth discovery failed. Check the MCP URL, advertised authority and supported server version.", { statusCode: 502 });
  }
}

const registrationSchema = createSchema({
  ...mcpRegistrationFields,
  serverUrl: { type: "string", required: true, minLength: 1, maxLength: 2048 },
  scopes: { type: "array", required: true, minLength: 1,
    items: { type: "string", minLength: 1, maxLength: 200 },
    validator: (values) => new Set(values).size === values.length || "Select each permission once." }
});

// The privileged setup caller owns authorization and private storage of this result.
async function registerN8nClient(input, options) {
  const values = validateSchemaPayload({ schema: registrationSchema, mode: "replace" }, input, { statusCode: 422 });
  const discovery = await discoverN8nOAuth({ serverUrl: values.serverUrl }, options);
  if (values.scopes.some((scope) => !discovery.scopes.includes(scope))) {
    throw new ConnectorError("connector_scope_unavailable", "Select only permissions advertised by this n8n MCP server.", { statusCode: 422 });
  }
  const client = await registerMcpClient("n8n", discovery.oauth, values, options);
  return { ...client, ...discovery, requestedScopes: [...values.scopes] };
}

export { n8nProvider, discoverN8nOAuth, registerN8nClient };
