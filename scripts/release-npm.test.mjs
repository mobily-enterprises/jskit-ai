import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  resolvePackageLockRefreshSteps,
  STAGING_TAG,
  topologicalPublishOrder
} from "./release-npm.mjs";

test("selective releases rebuild nested exact workspace dependencies then validate normally", () => {
  assert.deepEqual(resolvePackageLockRefreshSteps(), [
    ["install", "--package-lock-only", "--ignore-scripts"]
  ]);
  assert.deepEqual(resolvePackageLockRefreshSteps({ onlyMode: true }), [
    ["install", "--package-lock-only", "--ignore-scripts", "--force"],
    ["install", "--package-lock-only", "--ignore-scripts"]
  ]);
});

test("release publication reserves a non-consumer staging tag", () => {
  assert.equal(STAGING_TAG, "jskit-staged");
  assert.notEqual(STAGING_TAG, "latest");
});

test("release promotion order keeps exact dependencies before dependants", () => {
  const records = [
    {
      name: "@jskit-ai/create-app",
      packageJsonLocalDeps: new Set(["@jskit-ai/jskit-cli"])
    },
    {
      name: "@jskit-ai/jskit-cli",
      packageJsonLocalDeps: new Set(["@jskit-ai/jskit-catalog"])
    },
    {
      name: "@jskit-ai/jskit-catalog",
      packageJsonLocalDeps: new Set()
    }
  ];
  const publishSet = new Set(records.map((record) => record.name));

  assert.deepEqual(topologicalPublishOrder(records, publishSet), [
    "@jskit-ai/jskit-catalog",
    "@jskit-ai/jskit-cli",
    "@jskit-ai/create-app"
  ]);
});

async function readWorkspacePackageJson(relativePath) {
  return JSON.parse(
    await readFile(new URL(`../${relativePath}/package.json`, import.meta.url), "utf8")
  );
}

test("prepared selected CRUD and toolchain manifests pin one exact dependency graph", async () => {
  const [
    authCore,
    crudCore,
    crudServerGenerator,
    crudUiGenerator,
    databaseRuntime,
    httpRuntime,
    jsonRestApiCore,
    usersCore,
    usersWeb,
    catalog,
    cli,
    createApp
  ] = await Promise.all([
    readWorkspacePackageJson("packages/auth-core"),
    readWorkspacePackageJson("packages/crud-core"),
    readWorkspacePackageJson("packages/crud-server-generator"),
    readWorkspacePackageJson("packages/crud-ui-generator"),
    readWorkspacePackageJson("packages/database-runtime"),
    readWorkspacePackageJson("packages/http-runtime"),
    readWorkspacePackageJson("packages/json-rest-api-core"),
    readWorkspacePackageJson("packages/users-core"),
    readWorkspacePackageJson("packages/users-web"),
    readWorkspacePackageJson("tooling/jskit-catalog"),
    readWorkspacePackageJson("tooling/jskit-cli"),
    readWorkspacePackageJson("tooling/create-app")
  ]);
  assert.equal(usersWeb.dependencies["@jskit-ai/http-runtime"], httpRuntime.version);
  assert.equal(usersWeb.dependencies["@jskit-ai/users-core"], usersCore.version);
  assert.equal(crudCore.dependencies["@jskit-ai/database-runtime"], databaseRuntime.version);
  assert.equal(crudCore.dependencies["@jskit-ai/http-runtime"], httpRuntime.version);
  assert.equal(crudCore.dependencies["@jskit-ai/users-core"], usersCore.version);
  assert.equal(crudCore.dependencies["@jskit-ai/users-web"], usersWeb.version);
  assert.equal(
    usersWeb.jskit.mutations.dependencies.runtime["@jskit-ai/users-core"],
    usersCore.version
  );
  assert.equal(crudServerGenerator.dependencies["@jskit-ai/crud-core"], crudCore.version);
  assert.equal(crudServerGenerator.dependencies["@jskit-ai/database-runtime"], databaseRuntime.version);
  assert.equal(crudServerGenerator.dependencies["@jskit-ai/http-runtime"], httpRuntime.version);
  assert.equal(crudServerGenerator.dependencies["@jskit-ai/json-rest-api-core"], jsonRestApiCore.version);
  assert.equal(
    crudServerGenerator.jskit.mutations.dependencies.runtime["@jskit-ai/auth-core"],
    authCore.version
  );
  assert.equal(
    crudServerGenerator.jskit.mutations.dependencies.runtime["@jskit-ai/database-runtime"],
    databaseRuntime.version
  );
  assert.equal(
    crudServerGenerator.jskit.mutations.dependencies.runtime["@jskit-ai/json-rest-api-core"],
    jsonRestApiCore.version
  );
  assert.equal(crudUiGenerator.dependencies["@jskit-ai/crud-core"], crudCore.version);

  assert.equal(cli.dependencies["@jskit-ai/jskit-catalog"], catalog.version);
  assert.equal(createApp.dependencies["@jskit-ai/jskit-cli"], cli.version);
});
