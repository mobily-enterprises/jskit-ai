import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { workspaceSchema } from "../src/shared/contracts/resources/workspaceSchema.js";
import { workspaceSettingsSchema } from "../src/shared/schemas/resources/workspaceSettingsSchema.js";
import { workspaceMemberSchema } from "../src/shared/contracts/resources/workspaceMemberSchema.js";
import { workspaceInviteSchema } from "../src/shared/contracts/resources/workspaceInviteSchema.js";
import { userProfileSchema } from "../src/shared/contracts/resources/userProfileSchema.js";
import { userSettingsSchema } from "../src/shared/contracts/resources/userSettingsSchema.js";
import { consoleSettingsSchema } from "../src/shared/contracts/resources/consoleSettingsSchema.js";
import { workspaceInviteRedeemCommand } from "../src/shared/contracts/commands/workspaceInviteRedeemCommand.js";
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
  const resourceMessages = contract?.operationMessages;
  const resolvedMessages =
    operationMessages && typeof operationMessages === "object"
      ? operationMessages
      : resourceMessages;

  assert.equal(
    typeof resolvedMessages,
    "object",
    `${label}.operations.${operationName} must resolve operation messages from operation.messages or contract.operationMessages.`
  );
}

test("users-core resource contracts expose messages for all operations", () => {
  const resources = {
    workspace: workspaceSchema,
    workspaceSettings: workspaceSettingsSchema,
    workspaceMember: workspaceMemberSchema,
    workspaceInvite: workspaceInviteSchema,
    userProfile: userProfileSchema,
    userSettings: userSettingsSchema,
    consoleSettings: consoleSettingsSchema
  };

  for (const [label, contract] of Object.entries(resources)) {
    for (const operationName of ["view", "list", "create", "replace", "patch"]) {
      assertResourceOperationMessages(contract, operationName, label);
    }
  }
});

test("users-core command contracts expose operation messages", () => {
  const commands = {
    workspaceInviteRedeemCommand,
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
  }
});

test("users-core no longer contains legacy shared/schema directory", () => {
  const testFilePath = fileURLToPath(import.meta.url);
  const packageRoot = path.resolve(path.dirname(testFilePath), "..");
  const legacySchemaDir = path.join(packageRoot, "src", "shared", "schema");
  assert.equal(existsSync(legacySchemaDir), false, "src/shared/schema must not exist.");
});
