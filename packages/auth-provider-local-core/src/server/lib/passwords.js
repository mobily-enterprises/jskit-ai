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

function normalizePasswordStrategy(strategy = null) {
  if (strategy == null) {
    return Object.freeze({
      hashPassword,
      verifyPassword
    });
  }

  if (typeof strategy !== "object" || Array.isArray(strategy)) {
    throw new TypeError("Local auth password strategy must be an object.");
  }

  const strategyHashPassword = typeof strategy.hashPassword === "undefined"
    ? hashPassword
    : strategy.hashPassword;
  const strategyVerifyPassword = typeof strategy.verifyPassword === "undefined"
    ? verifyPassword
    : strategy.verifyPassword;

  if (typeof strategyHashPassword !== "function") {
    throw new TypeError("Local auth password strategy hashPassword must be a function.");
  }
  if (typeof strategyVerifyPassword !== "function") {
    throw new TypeError("Local auth password strategy verifyPassword must be a function.");
  }

  return Object.freeze({
    async hashPassword(password) {
      return strategyHashPassword.call(strategy, password);
    },
    async verifyPassword(password, record) {
      return strategyVerifyPassword.call(strategy, password, record);
    }
  });
}

export { hashPassword, verifyPassword, normalizePasswordStrategy };
