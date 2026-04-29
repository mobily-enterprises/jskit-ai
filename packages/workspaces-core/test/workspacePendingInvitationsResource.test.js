import test from "node:test";
import assert from "node:assert/strict";
import { resolveStructuredSchemaTransportSchema } from "@jskit-ai/kernel/shared/validators";
import { workspacePendingInvitationsResource } from "../src/shared/resources/workspacePendingInvitationsResource.js";

test("workspacePendingInvitationsResource output schema accepts already-shaped invite payloads", () => {
  const outputSchema = resolveStructuredSchemaTransportSchema(workspacePendingInvitationsResource.operations.list.output, {
    context: "workspacePendingInvitations.list.output",
    defaultMode: "replace"
  });
  const result = {
    pendingInvites: [
      {
        id: "10",
        workspaceId: "3",
        workspaceSlug: "tonymobily3",
        workspaceName: "TonyMobily3",
        workspaceAvatarUrl: "",
        roleSid: "member",
        status: "pending",
        expiresAt: "2030-01-01T00:00:00.000Z",
        token: "opaque-token"
      }
    ]
  };

  assert.equal(outputSchema.type, "object");
  assert.equal(outputSchema.additionalProperties, false);
  assert.equal(outputSchema.properties.pendingInvites.type, "array");
  assert.equal(outputSchema.properties.pendingInvites.items.type, "object");
  assert.equal(result.pendingInvites[0].roleSid, "member");
});
