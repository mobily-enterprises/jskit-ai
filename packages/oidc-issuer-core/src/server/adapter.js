const MODELS_TABLE = "oidc_issuer_models";

function toDate(value) {
  if (value == null) return null;
  return value instanceof Date ? value : new Date(value);
}

function isExpired(row, now) {
  const expiresAt = toDate(row.expires_at);
  return Boolean(expiresAt && expiresAt.getTime() <= now().getTime());
}

/**
 * Persistent oidc-provider adapter: every model (sessions, interactions,
 * codes, grants, clients, registration tokens) is one row, so codes and
 * sessions survive a hub restart. The hub's own records (hub sessions and
 * settings) use the same table under their own kinds.
 */
function createKnexAdapterClass(knex, { now = () => new Date() } = {}) {
  return class KnexAdapter {
    constructor(kind) {
      this.kind = kind;
    }

    async upsert(id, payload, expiresIn) {
      const row = {
        id,
        kind: this.kind,
        payload: JSON.stringify(payload),
        grant_id: payload.grantId || null,
        user_code: payload.userCode || null,
        uid: payload.uid || null,
        account_id: payload.accountId || null,
        expires_at: expiresIn ? new Date(now().getTime() + expiresIn * 1000) : null,
        consumed_at: null
      };
      await knex(MODELS_TABLE).insert(row).onConflict(["kind", "id"]).merge();
    }

    async #findWhere(where) {
      const row = await knex(MODELS_TABLE).where({ kind: this.kind, ...where }).first();
      if (!row || isExpired(row, now)) return undefined;
      const payload = JSON.parse(row.payload);
      const consumedAt = toDate(row.consumed_at);
      return consumedAt ? { ...payload, consumed: Math.floor(consumedAt.getTime() / 1000) } : payload;
    }

    find(id) {
      return this.#findWhere({ id });
    }

    findByUserCode(userCode) {
      return this.#findWhere({ user_code: userCode });
    }

    findByUid(uid) {
      return this.#findWhere({ uid });
    }

    async consume(id) {
      await knex(MODELS_TABLE).where({ kind: this.kind, id }).update({ consumed_at: now() });
    }

    async destroy(id) {
      await knex(MODELS_TABLE).where({ kind: this.kind, id }).delete();
    }

    async revokeByGrantId(grantId) {
      await knex(MODELS_TABLE).where({ grant_id: grantId }).delete();
    }
  };
}

async function deleteExpiredModels(knex, { now = () => new Date() } = {}) {
  return knex(MODELS_TABLE).whereNotNull("expires_at").where("expires_at", "<=", now()).delete();
}

export { MODELS_TABLE, createKnexAdapterClass, deleteExpiredModels };
