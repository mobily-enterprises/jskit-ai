import { createAccountStore } from "./accounts.js";
import { createKnexAdapterClass, deleteExpiredModels } from "./adapter.js";
import { createClientStore, RegistrationError, validateRegistrationMetadata } from "./clients.js";
import { resolveHubConfig } from "./config.js";
import { constantEquals, randomToken } from "./crypto.js";
import { createEmailTokenStore } from "./emailTokens.js";
import { createGoogleSignIn, GOOGLE_ENDPOINTS } from "./google.js";
import { createHubSessionStore, createSettingStore } from "./hubSessions.js";
import { registerHubRoutes } from "./hubRoutes.js";
import { createMailer } from "./mailer.js";
import { ACTIVE_STATUSES, createOidcProvider } from "./oidcProvider.js";
import { createRateLimiter } from "./rateLimits.js";
import { createSigningKeyStore } from "./signingKeys.js";

const MAINTENANCE_INTERVAL_MS = 60 * 1000;
const BODY_LIMIT = 56 * 1024;
/** Paths the hub serves outside the application's /api prefix. */
const HUB_GLOBAL_PATHS = Object.freeze(["/.well-known", "/oidc", "/hub"]);

function isHubPath(url) {
  const pathname = String(url || "").split("?")[0];
  return HUB_GLOBAL_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function bearerToken(request) {
  const match = /^Bearer\s+(.+)$/iu.exec(String(request.headers.authorization || ""));
  return match ? match[1].trim() : "";
}

function sendRegistrationError(reply, error) {
  return reply.code(error.status).type("application/json").send({
    error: error.error,
    error_description: error.message
  });
}

function parseJsonBody(buffer) {
  try {
    return JSON.parse(Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer || ""));
  } catch {
    return null;
  }
}

/**
 * Creates the accounts hub: an OpenID Connect issuer, its registration
 * policy, the hub's own sign-in and admin API, and Google sign-in.
 * `mount(app)` registers everything on a Fastify instance.
 */
async function createOidcIssuer({
  knex,
  env = process.env,
  logger = console,
  mailer = null,
  now = () => new Date(),
  appRoot = "",
  googleEndpoints = GOOGLE_ENDPOINTS,
  fetchImpl = globalThis.fetch
}) {
  if (!knex) throw new TypeError("createOidcIssuer requires knex.");
  const config = resolveHubConfig(env, { appRoot });
  const Adapter = createKnexAdapterClass(knex, { now });
  const accounts = createAccountStore(knex, { now });
  const clients = createClientStore(knex, { now });
  const keys = createSigningKeyStore(knex, { secret: config.secret, now });
  const hub = {
    config,
    logger,
    accounts,
    clients,
    keys,
    sessions: createHubSessionStore(knex, { now }),
    settings: createSettingStore(knex),
    emailTokens: createEmailTokenStore(knex, { now }),
    rateLimiter: createRateLimiter(knex, { now }),
    mailer: mailer || createMailer({ mail: config.mail, logger, isProduction: config.isProduction, fetchImpl }),
    google: config.google
      ? createGoogleSignIn({ google: config.google, issuer: config.issuer, Adapter, endpoints: googleEndpoints, fetchImpl })
      : null,
    Adapter,
    provider: null,
    devAuth: Object.freeze({
      enabled: String(env.AUTH_DEV_BYPASS_ENABLED ?? "").trim().toLowerCase() === "true",
      secret: String(env.AUTH_DEV_BYPASS_SECRET ?? "").trim()
    }),
    now
  };

  let keyFingerprint = "";
  let callback = null;

  async function buildProvider() {
    await keys.ensureActiveKey();
    keyFingerprint = await keys.fingerprint();
    hub.provider = createOidcProvider({
      config,
      jwks: await keys.jwks(),
      Adapter,
      accounts,
      clients,
      onEndSession: (ctx) => hub.onEndSession?.(ctx)
    });
    callback = hub.provider.callback();
  }

  async function refreshKeysIfChanged() {
    await keys.retireExpired();
    if ((await keys.fingerprint()) !== keyFingerprint) await buildProvider();
  }

  hub.rotateSigningKey = async () => {
    const kid = await keys.rotate();
    await buildProvider();
    return kid;
  };

  /** Sends a signed logout token to every approved app that asked for back-channel logout. */
  hub.backchannelLogout = async (accountId) => {
    const results = [];
    for (const row of await clients.list()) {
      if (!ACTIVE_STATUSES.has(row.status)) continue;
      const client = await hub.provider.Client.find(row.client_id);
      if (!client?.backchannelLogoutUri) continue;
      try {
        await client.backchannelLogout(accountId);
        results.push({ clientId: row.client_id, ok: true });
      } catch (error) {
        logger.warn?.({ clientId: row.client_id, err: error }, "Back-channel logout was not accepted.");
        results.push({ clientId: row.client_id, ok: false });
      }
    }
    return results;
  };

  async function maintain() {
    try {
      await refreshKeysIfChanged();
      await clients.removeIdleDevelopmentClients();
      await deleteExpiredModels(knex, { now });
      await hub.emailTokens.deleteExpired();
      await hub.rateLimiter.deleteExpired();
    } catch (error) {
      logger.error?.({ err: error }, "Accounts hub maintenance failed.");
    }
  }

  await buildProvider();
  let timer = null;

  function forwardToProvider(request, reply) {
    const issuer = new URL(config.issuer);
    const headers = request.raw.headers;
    headers.host = issuer.host;
    headers["x-forwarded-host"] = issuer.host;
    headers["x-forwarded-proto"] = issuer.protocol.slice(0, -1);
    if (request.body !== undefined) request.raw.body = request.body;
    reply.hijack();
    callback(request.raw, reply.raw);
  }

  async function register(request, reply) {
    if (!constantEquals(bearerToken(request), config.registrationToken)) {
      return reply.code(401).type("application/json").send({
        error: "invalid_token",
        error_description: "A valid registration token is required."
      });
    }
    try {
      const { origin, name } = validateRegistrationMetadata(parseJsonBody(request.body));
      const status = await clients.statusForOrigin(origin, config.devOriginPatterns);
      const clientId = `app_${randomToken(16)}`;
      request.raw.hubClientId = clientId;
      await clients.insert({ clientId, origin, name, status });
      reply.raw.once("finish", () => {
        if (reply.raw.statusCode !== 201) clients.remove(clientId).catch(() => {});
      });
      reply.raw.setHeader("x-hub-client-status", status);
      return forwardToProvider(request, reply);
    } catch (error) {
      if (error instanceof RegistrationError) return sendRegistrationError(reply, error);
      throw error;
    }
  }

  async function updateRegistration(request, reply) {
    const row = await clients.get(request.params.clientId);
    if (row) {
      try {
        // RFC 7592 updates repeat the client's own id and secret.
        const { client_id: _clientId, client_secret: _clientSecret, ...metadata } = parseJsonBody(request.body) || {};
        const { origin, name } = validateRegistrationMetadata(metadata);
        if (origin !== row.origin) {
          throw new RegistrationError("invalid_client_metadata", "A registered app cannot move to another address. Register again instead.");
        }
        reply.raw.once("finish", () => {
          if (reply.raw.statusCode === 200) clients.rename(row.client_id, name).catch(() => {});
        });
      } catch (error) {
        if (error instanceof RegistrationError) return sendRegistrationError(reply, error);
        throw error;
      }
    }
    return forwardToProvider(request, reply);
  }

  async function deleteRegistration(request, reply) {
    const clientId = request.params.clientId;
    reply.raw.once("finish", () => {
      if (reply.raw.statusCode === 204) clients.remove(clientId).catch(() => {});
    });
    return forwardToProvider(request, reply);
  }

  // oidc-provider reads request bodies itself; only registration bodies are
  // read first, because the hub checks them against its policy.
  function protocolRoutes(instance, _options, done) {
    instance.removeAllContentTypeParsers();
    instance.addContentTypeParser("*", (_request, _payload, next) => next(null));
    const methods = ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"];
    instance.route({ method: methods, url: "/.well-known/openid-configuration", handler: forwardToProvider });
    instance.route({ method: methods, url: "/oidc/*", handler: forwardToProvider });
    instance.register((registration, _registrationOptions, registered) => {
      registration.removeAllContentTypeParsers();
      registration.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: BODY_LIMIT }, (_request, body, next) => next(null, body));
      registration.post("/oidc/reg", register);
      registration.put("/oidc/reg/:clientId", updateRegistration);
      registration.delete("/oidc/reg/:clientId", deleteRegistration);
      registered();
    });
    done();
  }

  return Object.freeze({
    config,
    hub,
    async mount(app) {
      // Hub pages are never framed. Development keeps the app's own pages
      // frameable so an editor's preview pane can show them.
      app.addHook("onRequest", async (request, reply) => {
        if (config.isProduction || isHubPath(request.url)) {
          reply.raw.setHeader("x-frame-options", "DENY");
          reply.raw.setHeader("content-security-policy", "frame-ancestors 'none'");
        }
      });
      await app.register(protocolRoutes);
      await app.register((instance, _options, done) => {
        registerHubRoutes(instance, hub);
        done();
      });
      timer = setInterval(maintain, MAINTENANCE_INTERVAL_MS);
      timer.unref?.();
    },
    maintain,
    rotateSigningKey: hub.rotateSigningKey,
    async close() {
      if (timer) clearInterval(timer);
      timer = null;
    }
  });
}

export { HUB_GLOBAL_PATHS, createOidcIssuer };
