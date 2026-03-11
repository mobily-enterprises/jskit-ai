import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deriveResourceRequiredMetadata } from "@jskit-ai/kernel/shared/contracts/resourceRequiredMetadata";
import { workspaceRoutes as workspaceSchema } from "../src/server/common/routes/workspaceRoutes.js";
import { consoleSettingsResource } from "../src/shared/resources/consoleSettingsResource.js";
import { userProfileResource } from "../src/shared/resources/userProfileResource.js";
import { userSettingsResource } from "../src/shared/resources/userSettingsResource.js";
import { settingsPasswordChangeCommand } from "../src/shared/contracts/commands/settingsPasswordChangeCommand.js";
import { settingsPasswordMethodToggleCommand } from "../src/shared/contracts/commands/settingsPasswordMethodToggleCommand.js";
import { settingsOAuthLinkStartCommand } from "../src/shared/contracts/commands/settingsOAuthLinkStartCommand.js";
import { settingsOAuthUnlinkCommand } from "../src/shared/contracts/commands/settingsOAuthUnlinkCommand.js";
import { settingsLogoutOtherSessionsCommand } from "../src/shared/contracts/commands/settingsLogoutOtherSessionsCommand.js";
import { settingsAvatarUploadCommand } from "../src/shared/contracts/commands/settingsAvatarUploadCommand.js";
import { settingsAvatarDeleteCommand } from "../src/shared/contracts/commands/settingsAvatarDeleteCommand.js";

function assertResourceContract(contract, label) {
  assert.ok(contract, `${label} contract must exist.`);
  assert.equal(typeof contract, "object", `${label} contract must be an object.`);
  assert.equal(typeof contract.resource, "string", `${label}.resource must be a string.`);

  for (const operationName of ["view", "list", "create", "replace", "patch"]) {
    const operation = contract.operations?.[operationName];
    assert.equal(typeof operation, "object", `${label}.operations.${operationName} must exist.`);
    assert.equal(typeof operation.method, "string", `${label}.operations.${operationName}.method must exist.`);
    const resolvedMessages =
      operation?.messages && typeof operation.messages === "object"
        ? operation.messages
        : contract?.messages || contract?.operationMessages;
    assert.equal(
      typeof resolvedMessages,
      "object",
      `${label}.operations.${operationName} must resolve messages from operation.messages or contract.messages.`
    );
    assert.equal(
      typeof (operation.output?.schema || operation.response?.schema),
      "object",
      `${label}.operations.${operationName} payload schema is required.`
    );
  }

  assert.equal(typeof contract.operations.create.body?.schema, "object", `${label}.operations.create.body.schema is required.`);
  assert.equal(typeof contract.operations.replace.body?.schema, "object", `${label}.operations.replace.body.schema is required.`);
  assert.equal(typeof contract.operations.patch.body?.schema, "object", `${label}.operations.patch.body.schema is required.`);

  const requiredMetadata = deriveResourceRequiredMetadata(contract);
  assert.ok(Array.isArray(requiredMetadata.create), `${label}.derivedRequired.create must be an array.`);
  assert.ok(Array.isArray(requiredMetadata.replace), `${label}.derivedRequired.replace must be an array.`);
  assert.ok(Array.isArray(requiredMetadata.patch), `${label}.derivedRequired.patch must be an array.`);
}

function assertCommandContract(contract, label) {
  assert.ok(contract, `${label} contract must exist.`);
  assert.equal(typeof contract, "object", `${label} contract must be an object.`);
  assert.equal(contract.command, label, `${label}.command must match command id.`);
  assert.equal(typeof contract.operation?.method, "string", `${label}.operation.method must exist.`);
  assert.equal(typeof contract.operation?.messages, "object", `${label}.operation.messages must be an object.`);
  assert.equal(
    typeof (contract.operation?.output?.schema || contract.operation?.response?.schema),
    "object",
    `${label}.operation payload schema must exist.`
  );
  assert.ok(Array.isArray(contract.operation?.invalidates), `${label}.operation.invalidates must be an array.`);

  if (contract.operation?.body) {
    assert.equal(typeof contract.operation.body.schema, "object", `${label}.operation.body.schema must be an object.`);
  }
}

test("workspace/settings/console schemas expose canonical resource contracts", () => {
  const resourceContracts = {
    workspace: workspaceSchema.resources.workspace,
    workspaceSettings: workspaceSchema.resources.workspaceSettings,
    workspaceMember: workspaceSchema.resources.workspaceMember,
    workspaceInvite: workspaceSchema.resources.workspaceInvite,
    userProfile: userProfileResource,
    userSettings: userSettingsResource,
    consoleSettings: consoleSettingsResource
  };

  for (const [label, contract] of Object.entries(resourceContracts)) {
    assertResourceContract(contract, label);
  }
});

test("workspace/settings schemas expose canonical command contracts", () => {
  const commandContracts = {
    "workspace.invite.redeem": workspaceSchema.commands["workspace.invite.redeem"],
    "settings.security.password.change": settingsPasswordChangeCommand,
    "settings.security.password_method.toggle": settingsPasswordMethodToggleCommand,
    "settings.security.oauth.link.start": settingsOAuthLinkStartCommand,
    "settings.security.oauth.unlink": settingsOAuthUnlinkCommand,
    "settings.security.sessions.logout_others": settingsLogoutOtherSessionsCommand,
    "settings.profile.avatar.upload": settingsAvatarUploadCommand,
    "settings.profile.avatar.delete": settingsAvatarDeleteCommand
  };

  for (const [label, contract] of Object.entries(commandContracts)) {
    assertCommandContract(contract, label);
  }
});

test("route schema building blocks are wired directly from canonical contracts", () => {
  assert.equal(
    workspaceSchema.body.createInvite,
    workspaceSchema.resources.workspaceInvite.operations.create.body.schema
  );
  assert.equal(
    workspaceSchema.body.redeemInvite,
    workspaceSchema.commands["workspace.invite.redeem"].operation.body.schema
  );
  assert.equal(
    workspaceSchema.response.respondToInvite,
    workspaceSchema.commands["workspace.invite.redeem"].operation.output.schema
  );
  assert.equal(
    workspaceSchema.response.workspacesList,
    workspaceSchema.resources.workspace.operations.list.output.schema
  );
  assert.equal(
    workspaceSchema.response.members,
    workspaceSchema.resources.workspaceMember.operations.list.response.schema
  );
  assert.equal(
    workspaceSchema.response.invites,
    workspaceSchema.resources.workspaceInvite.operations.list.response.schema
  );

});

test("users-core route contracts no longer live under a legacy shared/schema directory", () => {
  const testFilePath = fileURLToPath(import.meta.url);
  const packageRoot = path.resolve(path.dirname(testFilePath), "..");
  const legacySchemaDir = path.join(packageRoot, "src", "shared", "schema");
  assert.equal(existsSync(legacySchemaDir), false, "src/shared/schema must not exist.");
});
