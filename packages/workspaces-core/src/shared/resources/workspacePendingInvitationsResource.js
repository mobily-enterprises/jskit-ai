import { RECORD_ID_PATTERN } from "@jskit-ai/kernel/shared/validators";
import { createSchema } from "json-rest-schema";
import { defineResource } from "@jskit-ai/resource-core/shared/resource";
import { createOperationMessages } from "../operationMessages.js";

const invitationTokenQuerySchema = createSchema({
  token: {
    type: "string",
    required: true,
    minLength: 1,
    messages: {
      required: "Invite token is required.",
      minLength: "Invite token is required.",
      default: "Invite token is invalid."
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
      status: { type: "string", required: true, minLength: 1, maxLength: 64 },
      expiresAt: { type: "string", required: false, nullable: true, minLength: 1 },
      token: { type: "string", required: true, minLength: 1 }
    })
  }
});

const workspacePendingInvitationsResource = defineResource({
  namespace: "workspacePendingInvitations",
  messages: createOperationMessages(),
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
