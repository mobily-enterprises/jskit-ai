// readable-check: allow no-direct-knex - infrastructure: the auth_local_identities links are keyed by provider and provider subject together, a composite key no table resource can name, so this module keeps them with Knex
// readable-check: allow no-transaction-reader - infrastructure: identity links are written in the transaction the local sign-in records' handles opened, which a call passes in its options

const IDENTITIES_TABLE = "auth_local_identities";

function nowIso() {
  return new Date().toISOString();
}

/**
 * @param {unknown} value
 * @returns {Date}
 */
function toDate(value) {
  const date = value instanceof Date ? value : new Date(/** @type {string | number} */ (value));
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("Invalid local auth DB timestamp.");
  }
  return date;
}

function mapIdentity(row) {
  if (!row) {
    return null;
  }
  return {
    userId: String(row.user_id || ""),
    provider: String(row.provider || ""),
    providerSubject: String(row.provider_subject || ""),
    email: String(row.email || ""),
    createdAt: row.created_at ? toDate(row.created_at).toISOString() : ""
  };
}

/**
 * The provider identities linked to local accounts: the one local sign-in table outside a table resource. Each call
 * runs in its options' transaction, which the backend's handles opened, or on its own.
 * @param {object} dependencies
 * @param {import("@jskit-ai/database-runtime/server/types").RuntimeDatabase} dependencies.database
 */
function createIdentityStore({ database }) {
  const { knex } = database;
  const table = (options) => (options.trx || knex)(IDENTITIES_TABLE);

  /**
   * @param {{ userId?: unknown, provider?: unknown, providerSubject?: unknown, email?: unknown, createdAt?: unknown }} input
   * @param {{ trx?: object | null }} options
   */
  async function create(input, options) {
    const row = {
      user_id: String(input.userId || ""),
      provider: String(input.provider || ""),
      provider_subject: String(input.providerSubject || ""),
      email: String(input.email || ""),
      created_at: toDate(input.createdAt || nowIso())
    };
    await table(options).insert(row);
    return mapIdentity(row);
  }

  async function findByProviderSubject(provider, providerSubject, options) {
    return mapIdentity(await table(options)
      .where({ provider: String(provider || ""), provider_subject: String(providerSubject || "") })
      .first());
  }

  async function listForUser(userId, options) {
    const rows = await table(options).where({ user_id: String(userId || "") });
    return rows.map(mapIdentity);
  }

  async function deleteForUser(userId, provider, options) {
    const count = await table(options)
      .where({ user_id: String(userId || ""), provider: String(provider || "") })
      .delete();
    return Number(count || 0);
  }

  return Object.freeze({
    create,
    findByProviderSubject,
    listForUser,
    deleteForUser
  });
}

/** @typedef {ReturnType<typeof createIdentityStore>} IdentityStore */

export { IDENTITIES_TABLE, createIdentityStore };
