import { MODELS_TABLE } from "./adapter.js";
import { randomToken, sha256 } from "./crypto.js";

const SESSION_KIND = "HubSession";
const SETTING_KIND = "HubSetting";
const SESSION_TTL_SECONDS = 14 * 86400;

/** `__Host-` keeps sibling subdomains from planting the cookie when the hub runs on https. */
function hubSessionCookieName(config) {
  return config.secure ? "__Host-hub_session" : "hub_session";
}

/**
 * The hub's own signed-in state, shared by its pages and by every app's
 * sign-in. The cookie carries a random token; the database keeps its hash.
 * @param {object} dependencies
 * @param {import("@jskit-ai/database-runtime/server/types").RuntimeKnex} dependencies.knex
 * @param {import("./types.js").HubClock} dependencies.now
 */
function createHubSessionStore({ knex, now }) {
  const sessions = () => knex(MODELS_TABLE).where({ kind: SESSION_KIND });

  function toSession(row) {
    const payload = JSON.parse(row.payload);
    return { id: row.id, accountId: row.account_id, ...payload };
  }

  async function create(accountId, { userAgent = "", method = "password" } = {}) {
    const token = randomToken(32);
    const timestamp = now();
    await knex(MODELS_TABLE).insert({
      id: sha256(token),
      kind: SESSION_KIND,
      payload: JSON.stringify({
        createdAt: timestamp.toISOString(),
        userAgent: String(userAgent).slice(0, 200),
        method
      }),
      account_id: accountId,
      expires_at: new Date(timestamp.getTime() + SESSION_TTL_SECONDS * 1000)
    });
    return token;
  }

  async function find(token) {
    if (!token) return null;
    const row = await sessions().andWhere({ id: sha256(token) }).first();
    if (!row || new Date(row.expires_at).getTime() <= now().getTime()) return null;
    return toSession(row);
  }

  async function listForAccount(accountId) {
    const rows = await sessions().andWhere({ account_id: accountId }).andWhere("expires_at", ">", now());
    return rows.map(toSession);
  }

  async function destroy(id) {
    await sessions().andWhere({ id }).delete();
  }

  async function destroyToken(token) {
    if (token) await sessions().andWhere({ id: sha256(token) }).delete();
  }

  /** Ends every hub session and every oidc-provider session and grant of the account. */
  async function destroyAllForAccount(accountId) {
    await knex(MODELS_TABLE).where({ account_id: accountId }).delete();
  }

  return Object.freeze({
    ttlSeconds: SESSION_TTL_SECONDS,
    create,
    find,
    listForAccount,
    destroy,
    destroyToken,
    destroyAllForAccount
  });
}

/**
 * The hub's own settings, one JSON value per id.
 * @param {object} dependencies
 * @param {import("@jskit-ai/database-runtime/server/types").RuntimeKnex} dependencies.knex
 */
function createSettingStore({ knex }) {
  const settings = () => knex(MODELS_TABLE).where({ kind: SETTING_KIND });

  async function get(id) {
    const row = await settings().andWhere({ id }).first();
    return row ? JSON.parse(row.payload) : null;
  }

  async function set(id, value) {
    await knex(MODELS_TABLE)
      .insert({ id, kind: SETTING_KIND, payload: JSON.stringify(value) })
      .onConflict(["kind", "id"])
      .merge();
  }

  return Object.freeze({
    get,
    set
  });
}

export { createHubSessionStore, createSettingStore, hubSessionCookieName };
