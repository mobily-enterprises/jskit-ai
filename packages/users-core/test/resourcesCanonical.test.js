import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import "../test-support/registerDefaultSettingsFields.js";
import { workspaceMembersResource } from "../src/shared/resources/workspaceMembersResource.js";
import { workspaceResource } from "../src/shared/resources/workspaceResource.js";
import { workspaceSettingsResource } from "../src/shared/resources/workspaceSettingsResource.js";
import { userProfileResource } from "../src/shared/resources/userProfileResource.js";
import { userSettingsResource } from "../src/shared/resources/userSettingsResource.js";
import { consoleSettingsResource } from "../src/shared/resources/consoleSettingsResource.js";

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

test("users-core resources expose messages for all operations", () => {
  const resources = {
    workspace: workspaceResource,
    workspaceSettings: workspaceSettingsResource,
    userProfile: userProfileResource,
    userSettings: userSettingsResource,
    consoleSettings: consoleSettingsResource
  };

  for (const [label, resource] of Object.entries(resources)) {
    for (const operationName of ["view", "list", "create", "replace", "patch"]) {
      assertResourceOperationMessages(resource, operationName, label);
    }
  }
});

test("users-core specialized resource operations expose messages and validators", () => {
  const workspaceMembersOperationSpecs = [
    { label: "workspaceMembers.rolesList", operation: workspaceMembersResource.operations.rolesList },
    { label: "workspaceMembers.membersList", operation: workspaceMembersResource.operations.membersList },
    { label: "workspaceMembers.updateMemberRole", operation: workspaceMembersResource.operations.updateMemberRole },
    { label: "workspaceMembers.removeMember", operation: workspaceMembersResource.operations.removeMember },
    { label: "workspaceMembers.invitesList", operation: workspaceMembersResource.operations.invitesList },
    { label: "workspaceMembers.createInvite", operation: workspaceMembersResource.operations.createInvite },
    { label: "workspaceMembers.revokeInvite", operation: workspaceMembersResource.operations.revokeInvite },
    { label: "workspaceMembers.redeemInvite", operation: workspaceMembersResource.operations.redeemInvite }
  ];
  const operationSpecs = [
    ...workspaceMembersOperationSpecs,
    { label: "userProfile.avatarUpload", operation: userProfileResource.operations.avatarUpload },
    { label: "userProfile.avatarDelete", operation: userProfileResource.operations.avatarDelete },
    { label: "userSettings.passwordChange", operation: userSettingsResource.operations.passwordChange },
    { label: "userSettings.passwordMethodToggle", operation: userSettingsResource.operations.passwordMethodToggle },
    { label: "userSettings.oauthLinkStart", operation: userSettingsResource.operations.oauthLinkStart },
    { label: "userSettings.oauthUnlink", operation: userSettingsResource.operations.oauthUnlink },
    { label: "userSettings.logoutOtherSessions", operation: userSettingsResource.operations.logoutOtherSessions }
  ];

  for (const { label, operation } of operationSpecs) {
    assert.equal(typeof operation?.messages, "object", `${label}.messages must be an object.`);
    assert.equal(typeof operation?.outputValidator?.schema, "object", `${label}.outputValidator.schema must exist.`);
    if (operation?.bodyValidator) {
      assert.equal(typeof operation.bodyValidator.schema, "object", `${label}.bodyValidator.schema must exist.`);
    }
    if (operation?.paramsValidator) {
      assert.equal(typeof operation.paramsValidator.schema, "object", `${label}.paramsValidator.schema must exist.`);
    }
    if (operation?.queryValidator) {
      assert.equal(typeof operation.queryValidator.schema, "object", `${label}.queryValidator.schema must exist.`);
    }
  }
});

test("users-core no longer contains legacy shared/schema directory", () => {
  const testFilePath = fileURLToPath(import.meta.url);
  const packageRoot = path.resolve(path.dirname(testFilePath), "..");
  const legacySchemaDir = path.join(packageRoot, "src", "shared", "schema");
  assert.equal(existsSync(legacySchemaDir), false, "src/shared/schema must not exist.");
});
