import crypto from "node:crypto";

const OPAQUE_INVITE_TOKEN_HASH_PREFIX = "inviteh_";

function normalizeInviteToken(token) {
  return String(token || "").trim();
}

function isSha256Hex(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || "").trim());
}

function buildInviteToken() {
  return crypto.randomBytes(24).toString("hex");
}

function hashInviteToken(token) {
  return crypto.createHash("sha256").update(normalizeInviteToken(token)).digest("hex");
}

function encodeInviteTokenHash(tokenHash) {
  const normalizedTokenHash = String(tokenHash || "")
    .trim()
    .toLowerCase();
  if (!isSha256Hex(normalizedTokenHash)) {
    return "";
  }

  return `${OPAQUE_INVITE_TOKEN_HASH_PREFIX}${normalizedTokenHash}`;
}

function resolveInviteTokenHash(inviteToken) {
  const normalizedToken = normalizeInviteToken(inviteToken);
  if (!normalizedToken) {
    return "";
  }

  if (normalizedToken.startsWith(OPAQUE_INVITE_TOKEN_HASH_PREFIX)) {
    const tokenHash = normalizedToken.slice(OPAQUE_INVITE_TOKEN_HASH_PREFIX.length).trim().toLowerCase();
    return isSha256Hex(tokenHash) ? tokenHash : "";
  }

  return hashInviteToken(normalizedToken);
}

export {
  OPAQUE_INVITE_TOKEN_HASH_PREFIX,
  normalizeInviteToken,
  isSha256Hex,
  buildInviteToken,
  hashInviteToken,
  encodeInviteTokenHash,
  resolveInviteTokenHash
};
