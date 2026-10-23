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
 * Knex storage for registered clients (one per issuer and app origin), app
 * sessions, and seen back-channel logout token ids.
 */
function createOidcStore({ knex, now = Date.now }) {
  if (typeof knex !== "function") throw new TypeError("OIDC sign-in requires runtime.database knex.");
  const stamp = () => new Date(now());

  return Object.freeze({
    async findClient(issuer, origin) {
      return mapClient(await knex(TABLES.clients).where({ issuer, origin }).first());
    },
    async listClientIds(issuer) {
      const rows = await knex(TABLES.clients).where({ issuer }).select("client_id");
      return rows.map((row) => row.client_id);
    },
    // Two first sign-ins may register at once; the first stored client wins.
    async insertClient(client) {
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
    },

    async createSession(session) {
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
    },
    async findActiveSessionByTokenHash(tokenHash) {
      const session = mapSession(await knex(TABLES.sessions).where({ token_hash: tokenHash }).first());
      return session && !session.revokedAt && !isExpired(session.expiresAt, now()) ? session : null;
    },
    async revokeSession(id) {
      await knex(TABLES.sessions).where({ id }).whereNull("revoked_at").update({ revoked_at: stamp(), updated_at: stamp() });
    },
    // A subject ends all of that person's sessions; an issuer session id alone ends its own.
    async revokeIssuerSessions(issuer, { sub = "", sid = "" } = {}) {
      if (!sub && !sid) return 0;
      return knex(TABLES.sessions).where({ issuer }).whereNull("revoked_at")
        .andWhere(sub ? { sub } : { sid })
        .update({ revoked_at: stamp(), updated_at: stamp() });
    },

    // Returns false when this token id was already used.
    async rememberLogoutToken(issuer, jti, expiresAt) {
      await knex(TABLES.logoutTokens).where("expires_at", "<=", stamp()).del();
      try {
        await knex(TABLES.logoutTokens).insert({ issuer, jti, expires_at: toDate(expiresAt) });
        return true;
      } catch (error) {
        if (isDuplicateError(error)) return false;
        throw error;
      }
    },

    // Preview identity signs in as an account the app already knows.
    async findKnownUser(provider, { userId = "", email = "" } = {}) {
      const query = knex("users").where({ auth_provider: provider });
      if (userId) query.andWhere({ auth_provider_user_sid: userId });
      else query.andWhere({ email });
      let row;
      try {
        row = await query.first("auth_provider_user_sid", "email", "display_name");
      } catch {
        return null;
      }
      return row ? { sub: row.auth_provider_user_sid, email: row.email, displayName: row.display_name } : null;
    }
  });
}

export { TABLES, createOidcStore };
