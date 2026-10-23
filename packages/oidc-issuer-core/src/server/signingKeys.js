import { exportJWK, generateKeyPair } from "jose";
import { HubConfigError } from "./config.js";
import { decrypt, deriveKey, encrypt, randomToken } from "./crypto.js";

const SIGNING_KEYS_TABLE = "oidc_issuer_signing_keys";
const ALGORITHM = "ES256";
/** ID tokens live one hour; a retiring key keeps verifying for that long plus one hour. */
const RETIRE_GRACE_SECONDS = 3600 + 3600;

/**
 * ES256 signing keys, stored encrypted with a key derived from
 * OIDC_HUB_SECRET. The active key signs; retiring keys stay in the JWKS until
 * every token they signed has expired; retired keys leave the JWKS.
 */
function createSigningKeyStore(knex, { secret, now = () => new Date() }) {
  const encryptionKey = deriveKey(secret, "signing-keys");
  const table = () => knex(SIGNING_KEYS_TABLE);

  async function createKey() {
    const { privateKey } = await generateKeyPair(ALGORITHM, { extractable: true });
    const kid = `k_${randomToken(12)}`;
    const jwk = { ...(await exportJWK(privateKey)), kid, alg: ALGORITHM, use: "sig" };
    await table().insert({
      kid,
      alg: ALGORITHM,
      private_jwk_encrypted: encrypt(encryptionKey, JSON.stringify(jwk)),
      state: "active",
      created_at: now(),
      retire_after: null
    });
    return kid;
  }

  async function retireExpired() {
    return table().where({ state: "retiring" }).andWhere("retire_after", "<=", now()).update({ state: "retired" });
  }

  return Object.freeze({
    async ensureActiveKey() {
      if (!(await table().where({ state: "active" }).first())) await createKey();
    },

    async rotate() {
      await table().where({ state: "active" }).update({
        state: "retiring",
        retire_after: new Date(now().getTime() + RETIRE_GRACE_SECONDS * 1000)
      });
      return createKey();
    },

    retireExpired,

    /** The JWKS for oidc-provider: the active key first, so it is the one that signs. */
    async jwks() {
      await retireExpired();
      const rows = await table().whereIn("state", ["active", "retiring"]).orderBy("created_at", "desc");
      rows.sort((left, right) => (left.state === "active" ? -1 : 0) - (right.state === "active" ? -1 : 0));
      try {
        return { keys: rows.map((row) => JSON.parse(decrypt(encryptionKey, row.private_jwk_encrypted))) };
      } catch {
        throw new HubConfigError(
          "The stored signing keys were sealed with a different OIDC_HUB_SECRET. Set OIDC_HUB_SECRET back to the value they were made with."
        );
      }
    },

    async summary() {
      return (await table().whereNot({ state: "retired" }).orderBy("created_at", "desc"))
        .map((row) => ({ kid: row.kid, state: row.state, createdAt: row.created_at, retireAfter: row.retire_after }));
    },

    /** A fingerprint of the published keys, to notice rotation by another process. */
    async fingerprint() {
      const rows = await table().whereIn("state", ["active", "retiring"]).orderBy("kid");
      return rows.map((row) => `${row.kid}:${row.state}`).join(",");
    }
  });
}

export { createSigningKeyStore };
