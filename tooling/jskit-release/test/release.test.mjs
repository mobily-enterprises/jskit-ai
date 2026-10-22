import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { mkdtemp, mkdir, readFile, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { publicationFixture } from "./npm-publication-fixture.mjs";
import { createPublicationInspection, planPublication, snapshotFiles } from "../src/npm-publication.mjs";
import {
  assertMainReleaseCheckout,
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
    registry: "https://registry.npmjs.org",
    from: []
  });
  assert.deepEqual(parseArgs(["publish", "--dry-run", "--registry", "registry.example.test/", "--cwd", "/tmp/target"]), {
    intent: "publish",
    cwd: "/tmp/target",
    dryRun: true,
    registry: "https://registry.example.test",
    from: []
  });
  assert.deepEqual(parseArgs(["pin", "--from", "/tmp/a", "--from=/tmp/b", "--cwd=/tmp/target"]).from, ["/tmp/a", "/tmp/b"]);
  assert.throws(() => parseArgs([]), /prepare\|publish\|pin/u);
  assert.throws(() => parseArgs(["prepare", "--only", "kernel"]), /Unknown argument/u);
  assert.throws(() => parseArgs(["publish", "--from", "/tmp/a"]), /Unknown argument/u);
  assert.throws(() => parseArgs(["pin"]), /requires at least one --from/u);
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

test("publication skips a matching dependency and publishes only the absent consumer tarball", async t => {
  const f = await publicationFixture(t, "jskit");
  await f.published(0);
  const result = f.run(["publish"]);
  assert.equal(result.status, 0, result.stderr);
  const calls = await f.calls();
  const publications = calls.filter(call => call.args[0] === "publish");
  assert.equal(publications.length, 1);
  assert.match(publications[0].args[1], /jskit-ai-b-1\.0\.0\.tgz$/u);
  assert.equal(publications[0].integrity, await f.published(1));
  assert.equal(existsSync(publications[0].args[1]), false);
  assert.equal(existsSync(calls[0].config), false);
  assert.match(result.stdout, /Skip matching release: @jskit-ai\/a@1\.0\.0/u);
});

test("publication checks later packages before uploading earlier absent versions", async t => {
  const f = await publicationFixture(t, "jskit");
  await f.published(1, { content: "export const value = 2;\n" });
  const directory = await mkdtemp(path.join(f.directory, "plan-"));
  const inspection = createPublicationInspection({ directory, registry: "https://registry.npmjs.org", env: f.env });
  await assert.rejects(planPublication(f.packages, { inspection, report: false }),
    /@jskit-ai\/b@1\.0\.0: published contents differ/u);
  assert.equal((await f.calls()).some(call => call.args[0] === "publish"), false);
});

test("publish prepares a changed published version, commits and pushes it, then uploads in order", async t => {
  const f = await publicationFixture(t, "jskit");
  await f.published(1, { content: "export const value = 2;\n" });
  const result = f.run(["publish"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /@jskit-ai\/b@1\.0\.0 -> 1\.0\.1 \(direct content change\)/u);
  assert.equal(f.git("log", "-1", "--format=%s").toString().trim(), "Release @jskit-ai/a@1.0.0, @jskit-ai/b@1.0.1");
  assert.equal(f.git("rev-parse", "HEAD").toString(), f.git("rev-parse", "origin/main").toString());
  assert.equal(f.git("status", "--porcelain").toString(), "");
  const publications = (await f.calls()).filter(call => call.args[0] === "publish");
  assert.deepEqual(publications.map(call => path.basename(call.args[1])), ["jskit-ai-a-1.0.0.tgz", "jskit-ai-b-1.0.1.tgz"]);
});

test("publish refuses an unclean or unpushed checkout before preparing", async t => {
  const f = await publicationFixture(t, "jskit");
  await writeFile(path.join(f.packages[0].dir, "index.js"), "export const value = 2;\n");
  const result = f.run(["publish"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires a clean checkout/u);
  assert.equal((await f.calls()).length, 0);
});

test("publish rebases its release commit when main moved and retries the push", async t => {
  const f = await publicationFixture(t, "jskit");
  await f.published(0, { content: "export const value = 2;\n" });
  const other = path.join(f.directory, "other");
  execFileSync("git", ["clone", "--quiet", path.join(f.directory, "origin.git"), other]);
  await writeFile(path.join(other, "notes.txt"), "concurrent work\n");
  const otherGit = (...args) => execFileSync("git", args, { cwd: other, stdio: "pipe" });
  otherGit("-c", "user.email=other@example.invalid", "-c", "user.name=Other", "-c", "commit.gpgsign=false", "add", ".");
  otherGit("-c", "user.email=other@example.invalid", "-c", "user.name=Other", "-c", "commit.gpgsign=false", "commit", "-m", "Concurrent work");
  // The release checkout passes its clean/current check, then main moves before its push.
  await writeFile(path.join(f.repo, ".git/hooks/pre-push"), `#!/bin/sh\nunset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE\n[ -f "${other}/.pushed" ] || (cd "${other}" && git push --quiet origin HEAD:main && touch .pushed)\n`, { mode: 0o755 });
  const result = f.run(["publish"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /main moved; rebasing the release commit and retrying/u);
  assert.equal(f.git("log", "-2", "--format=%s").toString().trim(), "Release @jskit-ai/a@1.0.1, @jskit-ai/b@1.0.0\nConcurrent work");
  assert.equal(f.git("rev-parse", "HEAD").toString(), f.git("ls-remote", "origin", "refs/heads/main").toString().split("\t")[0] + "\n");
});

test("publication refuses newer registry releases discovered after preparation", async t => {
  const f = await publicationFixture(t, "jskit");
  await f.published(1, { version: "1.0.1" });
  const result = f.run(["publish"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /@jskit-ai\/b: checkout version 1\.0\.0 is behind published 1\.0\.1/u);
  assert.equal((await f.calls()).some(call => call.args[0] === "publish"), false);
});

test("publication accepts matching archive contents despite different tarball metadata", async t => {
  const f = await publicationFixture(t, "jskit");
  await f.published(0, { mtime: 2000 });
  await f.published(1, { mtime: 2000 });
  const result = f.run(["publish"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal((await f.calls()).some(call => call.args[0] === "publish"), false);
});

test("publication verifies downloaded integrity before accepting equal archive contents", async t => {
  const f = await publicationFixture(t, "jskit");
  await f.published(0, { integrity: "sha512-AAAA" });
  const result = f.run(["publish"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not match registry integrity/u);
  assert.equal((await f.calls()).some(call => call.args[0] === "publish"), false);
});

test("publication stops on registry errors, including after earlier absent versions", async t => {
  const f = await publicationFixture(t, "jskit");
  const result = f.run(["publish"], { RELEASE_TEST_FAIL: "view", RELEASE_TEST_CODE: "E503" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Registry state is unknown/u);
  assert.equal((await f.calls()).some(call => call.args[0] === "publish"), false);
});

test("publication retains dependency order and cleans artifacts after an interrupted upload", async t => {
  const f = await publicationFixture(t, "jskit");
  const result = f.run(["publish"], { RELEASE_TEST_FAIL: "publish" });
  assert.equal(result.status, 1);
  const calls = await f.calls();
  const publications = calls.filter(call => call.args[0] === "publish");
  assert.equal(publications.length, 1);
  assert.match(publications[0].args[1], /jskit-ai-a-1\.0\.0\.tgz$/u);
  assert.equal(existsSync(publications[0].args[1]), false);
  assert.equal(existsSync(calls[0].config), false);
});

test("publication dry run checks registry matches and makes no uploads", async t => {
  const f = await publicationFixture(t, "jskit");
  await f.published(0);
  const result = f.run(["publish", "--dry-run"], { NPM_TOKEN: "" });
  assert.equal(result.status, 0, result.stderr);
  const calls = await f.calls();
  assert.equal(calls.some(call => ["publish", "whoami"].includes(call.args[0])), false);
  assert.match(result.stdout, /Publish new release: @jskit-ai\/b@1\.0\.0/u);
});

test("empty registry metadata stops publication instead of implying absence", async t => {
  const f = await publicationFixture(t, "jskit");
  const result = f.run(["publish"], { RELEASE_TEST_NULL_METADATA: "1" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid JSON/u);
  assert.equal((await f.calls()).some(call => call.args[0] === "publish"), false);
});

async function publishFixtureBaseline(f) {
  f.regenerate();
  await f.syncLockfile();
  for (let index = 0; index < f.packages.length; index++) await f.published(index);
}

async function fixtureVersions(f) {
  return Object.fromEntries(await Promise.all(f.packages.map(async record => {
    const manifest = JSON.parse(await readFile(path.join(record.dir, "package.json"), "utf8"));
    return [record.name, manifest.version];
  })));
}

test("selective preparation is a no-op for matching packages and excluded development changes", async t => {
  const f = await publicationFixture(t, "jskit");
  await publishFixtureBaseline(f);
  await writeFile(path.join(f.packages[0].dir, "excluded.test.js"), "test-only edit\n");
  await writeFile(path.join(f.repo, "development.txt"), "root-only edit\n");
  const before = await snapshotFiles(f.repo);
  const status = f.git("status", "--porcelain").toString();
  const result = f.run(["prepare"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0\/2 packages need publication; 0 source\/generated files/u);
  assert.deepEqual(await snapshotFiles(f.repo), before);
  assert.equal(f.git("status", "--porcelain").toString(), status);
  assert.deepEqual(await fixtureVersions(f), { "@jskit-ai/a": "1.0.0", "@jskit-ai/b": "1.0.0" });
  assert.equal((await f.calls()).some(call => ["install", "publish"].includes(call.args[0])), false);
});

test("a publishable source change propagates through all exact dependency fields and packaged examples", async t => {
  const f = await publicationFixture(t, "jskit");
  const c = await f.addPackage("@jskit-ai/c", { dependencies: { "@jskit-ai/b": "1.0.0" } });
  const independent = await f.addPackage("@jskit-ai/independent");
  for (const field of ["devDependencies", "peerDependencies", "optionalDependencies"]) {
    await f.addPackage(`@jskit-ai/${field.toLowerCase()}`, { [field]: { "@jskit-ai/a": "1.0.0" } });
  }
  const example = await f.addPackage("@jskit-ai/example", { files: ["index.js", "examples"] });
  const exampleManifest = path.join(f.packages[example].dir, "examples/sample/package.json");
  await mkdir(path.dirname(exampleManifest), { recursive: true });
  await writeFile(exampleManifest, '{"dependencies":{"@jskit-ai/a":"1.0.0"}}\n');
  await publishFixtureBaseline(f);
  await writeFile(path.join(f.packages[0].dir, "index.js"), "export const value = 2;\n");
  const result = f.run(["prepare"]);
  assert.equal(result.status, 0, result.stderr);
  const versions = await fixtureVersions(f);
  for (const record of f.packages) assert.equal(versions[record.name], record === f.packages[independent] ? "1.0.0" : "1.0.1");
  const manifest = JSON.parse(await readFile(path.join(f.packages[c].dir, "package.json"), "utf8"));
  assert.equal(manifest.dependencies["@jskit-ai/b"], "1.0.1");
  assert.equal(JSON.parse(await readFile(exampleManifest, "utf8")).dependencies["@jskit-ai/a"], "1.0.1");
  assert.match(result.stdout, /@jskit-ai\/a@1\.0\.0 -> 1\.0\.1 \(direct content change\)/u);
  assert.match(result.stdout, /@jskit-ai\/b@1\.0\.0 -> 1\.0\.1 \(dependency update\)/u);
  const after = await snapshotFiles(f.repo);
  const repeat = f.run(["prepare"]);
  assert.equal(repeat.status, 0, repeat.stderr);
  assert.deepEqual(await snapshotFiles(f.repo), after);
  assert.deepEqual(await fixtureVersions(f), versions);
  assert.match(repeat.stdout, /Keep unpublished: @jskit-ai\/a@1\.0\.1/u);
});

test("included README and ignored built output count as changes; a sibling remains unchanged", async t => {
  const f = await publicationFixture(t, "jskit");
  const independent = await f.addPackage("@jskit-ai/independent");
  const built = await f.addPackage("@jskit-ai/built", { files: ["index.js", "dist"] });
  const dir = f.packages[built].dir;
  await mkdir(path.join(dir, "dist"));
  await writeFile(path.join(dir, ".gitignore"), "dist/\n");
  await writeFile(path.join(dir, "dist/runtime.js"), "export const built = 1;\n");
  await writeFile(path.join(f.packages[1].dir, "README.md"), "Original guide.\n");
  await publishFixtureBaseline(f);
  await writeFile(path.join(f.packages[1].dir, "README.md"), "Changed included guide.\n");
  await writeFile(path.join(dir, "dist/runtime.js"), "export const built = 2;\n");
  const result = f.run(["prepare"]);
  assert.equal(result.status, 0, result.stderr);
  const versions = await fixtureVersions(f);
  assert.equal(versions[f.packages[0].name], "1.0.0");
  assert.equal(versions[f.packages[1].name], "1.0.1");
  assert.equal(versions[f.packages[built].name], "1.0.1");
  assert.equal(versions[f.packages[independent].name], "1.0.0");
});

test("catalog self-version and generated docs converge with the final mixed graph", async t => {
  const f = await publicationFixture(t, "jskit");
  const docs = await f.addPackage("@jskit-ai/agent-docs", { files: ["reference", "guide", "skills", "templates", "patterns"] });
  const catalog = await f.addPackage("@jskit-ai/jskit-catalog", { files: ["catalog", "scripts"] });
  const independent = await f.addPackage("@jskit-ai/independent");
  const pattern = path.join(f.packages[docs].dir, "patterns/sample");
  await mkdir(path.join(pattern, "example"), { recursive: true });
  await writeFile(path.join(pattern, "PATTERN.md"), "---\nid: app/sample\ntitle: Fixture sample\nsummary: A release fixture.\nkeywords: fixture\nrequires: @jskit-ai/a\n---\n# Fixture sample\n" +
    ["Use when", "Do not use when", "Product decisions", "Invariants", "Framework APIs", "Example files", "Variation points", "Verification", "Avoid"]
      .map(heading => `\n## ${heading}\n\nFixture explanation.\n`).join(""));
  await writeFile(path.join(pattern, "example/package.json"), '{"dependencies":{"@jskit-ai/a":"1.0.0"}}\n');
  await publishFixtureBaseline(f);
  await writeFile(path.join(f.packages[0].dir, "index.js"), "export function changedPublicApi() {}\n");
  const status = f.git("status", "--porcelain").toString();
  const before = await snapshotFiles(f.repo);
  const dry = f.run(["prepare", "--dry-run"]);
  assert.equal(dry.status, 0, dry.stderr);
  assert.deepEqual(await snapshotFiles(f.repo), before);
  assert.equal(f.git("status", "--porcelain").toString(), status);
  const real = f.run(["prepare"]);
  assert.equal(real.status, 0, real.stderr);
  const summary = text => text.split("\n").filter(line => /^(Keep published|Keep unpublished|New version):/u.test(line));
  assert.deepEqual(summary(dry.stdout), summary(real.stdout));
  const versions = await fixtureVersions(f);
  assert.equal(versions[f.packages[docs].name], "1.0.1");
  assert.equal(versions[f.packages[catalog].name], "1.0.1");
  assert.equal(versions[f.packages[independent].name], "1.0.0");
  const generated = JSON.parse(await readFile(path.join(f.packages[catalog].dir, "catalog/packages.json"), "utf8"));
  assert.deepEqual(generated.release.packages, versions);
  const patternIndex = await readFile(path.join(f.packages[docs].dir, "reference/autogen/PATTERN_INDEX.md"), "utf8");
  assert.match(patternIndex, /Owner: `@jskit-ai\/agent-docs@1\.0\.1`/u);
  const bundledExample = path.join(f.packages[docs].dir, "skills/jskit/references/patterns/app/sample/example/package.json");
  assert.equal(JSON.parse(await readFile(bundledExample, "utf8")).dependencies["@jskit-ai/a"], "1.0.1");
  assert.match(real.stdout, /generated artifact change/u);
  const after = await snapshotFiles(f.repo);
  f.regenerate();
  assert.deepEqual(await snapshotFiles(f.repo), after);
  const repeat = f.run(["prepare"]);
  assert.equal(repeat.status, 0, repeat.stderr);
  assert.deepEqual(await snapshotFiles(f.repo), after);
});

test("generation repairs stale outputs before deciding versions, without creating a false release", async t => {
  const f = await publicationFixture(t, "jskit");
  const catalog = await f.addPackage("@jskit-ai/jskit-catalog", { files: ["catalog", "scripts"] });
  await publishFixtureBaseline(f);
  const output = path.join(f.packages[catalog].dir, "catalog/packages.json");
  const original = await readFile(output, "utf8");
  await writeFile(output, '{"stale":true}\n');
  const result = f.run(["prepare"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0\/3 packages need publication/u);
  assert.equal(await readFile(output, "utf8"), original);
  assert.equal((await fixtureVersions(f))[f.packages[catalog].name], "1.0.0");
  assert.equal((await f.calls()).some(call => call.args[0] === "install"), false);
});

test("preparation retains unpublished versions for both existing and never-published packages", async t => {
  const f = await publicationFixture(t, "jskit");
  await f.published(0, { version: "0.9.9" });
  const result = f.run(["prepare"]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await fixtureVersions(f), { "@jskit-ai/a": "1.0.0", "@jskit-ai/b": "1.0.0" });
  assert.match(result.stdout, /Keep unpublished: @jskit-ai\/a@1\.0\.0/u);
  const after = await snapshotFiles(f.repo);
  const repeat = f.run(["prepare"]);
  assert.equal(repeat.status, 0, repeat.stderr);
  assert.deepEqual(await snapshotFiles(f.repo), after);
});

test("repeating preparation repairs a failed lockfile refresh without bumping prepared versions", async t => {
  const f = await publicationFixture(t, "jskit");
  await publishFixtureBaseline(f);
  await writeFile(path.join(f.packages[0].dir, "index.js"), "export const value = 2;\n");
  const partial = f.run(["prepare"], { RELEASE_TEST_FAIL: "install" });
  assert.equal(partial.status, 1);
  const prepared = await fixtureVersions(f);
  assert.equal(prepared["@jskit-ai/a"], "1.0.1");
  const retry = f.run(["prepare"]);
  assert.equal(retry.status, 0, retry.stderr);
  assert.deepEqual(await fixtureVersions(f), prepared);
  const lock = JSON.parse(await readFile(path.join(f.repo, "package-lock.json"), "utf8"));
  assert.equal(lock.packages["packages/a"].version, "1.0.1");
  assert.equal(lock.packages["packages/b"].dependencies["@jskit-ai/a"], "1.0.1");
  const installCount = (await f.calls()).filter(call => call.args[0] === "install").length;
  const before = await snapshotFiles(f.repo);
  assert.equal(f.run(["prepare"]).status, 0);
  assert.deepEqual(await snapshotFiles(f.repo), before);
  assert.equal((await f.calls()).filter(call => call.args[0] === "install").length, installCount);
});

test("preparation refuses a checkout behind npm, including an occupied patch version", async t => {
  const f = await publicationFixture(t, "jskit");
  await f.published(0);
  await f.published(0, { version: "1.0.1" });
  const before = await snapshotFiles(f.repo);
  const result = f.run(["prepare"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /checkout version 1\.0\.0 is behind published 1\.0\.1.*Update the checkout/u);
  assert.deepEqual(await snapshotFiles(f.repo), before);
  assert.equal((await f.calls()).some(call => ["install", "publish"].includes(call.args[0])), false);
});

test("preparation also refuses an occupied next version absent from earlier version history", async t => {
  const f = await publicationFixture(t, "jskit");
  await f.published(0, { version: "1.0.1" });
  await f.published(0);
  await writeFile(path.join(f.packages[0].dir, "index.js"), "export const value = 2;\n");
  const before = await snapshotFiles(f.repo);
  const result = f.run(["prepare"], { RELEASE_TEST_HIDE_VERSION: "1.0.1" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /chosen next version 1\.0\.1 is already published/u);
  assert.deepEqual(await snapshotFiles(f.repo), before);
});

test("the current exact version remains the comparison anchor when latest points elsewhere", async t => {
  const f = await publicationFixture(t, "jskit");
  await f.published(0);
  await f.published(0, { version: "0.9.9", content: "export const value = 0;\n" });
  await f.published(1);
  const before = await snapshotFiles(f.repo);
  const result = f.run(["prepare"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0\/2 packages need publication/u);
  assert.deepEqual(await snapshotFiles(f.repo), before);
});

test("preparation fails on registry errors without modifying the checkout", async t => {
  for (const code of ["E401", "E403", "E429", "E503", "ENOTFOUND"]) {
    await t.test(code, async t => {
      const f = await publicationFixture(t, "jskit");
      const before = await snapshotFiles(f.repo);
      const result = f.run(["prepare"], { RELEASE_TEST_FAIL: "view", RELEASE_TEST_CODE: code });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Registry state is unknown/u);
      assert.deepEqual(await snapshotFiles(f.repo), before);
    });
  }
});

test("preparation ignores archive metadata differences and reuses package comparisons", async t => {
  const f = await publicationFixture(t, "jskit");
  for (let index = 0; index < f.packages.length; index++) await f.published(index, { mtime: 2000 });
  const before = await snapshotFiles(f.repo);
  const result = f.run(["prepare"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0\/2 packages need publication/u);
  assert.deepEqual(await snapshotFiles(f.repo), before);
  const calls = await f.calls();
  assert.equal(calls.filter(call => call.args[0] === "pack" && call.args[1].startsWith("--")).length, 2);
  assert.equal(calls.filter(call => call.args[0] === "pack" && !call.args[1].startsWith("--")).length, 2);
});

test("selectively prepared publication resumes after partial success and becomes a no-op", async t => {
  const f = await publicationFixture(t, "jskit");
  const independent = await f.addPackage("@jskit-ai/independent");
  await publishFixtureBaseline(f);
  await writeFile(path.join(f.packages[0].dir, "index.js"), "export const value = 2;\n");
  const prepared = f.run(["prepare"]);
  assert.equal(prepared.status, 0, prepared.stderr);
  assert.equal((await fixtureVersions(f))[f.packages[independent].name], "1.0.0");
  f.git("add", "."); f.git("commit", "-m", "Prepared release"); f.git("push", "origin", "main");
  const partial = f.run(["publish"], { RELEASE_TEST_FAIL_UPLOAD: "2" });
  assert.equal(partial.status, 1);
  const retry = f.run(["publish"]);
  assert.equal(retry.status, 0, retry.stderr);
  assert.match(retry.stdout, /Skip matching release: @jskit-ai\/a@1\.0\.1/u);
  assert.match(retry.stdout, /Publish new release: @jskit-ai\/b@1\.0\.1/u);
  const afterSuccess = (await f.calls()).filter(call => call.args[0] === "publish").length;
  const repeated = f.run(["publish"]);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal((await f.calls()).filter(call => call.args[0] === "publish").length, afterSuccess);
  const finalPreparation = f.run(["prepare"]);
  assert.equal(finalPreparation.status, 0, finalPreparation.stderr);
  assert.match(finalPreparation.stdout, /0\/3 packages need publication/u);
});

test("a custom pack command supplies the published tarball and keeps unchanged detection", async t => {
  const f = await publicationFixture(t, "jskit");
  const custom = await f.addPackage("@jskit-ai/custom", { jskitRelease: { pack: "node pack.mjs" } });
  const dir = f.packages[custom].dir;
  // The artifact is built, not packed from source: it contains a generated file.
  await writeFile(path.join(dir, "pack.mjs"), `import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { create } from "tar";
import { realpathSync } from "node:fs";
// A build must resolve workspace links inside the tree it builds, as it would in place.
const link = realpathSync("../../node_modules/fixture-workspace-link");
if (!link.startsWith(realpathSync("../..") + path.sep)) throw new Error("workspace link resolves outside the build tree: " + link);
// Build output lives outside the package (and is ignored), like a release build directory.
mkdirSync("../../.custom-out", { recursive: true });
const out = mkdtempSync("../../.custom-out/build-");
mkdirSync(path.join(out, "package"));
writeFileSync(path.join(out, "package/package.json"), readFileSync("package.json"));
writeFileSync(path.join(out, "package/artifact.js"), "export const built = " + JSON.stringify(readFileSync("index.js", "utf8")) + ";\\n");
const tarball = path.resolve(out, "custom.tgz");
await create({ cwd: out, file: tarball, gzip: true, portable: true }, ["package"]);
console.log("custom build log");
console.log(JSON.stringify({ tarball }));
`);
  await writeFile(path.join(f.repo, ".gitignore"), "node_modules\n.custom-out/\n");
  // An installed tree like an npm workspace: dependencies plus a relative workspace link.
  const installed = path.join(f.repo, "node_modules");
  const dependencies = await readlink(installed);
  await rm(installed);
  await mkdir(installed);
  for (const entry of await readdir(dependencies)) await symlink(path.join(dependencies, entry), path.join(installed, entry));
  await symlink("../packages/b", path.join(installed, "fixture-workspace-link"));
  await f.syncLockfile();
  f.git("add", "."); f.git("commit", "-m", "Add custom package"); f.git("push", "origin", "main");

  const first = f.run(["publish"]);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stderr, /custom build log/u);
  const publication = (await f.calls()).filter(call => call.args[0] === "publish")
    .find(call => /custom\.tgz$/u.test(call.args[1]));
  assert.ok(publication, "the custom tarball is the uploaded artifact");
  assert.equal((await f.calls()).some(call => call.args[0] === "pack" && call.cwd === dir), false);

  const unchanged = f.run(["prepare"]);
  assert.equal(unchanged.status, 0, unchanged.stderr);
  assert.match(unchanged.stdout, /0\/3 packages need publication; 0 source\/generated files/u);
  assert.equal(f.git("status", "--porcelain").toString(), "");

  await writeFile(path.join(dir, "index.js"), "export const value = 2;\n");
  f.git("commit", "-am", "Change custom source"); f.git("push", "origin", "main");
  const changed = f.run(["publish"]);
  assert.equal(changed.status, 0, changed.stderr);
  assert.match(changed.stdout, /@jskit-ai\/custom@1\.0\.0 -> 1\.0\.1 \(direct content change\)/u);
  assert.match(changed.stdout, /Publish new release: @jskit-ai\/custom@1\.0\.1/u);
  assert.equal(f.git("log", "-1", "--format=%s").toString().trim(), "Release @jskit-ai/custom@1.0.1");
});

test("a root package and its file: dependency release together in dependency order", async t => {
  const f = await publicationFixture(t, "genesis");
  const [compiler, stack] = f.packages;
  const pluginManifest = path.join(f.repo, "plugins/genesis/plugin.json");
  await mkdir(path.dirname(pluginManifest), { recursive: true });
  await writeFile(pluginManifest, '{"name":"genesis","version":"1.0.0"}\n');
  compiler.packageJson.jskitRelease = { versionFiles: ["plugins/genesis/plugin.json"] };
  await writeFile(path.join(compiler.dir, "package.json"), JSON.stringify(compiler.packageJson) + "\n");
  for (let index = 0; index < f.packages.length; index++) await f.published(index);
  f.git("add", "."); f.git("commit", "-m", "Declare plugin version file"); f.git("push", "origin", "main");

  const unchanged = f.run(["publish", "--dry-run"], { NPM_TOKEN: "" });
  assert.equal(unchanged.status, 0, unchanged.stderr);
  assert.match(unchanged.stdout, /0\/2 packages need publication/u);

  await writeFile(path.join(compiler.dir, "index.js"), "export const value = 2;\n");
  await writeFile(path.join(stack.dir, "index.js"), "export const value = 2;\n");
  f.git("commit", "-am", "Change both packages"); f.git("push", "origin", "main");
  const result = f.run(["publish"]);
  assert.equal(result.status, 0, result.stderr);
  const root = JSON.parse(await readFile(path.join(f.repo, "package.json"), "utf8"));
  assert.equal(root.version, "1.0.1");
  assert.equal(root.devDependencies["genesis-stack"], "file:packages/genesis-stack");
  assert.equal(JSON.parse(await readFile(path.join(stack.dir, "package.json"), "utf8")).version, "1.0.1");
  assert.equal(JSON.parse(await readFile(pluginManifest, "utf8")).version, "1.0.1");
  assert.equal(f.git("log", "-1", "--format=%s").toString().trim(), "Release genesis-stack@1.0.1, genesis-compiler@1.0.1");
  const publications = (await f.calls()).filter(call => call.args[0] === "publish");
  assert.deepEqual(publications.map(call => path.basename(call.args[1])), ["genesis-stack-1.0.1.tgz", "genesis-compiler-1.0.1.tgz"]);
});

test("a version file that disagrees with its package stops publication", async t => {
  const f = await publicationFixture(t, "genesis");
  const [compiler] = f.packages;
  await writeFile(path.join(f.repo, "plugin.json"), '{"version":"0.9.0"}\n');
  compiler.packageJson.jskitRelease = { versionFiles: ["plugin.json"] };
  await writeFile(path.join(compiler.dir, "package.json"), JSON.stringify(compiler.packageJson) + "\n");
  for (let index = 0; index < f.packages.length; index++) await f.published(index);
  await writeFile(path.join(f.repo, "plugin.json"), '{"version":"0.9.0"}\n');
  const directory = await mkdtemp(path.join(f.directory, "validate-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(validateReleaseState(await discoverReleasePackages(f.repo), f.repo),
    /plugin\.json has version 0\.9\.0; expected 1\.0\.0/u);
});

async function consumerRepository(f) {
  const consumer = path.join(f.directory, "consumer");
  const manifests = {
    "package.json": { name: "consumer", private: true, workspaces: ["packages/*"], jskitRelease: { manifests: ["composed/y"] },
      dependencies: { "@jskit-ai/a": "^0.9.0", "@jskit-ai/b": "1.0.0", "left-pad": "^1.0.0", "@jskit-ai/local": "file:vendor/local" } },
    "packages/x/package.json": { name: "x", private: true, devDependencies: { "@jskit-ai/a": "~0.9.1" } },
    "composed/y/package.json": { name: "y", private: true, dependencies: { "@jskit-ai/a": "0.9.0" } }
  };
  for (const [file, json] of Object.entries(manifests)) {
    await mkdir(path.dirname(path.join(consumer, file)), { recursive: true });
    await writeFile(path.join(consumer, file), JSON.stringify(json, null, 2) + "\n");
  }
  const git = (...args) => execFileSync("git", args, { cwd: consumer, stdio: "pipe" });
  git("init", "--initial-branch=main");
  git("config", "user.email", "release-test@example.invalid");
  git("config", "user.name", "Release test");
  git("config", "commit.gpgsign", "false");
  git("add", "."); git("commit", "-m", "Consumer");
  execFileSync("git", ["init", "--bare", path.join(f.directory, "consumer.git")], { stdio: "pipe" });
  git("remote", "add", "origin", path.join(f.directory, "consumer.git"));
  git("push", "origin", "main");
  return { consumer, git };
}

test("pin follows released versions, keeps range prefixes, retries npm propagation, commits and pushes", async t => {
  const f = await publicationFixture(t, "jskit");
  const { consumer, git } = await consumerRepository(f);
  const before = await snapshotFiles(consumer);
  const dry = f.run(["pin", "--from", f.repo, "--dry-run"], {}, consumer);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /package\.json: dependencies\.@jskit-ai\/a \^0\.9\.0 -> \^1\.0\.0/u);
  assert.match(dry.stdout, /packages\/x\/package\.json: devDependencies\.@jskit-ai\/a ~0\.9\.1 -> ~1\.0\.0/u);
  assert.match(dry.stdout, /composed\/y\/package\.json: dependencies\.@jskit-ai\/a 0\.9\.0 -> 1\.0\.0/u);
  assert.deepEqual(await snapshotFiles(consumer), before);
  assert.equal((await f.calls()).length, 0);

  const result = f.run(["pin", "--from", f.repo], { RELEASE_TEST_INSTALL_FAILURES: "1", JSKIT_RELEASE_RETRY_DELAY_MS: "10" }, consumer);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /npm does not serve the new versions yet; retrying/u);
  const calls = await f.calls();
  const installs = calls.filter(call => call.args[0] === "install");
  assert.equal(installs.length, 2);
  const firstInstall = calls.indexOf(installs[0]);
  assert.deepEqual(calls[firstInstall + 1].args, ["cache", "clean", "--force"], "the retry drops npm's stale package list");
  assert.ok(installs[0].args.includes("--prefer-online"));
  const root = JSON.parse(await readFile(path.join(consumer, "package.json"), "utf8"));
  assert.deepEqual(root.dependencies, { "@jskit-ai/a": "^1.0.0", "@jskit-ai/b": "1.0.0", "left-pad": "^1.0.0", "@jskit-ai/local": "file:vendor/local" });
  assert.equal(JSON.parse(await readFile(path.join(consumer, "packages/x/package.json"), "utf8")).devDependencies["@jskit-ai/a"], "~1.0.0");
  assert.equal(JSON.parse(await readFile(path.join(consumer, "composed/y/package.json"), "utf8")).dependencies["@jskit-ai/a"], "1.0.0");
  assert.equal(git("log", "-1", "--format=%s").toString().trim(), "Consume released packages");
  assert.equal(git("rev-parse", "HEAD").toString(), git("ls-remote", "origin", "refs/heads/main").toString().split("\t")[0] + "\n");

  const repeat = f.run(["pin", "--from", f.repo], {}, consumer);
  assert.equal(repeat.status, 0, repeat.stderr);
  assert.match(repeat.stdout, /pins already match the released versions/u);
});
