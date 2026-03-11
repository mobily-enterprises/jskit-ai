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
      typeof operation.output?.schema,
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

test("specialized settings and invite operations expose canonical validators", () => {
  const operationSpecs = [
    { label: "workspaceInvite.redeem", operation: workspaceSchema.resources.workspaceInvite.operations.redeem },
    { label: "userProfile.avatarUpload", operation: userProfileResource.operations.avatarUpload },
    { label: "userProfile.avatarDelete", operation: userProfileResource.operations.avatarDelete },
    { label: "userSettings.passwordChange", operation: userSettingsResource.operations.passwordChange },
    { label: "userSettings.passwordMethodToggle", operation: userSettingsResource.operations.passwordMethodToggle },
    { label: "userSettings.oauthLinkStart", operation: userSettingsResource.operations.oauthLinkStart },
    { label: "userSettings.oauthUnlink", operation: userSettingsResource.operations.oauthUnlink },
    { label: "userSettings.logoutOtherSessions", operation: userSettingsResource.operations.logoutOtherSessions }
  ];

  for (const { label, operation } of operationSpecs) {
    assert.equal(typeof operation?.method, "string", `${label}.method must exist.`);
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

test("route schema building blocks are wired directly from canonical contracts", () => {
  assert.equal(
    workspaceSchema.body.createInvite,
    workspaceSchema.resources.workspaceInvite.operations.create.body.schema
  );
  assert.equal(
    workspaceSchema.body.redeemInvite,
    workspaceSchema.resources.workspaceInvite.operations.redeem.body.schema
  );
  assert.equal(
    workspaceSchema.response.respondToInvite,
    workspaceSchema.resources.workspaceInvite.operations.redeem.output.schema
  );
  assert.equal(
    workspaceSchema.response.workspacesList,
    workspaceSchema.resources.workspace.operations.list.output.schema
  );
  assert.equal(
    workspaceSchema.response.members,
    workspaceSchema.resources.workspaceMember.operations.list.output.schema
  );
  assert.equal(
    workspaceSchema.response.invites,
    workspaceSchema.resources.workspaceInvite.operations.list.output.schema
  );

});

test("users-core route contracts no longer live under a legacy shared/schema directory", () => {
  const testFilePath = fileURLToPath(import.meta.url);
  const packageRoot = path.resolve(path.dirname(testFilePath), "..");
  const legacySchemaDir = path.join(packageRoot, "src", "shared", "schema");
  assert.equal(existsSync(legacySchemaDir), false, "src/shared/schema must not exist.");
});
