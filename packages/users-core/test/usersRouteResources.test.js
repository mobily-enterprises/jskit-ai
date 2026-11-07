import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deriveResourceRequiredMetadata } from "@jskit-ai/kernel/_testable";
import { resolveSchemaTransportSchemaDefinition } from "@jskit-ai/kernel/shared/validators";
import { userProfileContract, userProfileCrud } from "../src/shared/resources/userProfileResource.js";
import { userSettingsContract, userSettingsCrud } from "../src/shared/resources/userSettingsResource.js";

function assertContractShape(contract, label) {
  assert.ok(contract, `${label} contract must exist.`);
  assert.equal(typeof contract, "object", `${label} contract must be an object.`);
  assert.equal(typeof contract.namespace, "string", `.namespace must be a string.`);

  for (const [operationName, operation] of Object.entries(contract.operations)) {
    assert.equal(typeof operation.method, "string", `${label}.operations.${operationName}.method must exist.`);
    const resolvedMessages =
      operation?.messages && typeof operation.messages === "object"
        ? operation.messages
        : contract?.messages;
    assert.equal(
      typeof resolvedMessages,
      "object",
      `${label}.operations.${operationName} must resolve messages from operation.messages or contract.messages.`
    );
    assert.equal(
      typeof resolveSchemaTransportSchemaDefinition(operation.output, {
        context: `${label}.operations.${operationName}.output`,
        defaultMode: "replace"
      }),
      "object",
      `${label}.operations.${operationName} payload schema is required.`
    );
    if (operation.body) {
      assert.equal(typeof operation.body.schema, "object", `${label}.operations.${operationName}.body.schema is required.`);
    }
  }

  const requiredMetadata = deriveResourceRequiredMetadata(contract);
  assert.ok(Array.isArray(requiredMetadata.create), `${label}.derivedRequired.create must be an array.`);
  assert.ok(Array.isArray(requiredMetadata.replace), `${label}.derivedRequired.replace must be an array.`);
  assert.ok(Array.isArray(requiredMetadata.patch), `${label}.derivedRequired.patch must be an array.`);
}

test("account API contracts expose canonical validators for the operations they serve", () => {
  const contractsByLabel = {
    userProfile: userProfileContract,
    userSettings: userSettingsContract
  };

  for (const [label, contract] of Object.entries(contractsByLabel)) {
    assertContractShape(contract, label);
  }
  assert.deepEqual(Object.keys(userProfileContract.operations), ["patch", "avatarUpload", "avatarDelete"]);
  assert.deepEqual(Object.keys(userSettingsContract.operations), [
    "view",
    "preferencesUpdate",
    "notificationsUpdate",
    "passwordChange",
    "passwordMethodToggle",
    "oauthLinkStart",
    "oauthUnlink",
    "logoutOtherSessions"
  ]);
});

test("account CRUD contracts keep their create, replace and patch bodies and their outputs", () => {
  const contractsByLabel = {
    userProfile: userProfileCrud,
    userSettings: userSettingsCrud
  };

  for (const [label, contract] of Object.entries(contractsByLabel)) {
    assertContractShape(contract, label);
    assert.deepEqual(Object.keys(contract.operations), ["view", "list", "create", "replace", "patch"]);
    assert.equal(contract.operations.view.method, "GET");
    assert.equal(contract.operations.list.method, "GET");
    assert.equal(contract.operations.create.method, "POST");
    assert.equal(contract.operations.replace.method, "PUT");
    assert.equal(contract.operations.patch.method, "PATCH");
    assert.equal(contract.operations.create.body.mode, "create");
    assert.equal(contract.operations.replace.body.mode, "replace");
    assert.equal(contract.operations.patch.body.mode, "patch");
    assert.deepEqual(contract.operations.list.realtime.events, [`${label.toLowerCase()}.record.changed`]);
  }
  assert.deepEqual(Object.keys(userProfileCrud.operations.patch.body.schema.getFieldDefinitions()), ["displayName"]);
  assert.deepEqual(Object.keys(userSettingsCrud.operations.patch.body.schema.getFieldDefinitions()), [
    "theme",
    "locale",
    "timeZone",
    "dateFormat",
    "numberFormat",
    "currencyCode",
    "avatarSize",
    "productUpdates",
    "accountActivity",
    "securityAlerts"
  ]);
  assert.equal(userSettingsCrud.operations.view.output.schema, userSettingsContract.operations.view.output.schema);
  assert.equal(userProfileCrud.operations.patch.body.schema, userProfileContract.operations.patch.body.schema);
});

test("specialized settings and invite operations expose canonical validators", () => {
  const operationSpecs = [
    { label: "userProfile.avatarUpload", operation: userProfileContract.operations.avatarUpload },
    { label: "userProfile.avatarDelete", operation: userProfileContract.operations.avatarDelete },
    { label: "userSettings.passwordChange", operation: userSettingsContract.operations.passwordChange },
    { label: "userSettings.passwordMethodToggle", operation: userSettingsContract.operations.passwordMethodToggle },
    { label: "userSettings.oauthLinkStart", operation: userSettingsContract.operations.oauthLinkStart },
    { label: "userSettings.oauthUnlink", operation: userSettingsContract.operations.oauthUnlink },
    { label: "userSettings.logoutOtherSessions", operation: userSettingsContract.operations.logoutOtherSessions }
  ];

  for (const { label, operation } of operationSpecs) {
    assert.equal(typeof operation?.method, "string", `${label}.method must exist.`);
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

test("users-core does not use workspaceRoutes.js helper that exposes raw schema leaves", () => {
  const testFilePath = fileURLToPath(import.meta.url);
  const packageRoot = path.resolve(path.dirname(testFilePath), "..");
  const workspaceRoutesFilePath = path.join(packageRoot, "src", "server", "common", "routes", "workspaceRoutes.js");
  assert.equal(existsSync(workspaceRoutesFilePath), false, "workspaceRoutes.js must not exist.");
});

test("users-core route validators do not live under src/shared/schema", () => {
  const testFilePath = fileURLToPath(import.meta.url);
  const packageRoot = path.resolve(path.dirname(testFilePath), "..");
  const sharedSchemaDirPath = path.join(packageRoot, "src", "shared", "schema");
  assert.equal(existsSync(sharedSchemaDirPath), false, "src/shared/schema must not exist.");
});
