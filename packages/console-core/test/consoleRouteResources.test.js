import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deriveResourceRequiredMetadata } from "@jskit-ai/kernel/_testable";
import { resolveStructuredSchemaTransportSchema } from "@jskit-ai/kernel/shared/validators";
import { consoleSettingsResource } from "../src/shared/resources/consoleSettingsResource.js";

function assertResourceShape(resource, label) {
  assert.ok(resource, `${label} resource must exist.`);
  assert.equal(typeof resource, "object", `${label} resource must be an object.`);
  assert.equal(typeof resource.namespace, "string", `.namespace must be a string.`);

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
      typeof resolveStructuredSchemaTransportSchema(operation.output, {
        context: `${label}.operations.${operationName}.output`,
        defaultMode: "replace"
      }),
      "object",
      `${label}.operations.${operationName} payload schema is required.`
    );
  }

  assert.equal(typeof resolveStructuredSchemaTransportSchema(resource.operations.create.body, {
    context: `${label}.operations.create.body`,
    defaultMode: "create"
  }), "object", `${label}.operations.create.body.schema is required.`);
  assert.equal(typeof resolveStructuredSchemaTransportSchema(resource.operations.replace.body, {
    context: `${label}.operations.replace.body`,
    defaultMode: "replace"
  }), "object", `${label}.operations.replace.body.schema is required.`);
  assert.equal(typeof resolveStructuredSchemaTransportSchema(resource.operations.patch.body, {
    context: `${label}.operations.patch.body`,
    defaultMode: "patch"
  }), "object", `${label}.operations.patch.body.schema is required.`);

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
    assert.equal(typeof resolveStructuredSchemaTransportSchema(operation?.output, {
      context: `${operationName}.output`,
      defaultMode: "replace"
    }), "object", `${operationName}.output.schema must exist.`);
    if (operation?.body) {
      assert.equal(typeof resolveStructuredSchemaTransportSchema(operation.body, {
        context: `${operationName}.body`,
        defaultMode: operationName === "create" ? "create" : operationName === "replace" ? "replace" : "patch"
      }), "object", `${operationName}.body.schema must exist.`);
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
