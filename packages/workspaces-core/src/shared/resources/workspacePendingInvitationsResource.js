import { createOperationMessages } from "../operationMessages.js";
import { RECORD_ID_PATTERN } from "@jskit-ai/kernel/shared/validators";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { createSchema } from "json-rest-schema";

const pendingInviteRecordSchema = createSchema({
  id: { type: "string", required: true, minLength: 1, pattern: RECORD_ID_PATTERN },
  workspaceId: { type: "string", required: true, minLength: 1, pattern: RECORD_ID_PATTERN },
  workspaceSlug: { type: "string", required: true, minLength: 1, maxLength: 120 },
  workspaceName: { type: "string", required: true, minLength: 1, maxLength: 160 },
  workspaceAvatarUrl: { type: "string", required: true },
  roleSid: { type: "string", required: true, minLength: 1, maxLength: 64 },
  status: { type: "string", required: true, minLength: 1, maxLength: 64 },
  expiresAt: { type: "string", required: false, nullable: true, minLength: 1 },
  token: { type: "string", required: true, minLength: 1 }
});

const pendingInvitationsListOutputDefinition = deepFreeze({
  pendingInvites: {
    schema: {
      type: "array",
      items: pendingInviteRecordSchema.toJsonSchema({ mode: "replace" })
    }
  }
});

const WORKSPACE_PENDING_INVITATIONS_MESSAGES = createOperationMessages();

const workspacePendingInvitationsResource = deepFreeze({
  namespace: "workspacePendingInvitations",
  messages: WORKSPACE_PENDING_INVITATIONS_MESSAGES,
  operations: {
    list: {
      method: "GET",
      messages: WORKSPACE_PENDING_INVITATIONS_MESSAGES,
      output: pendingInvitationsListOutputDefinition
    }
  }
});

export { workspacePendingInvitationsResource };
