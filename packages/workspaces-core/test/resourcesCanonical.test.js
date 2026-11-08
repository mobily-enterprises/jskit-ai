import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveSchemaTransportSchemaDefinition } from "@jskit-ai/kernel/shared/validators";
import { workspaceMembersContract } from "../src/shared/resources/workspaceMembersResource.js";
import { workspacePendingInvitationsContract } from "../src/shared/resources/workspacePendingInvitationsResource.js";
import { workspaceInvitesResource } from "../src/shared/resources/workspaceInvitesResource.js";
import { workspaceMembershipsResource } from "../src/shared/resources/workspaceMembershipsResource.js";
import { workspaceCrud, workspaceResource } from "../src/shared/resources/workspaceResource.js";
import { workspaceSettingsCrud, workspaceSettingsResource } from "../src/shared/resources/workspaceSettingsResource.js";

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

test("workspaces-core CRUD contracts expose messages for all operations", () => {
  const contracts = {
    workspace: workspaceCrud,
    workspaceSettings: workspaceSettingsCrud
  };

  for (const [label, contract] of Object.entries(contracts)) {
    assert.deepEqual(Object.keys(contract.operations), ["view", "list", "create", "replace", "patch"]);
    for (const operationName of Object.keys(contract.operations)) {
      assertResourceOperationMessages(contract, operationName, label);
    }
  }
});

test("each workspaces-core table is one table resource, and only workspaces and their settings have an HTTP surface", () => {
  const tables = [workspaceResource, workspaceSettingsResource, workspaceMembershipsResource, workspaceInvitesResource];
  assert.deepEqual(tables.map((resource) => [resource.name, resource.tableName]), [
    ["workspaces", "workspaces"],
    ["workspaceSettings", "workspace_settings"],
    ["workspaceMemberships", "workspace_memberships"],
    ["workspaceInvites", "workspace_invites"]
  ]);
  for (const resource of tables) {
    assert.equal(Object.hasOwn(resource, "operations"), false, `${resource.name} keeps its HTTP surface apart.`);
  }
  assert.equal(workspaceCrud.resource, workspaceResource);
  assert.equal(workspaceSettingsCrud.resource, workspaceSettingsResource);
});

// Their id filter is every handle's own, which takes one id or a list.
test("workspaces-core repository filters are declared on canonical resources", () => {
  assert.deepEqual(Object.keys(workspaceResource.searchSchema), ["slug", "slugs", "owner", "isPersonal"]);
  assert.equal(workspaceResource.searchSchema.slug.actualField, "slug");
  assert.equal(workspaceResource.searchSchema.slugs.actualField, "slug");
  assert.equal(workspaceResource.searchSchema.slugs.filterOperator, "in");
  assert.equal(workspaceResource.searchSchema.owner.actualField, "owner_user_id");

  assert.deepEqual(Object.keys(workspaceMembershipsResource.searchSchema), ["workspace", "user", "users", "status"]);
  assert.equal(workspaceMembershipsResource.searchSchema.workspace.actualField, "workspace_id");
  assert.equal(workspaceMembershipsResource.searchSchema.user.actualField, "user_id");
  assert.equal(workspaceMembershipsResource.searchSchema.users.actualField, "user_id");
  assert.equal(workspaceMembershipsResource.searchSchema.users.filterOperator, "in");

  assert.deepEqual(Object.keys(workspaceInvitesResource.searchSchema), ["workspace", "email", "status", "tokenHash"]);
  assert.equal(workspaceInvitesResource.searchSchema.workspace.actualField, "workspace_id");
  assert.equal(workspaceInvitesResource.searchSchema.tokenHash.actualField, "token_hash");
});

test("workspaces-core specialized resource operations expose messages and validators", () => {
  const operationSpecs = [
    { label: "workspaceMembers.rolesList", operation: workspaceMembersContract.operations.rolesList },
    { label: "workspaceMembers.membersList", operation: workspaceMembersContract.operations.membersList },
    { label: "workspaceMembers.updateMemberRole", operation: workspaceMembersContract.operations.updateMemberRole },
    { label: "workspaceMembers.removeMember", operation: workspaceMembersContract.operations.removeMember },
    { label: "workspaceMembers.invitesList", operation: workspaceMembersContract.operations.invitesList },
    { label: "workspaceMembers.createInvite", operation: workspaceMembersContract.operations.createInvite },
    { label: "workspaceMembers.revokeInvite", operation: workspaceMembersContract.operations.revokeInvite },
    { label: "workspaceMembers.redeemInvite", operation: workspaceMembersContract.operations.redeemInvite },
    { label: "workspacePendingInvitations.resolve", operation: workspacePendingInvitationsContract.operations.resolve },
    { label: "workspacePendingInvitations.list", operation: workspacePendingInvitationsContract.operations.list }
  ];

  for (const { label, operation } of operationSpecs) {
    assert.equal(typeof operation?.messages, "object", `${label}.messages must be an object.`);
    assert.equal(
      typeof resolveSchemaTransportSchemaDefinition(operation?.output, {
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
