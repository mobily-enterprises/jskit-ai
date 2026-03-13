import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deriveResourceRequiredMetadata } from "@jskit-ai/kernel/shared/validators/resourceRequiredMetadata";
import { consoleSettingsResource } from "../src/shared/resources/consoleSettingsResource.js";
import { userProfileResource } from "../src/shared/resources/userProfileResource.js";
import { userSettingsResource } from "../src/shared/resources/userSettingsResource.js";
import { workspaceResource } from "../src/shared/resources/workspaceResource.js";
import { workspaceInviteResource } from "../src/shared/resources/workspaceInviteResource.js";
import { workspaceMemberResource } from "../src/shared/resources/workspaceMemberResource.js";
import { workspaceSettingsResource } from "../src/shared/resources/workspaceSettingsResource.js";

function assertResourceShape(resource, label) {
  assert.ok(resource, `${label} resource must exist.`);
  assert.equal(typeof resource, "object", `${label} resource must be an object.`);
  assert.equal(typeof resource.resource, "string", `${label}.resource must be a string.`);

  for (const operationName of ["view", "list", "create", "replace", "patch"]) {
    const operation = resource.operations?.[operationName];
    assert.equal(typeof operation, "object", `${label}.operations.${operationName} must exist.`);
    assert.equal(typeof operation.method, "string", `${label}.operations.${operationName}.method must exist.`);
    const resolvedMessages =
      operation?.messages && typeof operation.messages === "object"
        ? operation.messages
        : resource?.messages || resource?.operationMessages;
    assert.equal(
      typeof resolvedMessages,
      "object",
      `${label}.operations.${operationName} must resolve messages from operation.messages or resource.messages.`
    );
    assert.equal(
      typeof operation.outputValidator?.schema,
      "object",
      `${label}.operations.${operationName} payload schema is required.`
    );
  }

  assert.equal(typeof resource.operations.create.bodyValidator?.schema, "object", `${label}.operations.create.bodyValidator.schema is required.`);
  assert.equal(typeof resource.operations.replace.bodyValidator?.schema, "object", `${label}.operations.replace.bodyValidator.schema is required.`);
  assert.equal(typeof resource.operations.patch.bodyValidator?.schema, "object", `${label}.operations.patch.bodyValidator.schema is required.`);

  const requiredMetadata = deriveResourceRequiredMetadata(resource);
  assert.ok(Array.isArray(requiredMetadata.create), `${label}.derivedRequired.create must be an array.`);
  assert.ok(Array.isArray(requiredMetadata.replace), `${label}.derivedRequired.replace must be an array.`);
  assert.ok(Array.isArray(requiredMetadata.patch), `${label}.derivedRequired.patch must be an array.`);
}

test("workspace/settings/console resources expose canonical validators", () => {
  const resourcesByLabel = {
    workspace: workspaceResource,
    workspaceSettings: workspaceSettingsResource,
    workspaceMember: workspaceMemberResource,
    workspaceInvite: workspaceInviteResource,
    userProfile: userProfileResource,
    userSettings: userSettingsResource,
    consoleSettings: consoleSettingsResource
  };

  for (const [label, resource] of Object.entries(resourcesByLabel)) {
    assertResourceShape(resource, label);
  }
});

test("specialized settings and invite operations expose canonical validators", () => {
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
    assert.equal(typeof operation?.method, "string", `${label}.method must exist.`);
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

test("users-core no longer uses a workspace schema helper that exposes raw schema leaves", () => {
  const testFilePath = fileURLToPath(import.meta.url);
  const packageRoot = path.resolve(path.dirname(testFilePath), "..");
  const legacyWorkspaceRoutesFile = path.join(packageRoot, "src", "server", "common", "routes", "workspaceRoutes.js");
  assert.equal(existsSync(legacyWorkspaceRoutesFile), false, "workspaceRoutes.js must not exist.");
});

test("users-core route validators no longer live under a legacy shared/schema directory", () => {
  const testFilePath = fileURLToPath(import.meta.url);
  const packageRoot = path.resolve(path.dirname(testFilePath), "..");
  const legacySchemaDir = path.join(packageRoot, "src", "shared", "schema");
  assert.equal(existsSync(legacySchemaDir), false, "src/shared/schema must not exist.");
});
