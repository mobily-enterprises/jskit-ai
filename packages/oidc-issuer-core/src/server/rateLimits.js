const RATE_LIMITS_TABLE = "oidc_issuer_rate_limits";

const LIMITS = Object.freeze({
  signInPerIp: { limit: 10, windowSeconds: 60 },
  emailPerAddress: { limit: 5, windowSeconds: 3600 },
  emailPerIp: { limit: 20, windowSeconds: 3600 }
});

/** Fixed-window counters kept in the database, so limits hold across restarts. */
function createRateLimiter(knex, { now = () => new Date() } = {}) {
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

  return Object.freeze({
    signIn(ip) {
      return hit(`sign-in:${ip}`, LIMITS.signInPerIp);
    },
    async email(address, ip) {
      const perAddress = await hit(`email:${String(address).toLowerCase()}`, LIMITS.emailPerAddress);
      const perIp = await hit(`email-ip:${ip}`, LIMITS.emailPerIp);
      return perAddress && perIp;
    },
    async deleteExpired() {
      return knex(RATE_LIMITS_TABLE).where("window_ends_at", "<=", now()).delete();
    }
  });
}

export { createRateLimiter };
