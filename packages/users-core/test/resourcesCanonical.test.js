import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveSchemaTransportSchemaDefinition } from "@jskit-ai/kernel/shared/validators";
import { userProfileContract, userProfileCrud, userProfileTableResource } from "../src/shared/resources/userProfileResource.js";
import { userSettingsContract, userSettingsCrud, userSettingsTableResource } from "../src/shared/resources/userSettingsResource.js";

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

test("users-core API contracts expose messages for all operations", () => {
  const contracts = {
    userProfile: userProfileContract,
    userSettings: userSettingsContract
  };

  for (const [label, contract] of Object.entries(contracts)) {
    for (const operationName of Object.keys(contract.operations)) {
      assertResourceOperationMessages(contract, operationName, label);
    }
  }
});

test("users-core CRUD contracts expose messages for view, list, create, replace and patch", () => {
  const contracts = {
    userProfile: userProfileCrud,
    userSettings: userSettingsCrud
  };

  for (const [label, contract] of Object.entries(contracts)) {
    assert.equal(contract.namespace, label);
    assert.deepEqual(Object.keys(contract.operations), ["view", "list", "create", "replace", "patch"]);
    for (const operationName of Object.keys(contract.operations)) {
      assertResourceOperationMessages(contract, operationName, label);
    }
  }
});

test("the users and user_settings tables are table resources, apart from their CRUD and API contracts", () => {
  assert.equal(userProfileTableResource.name, "userProfiles");
  assert.equal(userProfileTableResource.tableName, "users");
  assert.equal(userSettingsTableResource.name, "userSettings");
  assert.equal(userSettingsTableResource.tableName, "user_settings");
  assert.equal(Object.hasOwn(userProfileTableResource, "operations"), false);
  assert.equal(Object.hasOwn(userSettingsTableResource, "operations"), false);
  assert.equal(userProfileCrud.resource, userProfileTableResource);
  assert.equal(userSettingsCrud.resource, userSettingsTableResource);
});

test("the users table resource searches display name, email and username with q", () => {
  assert.deepEqual(userProfileTableResource.searchSchema.q, {
    type: "string",
    oneOf: ["displayName", "email", "username"],
    filterOperator: "like",
    splitBy: " ",
    matchAll: true
  });
});

test("user profile resource exposes managed timestamps used by JSON REST writes", () => {
  assert.equal(userProfileTableResource.schema.createdAt?.type, "dateTime");
  assert.equal(userProfileTableResource.schema.createdAt?.storage?.column, "created_at");
  assert.equal(userProfileTableResource.schema.createdAt?.storage?.writeSerializer, "datetime-utc");
  assert.equal(userProfileTableResource.schema.updatedAt?.type, "dateTime");
  assert.equal(userProfileTableResource.schema.updatedAt?.storage?.column, "updated_at");
  assert.equal(userProfileTableResource.schema.updatedAt?.storage?.writeSerializer, "datetime-utc");
});

test("users-core specialized resource operations expose messages and validators", () => {
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

test("users-core does not contain src/shared/schema", () => {
  const testFilePath = fileURLToPath(import.meta.url);
  const packageRoot = path.resolve(path.dirname(testFilePath), "..");
  const sharedSchemaDirPath = path.join(packageRoot, "src", "shared", "schema");
  assert.equal(existsSync(sharedSchemaDirPath), false, "src/shared/schema must not exist.");
});
