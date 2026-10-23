import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// One sign-in attempt (state, nonce, PKCE verifier, origin, return page) lives
// in a sealed cookie on the browser that started it, so a callback completes
// only in that browser.
const TRANSACTION_COOKIE = "jskit_oidc_attempt";
const TRANSACTION_COOKIE_PATH = "/api/oauth";
const TRANSACTION_TTL_SECONDS = 10 * 60;

function transactionKey(secret) {
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.alloc(0), "jskit-oidc-attempt-v1", 32));
}

function createTransactionSealer({ secret, now = Date.now }) {
  const key = transactionKey(secret);

  function seal(attempt) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const payload = JSON.stringify({ ...attempt, exp: now() + TRANSACTION_TTL_SECONDS * 1000 });
    const encrypted = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
    return [iv, encrypted, cipher.getAuthTag()].map((part) => part.toString("base64url")).join(".");
  }

  function open(value) {
    const parts = String(value || "").split(".");
    if (parts.length !== 3) return null;
    try {
      const [iv, encrypted, tag] = parts.map((part) => Buffer.from(part, "base64url"));
      const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
      decipher.setAuthTag(tag);
      const attempt = JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8"));
      return Number(attempt?.exp) > now() ? attempt : null;
    } catch {
      return null;
    }
  }

  return Object.freeze({ open, seal });
}

function transactionCookieOptions(secure, maxAge = TRANSACTION_TTL_SECONDS) {
  return { path: TRANSACTION_COOKIE_PATH, httpOnly: true, sameSite: "lax", secure, maxAge };
}

export {
  TRANSACTION_COOKIE,
  createTransactionSealer,
  transactionCookieOptions
};
