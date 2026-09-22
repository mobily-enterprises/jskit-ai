import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  assertMainReleaseCheckout,
  bumpPatch,
  collectPublishDependencies,
  collectPatternPackageJsonPaths,
  discoverWorkspacePackages,
  parseArgs,
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

test("release checks include standalone examples and exclude installed dependencies", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jskit-release-examples-"));
  try {
    const paths = ["patterns/feature/example/package.json", "examples/conversation/package.json",
      "examples/conversation/node_modules/dependency/package.json"];
    for (const relative of paths) {
      await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
      await writeFile(path.join(root, relative), "{}");
    }
    assert.deepEqual(await collectPatternPackageJsonPaths(root), paths.slice(0, 2).map((entry) => path.join(root, entry)).sort());
  } finally { await rm(root, { recursive: true, force: true }); }
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

test("publication requires clean main matching the remote main commit", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "jskit-release-checkout-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const checkout = path.join(root, "checkout");
  const remote = path.join(root, "remote.git");
  await mkdir(checkout);
  const git = (...args) => execFileSync("git", args, {
    cwd: checkout,
    stdio: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Release Test",
      GIT_AUTHOR_EMAIL: "release@example.test",
      GIT_COMMITTER_NAME: "Release Test",
      GIT_COMMITTER_EMAIL: "release@example.test"
    }
  });
  git("init", "--bare", remote);
  git("init", "--initial-branch=main");
  git("config", "commit.gpgsign", "false");
  await writeFile(path.join(checkout, "release.txt"), "released\n");
  git("add", "release.txt");
  git("commit", "-m", "Initial release");
  git("remote", "add", "origin", remote);
  git("push", "origin", "main");
  assert.doesNotThrow(() => assertMainReleaseCheckout(checkout));

  git("switch", "-c", "feature");
  assert.throws(() => assertMainReleaseCheckout(checkout), /requires the main branch/u);
  git("switch", "main");
  await writeFile(path.join(checkout, "release.txt"), "uncommitted\n");
  assert.throws(() => assertMainReleaseCheckout(checkout), /requires a clean checkout/u);
  git("restore", "release.txt");
  await writeFile(path.join(checkout, "untracked.txt"), "uncommitted\n");
  assert.throws(() => assertMainReleaseCheckout(checkout), /requires a clean checkout/u);
  await rm(path.join(checkout, "untracked.txt"));

  git("commit", "--allow-empty", "-m", "Unpublished release");
  assert.throws(() => assertMainReleaseCheckout(checkout), /requires HEAD to match/u);
  git("push", "origin", "main");
  assert.doesNotThrow(() => assertMainReleaseCheckout(checkout));
  git("reset", "--hard", "HEAD~1");
  assert.throws(() => assertMainReleaseCheckout(checkout), /requires HEAD to match/u);
  git("switch", "--detach");
  assert.throws(() => assertMainReleaseCheckout(checkout), /requires the main branch/u);
});
