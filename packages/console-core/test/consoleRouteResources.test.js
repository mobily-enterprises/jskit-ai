import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deriveResourceRequiredMetadata } from "@jskit-ai/kernel/_testable";
import { resolveSchemaTransportSchemaDefinition } from "@jskit-ai/kernel/shared/validators";
import { consoleSettingsContract } from "../src/shared/resources/consoleSettingsResource.js";

test("the console settings API contract serves view and a whole replace, with messages and validators", () => {
  const contract = consoleSettingsContract;
  assert.equal(contract.namespace, "consoleSettings");
  assert.deepEqual(Object.keys(contract.operations), ["view", "replace"]);
  assert.equal(contract.operations.view.method, "GET");
  assert.equal(contract.operations.replace.method, "PUT");
  for (const [operationName, operation] of Object.entries(contract.operations)) {
    assert.equal(typeof operation.messages, "object", `${operationName}.messages must exist.`);
    assert.equal(typeof resolveSchemaTransportSchemaDefinition(operation.output, {
      context: `${operationName}.output`,
      defaultMode: "replace"
    }), "object", `${operationName}.output.schema must exist.`);
  }
  assert.equal(typeof resolveSchemaTransportSchemaDefinition(contract.operations.replace.body, {
    context: "replace.body",
    defaultMode: "replace"
  }), "object", "replace.body.schema must exist.");
  assert.equal(contract.operations.replace.body.mode, "replace");
  assert.deepEqual(deriveResourceRequiredMetadata(contract).replace, []);
});

test("console-core does not use workspaceRoutes.js helper path", () => {
  const testFilePath = fileURLToPath(import.meta.url);
  const packageRoot = path.resolve(path.dirname(testFilePath), "..");
  const workspaceRoutesFilePath = path.join(packageRoot, "src", "server", "common", "routes", "workspaceRoutes.js");
  assert.equal(existsSync(workspaceRoutesFilePath), false, "workspaceRoutes.js must not exist.");
});

test("console-core route validators do not live under src/shared/schema", () => {
  const testFilePath = fileURLToPath(import.meta.url);
  const packageRoot = path.resolve(path.dirname(testFilePath), "..");
  const sharedSchemaDirPath = path.join(packageRoot, "src", "shared", "schema");
  assert.equal(existsSync(sharedSchemaDirPath), false, "src/shared/schema must not exist.");
});
