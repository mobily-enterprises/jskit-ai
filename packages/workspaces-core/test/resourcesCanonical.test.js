import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveStructuredSchemaTransportSchema } from "@jskit-ai/kernel/shared/validators";
import { workspaceMembersResource } from "../src/shared/resources/workspaceMembersResource.js";
import { workspaceResource } from "../src/shared/resources/workspaceResource.js";
import { workspaceSettingsResource } from "../src/shared/resources/workspaceSettingsResource.js";

function assertResourceOperationMessages(resource, operationName, label) {
  const operation = resource?.operations?.[operationName];
  assert.equal(typeof operation, "object", `${label}.operations.${operationName} must exist.`);

  const operationMessages = operation?.messages;
  const resourceMessages = resource?.messages || resource?.operationMessages;
  const resolvedMessages =
    operationMessages && typeof operationMessages === "object"
      ? operationMessages
      : resourceMessages;

  assert.equal(
    typeof resolvedMessages,
    "object",
    `${label}.operations.${operationName} must resolve operation messages from operation.messages or resource.messages.`
  );
}

test("workspaces-core resources expose messages for all operations", () => {
  const resources = {
    workspace: workspaceResource,
    workspaceSettings: workspaceSettingsResource
  };

  for (const [label, resource] of Object.entries(resources)) {
    for (const operationName of ["view", "list", "create", "replace", "patch"]) {
      assertResourceOperationMessages(resource, operationName, label);
    }
  }
});

test("workspaces-core specialized resource operations expose messages and validators", () => {
  const operationSpecs = [
    { label: "workspaceMembers.rolesList", operation: workspaceMembersResource.operations.rolesList },
    { label: "workspaceMembers.membersList", operation: workspaceMembersResource.operations.membersList },
    { label: "workspaceMembers.updateMemberRole", operation: workspaceMembersResource.operations.updateMemberRole },
    { label: "workspaceMembers.removeMember", operation: workspaceMembersResource.operations.removeMember },
    { label: "workspaceMembers.invitesList", operation: workspaceMembersResource.operations.invitesList },
    { label: "workspaceMembers.createInvite", operation: workspaceMembersResource.operations.createInvite },
    { label: "workspaceMembers.revokeInvite", operation: workspaceMembersResource.operations.revokeInvite },
    { label: "workspaceMembers.redeemInvite", operation: workspaceMembersResource.operations.redeemInvite }
  ];

  for (const { label, operation } of operationSpecs) {
    assert.equal(typeof operation?.messages, "object", `${label}.messages must be an object.`);
    assert.equal(
      typeof resolveStructuredSchemaTransportSchema(operation?.output, {
        context: `${label}.output`,
        defaultMode: "replace"
      }),
      "object",
      `${label}.output transport schema must exist.`
    );
    if (operation?.body) {
      assert.equal(typeof operation.body.schema, "object", `${label}.body.schema must exist.`);
    }
    if (operation?.params) {
      assert.equal(typeof operation.params.schema, "object", `${label}.params.schema must exist.`);
    }
    if (operation?.query) {
      assert.equal(typeof operation.query.schema, "object", `${label}.query.schema must exist.`);
    }
  }
});

test("workspaces-core no longer contains legacy shared/schema directory", () => {
  const testFilePath = fileURLToPath(import.meta.url);
  const packageRoot = path.resolve(path.dirname(testFilePath), "..");
  const legacySchemaDir = path.join(packageRoot, "src", "shared", "schema");
  assert.equal(existsSync(legacySchemaDir), false, "src/shared/schema must not exist.");
});
