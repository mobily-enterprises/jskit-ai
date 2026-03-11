import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { workspaceResource } from "../src/shared/contracts/resources/workspaceResource.js";
import { workspaceSettingsResource } from "../src/shared/schemas/resources/workspaceSettingsResource.js";
import { workspaceMemberResource } from "../src/shared/contracts/resources/workspaceMemberResource.js";
import { workspaceInviteResource } from "../src/shared/contracts/resources/workspaceInviteResource.js";
import { userProfileResource } from "../src/shared/contracts/resources/userProfileResource.js";
import { userSettingsResource } from "../src/shared/contracts/resources/userSettingsResource.js";
import { consoleSettingsResource } from "../src/shared/contracts/resources/consoleSettingsResource.js";
import { workspaceInviteRedeemCommandResource } from "../src/shared/contracts/commands/workspaceInviteRedeemCommandResource.js";
import { settingsPasswordChangeCommand } from "../src/shared/contracts/commands/settingsPasswordChangeCommand.js";
import { settingsPasswordMethodToggleCommand } from "../src/shared/contracts/commands/settingsPasswordMethodToggleCommand.js";
import { settingsOAuthLinkStartCommand } from "../src/shared/contracts/commands/settingsOAuthLinkStartCommand.js";
import { settingsOAuthUnlinkCommand } from "../src/shared/contracts/commands/settingsOAuthUnlinkCommand.js";
import { settingsLogoutOtherSessionsCommand } from "../src/shared/contracts/commands/settingsLogoutOtherSessionsCommand.js";
import { settingsAvatarUploadCommand } from "../src/shared/contracts/commands/settingsAvatarUploadCommand.js";
import { settingsAvatarDeleteCommand } from "../src/shared/contracts/commands/settingsAvatarDeleteCommand.js";

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
