import { createHash } from "node:crypto";

const hash = (value) => createHash("sha256").update(value).digest("hex");

/**
 * Connections kept encrypted in the connector tables, each locked in a transaction while it is used.
 * @param {object} options
 * @param {import("@jskit-ai/database-runtime/server/types").RuntimeKnex} options.knex The application's transactional Knex client.
 * @param {import("./types.js").CredentialProtection} options.protection
 */
function createKnexConnectionStore({ knex, protection }) {
  // readable-check: allow method-probe - input validation: the application passes its own Knex instance
  if (typeof knex !== "function" || typeof knex.transaction !== "function") {
    throw new TypeError("createKnexConnectionStore requires the application's Knex instance.");
  }
  // readable-check: allow method-probe - input validation: the application passes its credential protection
  if (typeof protection?.seal !== "function" || typeof protection?.open !== "function") {
    throw new TypeError("Connector storage requires credential protection.");
  }
  async function withConnection({ owner, integrationId }, work) {
    const connectionKey = hash(JSON.stringify([owner.applicationId, owner.subjectId, integrationId]));
    const connectionBinding = `connection:${connectionKey}`;
    return knex.transaction(async (trx) => {
      // Retain this row on disconnect so other processes continue to lock the same identity.
      await trx("connector_connections").insert({ connection_key: connectionKey })
        .onConflict("connection_key").merge({ connection_key: connectionKey });
      const row = await trx("connector_connections").where({ connection_key: connectionKey }).forUpdate().first();
      return work({
        connection: row.payload ? await protection.open(row.payload, connectionBinding) : null,
        save: async (connection) => {
          const payload = await protection.seal(connection, connectionBinding);
          await trx("connector_connections").where({ connection_key: connectionKey }).update({ payload });
        },
        remove: async () => {
          await trx("connector_connections").where({ connection_key: connectionKey }).update({ payload: null });
          await trx("connector_authorization_attempts").where({ connection_key: connectionKey }).delete();
        },
        putAttempt: async (attempt) => {
          const attemptKey = hash(attempt.state);
          await trx("connector_authorization_attempts").insert({
            attempt_key: attemptKey, connection_key: connectionKey, expires_at: attempt.expiresAt,
            payload: await protection.seal(attempt, `attempt:${connectionKey}:${attemptKey}`)
          });
        },
        latestAttempt: async ({ after }) => {
          const attempt = await trx("connector_authorization_attempts")
            .where({ connection_key: connectionKey }).where("expires_at", ">", after)
            .orderBy("expires_at", "desc").first();
          return attempt ? protection.open(attempt.payload, `attempt:${connectionKey}:${attempt.attempt_key}`) : null;
        },
        consumeAttempt: async (state) => {
          const attemptKey = hash(state);
          const where = { attempt_key: attemptKey, connection_key: connectionKey };
          const attempt = await trx("connector_authorization_attempts").where(where).first();
          if (!attempt) return null;
          await trx("connector_authorization_attempts").where(where).delete();
          return protection.open(attempt.payload, `attempt:${connectionKey}:${attemptKey}`);
        }
      });
    });
  }

  async function pruneExpiredAttempts({ before = Date.now() } = {}) {
    return knex("connector_authorization_attempts").where("expires_at", "<=", before).delete();
  }

  return Object.freeze({
    withConnection,
    pruneExpiredAttempts
  });
}

export { createKnexConnectionStore };
