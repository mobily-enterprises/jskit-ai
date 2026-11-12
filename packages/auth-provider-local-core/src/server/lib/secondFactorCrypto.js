import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

// Authenticator codes as RFC 6238 defines them and every authenticator app makes them by default: HMAC-SHA1 over
// 30-second steps, six digits. One step either side is accepted, for a phone whose clock drifts.
const STEP_SECONDS = 30;
const CODE_DIGITS = 6;
const ACCEPTED_STEP_OFFSETS = Object.freeze([-1, 0, 1]);
// RFC 4226 recommends a 160-bit secret.
const SECRET_BYTES = 20;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
// Recovery codes: ten characters of Crockford's base32 (no i, l, o or u), 50 random bits each, shown as xxxxx-xxxxx.
const RECOVERY_CODE_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const RECOVERY_CODE_LENGTH = 10;
const RECOVERY_CODE_PATTERN = /^[0-9a-hjkmnp-tv-z]{10}$/u;
const CODE_PATTERN = new RegExp(`^\\d{${CODE_DIGITS}}$`, "u");
// A sealed secret: AES-256-GCM, its version, nonce, ciphertext and tag in base64url, bound to its account's id.
const SEALED_VERSION = "v1";

/** @param {Buffer} bytes */
function toBase32(bytes) {
  let bits = 0;
  let value = 0;
  let text = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      text += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    text += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return text;
}

/** @param {string} text Base32 without padding, as toBase32 writes it. */
function fromBase32(text) {
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const character of text) {
    const digit = BASE32_ALPHABET.indexOf(character);
    if (digit < 0) {
      throw new Error("A second factor secret is not base32.");
    }
    value = (value << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** A new authenticator secret, in base32. */
function newAuthenticatorSecret() {
  return toBase32(randomBytes(SECRET_BYTES));
}

/** The 30-second step a time falls in. @param {number} nowMs */
function stepAt(nowMs) {
  return Math.floor(nowMs / 1000 / STEP_SECONDS);
}

/**
 * The code an authenticator shows in one step (RFC 4226's HOTP of the step).
 * @param {string} secret Base32.
 * @param {number} step
 */
function totpCodeAt(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", fromBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** CODE_DIGITS).padStart(CODE_DIGITS, "0");
}

/**
 * A typed code as six digits, with the spaces and hyphens a person may type
 * removed, or "" when it is not one.
 * @param {unknown} value
 */
function normalizeAuthenticatorCode(value) {
  const code = String(value ?? "").replace(/[\s-]/gu, "");
  return CODE_PATTERN.test(code) ? code : "";
}

/**
 * The step of the accepted window whose code the person typed, or null. Every
 * step of the window is compared, in constant time.
 * @param {string} secret Base32.
 * @param {string} code Six digits.
 * @param {number} nowMs
 */
function matchCodeStep(secret, code, nowMs) {
  const typed = Buffer.from(code);
  let matched = null;
  for (const offset of ACCEPTED_STEP_OFFSETS) {
    const step = stepAt(nowMs) + offset;
    const expected = Buffer.from(totpCodeAt(secret, step));
    if (typed.length === expected.length && timingSafeEqual(typed, expected)) {
      matched = step;
    }
  }
  return matched;
}

/**
 * The otpauth:// address an authenticator app reads from a QR code.
 * @param {{ secret: string, issuer: string, accountName: string }} input
 */
function buildOtpauthUrl({ secret, issuer, accountName }) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}`;
  const query = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: String(CODE_DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${query}`;
}

/**
 * The keys the application's second factor key derives: one seals authenticator
 * secrets, the other hashes recovery codes.
 * @param {string} secondFactorKey AUTH_LOCAL_SECOND_FACTOR_KEY.
 */
function deriveSecondFactorKeys(secondFactorKey) {
  const derive = (purpose) => Buffer.from(hkdfSync("sha256", secondFactorKey, "", `jskit auth.local ${purpose}`, 32));
  return Object.freeze({
    seal: derive("second factor secrets"),
    recoveryCodes: derive("second factor recovery codes")
  });
}

/**
 * An authenticator secret sealed for storage, bound to its account: a sealed
 * secret copied to another account does not open.
 * @param {ReturnType<typeof deriveSecondFactorKeys>} keys
 * @param {string} userId
 * @param {string} secret
 */
function sealSecret(keys, userId, secret) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keys.seal, nonce);
  cipher.setAAD(Buffer.from(userId));
  const sealed = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [SEALED_VERSION, nonce.toString("base64url"), sealed.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

/**
 * The secret sealSecret sealed for the account. It fails when the key is not
 * the one that sealed it.
 * @param {ReturnType<typeof deriveSecondFactorKeys>} keys
 * @param {string} userId
 * @param {string} sealed
 */
function openSecret(keys, userId, sealed) {
  const [version, nonce, body, tag] = String(sealed).split(".");
  if (version !== SEALED_VERSION) {
    throw new Error(`The second factor secret of account ${userId} is not a sealed secret.`);
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", keys.seal, Buffer.from(nonce, "base64url"));
    decipher.setAAD(Buffer.from(userId));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch (error) {
    throw new Error(
      `The second factor secret of account ${userId} does not open with AUTH_LOCAL_SECOND_FACTOR_KEY. ` +
        "Restore the key that sealed it, or reset the account's second factor.",
      { cause: error }
    );
  }
}

/** A new recovery code, as the person sees it: xxxxx-xxxxx. */
function newRecoveryCode() {
  let code = "";
  for (let index = 0; index < RECOVERY_CODE_LENGTH; index += 1) {
    code += RECOVERY_CODE_ALPHABET[randomInt(RECOVERY_CODE_ALPHABET.length)];
  }
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/**
 * A typed recovery code in lower case without spaces or hyphens, or "" when it
 * is not one.
 * @param {unknown} value
 */
function normalizeRecoveryCode(value) {
  const code = String(value ?? "").replace(/[\s-]/gu, "").toLowerCase();
  return RECOVERY_CODE_PATTERN.test(code) ? code : "";
}

/**
 * The stored form of an account's recovery code: a keyed hash, so a copy of
 * the store cannot be searched for codes without the key.
 * @param {ReturnType<typeof deriveSecondFactorKeys>} keys
 * @param {string} userId
 * @param {string} code A normalized recovery code.
 */
function hashRecoveryCode(keys, userId, code) {
  return createHmac("sha256", keys.recoveryCodes).update(`${userId}:${code}`).digest("base64url");
}

/**
 * The index of the hash among the stored ones, or -1; every stored hash is
 * compared, in constant time.
 * @param {readonly string[]} hashes
 * @param {string} hash
 */
function findRecoveryCodeHash(hashes, hash) {
  const wanted = Buffer.from(hash);
  let found = -1;
  hashes.forEach((stored, index) => {
    const candidate = Buffer.from(stored);
    if (candidate.length === wanted.length && timingSafeEqual(candidate, wanted)) {
      found = index;
    }
  });
  return found;
}

const __testables = Object.freeze({ fromBase32, stepAt, toBase32, totpCodeAt });

export {
  __testables,
  buildOtpauthUrl,
  deriveSecondFactorKeys,
  findRecoveryCodeHash,
  hashRecoveryCode,
  matchCodeStep,
  newAuthenticatorSecret,
  newRecoveryCode,
  normalizeAuthenticatorCode,
  normalizeRecoveryCode,
  openSecret,
  sealSecret
};
