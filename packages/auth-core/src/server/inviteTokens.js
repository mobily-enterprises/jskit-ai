import crypto from "node:crypto";
import {
  OPAQUE_INVITE_TOKEN_HASH_PREFIX,
  normalizeInviteToken,
  isSha256Hex,
  encodeInviteTokenHash,
  decodeInviteTokenHash
} from "../shared/inviteTokens.js";

function buildInviteToken() {
  return crypto.randomBytes(24).toString("hex");
}

function hashInviteToken(token) {
  return crypto.createHash("sha256").update(normalizeInviteToken(token)).digest("hex");
}

function resolveInviteTokenHash(inviteToken) {
  const normalizedToken = normalizeInviteToken(inviteToken);
  if (!normalizedToken) {
    return "";
  }

  const decodedTokenHash = decodeInviteTokenHash(normalizedToken);
  if (decodedTokenHash) {
    return decodedTokenHash;
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
  decodeInviteTokenHash,
  resolveInviteTokenHash
};
