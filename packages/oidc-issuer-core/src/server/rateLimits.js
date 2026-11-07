// readable-check: allow no-direct-knex - infrastructure: the accounts hub's fixed-window rate-limit counters (oidc_issuer_rate_limits), each hit counted under its row's lock in a transaction of its own

const RATE_LIMITS_TABLE = "oidc_issuer_rate_limits";

const LIMITS = Object.freeze({
  signInPerIp: { limit: 10, windowSeconds: 60 },
  emailPerAddress: { limit: 5, windowSeconds: 3600 },
  emailPerIp: { limit: 20, windowSeconds: 3600 }
});

/**
 * Fixed-window counters kept in the database, so limits hold across restarts.
 * @param {object} dependencies
 * @param {import("@jskit-ai/database-runtime/server/types").RuntimeKnex} dependencies.knex
 * @param {import("./types.js").HubClock} dependencies.now
 */
function createRateLimiter({ knex, now }) {
  async function hit(bucket, { limit, windowSeconds }) {
    return knex.transaction(async (trx) => {
      const current = now();
      const row = await trx(RATE_LIMITS_TABLE).where({ bucket }).forUpdate().first();
      if (!row || new Date(row.window_ends_at).getTime() <= current.getTime()) {
        const windowEndsAt = new Date(current.getTime() + windowSeconds * 1000);
        await trx(RATE_LIMITS_TABLE)
          .insert({ bucket, hits: 1, window_ends_at: windowEndsAt })
          .onConflict("bucket")
          .merge();
        return true;
      }
      await trx(RATE_LIMITS_TABLE).where({ bucket }).increment("hits", 1);
      return Number(row.hits) + 1 <= limit;
    });
  }

  function signIn(ip) {
    return hit(`sign-in:${ip}`, LIMITS.signInPerIp);
  }

  async function email(address, ip) {
    const perAddress = await hit(`email:${String(address).toLowerCase()}`, LIMITS.emailPerAddress);
    const perIp = await hit(`email-ip:${ip}`, LIMITS.emailPerIp);
    return perAddress && perIp;
  }

  async function deleteExpired() {
    return knex(RATE_LIMITS_TABLE).where("window_ends_at", "<=", now()).delete();
  }

  return Object.freeze({
    signIn,
    email,
    deleteExpired
  });
}

export { RATE_LIMITS_TABLE, createRateLimiter };
