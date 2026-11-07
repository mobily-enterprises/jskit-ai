// readable-check: allow no-direct-knex - infrastructure: the OIDC relying party's protocol state (the clients it registered at each issuer, the sessions the issuer's tokens opened and the back-channel logout token ids it has seen) is kept with Knex, as the data-access spec keeps protocol state

const TABLES = Object.freeze({
  clients: "auth_oidc_clients",
  sessions: "auth_oidc_sessions",
  logoutTokens: "auth_oidc_logout_tokens"
});

function toDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("Invalid OIDC store timestamp.");
  return date;
}

function isExpired(value, now) {
  return toDate(value).getTime() <= now;
}

function mapClient(row) {
  if (!row) return null;
  return {
    issuer: row.issuer,
    origin: row.origin,
    clientId: row.client_id,
    clientSecret: row.client_secret || "",
    registrationAccessToken: row.registration_access_token || "",
    registrationClientUri: row.registration_client_uri || ""
  };
}

function mapSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    issuer: row.issuer,
    clientId: row.client_id || "",
    sub: row.sub,
    sid: row.sid || "",
    email: row.email,
    displayName: row.display_name,
    idToken: row.id_token || "",
    purpose: row.purpose,
    expiresAt: toDate(row.expires_at).toISOString(),
    revokedAt: row.revoked_at ? toDate(row.revoked_at).toISOString() : ""
  };
}

function isDuplicateError(error) {
  const code = String(error?.code || "");
  return code === "ER_DUP_ENTRY" || code === "23505" || code.startsWith("SQLITE_CONSTRAINT");
}

/**
 * @typedef {object} OidcKnownUsers The accounts the app already knows: users-core's `users.profiles`.
 * @property {(identity: { provider: string, providerUserId: string }) => Promise<{ authProvider: string, authProviderUserSid: string, email: string, displayName: string } | null>} findByIdentity
 * @property {(email: string) => Promise<{ authProvider: string, authProviderUserSid: string, email: string, displayName: string } | null>} findByEmail
 */

/**
 * Knex storage for registered clients (one per issuer and app origin), app
 * sessions, and seen back-channel logout token ids.
 * @param {object} dependencies
 * @param {import("@jskit-ai/database-runtime/server/types").RuntimeDatabase} dependencies.database
 * @param {OidcKnownUsers | null} dependencies.profiles users-core's `users.profiles`, or null when the app keeps no users.
 * @param {() => number} [dependencies.now]
 */
function createOidcStore({ database, profiles, now = Date.now }) {
  const { knex } = database;
  const stamp = () => new Date(now());

  async function findClient(issuer, origin) {
    return mapClient(await knex(TABLES.clients).where({ issuer, origin }).first());
  }

  async function listClientIds(issuer) {
    const rows = await knex(TABLES.clients).where({ issuer }).select("client_id");
    return rows.map((row) => row.client_id);
  }

  /** Two first sign-ins may register at once; the first stored client wins. */
  async function insertClient(client) {
    try {
      await knex(TABLES.clients).insert({
        issuer: client.issuer,
        origin: client.origin,
        client_id: client.clientId,
        client_secret: client.clientSecret || null,
        registration_access_token: client.registrationAccessToken || null,
        registration_client_uri: client.registrationClientUri || null,
        created_at: stamp(),
        updated_at: stamp()
      });
    } catch (error) {
      if (!isDuplicateError(error)) throw error;
    }
    return mapClient(await knex(TABLES.clients).where({ issuer: client.issuer, origin: client.origin }).first());
  }

  async function createSession(session) {
    const createdAt = stamp();
    await knex(TABLES.sessions).insert({
      id: session.id,
      token_hash: session.tokenHash,
      issuer: session.issuer,
      client_id: session.clientId || null,
      sub: session.sub,
      sid: session.sid || null,
      email: session.email,
      display_name: session.displayName,
      id_token: session.idToken || null,
      purpose: session.purpose,
      expires_at: toDate(session.expiresAt),
      created_at: createdAt,
      updated_at: createdAt
    });
  }

  async function findActiveSessionByTokenHash(tokenHash) {
    const session = mapSession(await knex(TABLES.sessions).where({ token_hash: tokenHash }).first());
    return session && !session.revokedAt && !isExpired(session.expiresAt, now()) ? session : null;
  }

  async function revokeSession(id) {
    await knex(TABLES.sessions).where({ id }).whereNull("revoked_at").update({ revoked_at: stamp(), updated_at: stamp() });
  }

  /** A subject ends all of that person's sessions; an issuer session id alone ends its own. */
  async function revokeIssuerSessions(issuer, { sub = "", sid = "" } = {}) {
    if (!sub && !sid) return 0;
    return knex(TABLES.sessions).where({ issuer }).whereNull("revoked_at")
      .andWhere(sub ? { sub } : { sid })
      .update({ revoked_at: stamp(), updated_at: stamp() });
  }

  /** Returns false when this token id was already used. */
  async function rememberLogoutToken(issuer, jti, expiresAt) {
    await knex(TABLES.logoutTokens).where("expires_at", "<=", stamp()).del();
    try {
      await knex(TABLES.logoutTokens).insert({ issuer, jti, expires_at: toDate(expiresAt) });
      return true;
    } catch (error) {
      if (isDuplicateError(error)) return false;
      throw error;
    }
  }

  /** Preview identity signs in as an account the app already knows, which users-core's records answer. */
  async function findKnownUser(provider, { userId = "", email = "" } = {}) {
    if (!profiles) return null;
    let profile;
    try {
      profile = userId
        ? await profiles.findByIdentity({ provider, providerUserId: userId })
        : await profiles.findByEmail(email);
    } catch {
      return null;
    }
    return profile && profile.authProvider === provider
      ? { sub: profile.authProviderUserSid, email: profile.email, displayName: profile.displayName }
      : null;
  }

  return Object.freeze({
    findClient,
    listClientIds,
    insertClient,
    createSession,
    findActiveSessionByTokenHash,
    revokeSession,
    revokeIssuerSessions,
    rememberLogoutToken,
    findKnownUser
  });
}

// The tables the relying party keeps outside table resources, for an app test's expectEveryTableOwned infrastructureTables.
const OIDC_CLIENT_INFRASTRUCTURE_TABLES = Object.freeze(Object.values(TABLES));

export { OIDC_CLIENT_INFRASTRUCTURE_TABLES, TABLES, createOidcStore };
