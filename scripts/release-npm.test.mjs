import assert from "node:assert/strict";
import test from "node:test";
import {
  bumpPatch,
  collectPublishDependencies,
  discoverWorkspacePackages,
  mutationDependencyVersion,
  parseArgs,
  topologicalPublishOrder,
  updatePackageDependencyVersions,
  updateTemplatedPackageJsonContents,
  validateReleaseState
} from "./release-npm.mjs";

test("release commands have one explicit intent", () => {
  assert.deepEqual(parseArgs(["prepare"]), {
    intent: "prepare",
    dryRun: false,
    registry: "https://registry.npmjs.org"
  });
  assert.deepEqual(parseArgs(["publish", "--dry-run", "--registry", "registry.example.test/"]), {
    intent: "publish",
    dryRun: true,
    registry: "https://registry.example.test"
  });
  assert.throws(() => parseArgs([]), /prepare\|publish/u);
  assert.throws(() => parseArgs(["prepare", "--only", "kernel"]), /Unknown argument/u);
});

test("prepare increments exact patch versions", () => {
  assert.equal(bumpPatch("0.2.182"), "0.2.183");
  assert.throws(() => bumpPatch("0.x"), /x\.y\.z/u);
});

test("prepare updates npm and package mutation dependency versions", () => {
  const packageJson = {
    dependencies: {
      "@jskit-ai/kernel": "0.1.1",
      vue: "^3.5.0"
    },
    jskit: {
      mutations: {
        dependencies: {
          runtime: {
            "@jskit-ai/auth-core": "0.1.1",
            "@jskit-ai/http-runtime": {
              version: "0.1.1",
              when: { option: "transport", equals: "http" }
            }
          }
        }
      }
    }
  };
  const versions = new Map([
    ["@jskit-ai/kernel", "0.1.2"],
    ["@jskit-ai/auth-core", "0.1.2"],
    ["@jskit-ai/http-runtime", "0.1.2"]
  ]);

  assert.equal(updatePackageDependencyVersions(packageJson, versions), true);
  assert.equal(packageJson.dependencies["@jskit-ai/kernel"], "0.1.2");
  assert.equal(packageJson.dependencies.vue, "^3.5.0");
  assert.equal(packageJson.jskit.mutations.dependencies.runtime["@jskit-ai/auth-core"], "0.1.2");
  assert.equal(
    packageJson.jskit.mutations.dependencies.runtime["@jskit-ai/http-runtime"].version,
    "0.1.2"
  );
  assert.equal(updatePackageDependencyVersions(packageJson, versions), false);
});

test("dependency mutation objects use version", () => {
  assert.equal(mutationDependencyVersion("0.1.2"), "0.1.2");
  assert.equal(mutationDependencyVersion({ version: "0.1.2" }), "0.1.2");
  assert.equal(mutationDependencyVersion({ value: "0.1.2" }), "");
});

test("prepare updates tokenized package templates", () => {
  const source = `{
  "dependencies": {
    "@jskit-ai/kernel": "0.1.1"__JSKIT_DEPENDENCY_LINES__
  },
  "metadata": {
    "tableName": __JSKIT_TABLE_NAME__
  }
}\n`;
  const update = updateTemplatedPackageJsonContents(
    source,
    new Map([["@jskit-ai/kernel", "0.1.2"]])
  );

  assert.equal(update.changed, true);
  assert.match(update.contents, /"@jskit-ai\/kernel": "0\.1\.2"/u);
  assert.match(update.contents, /"tableName": __JSKIT_TABLE_NAME__/u);
});

test("publish order places dependencies before consumers", () => {
  assert.deepEqual(topologicalPublishOrder([
    { name: "@jskit-ai/create-app", localDependencies: new Set(["@jskit-ai/jskit-cli"]) },
    { name: "@jskit-ai/jskit-cli", localDependencies: new Set(["@jskit-ai/jskit-catalog"]) },
    { name: "@jskit-ai/jskit-catalog", localDependencies: new Set() }
  ]), [
    "@jskit-ai/jskit-catalog",
    "@jskit-ai/jskit-cli",
    "@jskit-ai/create-app"
  ]);
});

test("publish order follows npm dependencies rather than generated-app mutations", () => {
  const dependencies = collectPublishDependencies({
    dependencies: {
      "@jskit-ai/kernel": "0.1.2"
    },
    jskit: {
      mutations: {
        dependencies: {
          runtime: {
            "@jskit-ai/example": "0.1.2"
          }
        }
      }
    }
  }, new Set(["@jskit-ai/example", "@jskit-ai/kernel"]));

  assert.deepEqual([...dependencies], ["@jskit-ai/kernel"]);
});

test("package dependency cycles are invalid", () => {
  assert.throws(
    () => topologicalPublishOrder([
      { name: "@jskit-ai/a", localDependencies: new Set(["@jskit-ai/b"]) },
      { name: "@jskit-ai/b", localDependencies: new Set(["@jskit-ai/a"]) }
    ]),
    /must be acyclic.*@jskit-ai\/a, @jskit-ai\/b/u
  );
});

test("repository package state is one coordinated exact graph", async () => {
  await validateReleaseState(await discoverWorkspacePackages());
});
