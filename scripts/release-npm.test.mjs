import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  collectTemplatePackageJsonPaths,
  resolvePackageLockRefreshSteps,
  STAGING_TAG,
  topologicalPublishOrder,
  updatePackageDependencyVersions,
  updateTemplatedPackageJsonContents
} from "./release-npm.mjs";
import { createPublishablePackageManifest } from "./npm-publish-support.mjs";

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

test("release snapshots remove only the source private flag", () => {
  const source = {
    name: "@jskit-ai/example",
    version: "0.1.2",
    private: true,
    dependencies: { lodash: "^4.17.21" }
  };

  assert.deepEqual(createPublishablePackageManifest(source), {
    name: source.name,
    version: source.version,
    dependencies: source.dependencies
  });
  assert.equal(source.private, true);
});

test("release coordination uses one version rewrite for manifests and JSKIT mutations", () => {
  const packageJson = {
    dependencies: {
      "@jskit-ai/kernel": "0.1.1",
      vue: "^3.5.0"
    },
    devDependencies: {
      "@jskit-ai/jskit-cli": "0.2.1"
    },
    jskit: {
      mutations: {
        dependencies: {
          runtime: {
            "@jskit-ai/auth-core": "0.1.1",
            "@jskit-ai/http-runtime": { version: "0.1.1" }
          },
          dev: {
            "@jskit-ai/database-runtime": { value: "0.1.1", reason: "tests" }
          }
        }
      }
    }
  };
  const nextVersions = new Map([
    ["@jskit-ai/kernel", "0.1.2"],
    ["@jskit-ai/jskit-cli", "0.2.2"],
    ["@jskit-ai/auth-core", "0.1.2"],
    ["@jskit-ai/http-runtime", "0.1.2"],
    ["@jskit-ai/database-runtime", "0.1.2"]
  ]);

  assert.equal(updatePackageDependencyVersions(packageJson, nextVersions), true);
  assert.equal(packageJson.dependencies["@jskit-ai/kernel"], "0.1.2");
  assert.equal(packageJson.dependencies.vue, "^3.5.0");
  assert.equal(packageJson.devDependencies["@jskit-ai/jskit-cli"], "0.2.2");
  assert.equal(packageJson.jskit.mutations.dependencies.runtime["@jskit-ai/auth-core"], "0.1.2");
  assert.equal(
    packageJson.jskit.mutations.dependencies.runtime["@jskit-ai/http-runtime"].version,
    "0.1.2"
  );
  assert.equal(
    packageJson.jskit.mutations.dependencies.dev["@jskit-ai/database-runtime"].value,
    "0.1.2"
  );
  assert.equal(updatePackageDependencyVersions(packageJson, nextVersions), false);
});

test("release coordination updates dependency versions in tokenized JSON templates", () => {
  const template = `{
  "dependencies": {
    "@jskit-ai/kernel": "0.1.1",
    "json-rest-schema": "^1.0.17"__JSKIT_DEPENDENCY_LINES__
  },
  "metadata": {
    "tableName": __JSKIT_TABLE_NAME__
  }
}\n`;

  const update = updateTemplatedPackageJsonContents(
    template,
    new Map([["@jskit-ai/kernel", "0.1.2"]])
  );

  assert.equal(update.changed, true);
  assert.match(update.contents, /"@jskit-ai\/kernel": "0\.1\.2"/u);
  assert.match(update.contents, /"json-rest-schema": "\^1\.0\.17"__JSKIT_DEPENDENCY_LINES__/u);
  assert.match(update.contents, /"tableName": __JSKIT_TABLE_NAME__/u);
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

test("release order deterministically linearizes exact dependency cycles", () => {
  const records = [
    {
      name: "@jskit-ai/b",
      packageJsonLocalDeps: new Set(["@jskit-ai/a"])
    },
    {
      name: "@jskit-ai/a",
      packageJsonLocalDeps: new Set(["@jskit-ai/b"])
    }
  ];
  const publishSet = new Set(records.map((record) => record.name));

  assert.deepEqual(topologicalPublishOrder(records, publishSet), [
    "@jskit-ai/a",
    "@jskit-ai/b"
  ]);
});

async function readWorkspacePackageJson(relativePath) {
  return JSON.parse(
    await readFile(new URL(`../${relativePath}/package.json`, import.meta.url), "utf8")
  );
}

test("every embedded template manifest uses the current exact JSKIT package graph", async () => {
  const workspaceRoots = ["packages", "tooling"];
  const workspacePackages = new Map();
  const packageRoots = [];

  for (const workspaceRoot of workspaceRoots) {
    const rootUrl = new URL(`../${workspaceRoot}/`, import.meta.url);
    const entries = await readdir(rootUrl, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const packageRoot = new URL(`${entry.name}/`, rootUrl);
      try {
        const packageJson = JSON.parse(await readFile(new URL("package.json", packageRoot), "utf8"));
        if (String(packageJson.name || "").startsWith("@jskit-ai/")) {
          workspacePackages.set(packageJson.name, packageJson.version);
          packageRoots.push(fileURLToPath(packageRoot));
        }
      } catch (error) {
        if (error?.code !== "ENOENT") {
          throw error;
        }
      }
    }
  }

  const mismatches = [];
  for (const packageRoot of packageRoots) {
    for (const manifestPath of await collectTemplatePackageJsonPaths(packageRoot)) {
      const contents = await readFile(manifestPath, "utf8");
      if (updateTemplatedPackageJsonContents(contents, workspacePackages).changed) {
        mismatches.push(manifestPath);
      }
    }
  }

  assert.deepEqual(mismatches, []);
});

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
