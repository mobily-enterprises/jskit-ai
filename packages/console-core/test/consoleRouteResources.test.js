import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deriveResourceRequiredMetadata } from "@jskit-ai/kernel/_testable";
import { resolveSchemaTransportSchemaDefinition } from "@jskit-ai/kernel/shared/validators";
import { registerConsoleSettingsRoutes } from "../src/server/consoleSettings/consoleSettingsRoutes.js";
import { consoleSettingsContract } from "../src/shared/resources/consoleSettingsResource.js";

test("the console settings API contract serves view and patch, with the methods of the routes that serve them", () => {
  const contract = consoleSettingsContract;
  assert.equal(contract.namespace, "consoleSettings");
  assert.deepEqual(Object.keys(contract.operations), ["view", "patch"]);
  assert.equal(contract.operations.view.method, "GET");
  assert.equal(contract.operations.patch.method, "PATCH");
  for (const [operationName, operation] of Object.entries(contract.operations)) {
    assert.equal(typeof operation.messages, "object", `${operationName}.messages must exist.`);
    assert.equal(typeof resolveSchemaTransportSchemaDefinition(operation.output, {
      context: `${operationName}.output`,
      defaultMode: "replace"
    }), "object", `${operationName}.output.schema must exist.`);
  }
  assert.equal(typeof resolveSchemaTransportSchemaDefinition(contract.operations.patch.body, {
    context: "patch.body",
    defaultMode: "patch"
  }), "object", "patch.body.schema must exist.");
  assert.equal(contract.operations.patch.body.mode, "patch");
  assert.deepEqual(deriveResourceRequiredMetadata(contract).patch, []);
});

test("each console settings route uses its contract operation's method", () => {
  const registered = [];
  registerConsoleSettingsRoutes({ register: (method, url, options) => registered.push({ method, url, options }) });
  assert.deepEqual(registered.map(({ method, url }) => `${method} ${url}`), [
    `${consoleSettingsContract.operations.view.method} /api/console/settings`,
    `${consoleSettingsContract.operations.patch.method} /api/console/settings`
  ]);
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
