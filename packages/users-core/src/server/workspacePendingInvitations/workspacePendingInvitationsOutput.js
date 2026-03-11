import { encodeInviteTokenHash } from "@jskit-ai/auth-core/server/inviteTokens";
import {
  normalizeLowerText,
  normalizeText
} from "../workspace/workspaceSupport.js";

function mapPendingInvite(invite) {
  if (!invite || typeof invite !== "object") {
    return null;
  }

  const id = Number(invite.id);
  const workspaceId = Number(invite.workspaceId);
  const tokenHash = normalizeText(invite.tokenHash);
  if (!Number.isInteger(id) || id < 1 || !Number.isInteger(workspaceId) || workspaceId < 1 || !tokenHash) {
    return null;
  }

  const workspaceSlug = normalizeText(invite.workspaceSlug);
  const workspaceName = normalizeText(invite.workspaceName || invite.workspaceSlug);

  return {
    id,
    workspaceId,
    workspaceSlug,
    workspaceName,
    workspaceAvatarUrl: normalizeText(invite.workspaceAvatarUrl),
    roleId: normalizeLowerText(invite.roleId || "member") || "member",
    status: normalizeLowerText(invite.status || "pending") || "pending",
    expiresAt: invite.expiresAt || null,
    token: encodeInviteTokenHash(tokenHash)
  };
}

function mapPendingInvites(invites) {
  return (Array.isArray(invites) ? invites : []).map((invite) => mapPendingInvite(invite)).filter(Boolean);
}

export {
  mapPendingInvite,
  mapPendingInvites
};
