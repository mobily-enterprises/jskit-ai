import assert from "node:assert/strict";
import test from "node:test";
import { schema as workspaceSchema } from "../src/shared/schema/workspaceSchema.js";
import { schema as settingsSchema } from "../src/shared/schema/settingsSchema.js";
import { schema as consoleSettingsSchema } from "../src/shared/schema/consoleSettingsSchema.js";

function assertResourceContract(contract, label) {
  assert.ok(contract, `${label} contract must exist.`);
  assert.equal(typeof contract, "object", `${label} contract must be an object.`);
  assert.equal(typeof contract.record, "object", `${label}.record must be a schema object.`);
  assert.equal(typeof contract.create, "object", `${label}.create must be a schema object.`);
  assert.equal(typeof contract.replace, "object", `${label}.replace must be a schema object.`);
  assert.equal(typeof contract.patch, "object", `${label}.patch must be a schema object.`);
  assert.equal(typeof contract.listItem, "object", `${label}.listItem must be a schema object.`);
  assert.equal(typeof contract.list, "object", `${label}.list must be a schema object.`);
  assert.ok(Array.isArray(contract.required?.create), `${label}.required.create must be an array.`);
  assert.ok(Array.isArray(contract.required?.replace), `${label}.required.replace must be an array.`);
  assert.ok(Array.isArray(contract.required?.patch), `${label}.required.patch must be an array.`);
}

function assertCommandContract(contract, label) {
  assert.ok(contract, `${label} contract must exist.`);
  assert.equal(typeof contract, "object", `${label} contract must be an object.`);
  assert.equal(typeof contract.input, "object", `${label}.input must be a schema object.`);
  assert.equal(typeof contract.output, "object", `${label}.output must be a schema object.`);
  assert.ok(Array.isArray(contract.invalidates), `${label}.invalidates must be an array.`);
  if (Object.hasOwn(contract, "idempotent")) {
    assert.equal(typeof contract.idempotent, "boolean", `${label}.idempotent must be boolean when provided.`);
  }
}

test("workspace/settings/console schemas expose all required stage-2 resource contracts", () => {
  const resourceContracts = {
    workspace: workspaceSchema.resourceContracts.workspace,
    workspaceSettings: workspaceSchema.resourceContracts.workspaceSettings,
    workspaceMember: workspaceSchema.resourceContracts.workspaceMember,
    workspaceInvite: workspaceSchema.resourceContracts.workspaceInvite,
    userProfile: settingsSchema.resourceContracts.userProfile,
    userSettings: settingsSchema.resourceContracts.userSettings,
    consoleSettings: consoleSettingsSchema.resourceContracts.consoleSettings
  };

  for (const [label, contract] of Object.entries(resourceContracts)) {
    assertResourceContract(contract, label);
  }
});

test("workspace/settings schemas expose all required stage-2 command contracts", () => {
  const commandContracts = {
    "workspace.invite.redeem": workspaceSchema.commandContracts["workspace.invite.redeem"],
    "settings.security.password.change": settingsSchema.commandContracts["settings.security.password.change"],
    "settings.security.password_method.toggle": settingsSchema.commandContracts["settings.security.password_method.toggle"],
    "settings.security.oauth.link.start": settingsSchema.commandContracts["settings.security.oauth.link.start"],
    "settings.security.oauth.unlink": settingsSchema.commandContracts["settings.security.oauth.unlink"],
    "settings.security.sessions.logout_others": settingsSchema.commandContracts["settings.security.sessions.logout_others"],
    "settings.profile.avatar.upload": settingsSchema.commandContracts["settings.profile.avatar.upload"],
    "settings.profile.avatar.delete": settingsSchema.commandContracts["settings.profile.avatar.delete"]
  };

  for (const [label, contract] of Object.entries(commandContracts)) {
    assertCommandContract(contract, label);
  }
});

test("route schema building blocks are wired directly from contracts", () => {
  assert.equal(workspaceSchema.body.settingsUpdate, workspaceSchema.resourceContracts.workspaceSettings.patch);
  assert.equal(workspaceSchema.body.createInvite, workspaceSchema.resourceContracts.workspaceInvite.create);
  assert.equal(workspaceSchema.body.redeemInvite, workspaceSchema.commandContracts["workspace.invite.redeem"].input);
  assert.equal(workspaceSchema.response.workspacesList, workspaceSchema.resourceContracts.workspace.list);
  assert.equal(workspaceSchema.response.settings, workspaceSchema.resourceContracts.workspaceSettings.record);
  assert.equal(workspaceSchema.response.members, workspaceSchema.resourceContracts.workspaceMember.list);
  assert.equal(workspaceSchema.response.invites, workspaceSchema.resourceContracts.workspaceInvite.list);

  assert.equal(settingsSchema.body.profile, settingsSchema.resourceContracts.userProfile.replace);
  assert.equal(
    settingsSchema.body.changePassword,
    settingsSchema.commandContracts["settings.security.password.change"].input
  );
  assert.equal(
    settingsSchema.body.passwordMethodToggle,
    settingsSchema.commandContracts["settings.security.password_method.toggle"].input
  );
  assert.equal(settingsSchema.response, settingsSchema.resourceContracts.userSettings.record);

  assert.equal(
    settingsSchema.params.oauthProvider.properties.provider,
    settingsSchema.commandContracts["settings.security.oauth.link.start"].input.properties.provider
  );
  assert.equal(
    settingsSchema.query.oauthProvider.properties.returnTo,
    settingsSchema.commandContracts["settings.security.oauth.link.start"].input.properties.returnTo
  );

  assert.equal(consoleSettingsSchema.body.update, consoleSettingsSchema.resourceContracts.consoleSettings.replace);
  assert.equal(consoleSettingsSchema.response.settings, consoleSettingsSchema.resourceContracts.consoleSettings.record);
});
