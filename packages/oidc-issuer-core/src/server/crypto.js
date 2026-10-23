import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

/*
 * JSKIT local accounts store scrypt v1 passwords (16-byte salt, 64-byte key,
 * base64url). The hub keeps exactly that format so exported local accounts
 * import unchanged. It cannot import the helpers from
 * @jskit-ai/auth-provider-local-core: a JSKIT runtime dependency would install
 * that package's local auth provider inside the hub. test/passwords.test.js
 * proves both implementations accept each other's hashes.
 */
const PASSWORD_ALGORITHM = "scrypt";
const PASSWORD_VERSION = "v1";
const PASSWORD_KEY_LENGTH = 64;

async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(String(password || ""), salt, PASSWORD_KEY_LENGTH);
  return {
    algorithm: PASSWORD_ALGORITHM,
    version: PASSWORD_VERSION,
    salt: salt.toString("base64url"),
    hash: Buffer.from(hash).toString("base64url")
  };
}

async function verifyPassword(password, record) {
  if (
    !record ||
    record.algorithm !== PASSWORD_ALGORITHM ||
    record.version !== PASSWORD_VERSION ||
    !record.salt ||
    !record.hash
  ) {
    return false;
  }
  const expected = Buffer.from(String(record.hash), "base64url");
  const actual = await scrypt(String(password || ""), Buffer.from(String(record.salt), "base64url"), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function deriveKey(secret, purpose, length = 32) {
  return Buffer.from(hkdfSync("sha256", Buffer.from(String(secret), "utf8"), Buffer.alloc(0), `oidc-hub:${purpose}`, length));
}

function encrypt(key, plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

function decrypt(key, sealed) {
  const [version, iv, tag, body] = String(sealed || "").split(".");
  if (version !== "v1" || !iv || !tag || !body) {
    throw new Error("Encrypted value has an unknown format.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"), { authTagLength: 16 });
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}

function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("base64url");
}

function constantEquals(left, right) {
  const a = Buffer.from(String(left ?? ""));
  const b = Buffer.from(String(right ?? ""));
  const same = a.length === b.length;
  return timingSafeEqual(same ? a : b, b) && same;
}

function createAccountId() {
  return `usr_${randomToken(18)}`;
}

export {
  constantEquals,
  createAccountId,
  decrypt,
  deriveKey,
  encrypt,
  hashPassword,
  randomToken,
  sha256,
  verifyPassword
};
