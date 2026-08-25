import assert from "node:assert/strict";
import test from "node:test";
import {
  bumpPatch,
  collectPublishDependencies,
  discoverWorkspacePackages,
  parseArgs,
  resolvePublishAuthentication,
  topologicalPublishOrder,
  updatePackageDependencyVersions,
  updatePatternPackageJsonContents,
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

test("publish authentication prefers an existing npm login over NPM_TOKEN", async () => {
  let tokenConfigCreated = false;
  const authentication = await resolvePublishAuthentication(
    "https://registry.npmjs.org",
    {
      env: { NPM_TOKEN: "stale-token" },
      readIdentity: async () => "mercmobily",
      createTokenConfig: async () => {
        tokenConfigCreated = true;
        return { configPath: "/unused", directory: "/unused" };
      }
    }
  );

  assert.deepEqual(authentication, {
    identity: "mercmobily",
    kind: "npm-login",
    npmConfig: null
  });
  assert.equal(tokenConfigCreated, false);
});

test("publish authentication falls back to NPM_TOKEN for automation", async () => {
  const observed = {};
  const authentication = await resolvePublishAuthentication(
    "https://registry.example.test",
    {
      env: { NPM_TOKEN: "automation-token" },
      readIdentity: async (registry) => {
        observed.registry = registry;
        return "";
      },
      createTokenConfig: async (registry, token) => {
        observed.tokenConfig = { registry, token };
        return { configPath: "/tmp/npmrc", directory: "/tmp/config" };
      }
    }
  );

  assert.deepEqual(observed, {
    registry: "https://registry.example.test",
    tokenConfig: {
      registry: "https://registry.example.test",
      token: "automation-token"
    }
  });
  assert.deepEqual(authentication, {
    identity: "",
    kind: "npm-token",
    npmConfig: { configPath: "/tmp/npmrc", directory: "/tmp/config" }
  });
});

test("publish authentication explains how to authenticate when no credential works", async () => {
  await assert.rejects(
    resolvePublishAuthentication(
      "https://registry.npmjs.org",
      {
        env: {},
        readIdentity: async () => ""
      }
    ),
    /Run npm login.*or set NPM_TOKEN/u
  );
});

test("prepare increments exact patch versions", () => {
  assert.equal(bumpPatch("0.2.182"), "0.2.183");
  assert.throws(() => bumpPatch("0.x"), /x\.y\.z/u);
});

test("prepare updates ordinary npm dependency versions", () => {
  const packageJson = {
    dependencies: {
      "@jskit-ai/kernel": "0.1.1",
      vue: "^3.5.0"
    }
  };
  const versions = new Map([
    ["@jskit-ai/kernel", "0.1.2"]
  ]);

  assert.equal(updatePackageDependencyVersions(packageJson, versions), true);
  assert.equal(packageJson.dependencies["@jskit-ai/kernel"], "0.1.2");
  assert.equal(packageJson.dependencies.vue, "^3.5.0");
  assert.equal(updatePackageDependencyVersions(packageJson, versions), false);
});

test("prepare updates concrete package manifests inside patterns", () => {
  const source = `{
  "dependencies": {
    "@jskit-ai/kernel": "0.1.1"
  }
}\n`;
  const update = updatePatternPackageJsonContents(
    source,
    new Map([["@jskit-ai/kernel", "0.1.2"]])
  );

  assert.equal(update.changed, true);
  assert.match(update.contents, /"@jskit-ai\/kernel": "0\.1\.2"/u);
});

test("publish order places dependencies before consumers", () => {
  assert.deepEqual(topologicalPublishOrder([
    { name: "@jskit-ai/http-web", localDependencies: new Set(["@jskit-ai/http-runtime"]) },
    { name: "@jskit-ai/http-runtime", localDependencies: new Set(["@jskit-ai/kernel"]) },
    { name: "@jskit-ai/kernel", localDependencies: new Set() }
  ]), [
    "@jskit-ai/kernel",
    "@jskit-ai/http-runtime",
    "@jskit-ai/http-web"
  ]);
});

test("publish order follows only npm dependencies", () => {
  const dependencies = collectPublishDependencies({
    dependencies: {
      "@jskit-ai/kernel": "0.1.2"
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
