import { randomToken, sha256 } from "./crypto.js";

const EMAIL_TOKENS_TABLE = "oidc_issuer_email_tokens";
const TTL_SECONDS = Object.freeze({ confirm: 7 * 86400, recovery: 3600, "google-link": 3600 });

/** Single-use emailed links. Only a hash of each token is stored. */
function createEmailTokenStore(knex, { now = () => new Date() } = {}) {
  const table = () => knex(EMAIL_TOKENS_TABLE);

  return Object.freeze({
    async create(accountId, purpose, payload = null) {
      const token = randomToken(32);
      await table().insert({
        token_hash: sha256(token),
        account_id: accountId,
        purpose,
        payload: payload ? JSON.stringify(payload) : null,
        expires_at: new Date(now().getTime() + TTL_SECONDS[purpose] * 1000),
        used_at: null,
        created_at: now()
      });
      return token;
    },

    /** Uses a token once. Returns null for unknown, used, expired or other-purpose tokens. */
    async consume(token, purpose) {
      const tokenHash = sha256(String(token ?? ""));
      const row = await table().where({ token_hash: tokenHash, purpose }).whereNull("used_at").first();
      if (!row || new Date(row.expires_at).getTime() <= now().getTime()) return null;
      const used = await table().where({ token_hash: tokenHash }).whereNull("used_at").update({ used_at: now() });
      if (used !== 1) return null;
      return { accountId: row.account_id, payload: row.payload ? JSON.parse(row.payload) : null };
    },

    deleteExpired() {
      return table().where("expires_at", "<=", now()).delete();
    }
  });
}

export { EMAIL_TOKENS_TABLE, createEmailTokenStore };
