import { createSchema } from "json-rest-schema";
import { createSchemaDefinition } from "@jskit-ai/resource-core/shared/resource";

// Deliberate assistant allowlists: HTTP invitation responses also contain credentials.
const workspaceInviteAssistantOutput = createSchemaDefinition(createSchema({
  createdInviteId: { type: "string", required: true, minLength: 1 },
  invites: {
    type: "array", required: true,
    items: createSchema({
      id: { type: "string", required: true },
      email: { type: "string", required: true },
      roleSid: { type: "string", required: true },
      status: { type: "string", required: true },
      expiresAt: { type: "string", required: true }
    })
  },
  deliveryStatus: { type: "string", required: true, enum: ["sent", "failed", "mailer_unconfigured"] }
}), "replace");

const pendingInvitationsAssistantOutput = createSchemaDefinition(createSchema({
  pendingInvites: {
    type: "array", required: true,
    items: createSchema({
      id: { type: "string", required: true },
      workspaceId: { type: "string", required: true },
      workspaceSlug: { type: "string", required: true },
      workspaceName: { type: "string", required: true },
      roleSid: { type: "string", required: true },
      status: { type: "string", required: true },
      expiresAt: { type: "string", required: false, nullable: true }
    })
  }
}), "replace");

export { workspaceInviteAssistantOutput, pendingInvitationsAssistantOutput };
