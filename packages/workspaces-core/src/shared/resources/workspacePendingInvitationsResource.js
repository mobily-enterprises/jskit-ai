import { RECORD_ID_PATTERN } from "@jskit-ai/kernel/shared/validators";
import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { defineResource } from "@jskit-ai/resource-core/shared/resource";
import { OPERATION_MESSAGES } from "../operationMessages.js";

// Each field message: its English and the code a client renders it from in the user's language.
const WORKSPACE_PENDING_INVITATIONS_FIELD_MESSAGES = deepFreeze({
  inviteTokenRequired: { code: "workspaces.invite.tokenRequired", message: "Invite token is required." },
  inviteTokenInvalid: { code: "workspaces.invite.tokenInvalid", message: "Invite token is invalid." }
});

const invitationTokenQuerySchema = createSchema({
  token: {
    type: "string",
    required: true,
    minLength: 1,
    messages: {
      required: WORKSPACE_PENDING_INVITATIONS_FIELD_MESSAGES.inviteTokenRequired,
      minLength: WORKSPACE_PENDING_INVITATIONS_FIELD_MESSAGES.inviteTokenRequired,
      default: WORKSPACE_PENDING_INVITATIONS_FIELD_MESSAGES.inviteTokenInvalid
    }
  }
});

const invitationWorkspaceSummarySchema = createSchema({
  id: { type: "string", required: true },
  slug: { type: "string", required: true },
  name: { type: "string", required: true },
  avatarUrl: { type: "string", required: true }
});

const invitationResolveOutputSchema = createSchema({
  id: { type: "string", required: true },
  token: { type: "string", required: true, minLength: 1 },
  status: {
    type: "string",
    required: true,
    enum: ["pending", "expired", "accepted", "revoked", "not_found"]
  },
  email: { type: "string", required: true },
  maskedEmail: { type: "string", required: true },
  roleSid: { type: "string", required: true },
  roleLabel: { type: "string", required: false },
  expiresAt: { type: "string", required: false, nullable: true, minLength: 1 },
  workspace: {
    type: "object",
    required: true,
    schema: invitationWorkspaceSummarySchema
  }
});

const pendingInvitationsListOutputSchema = createSchema({
  pendingInvites: {
    type: "array",
    required: true,
    items: createSchema({
      id: { type: "string", required: true, minLength: 1, pattern: RECORD_ID_PATTERN },
      workspaceId: { type: "string", required: true, minLength: 1, pattern: RECORD_ID_PATTERN },
      workspaceSlug: { type: "string", required: true, minLength: 1, maxLength: 120 },
      workspaceName: { type: "string", required: true, minLength: 1, maxLength: 160 },
      workspaceAvatarUrl: { type: "string", required: true },
      roleSid: { type: "string", required: true, minLength: 1, maxLength: 64 },
      roleLabel: { type: "string", required: false },
      status: { type: "string", required: true, minLength: 1, maxLength: 64 },
      expiresAt: { type: "string", required: false, nullable: true, minLength: 1 },
      token: { type: "string", required: true, minLength: 1 }
    })
  }
});

const workspacePendingInvitationsResource = defineResource({
  namespace: "workspacePendingInvitations",
  messages: OPERATION_MESSAGES,
  operations: {
    resolve: {
      method: "GET",
      query: invitationTokenQuerySchema,
      output: invitationResolveOutputSchema
    },
    list: {
      method: "GET",
      output: pendingInvitationsListOutputSchema
    }
  }
});

export { workspacePendingInvitationsResource };
