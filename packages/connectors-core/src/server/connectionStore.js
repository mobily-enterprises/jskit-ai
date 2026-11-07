import { createHash } from "node:crypto";
import { isLostDuplicateInsertRace } from "@jskit-ai/database-runtime/shared";

const hash = (value) => createHash("sha256").update(value).digest("hex");

/**
 * The record with this id, created from `attributes` when it is missing. The create runs outside any transaction, so
 * of two concurrent creations one wins and the other reads the winner's record.
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} handle
 * @param {{ id: string } & Record<string, unknown>} attributes
 * @param {{ context: object }} options
 */
async function findOrCreate(handle, attributes, options) {
  const existing = await handle.get(attributes.id, {}, options);
  if (existing) {
    return existing;
  }
  try {
    return await handle.create(attributes, options);
  } catch (error) {
    if (!isLostDuplicateInsertRace(error, options)) {
      throw error;
    }
    return handle.get(attributes.id, {}, options);
  }
}

/**
 * Runs work in one transaction and answers what it returns. A failure of the work reaches the caller as the work
 * threw it, not inside json-rest-api's write error. A deadlock fails the work instead of running it again, since work
 * may exchange tokens with the provider.
 * @template T
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} handle
 * @param {{ context: object }} options
 * @param {(txOptions: Readonly<Record<string, any>>) => Promise<T>} work
 * @returns {Promise<T>}
 */
async function inTransaction(handle, options, work) {
  let failure = null;
  try {
    return await handle.withTransaction(options, async (txOptions) => {
      try {
        return await work(txOptions);
      } catch (error) {
        failure = { error };
        throw error;
      }
    }, { retry: false });
  } catch (error) {
    throw failure && error?.cause === failure.error ? failure.error : error;
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
  const pruneOptions = Object.freeze({ context: systemContext("maintenance prunes every connection's expired authorization attempts") });

  async function withConnection({ owner, integrationId }, work) {
    const connectionKey = hash(JSON.stringify([owner.applicationId, owner.subjectId, integrationId]));
    const connectionBinding = `connection:${connectionKey}`;
    // Retain this row on disconnect so other processes continue to lock the same identity.
    await findOrCreate(connections, { id: connectionKey, payload: null }, connectionOptions);
    return inTransaction(connections, connectionOptions, async (txOptions) => {
      const row = await connections.lock(connectionKey, txOptions);
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
          await attempts.deleteMany([attemptKey], { ...txOptions, missing: "skip" });
          return protection.open(attempt.payload, `attempt:${connectionKey}:${attemptKey}`);
        }
      });
    });
  }

  async function pruneExpiredAttempts({ before = Date.now() } = {}) {
    const pruned = await attempts.deleteWhere({ expiredBy: before }, { ...pruneOptions, returning: "ids" });
    return pruned.length;
  }

  return Object.freeze({
    withConnection,
    pruneExpiredAttempts
  });
}

export { createConnectionStore, requireProtection };
