import { createHash } from "node:crypto";
import { isDeadlockError, isDuplicateEntryError } from "@jskit-ai/database-runtime/shared";

const hash = (value) => createHash("sha256").update(value).digest("hex");

// First uses of one key at once can collide on its insert before any work runs (on MySQL and MariaDB, first uses of
// neighbouring keys too, through their gap locks): each collision runs the loser again after a short random wait.
const CREATE_RACE_ATTEMPTS = 4;
const CREATE_IF_MISSING = Object.freeze({ keys: ["id"], action: "ignore" });

/**
 * Runs work once on the connection row with `attributes.id`, locked in one transaction with the work, creating the row
 * there when it is missing, so work that fails leaves no row behind. Two first uses of one key can collide on that
 * insert before either work runs (a deadlock on MySQL's and MariaDB's gap locks, a duplicate key elsewhere): the loser
 * runs again, up to four runs in all, and finds the winner's row. Work that has started never runs again.
 * @template T
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} handle
 * @param {object} options The transaction's options: its context, and `retry: false`.
 * @param {{ id: string } & Record<string, unknown>} attributes
 * @param {(row: Record<string, any>, txOptions: object) => Promise<T>} work
 * @returns {Promise<T>}
 */
async function withLockedRow(handle, options, attributes, work) {
  for (let attempt = 1; ; attempt += 1) {
    let started = false;
    try {
      return await handle.withTransaction(options, async (txOptions) => {
        let row = await handle.lock(attributes.id, { ...txOptions, missing: "skip" });
        if (!row) {
          await handle.createMany([attributes], { ...txOptions, onConflict: CREATE_IF_MISSING, returning: "none" });
          row = await handle.lock(attributes.id, txOptions);
        }
        started = true;
        return work(row, txOptions);
      });
    } catch (error) {
      if (started || attempt >= CREATE_RACE_ATTEMPTS || !(isDeadlockError(error) || isDuplicateEntryError(error))) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 20 * 2 ** attempt));
    }
  }
}

/**
 * The application's credential protection, checked before it is used.
 * @param {import("./types.js").CredentialProtection} protection
 */
function requireProtection(protection) {
  // readable-check: allow method-probe - input validation: the application passes its credential protection
  if (typeof protection?.seal !== "function" || typeof protection?.open !== "function") {
    throw new TypeError("Connector storage requires credential protection.");
  }
  return protection;
}

/**
 * Connections kept encrypted in the connector tables, on their table resources' handles, each locked in a transaction
 * while it is used. Every call works in a system context, because a row's scope is its key.
 * @param {object} dependencies
 * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} dependencies.resources The handles of CONNECTOR_TABLES.
 * @param {(reason: string) => import("@jskit-ai/resource-runtime/server/types").SystemContext} dependencies.systemContext
 * @param {import("./types.js").CredentialProtection} dependencies.protection
 */
function createConnectionStore({ resources, systemContext, protection }) {
  requireProtection(protection);
  const { connectorConnections: connections, connectorAuthorizationAttempts: attempts } = resources;
  const connectionOptions = Object.freeze({ context: systemContext("a connection and its attempts are read and changed by their owner and integration key") });
  // One transaction per work, run once, since work may exchange tokens with the provider.
  const runOnce = Object.freeze({ ...connectionOptions, retry: false });
  const pruneOptions = Object.freeze({ context: systemContext("maintenance prunes every connection's expired authorization attempts") });

  async function withConnection({ owner, integrationId }, work) {
    const connectionKey = hash(JSON.stringify([owner.applicationId, owner.subjectId, integrationId]));
    const connectionBinding = `connection:${connectionKey}`;
    // Retain this row on disconnect so other processes continue to lock the same identity.
    return withLockedRow(connections, runOnce, { id: connectionKey, payload: null }, async (row, txOptions) => {
      const writeOptions = { ...txOptions, returning: "none" };
      return work({
        connection: row.payload ? await protection.open(row.payload, connectionBinding) : null,
        save: async (connection) => {
          const payload = await protection.seal(connection, connectionBinding);
          await connections.patch(connectionKey, { payload }, writeOptions);
        },
        remove: async () => {
          await connections.patch(connectionKey, { payload: null }, writeOptions);
          await attempts.deleteWhere({ connectionKey }, txOptions);
        },
        putAttempt: async (attempt) => {
          const attemptKey = hash(attempt.state);
          await attempts.create({
            id: attemptKey,
            connectionKey,
            expiresAt: attempt.expiresAt,
            payload: await protection.seal(attempt, `attempt:${connectionKey}:${attemptKey}`)
          }, writeOptions);
        },
        latestAttempt: async ({ after }) => {
          const { records: [attempt] } = await attempts.query({
            filters: { connectionKey, expiresAfter: after },
            sort: "-expiresAt",
            page: { size: 1 }
          }, txOptions);
          return attempt ? protection.open(attempt.payload, `attempt:${connectionKey}:${attempt.id}`) : null;
        },
        consumeAttempt: async (state) => {
          const attemptKey = hash(state);
          // A locking read sees an attempt another transaction consumed while this one waited for the connection.
          const [attempt] = await attempts.lockMany([attemptKey], { ...txOptions, missing: "skip" });
          if (attempt?.connectionKey !== connectionKey) return null;
          await attempts.delete(attemptKey, { ...txOptions, missing: "skip" });
          return protection.open(attempt.payload, `attempt:${connectionKey}:${attemptKey}`);
        }
      });
    });
  }

  async function pruneExpiredAttempts({ before = Date.now() } = {}) {
    return attempts.deleteWhere({ expiredBy: before }, { ...pruneOptions, returning: "count" });
  }

  return Object.freeze({
    withConnection,
    pruneExpiredAttempts
  });
}

export { createConnectionStore, requireProtection };
