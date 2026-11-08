import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { publicationFixture } from "./npm-publication-fixture.mjs";
import { createPublicationInspection, planPublication, snapshotFiles } from "../src/npm-publication.mjs";

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

test("prepare and publish refuse a publishable package pinned to a local build, before any npm call", async t => {
  const f = await publicationFixture(t, "jskit");
  const build = path.join(f.directory, "a-build");
  await f.addPackage("@jskit-ai/pinned", { dependencies: { "@jskit-ai/a": `file:${build}` } });
  // A private workspace is never published, so its paths are its own business.
  await f.addPackage("@jskit-ai/scratch", { private: true, devDependencies: { "@jskit-ai/a": "file:../../../scratch" } });
  f.git("add", ".");
  f.git("commit", "-m", "Pin a local build");
  f.git("push", "origin", "main");
  const before = await snapshotFiles(f.repo);
  for (const args of [["prepare"], ["prepare", "--dry-run"], ["publish"], ["publish", "--dry-run"]]) {
    const result = f.run(args);
    assert.equal(result.status, 1, args.join(" "));
    assert.equal(result.stderr, "jskit-release failed: Publishable packages depend on local paths that npm would publish as written:\n" +
      `- @jskit-ai/pinned: dependencies.@jskit-ai/a is file:${build}, an absolute path on this machine\n` +
      "Depend on a released version (or a path inside the repository) before preparing or publishing.\n", args.join(" "));
  }
  assert.deepEqual(await snapshotFiles(f.repo), before);
  assert.deepEqual(await f.calls(), []);
});
