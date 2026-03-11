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
import { workspaceInviteRedeemCommandResource } from "../src/shared/workspaceInviteRedeemCommandResource.js";
import { settingsPasswordChangeCommand } from "../src/shared/settingsPasswordChangeCommand.js";
import { settingsPasswordMethodToggleCommand } from "../src/shared/settingsPasswordMethodToggleCommand.js";
import { settingsOAuthLinkStartCommand } from "../src/shared/settingsOAuthLinkStartCommand.js";
import { settingsOAuthUnlinkCommand } from "../src/shared/settingsOAuthUnlinkCommand.js";
import { settingsLogoutOtherSessionsCommand } from "../src/shared/settingsLogoutOtherSessionsCommand.js";
import { settingsProfileUpdateCommand } from "../src/shared/settingsProfileUpdateCommand.js";
import { settingsAvatarUploadCommand } from "../src/shared/settingsAvatarUploadCommand.js";
import { settingsAvatarDeleteCommand } from "../src/shared/settingsAvatarDeleteCommand.js";

function assertOperationMessages(operation, label) {
  assert.equal(typeof operation?.messages, "object", `${label}.messages must be an object.`);
}

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

test("users-core command contracts expose operation messages", () => {
  const commands = {
    workspaceInviteRedeemCommandResource,
    settingsPasswordChangeCommand,
    settingsPasswordMethodToggleCommand,
    settingsOAuthLinkStartCommand,
    settingsOAuthUnlinkCommand,
    settingsLogoutOtherSessionsCommand,
    settingsProfileUpdateCommand,
    settingsAvatarUploadCommand,
    settingsAvatarDeleteCommand
  };

  for (const [label, contract] of Object.entries(commands)) {
    assertOperationMessages(contract.operation, `${label}.operation`);
    assert.equal(
      typeof (contract.operation?.output?.schema || contract.operation?.response?.schema),
      "object",
      `${label}.operation payload schema must exist.`
    );
  }
});

test("users-core no longer contains legacy shared/schema directory", () => {
  const testFilePath = fileURLToPath(import.meta.url);
  const packageRoot = path.resolve(path.dirname(testFilePath), "..");
  const legacySchemaDir = path.join(packageRoot, "src", "shared", "schema");
  assert.equal(existsSync(legacySchemaDir), false, "src/shared/schema must not exist.");
});
