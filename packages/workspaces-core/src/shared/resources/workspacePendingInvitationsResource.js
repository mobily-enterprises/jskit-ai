import { RECORD_ID_PATTERN } from "@jskit-ai/kernel/shared/validators";
import { createSchema } from "json-rest-schema";
import { defineResource } from "@jskit-ai/resource-core/shared/resource";
import { createOperationMessages } from "../operationMessages.js";

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
    list: {
      method: "GET",
      output: pendingInvitationsListOutputSchema
    }
  }
});

export { workspacePendingInvitationsResource };
