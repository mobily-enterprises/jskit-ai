import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const SCRYPT_ALGORITHM = "scrypt";
const SCRYPT_VERSION = "v1";
const SCRYPT_KEY_LENGTH = 64;

function base64url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function fromBase64url(value) {
  return Buffer.from(String(value || ""), "base64url");
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(String(password || ""), salt, SCRYPT_KEY_LENGTH);
  return {
    algorithm: SCRYPT_ALGORITHM,
    version: SCRYPT_VERSION,
    salt: base64url(salt),
    hash: base64url(hash)
  };
}

async function verifyPassword(password, record) {
  if (
    !record ||
    record.algorithm !== SCRYPT_ALGORITHM ||
    record.version !== SCRYPT_VERSION ||
    !record.salt ||
    !record.hash
  ) {
    return false;
  }

  const expected = fromBase64url(record.hash);
  const actual = await scrypt(String(password || ""), fromBase64url(record.salt), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export { hashPassword, verifyPassword };
