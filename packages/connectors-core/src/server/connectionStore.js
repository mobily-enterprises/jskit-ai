import { createHash } from "node:crypto";

const hash = (value) => createHash("sha256").update(value).digest("hex");

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
 * while it is used, unless the work only reads it. Every call works in a system context, because a row's scope is
 * its key.
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

  async function withConnection({ owner, integrationId }, work, { readOnly = false } = {}) {
    const connectionKey = hash(JSON.stringify([owner.applicationId, owner.subjectId, integrationId]));
    const connectionBinding = `connection:${connectionKey}`;
    if (readOnly) {
      // Work that only reads takes no lock and creates no row.
      const row = await connections.get(connectionKey, {}, { ...connectionOptions, missing: "skip" });
      return work({ connection: row?.payload ? await protection.open(row.payload, connectionBinding) : null });
    }
    // Retain this row on disconnect so other processes continue to lock the same identity.
    return connections.lockOrCreate({ id: connectionKey, payload: null }, connectionOptions, async (row, txOptions) => {
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
