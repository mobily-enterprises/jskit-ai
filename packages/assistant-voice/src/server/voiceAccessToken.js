import crypto from "node:crypto";

const VOICE_ACCESS_TOKEN_VERSION = "v1";
const VOICE_TENANT_PATTERN = /^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

function voiceTenant(value = "") {
  const tenant = String(value || "").trim().toLowerCase();
  if (!VOICE_TENANT_PATTERN.test(tenant)) {
    const error = new Error("Voice access requires a valid tenant name.");
    error.code = "voice_tenant_invalid";
    throw error;
  }
  return tenant;
}

function voiceAccessKey(value = "") {
  const key = Buffer.isBuffer(value) ? value : Buffer.from(String(value || ""), "utf8");
  if (key.byteLength < 32) {
    const error = new Error("Voice access signing keys must contain at least 32 bytes.");
    error.code = "voice_access_key_invalid";
    throw error;
  }
  return key;
}

function voiceAccessSignature(key, tenant) {
  return crypto
    .createHmac("sha256", voiceAccessKey(key))
    .update(`${VOICE_ACCESS_TOKEN_VERSION}.${voiceTenant(tenant)}`, "utf8")
    .digest("base64url");
}

function createVoiceAccessToken({ key, tenant } = {}) {
  const normalizedTenant = voiceTenant(tenant);
  return [
    VOICE_ACCESS_TOKEN_VERSION,
    normalizedTenant,
    voiceAccessSignature(key, normalizedTenant)
  ].join(".");
}

function verifyVoiceAccessToken(token = "", { key } = {}) {
  const [version = "", rawTenant = "", signature = "", ...extra] = String(token || "").trim().split(".");
  if (version !== VOICE_ACCESS_TOKEN_VERSION || !rawTenant || !signature || extra.length) {
    return null;
  }
  let tenant;
  let expected;
  try {
    tenant = voiceTenant(rawTenant);
    expected = voiceAccessSignature(key, tenant);
  } catch {
    return null;
  }
  const actualBytes = Buffer.from(signature, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (
    actualBytes.byteLength !== expectedBytes.byteLength ||
    !crypto.timingSafeEqual(actualBytes, expectedBytes)
  ) {
    return null;
  }
  return Object.freeze({ tenant, version });
}

function bearerVoiceAccessToken(headers = {}) {
  const value = String(headers.authorization || headers.Authorization || "").trim();
  const match = /^Bearer\s+([^\s]+)$/iu.exec(value);
  return match ? match[1] : "";
}

export {
  VOICE_ACCESS_TOKEN_VERSION,
  bearerVoiceAccessToken,
  createVoiceAccessToken,
  verifyVoiceAccessToken,
  voiceAccessKey,
  voiceTenant
};
