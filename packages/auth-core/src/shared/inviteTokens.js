const OPAQUE_INVITE_TOKEN_HASH_PREFIX = "inviteh_";

function normalizeInviteToken(token) {
  return String(token || "").trim();
}

function isSha256Hex(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || "").trim());
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

function decodeInviteTokenHash(inviteToken) {
  const normalizedToken = normalizeInviteToken(inviteToken);
  if (!normalizedToken.startsWith(OPAQUE_INVITE_TOKEN_HASH_PREFIX)) {
    return "";
  }

  const tokenHash = normalizedToken.slice(OPAQUE_INVITE_TOKEN_HASH_PREFIX.length).trim().toLowerCase();
  return isSha256Hex(tokenHash) ? tokenHash : "";
}

export {
  OPAQUE_INVITE_TOKEN_HASH_PREFIX,
  normalizeInviteToken,
  isSha256Hex,
  encodeInviteTokenHash,
  decodeInviteTokenHash
};
