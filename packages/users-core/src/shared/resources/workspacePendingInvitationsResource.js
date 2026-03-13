import { Type } from "@fastify/type-provider-typebox";
import { encodeInviteTokenHash } from "@jskit-ai/auth-core/server/inviteTokens";
import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import { createOperationMessages } from "../operationMessages.js";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/validators/inputNormalization";

function normalizePendingInvite(invite) {
  const id = Number(invite?.id);
  const workspaceId = Number(invite?.workspaceId);
  const tokenHash = normalizeText(invite?.tokenHash);

  if (!Number.isInteger(id) || id < 1) {
    return null;
  }
  if (!Number.isInteger(workspaceId) || workspaceId < 1) {
    return null;
  }
  if (!tokenHash) {
    return null;
  }

  return {
    id,
    workspaceId,
    workspaceSlug: normalizeText(invite?.workspaceSlug),
    workspaceName: normalizeText(invite?.workspaceName || invite?.workspaceSlug),
    workspaceAvatarUrl: normalizeText(invite?.workspaceAvatarUrl),
    roleId: normalizeLowerText(invite?.roleId || "member") || "member",
    status: normalizeLowerText(invite?.status || "pending") || "pending",
    expiresAt: invite?.expiresAt || null,
    token: encodeInviteTokenHash(tokenHash)
  };
}

function normalizePendingInviteList(invites) {
  return (Array.isArray(invites) ? invites : []).map((invite) => normalizePendingInvite(invite)).filter(Boolean);
}

const pendingInviteRecordValidator = Object.freeze({
  schema: Type.Object(
    {
      id: Type.Integer({ minimum: 1 }),
      workspaceId: Type.Integer({ minimum: 1 }),
      workspaceSlug: Type.String({ minLength: 1 }),
      workspaceName: Type.String({ minLength: 1 }),
      workspaceAvatarUrl: Type.String(),
      roleId: Type.String({ minLength: 1 }),
      status: Type.String({ minLength: 1 }),
      expiresAt: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
      token: Type.String({ minLength: 1 })
    },
    { additionalProperties: false }
  ),
  normalize: normalizePendingInvite
});

const pendingInvitationsListOutputValidator = Object.freeze({
  schema: Type.Object(
    {
      pendingInvites: Type.Array(pendingInviteRecordValidator.schema)
    },
    { additionalProperties: false }
  ),
  normalize(payload = {}) {
    const source = normalizeObjectInput(payload);

    return {
      pendingInvites: normalizePendingInviteList(source.pendingInvites)
    };
  }
});

const WORKSPACE_PENDING_INVITATIONS_MESSAGES = createOperationMessages();

const workspacePendingInvitationsResource = Object.freeze({
  resource: "workspacePendingInvitations",
  messages: WORKSPACE_PENDING_INVITATIONS_MESSAGES,
  operations: Object.freeze({
    list: Object.freeze({
      method: "GET",
      messages: WORKSPACE_PENDING_INVITATIONS_MESSAGES,
      outputValidator: pendingInvitationsListOutputValidator
    })
  })
});

export { workspacePendingInvitationsResource };
