import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertReleaseCheckout,
  bumpPatch,
  collectPublishDependencies,
  collectPatternPackageJsonPaths,
  discoverReleasePackages,
  parseArgs,
  topologicalPublishOrder,
  updatePackageDependencyVersions,
  updatePatternPackageJsonContents,
  validateReleaseState
} from "../src/release.mjs";

const JSKIT_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

test("release commands have one explicit intent", () => {
  assert.deepEqual(parseArgs(["prepare"]), {
    intent: "prepare",
    cwd: process.cwd(),
    dryRun: false,
    noCommit: false,
    noPush: false,
    branch: "main",
    registry: "https://registry.npmjs.org",
    from: []
  });
  assert.deepEqual(parseArgs(["publish", "--dry-run", "--registry", "registry.example.test/", "--cwd", "/tmp/target"]), {
    intent: "publish",
    cwd: "/tmp/target",
    dryRun: true,
    noCommit: false,
    noPush: false,
    branch: "main",
    registry: "https://registry.example.test",
    from: []
  });
  assert.deepEqual(parseArgs(["pin", "--from", "/tmp/a", "--from=/tmp/b", "--cwd=/tmp/target"]).from, ["/tmp/a", "/tmp/b"]);
  assert.equal(parseArgs(["pin", "--from", "/tmp/a", "--no-commit"]).noCommit, true);
  assert.throws(() => parseArgs(["publish", "--no-commit"]), /Unknown argument: --no-commit/u);
  assert.deepEqual(parseArgs(["pin", "--from", "/tmp/a", "--branch", "public", "--no-push"]),
    { ...parseArgs(["pin", "--from", "/tmp/a"]), branch: "public", noPush: true });
  assert.equal(parseArgs(["pin", "--from", "/tmp/a", "--branch=accounts-hub"]).branch, "accounts-hub");
  assert.throws(() => parseArgs(["pin", "--from", "/tmp/a", "--branch"]), /--branch requires a branch name/u);
  assert.throws(() => parseArgs(["pin", "--from", "/tmp/a", "--branch", "--no-push"]), /--branch requires a branch name/u);
  assert.throws(() => parseArgs(["pin", "--from", "/tmp/a", "--no-commit", "--no-push"]), /cannot be combined/u);
  assert.throws(() => parseArgs(["publish", "--branch", "public"]), /Unknown argument: --branch/u);
  assert.throws(() => parseArgs(["publish", "--no-push"]), /Unknown argument: --no-push/u);
  assert.throws(() => parseArgs([]), /prepare\|publish\|pin/u);
  assert.throws(() => parseArgs(["prepare", "--only", "kernel"]), /Unknown argument/u);
  assert.throws(() => parseArgs(["publish", "--from", "/tmp/a"]), /Unknown argument/u);
  assert.throws(() => parseArgs(["pin"]), /requires at least one --from/u);
  assert.equal(parseArgs(["publish", "--registry=registry.example.test"]).registry, "https://registry.example.test");
  assert.throws(() => parseArgs(["publish", "--registry"]), /--registry requires a URL/u);
  assert.throws(() => parseArgs(["publish", "--registry="]), /--registry requires a URL/u);
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

test("version updates keep ^/~ ranges and leave protocol specs alone", () => {
  const packageJson = {
    dependencies: { a: "^0.1.1", b: "~0.1.1", c: "file:packages/c", d: ">=0.1.0" }
  };
  const versions = new Map([["a", "0.2.0"], ["b", "0.2.0"], ["c", "0.2.0"], ["d", "0.2.0"]]);
  const changes = [];
  assert.equal(updatePackageDependencyVersions(packageJson, versions, changes), true);
  assert.deepEqual(packageJson.dependencies, { a: "^0.2.0", b: "~0.2.0", c: "file:packages/c", d: ">=0.1.0" });
  assert.deepEqual(changes, ["dependencies.a ^0.1.1 -> ^0.2.0", "dependencies.b ~0.1.1 -> ~0.2.0"]);
});

test("publishable packages are the non-private root, workspaces, declared manifests and in-repository file: dependencies", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jskit-release-discovery-"));
  try {
    const manifests = {
      "package.json": { name: "root-tool", version: "1.0.0", workspaces: ["packages/*"],
        jskitRelease: { manifests: ["composed/*"] },
        devDependencies: { "vendored": "file:vendor/vendored", "outside": "file:../outside" } },
      "composed/extra/package.json": { name: "composed-extra", version: "1.0.0" },
      "packages/public/package.json": { name: "@scope/public", version: "1.0.0" },
      "packages/internal/package.json": { name: "@scope/internal", version: "1.0.0", private: true,
        dependencies: { "nested": "file:../../nested" } },
      "packages/nameless/package.json": {},
      "vendor/vendored/package.json": { name: "vendored", version: "2.0.0" },
      "nested/package.json": { name: "nested", version: "3.0.0" },
      "unrelated/package.json": { name: "unrelated", version: "1.0.0" },
      "packages/public/node_modules/dep/package.json": { name: "dep", version: "1.0.0" }
    };
    for (const [file, json] of Object.entries(manifests)) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), JSON.stringify(json));
    }
    const records = await discoverReleasePackages(root);
    assert.deepEqual(records.map(record => [record.name, path.relative(root, record.dir)]), [
      ["@scope/public", "packages/public"], ["composed-extra", "composed/extra"], ["nested", "nested"], ["root-tool", ""],
      ["vendored", "vendor/vendored"]
    ]);
  } finally { await rm(root, { recursive: true, force: true }); }
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
  await validateReleaseState(await discoverReleasePackages(JSKIT_ROOT), JSKIT_ROOT);
});

test("publication requires clean main matching the remote main commit", async (t) => {
  const workspaceTemp = path.join(process.cwd(), ".tmp");
  await mkdir(workspaceTemp, { recursive: true });
  const root = await mkdtemp(path.join(workspaceTemp, "jskit-release-checkout-"));
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
  git("init", "--bare", "--initial-branch=main", remote);
  git("init", "--initial-branch=main");
  git("config", "commit.gpgsign", "false");
  await writeFile(path.join(checkout, "release.txt"), "released\n");
  git("add", "release.txt");
  git("commit", "-m", "Initial release");
  git("remote", "add", "origin", remote);
  git("push", "origin", "main");
  assert.doesNotThrow(() => assertReleaseCheckout(checkout));

  git("switch", "-c", "feature");
  assert.throws(() => assertReleaseCheckout(checkout), /requires the main branch/u);
  git("switch", "main");
  await writeFile(path.join(checkout, "release.txt"), "uncommitted\n");
  assert.throws(() => assertReleaseCheckout(checkout), /requires a clean checkout/u);
  git("restore", "release.txt");
  await writeFile(path.join(checkout, "untracked.txt"), "uncommitted\n");
  assert.throws(() => assertReleaseCheckout(checkout), /requires a clean checkout/u);
  await rm(path.join(checkout, "untracked.txt"));

  git("commit", "--allow-empty", "-m", "Unpublished release");
  assert.throws(() => assertReleaseCheckout(checkout), /requires HEAD to match/u);
  git("push", "origin", "main");
  assert.doesNotThrow(() => assertReleaseCheckout(checkout));
  git("reset", "--hard", "HEAD~1");
  assert.throws(() => assertReleaseCheckout(checkout), /requires HEAD to match/u);
  git("switch", "--detach");
  assert.throws(() => assertReleaseCheckout(checkout), /requires the main branch/u);

  // A named branch is held to the same rules against origin's commit for that branch.
  git("switch", "-c", "public", "main");
  assert.throws(() => assertReleaseCheckout(checkout, { branch: "public" }), /^Error: pin --branch public requires origin to have a public branch\.$/u);
  git("push", "origin", "public");
  assert.doesNotThrow(() => assertReleaseCheckout(checkout, { branch: "public" }));
  assert.throws(() => assertReleaseCheckout(checkout), /^Error: Publish requires the main branch\.$/u);
  git("switch", "main");
  assert.throws(() => assertReleaseCheckout(checkout, { branch: "public" }), /^Error: pin --branch public requires the public branch\.$/u);
  git("switch", "public");
  git("commit", "--allow-empty", "-m", "Unpushed starter work");
  assert.throws(() => assertReleaseCheckout(checkout, { branch: "public" }),
    /pin --branch public requires HEAD to match origin's public branch; reconcile and push public first/u);
  assert.doesNotThrow(() => assertReleaseCheckout(checkout, { branch: "public", allowAhead: true }));
});
