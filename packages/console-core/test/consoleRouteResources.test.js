import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deriveResourceRequiredMetadata } from "@jskit-ai/kernel/_testable";
import "../test-support/registerDefaultSettingsFields.js";
import { consoleSettingsResource } from "../src/shared/resources/consoleSettingsResource.js";

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

test("console settings resources expose canonical validators", () => {
  assertResourceShape(consoleSettingsResource, "consoleSettings");
});

test("console settings operations expose canonical validators", () => {
  for (const operationName of ["view", "list", "create", "replace", "patch"]) {
    const operation = consoleSettingsResource.operations?.[operationName];
    assert.equal(typeof operation?.method, "string", `${operationName}.method must exist.`);
    assert.equal(typeof operation?.outputValidator?.schema, "object", `${operationName}.outputValidator.schema must exist.`);
    if (operation?.bodyValidator) {
      assert.equal(typeof operation.bodyValidator.schema, "object", `${operationName}.bodyValidator.schema must exist.`);
    }
  }
});

test("console-core no longer uses a legacy workspace schema helper path", () => {
  const testFilePath = fileURLToPath(import.meta.url);
  const packageRoot = path.resolve(path.dirname(testFilePath), "..");
  const legacyWorkspaceRoutesFile = path.join(packageRoot, "src", "server", "common", "routes", "workspaceRoutes.js");
  assert.equal(existsSync(legacyWorkspaceRoutesFile), false, "workspaceRoutes.js must not exist.");
});

test("console-core route validators do not live under a legacy shared/schema directory", () => {
  const testFilePath = fileURLToPath(import.meta.url);
  const packageRoot = path.resolve(path.dirname(testFilePath), "..");
  const legacySchemaDir = path.join(packageRoot, "src", "shared", "schema");
  assert.equal(existsSync(legacySchemaDir), false, "src/shared/schema must not exist.");
});
