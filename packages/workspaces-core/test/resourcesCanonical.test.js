import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveStructuredSchemaTransportSchema } from "@jskit-ai/kernel/shared/validators";
import { workspaceMembersResource } from "../src/shared/resources/workspaceMembersResource.js";
import { workspaceInvitesResource } from "../src/shared/resources/workspaceInvitesResource.js";
import { workspaceMembershipsResource } from "../src/shared/resources/workspaceMembershipsResource.js";
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
    workspace: {
      resource: workspaceResource,
      operations: ["view", "list", "create", "replace", "patch"]
    },
    workspaceSettings: {
      resource: workspaceSettingsResource,
      operations: ["view", "list", "create", "replace", "patch"]
    },
    workspaceMemberships: {
      resource: workspaceMembershipsResource,
      operations: ["view", "list", "create", "patch"]
    },
    workspaceInvites: {
      resource: workspaceInvitesResource,
      operations: ["view", "list", "create", "patch"]
    }
  };

  for (const [label, spec] of Object.entries(resources)) {
    for (const operationName of spec.operations) {
      assertResourceOperationMessages(spec.resource, operationName, label);
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

test("workspaces-core does not contain src/shared/schema", () => {
  const testFilePath = fileURLToPath(import.meta.url);
  const packageRoot = path.resolve(path.dirname(testFilePath), "..");
  const sharedSchemaDirPath = path.join(packageRoot, "src", "shared", "schema");
  assert.equal(existsSync(sharedSchemaDirPath), false, "src/shared/schema must not exist.");
});
