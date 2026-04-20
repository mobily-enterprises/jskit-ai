import { Type } from "@fastify/type-provider-typebox";
import { encodeInviteTokenHash } from "@jskit-ai/auth-core/shared/inviteTokens";
import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import { createOperationMessages } from "../operationMessages.js";
import { normalizeObjectInput, recordIdSchema } from "@jskit-ai/kernel/shared/validators";
import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";

function normalizePendingInvite(invite) {
  const id = normalizeRecordId(invite?.id, { fallback: null });
  const workspaceId = normalizeRecordId(invite?.workspaceId, { fallback: null });
  const tokenHash = normalizeText(invite?.tokenHash);

  if (!id || !workspaceId || !tokenHash) {
    return null;
  }

  return {
    id,
    workspaceId,
    workspaceSlug: normalizeText(invite?.workspaceSlug),
    workspaceName: normalizeText(invite?.workspaceName || invite?.workspaceSlug),
    workspaceAvatarUrl: normalizeText(invite?.workspaceAvatarUrl),
    roleSid: normalizeLowerText(invite?.roleSid || "member") || "member",
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
      id: recordIdSchema,
      workspaceId: recordIdSchema,
      workspaceSlug: Type.String({ minLength: 1 }),
      workspaceName: Type.String({ minLength: 1 }),
      workspaceAvatarUrl: Type.String(),
      roleSid: Type.String({ minLength: 1 }),
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
  namespace: "workspacePendingInvitations",
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
