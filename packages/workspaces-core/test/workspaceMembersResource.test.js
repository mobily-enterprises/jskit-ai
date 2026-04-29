import test from "node:test";
import assert from "node:assert/strict";
import { resolveStructuredSchemaTransportSchema } from "@jskit-ai/kernel/shared/validators";
import { workspaceMembersResource } from "../src/shared/resources/workspaceMembersResource.js";

function resolveOutputSchema(operationName) {
  return resolveStructuredSchemaTransportSchema(workspaceMembersResource.operations[operationName].output, {
    context: `workspaceMembers.${operationName}.output`,
    defaultMode: "replace"
  });
}

test("workspace members role catalog output is explicit and nested", () => {
  const outputSchema = resolveOutputSchema("rolesList");

  assert.equal(outputSchema.type, "object");
  assert.equal(outputSchema.additionalProperties, false);
  assert.equal(outputSchema.properties.roles.type, "array");
  assert.equal(outputSchema.properties.roles.items.type, "object");
  assert.equal(outputSchema.properties.roles.items.properties.permissions.type, "array");
});

test("workspace members invite mutation outputs expose their tracking ids explicitly", () => {
  const createOutputSchema = resolveOutputSchema("createInvite");
  const revokeOutputSchema = resolveOutputSchema("revokeInvite");

  assert.equal(createOutputSchema.properties.createdInviteId.type, "string");
  assert.equal(createOutputSchema.properties.inviteTokenPreview.type, "string");
  assert.equal(revokeOutputSchema.properties.revokedInviteId.type, "string");
  assert.equal(revokeOutputSchema.properties.roleCatalog.type, "object");
});
