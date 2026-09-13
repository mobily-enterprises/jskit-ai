import { createHash } from "node:crypto";
import { createWithTransaction } from "@jskit-ai/database-runtime/shared";

const hash = (value) => createHash("sha256").update(value).digest("hex");

function createKnexConnectionStore({ knex, protection }) {
  if (typeof knex !== "function" || typeof knex.transaction !== "function") {
    throw new TypeError("Connector storage requires the application's transactional Knex client.");
  }
  if (typeof protection?.seal !== "function" || typeof protection?.open !== "function") {
    throw new TypeError("Connector storage requires credential protection.");
  }
  const transaction = createWithTransaction(knex);

  async function withConnection({ owner, integrationId }, work) {
    const connectionKey = hash(JSON.stringify([owner.applicationId, owner.subjectId, integrationId]));
    const connectionBinding = `connection:${connectionKey}`;
    return transaction(async (trx) => {
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

  return Object.freeze({ withConnection, pruneExpiredAttempts });
}

export { createKnexConnectionStore };
