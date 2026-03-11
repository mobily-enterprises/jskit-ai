import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { workspaceResource } from "../src/shared/resources/workspaceResource.js";
import { workspaceSettingsResource } from "../src/shared/schemas/resources/workspaceSettingsResource.js";
import { workspaceMemberResource } from "../src/shared/resources/workspaceMemberResource.js";
import { workspaceInviteResource } from "../src/shared/resources/workspaceInviteResource.js";
import { userProfileResource } from "../src/shared/resources/userProfileResource.js";
import { userSettingsResource } from "../src/shared/resources/userSettingsResource.js";
import { consoleSettingsResource } from "../src/shared/resources/consoleSettingsResource.js";

function assertResourceOperationMessages(contract, operationName, label) {
  const operation = contract?.operations?.[operationName];
  assert.equal(typeof operation, "object", `${label}.operations.${operationName} must exist.`);

  const operationMessages = operation?.messages;
  const resourceMessages = contract?.messages || contract?.operationMessages;
  const resolvedMessages =
    operationMessages && typeof operationMessages === "object"
      ? operationMessages
      : resourceMessages;

  assert.equal(
    typeof resolvedMessages,
    "object",
    `${label}.operations.${operationName} must resolve operation messages from operation.messages or contract.messages.`
  );
}

test("users-core resource contracts expose messages for all operations", () => {
  const resources = {
    workspace: workspaceResource,
    workspaceSettings: workspaceSettingsResource,
    workspaceMember: workspaceMemberResource,
    workspaceInvite: workspaceInviteResource,
    userProfile: userProfileResource,
    userSettings: userSettingsResource,
    consoleSettings: consoleSettingsResource
  };

  for (const [label, contract] of Object.entries(resources)) {
    for (const operationName of ["view", "list", "create", "replace", "patch"]) {
      assertResourceOperationMessages(contract, operationName, label);
    }
  }
});

test("users-core specialized resource operations expose messages and validators", () => {
  const operationSpecs = [
    { label: "workspaceInvite.redeem", operation: workspaceInviteResource.operations.redeem },
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
    assert.equal(typeof operation?.output?.schema, "object", `${label}.output.schema must exist.`);
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

test("users-core no longer contains legacy shared/schema directory", () => {
  const testFilePath = fileURLToPath(import.meta.url);
  const packageRoot = path.resolve(path.dirname(testFilePath), "..");
  const legacySchemaDir = path.join(packageRoot, "src", "shared", "schema");
  assert.equal(existsSync(legacySchemaDir), false, "src/shared/schema must not exist.");
});
