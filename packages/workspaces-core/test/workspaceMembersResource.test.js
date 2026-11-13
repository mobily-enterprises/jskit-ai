import test from "node:test";
import assert from "node:assert/strict";
import { resolveSchemaTransportSchemaDefinition, validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { workspaceInviteAssistantOutput } from "../src/shared/resources/workspaceAssistantOutputs.js";
import { workspaceMembersContract } from "../src/shared/resources/workspaceMembersResource.js";
import { createWorkspaceRoleCatalog } from "../src/shared/roles.js";

function resolveOutputSchema(operationName) {
  return resolveSchemaTransportSchemaDefinition(workspaceMembersContract.operations[operationName].output, {
    context: `workspaceMembers.${operationName}.output`,
    defaultMode: "replace"
  });
}

test("workspace members role catalog output is explicit and nested", () => {
  const outputSchema = resolveOutputSchema("rolesList");
  const roleItemRef = outputSchema.properties.roles.items.allOf[0].$ref.replace(/^#\/definitions\//, "");
  const roleItemSchema = outputSchema.definitions[roleItemRef];

  assert.equal(outputSchema.type, "object");
  assert.equal(outputSchema.additionalProperties, false);
  assert.equal(outputSchema.properties.roles.type, "array");
  assert.equal(outputSchema.properties.roles.items["x-json-rest-schema"]?.castType, "object");
  assert.equal(roleItemSchema.type, "object");
  assert.equal(roleItemSchema.properties.permissions.type, "array");
});

test("workspace members invite mutation outputs expose their tracking ids explicitly", () => {
  const createOutputSchema = resolveOutputSchema("createInvite");
  const revokeOutputSchema = resolveOutputSchema("revokeInvite");

  assert.equal(createOutputSchema.properties.createdInviteId.type, "string");
  assert.equal(createOutputSchema.properties.inviteTokenPreview.type, "string");
  assert.equal(createOutputSchema.properties.inviteUrl.type, "string");
  const inviteDeliverySchemaName = createOutputSchema.properties.inviteDelivery.allOf[0].$ref.replace(/^#\/definitions\//, "");
  const inviteDeliverySchema = createOutputSchema.definitions[inviteDeliverySchemaName];
  assert.deepEqual(inviteDeliverySchema.required, ["status", "message", "providerMessageId"]);
  // Any status the invite mailer answers, not only the ones the members panel words itself.
  assert.deepEqual(
    [inviteDeliverySchema.properties.status.type, inviteDeliverySchema.properties.status.minLength, inviteDeliverySchema.properties.status.enum],
    ["string", 1, undefined]
  );
  assert.equal(revokeOutputSchema.properties.revokedInviteId.type, "string");
  assert.equal(revokeOutputSchema.properties.roleCatalog["x-json-rest-schema"]?.castType, "object");
  assert.equal(Array.isArray(revokeOutputSchema.properties.roleCatalog.allOf), true);
});

// Before, both outputs allowed only sent, simulated, failed and mailer_unconfigured: an invitation the assistant made
// whose mailer answered `held` (or a status of its own) was saved and then failed, "Assistant tool output validation
// failed.", and the API's contract did not describe the status it sent.
test("an invitation's response carries any delivery status its mailer answers, with the mailer's message", () => {
  const created = (inviteDelivery) => validateSchemaPayload(workspaceMembersContract.operations.createInvite.output, {
    workspace: { id: "7", slug: "acme", name: "Acme", ownerUserId: "9", avatarUrl: "" },
    invites: [],
    roleCatalog: createWorkspaceRoleCatalog({}),
    inviteTokenPreview: "token",
    inviteUrl: "/invite/token",
    inviteDelivery: { message: "", providerMessageId: "", ...inviteDelivery },
    createdInviteId: "88"
  }, { phase: "output" });
  const told = (deliveryStatus) => validateSchemaPayload(workspaceInviteAssistantOutput, {
    createdInviteId: "88",
    invites: [],
    deliveryStatus
  }, { phase: "output" });

  for (const status of ["sent", "held", "queued"]) {
    assert.equal(created({ status }).inviteDelivery.status, status);
    assert.equal(told(status).deliveryStatus, status);
  }
  assert.equal(created({ status: "queued", message: "Invite queued: it goes out within the hour." }).inviteDelivery.message,
    "Invite queued: it goes out within the hour.");
  assert.throws(() => created({ status: "" }), /Schema validation failed\./u);
  assert.throws(() => told(""), /Schema validation failed\./u);
});
