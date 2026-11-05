import { createAccountStore } from "./accounts.js";
import { createKnexAdapterClass, deleteExpiredModels } from "./adapter.js";
import { createClientStore } from "./clients.js";
import { createEmailTokenStore } from "./emailTokens.js";
import { createGoogleSignIn } from "./google.js";
import { createHubSessionStore, createSettingStore, hubSessionCookieName } from "./hubSessions.js";
import { ACTIVE_STATUSES, createOidcProvider } from "./oidcProvider.js";
import { createRateLimiter } from "./rateLimits.js";
import { createSigningKeyStore } from "./signingKeys.js";

/**
 * The collaborators the hub's protocol routes and its own API share: its
 * stores, mailer, Google sign-in and signing keys, and the OpenID Connect
 * provider built over them. A changed signing key rebuilds the provider, so
 * callers read it through oidcProvider().
 * @param {object} dependencies
 * @param {import("@jskit-ai/database-runtime/server/types").RuntimeKnex} dependencies.knex
 * @param {import("./types.js").HubConfig} dependencies.config
 * @param {{ enabled: boolean, secret: string }} dependencies.devAuth Whether an editor's preview may sign in as an existing account, and the secret it sends.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} dependencies.logger
 * @param {import("./types.js").HubMailer} dependencies.mailer
 * @param {import("./types.js").HubClock} dependencies.now
 * @param {import("./types.js").GoogleEndpoints} dependencies.googleEndpoints
 * @param {typeof fetch} dependencies.fetchImpl
 * @param {import("./types.js").HubTexts} dependencies.texts The hub's pages and emails in a person's language.
 */
async function createHub({ knex, config, devAuth, logger, mailer, now, googleEndpoints, fetchImpl, texts }) {
  const Adapter = createKnexAdapterClass({ knex, now });
  const accounts = createAccountStore({ knex, now });
  const clients = createClientStore({ knex, now });
  const keys = createSigningKeyStore({ knex, secret: config.secret, now });
  const sessions = createHubSessionStore({ knex, now });
  const settings = createSettingStore({ knex });
  const emailTokens = createEmailTokenStore({ knex, now });
  const rateLimiter = createRateLimiter({ knex, now });
  const google = config.google
    ? createGoogleSignIn({ google: config.google, issuer: config.issuer, Adapter, endpoints: googleEndpoints, fetchImpl })
    : null;

  /** The provider over the active signing keys, the keys' fingerprint, and its request handler. */
  async function buildProvider() {
    await keys.ensureActiveKey();
    const keyFingerprint = await keys.fingerprint();
    const provider = createOidcProvider({
      config,
      jwks: await keys.jwks(),
      Adapter,
      accounts,
      clients,
      texts,
      async hasHubSession(ctx, accountId) {
        const session = await sessions.find(ctx.cookies.get(hubSessionCookieName(config), { signed: false }));
        return session?.accountId === accountId;
      }
    });
    return { provider, keyFingerprint, callback: provider.callback() };
  }

  let current = await buildProvider();

  /** The OpenID Connect provider over the current signing keys. */
  function oidcProvider() {
    return current.provider;
  }

  /** Answers an OpenID Connect protocol request with the current provider. */
  function handleProtocolRequest(rawRequest, rawReply) {
    current.callback(rawRequest, rawReply);
  }

  async function refreshKeysIfChanged() {
    await keys.retireExpired();
    if ((await keys.fingerprint()) !== current.keyFingerprint) current = await buildProvider();
  }

  async function rotateSigningKey() {
    const kid = await keys.rotate();
    current = await buildProvider();
    return kid;
  }

  /** Sends a signed logout token to every approved app that asked for back-channel logout. */
  async function backchannelLogout(accountId) {
    const results = [];
    for (const row of await clients.list()) {
      if (!ACTIVE_STATUSES.has(row.status)) continue;
      const client = await current.provider.Client.find(row.client_id);
      if (!client?.backchannelLogoutUri) continue;
      try {
        await client.backchannelLogout(accountId);
        results.push({ clientId: row.client_id, ok: true });
      } catch (error) {
        logger.warn({ clientId: row.client_id, err: error }, "Back-channel logout was not accepted.");
        results.push({ clientId: row.client_id, ok: false });
      }
    }
    return results;
  }

  async function maintain() {
    try {
      await refreshKeysIfChanged();
      await clients.removeIdleDevelopmentClients();
      await deleteExpiredModels({ knex, now });
      await emailTokens.deleteExpired();
      await rateLimiter.deleteExpired();
    } catch (error) {
      logger.error({ err: error }, "Accounts hub maintenance failed.");
    }
  }

  return Object.freeze({
    config,
    devAuth,
    logger,
    now,
    Adapter,
    accounts,
    clients,
    keys,
    sessions,
    settings,
    emailTokens,
    rateLimiter,
    mailer,
    texts,
    google,
    oidcProvider,
    handleProtocolRequest,
    rotateSigningKey,
    backchannelLogout,
    maintain
  });
}

export { createHub };
