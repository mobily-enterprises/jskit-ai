import * as client from "openid-client";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import {
  AUTH_OIDC_BACKCHANNEL_LOGOUT_PATH,
  AUTH_OIDC_REDIRECT_PATH
} from "../../shared/index.js";
import { isLoopbackHostname } from "./config.js";

const DISCOVERY_TTL_MS = 60 * 60 * 1000;
const BLOCKED_MESSAGE = "Your accounts hub has blocked this app's address.";
const UNREACHABLE_MESSAGE = "Your accounts hub can't be reached right now. Try again in a moment.";

function registrationMetadata(origin, appName) {
  return {
    client_name: appName,
    redirect_uris: [`${origin}${AUTH_OIDC_REDIRECT_PATH}`],
    post_logout_redirect_uris: [`${origin}/`],
    backchannel_logout_uri: `${origin}${AUTH_OIDC_BACKCHANNEL_LOGOUT_PATH}`,
    token_endpoint_auth_method: "client_secret_basic",
    grant_types: ["authorization_code"],
    response_types: ["code"]
  };
}

function unreachable(error, logger) {
  if (error instanceof AppError) return error;
  logger?.warn?.({ err: error }, "OIDC issuer request failed.");
  return new AppError(503, UNREACHABLE_MESSAGE);
}

/**
 * The relying party's view of one issuer: discovery, per-origin clients
 * (self-registered with the registration token, or the static client), and
 * the openid-client configuration each sign-in uses.
 */
function createIssuerClient({ config, store, logger = null, fetchImpl = null, now = Date.now }) {
  const issuerUrl = config.issuer ? new URL(config.issuer) : null;
  const insecure = Boolean(issuerUrl && issuerUrl.protocol === "http:" && isLoopbackHostname(issuerUrl.hostname));
  const requestOptions = {
    ...(fetchImpl ? { [client.customFetch]: fetchImpl } : {}),
    ...(insecure ? { execute: [client.allowInsecureRequests] } : {})
  };
  let discovered = null;

  function configure(configuration) {
    if (fetchImpl) configuration[client.customFetch] = fetchImpl;
    if (insecure) client.allowInsecureRequests(configuration);
    return configuration;
  }

  async function serverMetadata() {
    if (discovered && discovered.expiresAt > now()) return discovered.metadata;
    try {
      const configuration = await client.discovery(issuerUrl, "jskit-discovery", undefined, undefined, requestOptions);
      discovered = { metadata: configuration.serverMetadata(), expiresAt: now() + DISCOVERY_TTL_MS };
      return discovered.metadata;
    } catch (error) {
      throw unreachable(error, logger);
    }
  }

  function configurationFor(metadata, clientRecord) {
    return configure(new client.Configuration(
      metadata,
      clientRecord.clientId,
      {},
      clientRecord.clientSecret ? client.ClientSecretBasic(clientRecord.clientSecret) : client.None()
    ));
  }

  async function register(origin, appName) {
    let registered;
    try {
      registered = await client.dynamicClientRegistration(issuerUrl, registrationMetadata(origin, appName), undefined, {
        ...requestOptions,
        initialAccessToken: config.registrationToken
      });
    } catch (error) {
      // An accounts hub refuses an address its owner blocked with 403.
      if (error?.status === 403) throw new AppError(403, BLOCKED_MESSAGE);
      if (error?.status === 401 || String(error?.error || "") === "invalid_token") {
        throw new AppError(503, "Your accounts hub refused this app's registration token. Check AUTH_OIDC_REGISTRATION_TOKEN.");
      }
      throw unreachable(error, logger);
    }
    const metadata = registered.clientMetadata();
    return store.insertClient({
      issuer: config.issuer,
      origin,
      clientId: metadata.client_id,
      clientSecret: metadata.client_secret || "",
      registrationAccessToken: metadata.registration_access_token || "",
      registrationClientUri: metadata.registration_client_uri || ""
    });
  }

  /**
   * The client this app uses at `origin`, registered on first use. An address
   * still waiting for approval signs in to the hub's own waiting page.
   */
  async function clientFor(origin, { appName = "App" } = {}) {
    if (config.setupProblem) throw new AppError(503, config.setupProblem);
    if (config.staticClient) return { clientId: config.staticClient.clientId, clientSecret: config.staticClient.clientSecret };
    return (await store.findClient(config.issuer, origin)) || register(origin, appName);
  }

  async function configurationForOrigin(origin, options) {
    const record = await clientFor(origin, options);
    return configurationFor(await serverMetadata(), record);
  }

  async function configurationForClientId(clientId) {
    if (!(await audiences()).includes(clientId)) return null;
    // Logout addresses need only the client id, never its secret.
    return configurationFor(await serverMetadata(), { clientId, clientSecret: "" });
  }

  async function audiences() {
    return config.staticClient ? [config.staticClient.clientId] : store.listClientIds(config.issuer);
  }

  return Object.freeze({
    audiences,
    clientFor,
    configurationForClientId,
    configurationForOrigin,
    serverMetadata
  });
}

export {
  createIssuerClient,
  registrationMetadata
};
