import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { publicationFixture, publishFixtureBaseline } from "./npm-publication-fixture.mjs";
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

// The fixture's two packages and the catalog that pins them, all published as 1.0.0, then a change to the first one,
// committed and pushed: a publish releases both packages and the catalog as 1.0.1.
async function catalogFixture(t) {
  const f = await publicationFixture(t, "jskit");
  await f.addPackage("@jskit-ai/jskit-catalog", { files: ["catalog", "scripts"] });
  await publishFixtureBaseline(f);
  await writeFile(path.join(f.packages[0].dir, "index.js"), "export const value = 2;\n");
  f.git("add", ".");
  f.git("commit", "-m", "Add the catalog and change a");
  f.git("push", "origin", "main");
  return f;
}

function uploadsIn(calls) {
  return calls.flatMap((call, index) => call.args[0] === "publish"
    ? [{ file: path.basename(call.args[1]), tag: call.args[call.args.indexOf("--tag") + 1], index }] : []);
}

test("publish uploads the catalog under next with its packages, and moves latest to it once npm serves every version it pins as latest", async t => {
  const f = await catalogFixture(t);
  const result = f.run(["publish"], { JSKIT_RELEASE_RETRY_DELAY_MS: "0" });
  assert.equal(result.status, 0, result.stderr);
  const calls = await f.calls();
  const uploads = uploadsIn(calls);
  // The catalog goes up with the others, under next, so npm serves it by the time a consumer pins it.
  assert.deepEqual(uploads.map(({ file, tag }) => [file, tag]),
    [["jskit-ai-a-1.0.1.tgz", "latest"], ["jskit-ai-b-1.0.1.tgz", "latest"], ["jskit-ai-jskit-catalog-1.0.1.tgz", "next"]]);
  const moves = calls.flatMap((call, index) => call.args[0] === "dist-tag" ? [{ args: call.args.slice(0, 4), index }] : []);
  assert.deepEqual(moves.map(move => move.args), [["dist-tag", "add", "@jskit-ai/jskit-catalog@1.0.1", "latest"]]);
  // Between the catalog's upload and latest's move, it read what npm serves for each package the catalog pins.
  const reads = calls.slice(uploads[2].index + 1, moves[0].index).filter(call => call.args[0] === "view").map(call => call.args[1]);
  assert.ok(reads.includes("@jskit-ai/a") && reads.includes("@jskit-ai/b"), reads.join(" "));
  const registry = JSON.parse(await readFile(path.join(f.directory, "registry.json"), "utf8"));
  assert.deepEqual(registry["#tags"]["@jskit-ai/jskit-catalog"], { latest: "1.0.1", next: "1.0.1" });
});

test("publish leaves latest on the previous catalog while npm does not serve a version it pins as latest, and a rerun moves it", async t => {
  const f = await catalogFixture(t);
  const result = f.run(["publish"], { JSKIT_RELEASE_RETRY_DELAY_MS: "0", JSKIT_RELEASE_SERVE_ATTEMPTS: "2", RELEASE_TEST_HIDE_VERSION: "1.0.1" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /@jskit-ai\/jskit-catalog@1\.0\.1 is published under next; latest moves to it once npm serves every version it pins as latest, and it does not serve these yet:\n- @jskit-ai\/a@1\.0\.1 \(not served, latest 1\.0\.0\)\n- @jskit-ai\/b@1\.0\.1 \(not served, latest 1\.0\.0\)\nRerun the publish once npm serves them: the published packages are skipped and latest then moves to the catalog\./u);
  assert.match(result.stdout, /npm does not serve 2 pinned version\(s\) as latest yet; retrying in 0 s \(1\/2\)/u);
  const calls = await f.calls();
  assert.deepEqual(uploadsIn(calls).map(({ file, tag }) => [file, tag]),
    [["jskit-ai-a-1.0.1.tgz", "latest"], ["jskit-ai-b-1.0.1.tgz", "latest"], ["jskit-ai-jskit-catalog-1.0.1.tgz", "next"]]);
  assert.equal(calls.some(call => call.args[0] === "dist-tag"), false);

  const rerun = f.run(["publish"], { JSKIT_RELEASE_RETRY_DELAY_MS: "0" });
  assert.equal(rerun.status, 0, rerun.stderr);
  const more = (await f.calls()).slice(calls.length);
  assert.deepEqual(uploadsIn(more), [], "nothing is uploaded again");
  assert.deepEqual(more.filter(call => call.args[0] === "dist-tag").map(call => call.args.slice(0, 4)),
    [["dist-tag", "add", "@jskit-ai/jskit-catalog@1.0.1", "latest"]]);
});

test("publish uploads the tarballs preparation packed, packing nothing again in the checkout", async t => {
  const f = await publicationFixture(t, "jskit");
  await publishFixtureBaseline(f);
  await writeFile(path.join(f.packages[0].dir, "index.js"), "export const value = 2;\n");
  f.git("add", "."); f.git("commit", "-m", "Change a"); f.git("push", "origin", "main");
  const result = f.run(["publish"]);
  assert.equal(result.status, 0, result.stderr);
  const calls = await f.calls();
  const uploads = calls.filter(call => call.args[0] === "publish");
  assert.deepEqual(uploads.map(call => path.basename(call.args[1])), ["jskit-ai-a-1.0.1.tgz", "jskit-ai-b-1.0.1.tgz"]);
  assert.ok(uploads.every(call => call.args[1].includes(`${path.sep}jskit-prepare-`)), uploads.map(call => call.args[1]).join(" "));
  assert.deepEqual(calls.filter(call => call.args[0] === "pack" && call.args[1].startsWith("--") && call.cwd.startsWith(f.repo)), []);
  assert.match(result.stdout, /Publishing the tarballs preparation packed for 2\/2 packages: the release commit holds exactly the files they were packed from\./u);
  assert.equal(uploads.some(call => existsSync(call.args[1])), false, "the tarballs are removed after publishing");
});

test("a package whose root holds the lockfile publishes the tarball preparation packed with the refreshed lockfile", async t => {
  const f = await publicationFixture(t);
  await f.publishedAll();
  await writeFile(path.join(f.repo, "index.js"), "export const value = 2;\n");
  f.git("commit", "-am", "Change the root package"); f.git("push", "origin", "main");
  const result = f.run(["publish"]);
  assert.equal(result.status, 0, result.stderr);
  const calls = await f.calls();
  assert.deepEqual(calls.filter(call => call.args[0] === "pack" && call.args[1].startsWith("--") && call.cwd.startsWith(f.repo)), []);
  assert.deepEqual(calls.filter(call => call.args[0] === "publish").map(call => path.basename(call.args[1])), ["tool-compiler-1.0.1.tgz"]);
  // The lockfile refresh ran on the staged source, so the release commit is what preparation packed.
  const installs = calls.filter(call => call.args[0] === "install");
  assert.ok(installs.length === 1 && !installs[0].cwd.startsWith(f.repo), JSON.stringify(installs));
  assert.equal(JSON.parse(await readFile(path.join(f.repo, "package-lock.json"), "utf8")).packages[""].version, "1.0.1");
  assert.equal(f.git("status", "--porcelain").toString(), "");
});

test("publish packs again from the checkout a package whose committed files differ from what preparation packed", async t => {
  const f = await publicationFixture(t, "jskit");
  await publishFixtureBaseline(f);
  await writeFile(path.join(f.packages[0].dir, "index.js"), "export const value = 2;\n");
  f.git("add", "."); f.git("commit", "-m", "Change a"); f.git("push", "origin", "main");
  const other = path.join(f.directory, "other");
  execFileSync("git", ["clone", "--quiet", path.join(f.directory, "origin.git"), other]);
  await writeFile(path.join(other, "packages/a/index.js"), "export const value = 3;\n");
  const otherGit = (...args) => execFileSync("git", ["-c", "user.email=other@example.invalid", "-c", "user.name=Other", "-c", "commit.gpgsign=false", ...args], { cwd: other, stdio: "pipe" });
  otherGit("commit", "-am", "Concurrent change to a");
  // Main moves before the release commit's push, so the rebased release commit holds the other change to a.
  await writeFile(path.join(f.repo, ".git/hooks/pre-push"), `#!/bin/sh\nunset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE\n[ -f "${other}/.pushed" ] || (cd "${other}" && git push --quiet origin HEAD:main && touch .pushed)\n`, { mode: 0o755 });
  const result = f.run(["publish"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /@jskit-ai\/a@1\.0\.1: the release commit's packages\/a\/index\.js differs from what preparation packed; packing it again from the checkout/u);
  const calls = await f.calls();
  assert.deepEqual(calls.filter(call => call.args[0] === "pack" && call.args[1].startsWith("--") && call.cwd.startsWith(f.repo)).map(call => call.cwd),
    [f.packages[0].dir]);
  const uploads = calls.filter(call => call.args[0] === "publish");
  assert.deepEqual(uploads.map(call => path.basename(call.args[1])), ["jskit-ai-a-1.0.1.tgz", "jskit-ai-b-1.0.1.tgz"]);
  const registry = JSON.parse(await readFile(path.join(f.directory, "registry.json"), "utf8"));
  const published = execFileSync("tar", ["-xOf", registry["@jskit-ai/a@1.0.1"].file, "package/index.js"], { encoding: "utf8" });
  assert.equal(published, "export const value = 3;\n", "the committed source is what is published");
});

test("registry lookups and downloads run several at a time, never more than eight", async t => {
  const f = await publicationFixture(t, "jskit");
  for (let index = 0; index < 10; index++) await f.addPackage(`@jskit-ai/extra-${index}`);
  f.regenerate();
  await f.syncLockfile();
  f.git("add", "."); f.git("commit", "-m", "More packages"); f.git("push", "origin", "main");
  // Equal contents with other tarball metadata: each one is downloaded and compared.
  for (let index = 0; index < f.packages.length; index++) await f.published(index, { mtime: 2000 });
  const result = f.run(["prepare", "--dry-run"], { RELEASE_TEST_REGISTRY_DELAY_MS: "300" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0\/12 packages need publication/u);
  const lookups = await f.mostAtOnce(call => call.args[0] === "view");
  const downloads = await f.mostAtOnce(call => call.args[0] === "pack" && !call.args[1].startsWith("--"));
  assert.ok(lookups >= 2 && lookups <= 8, `${lookups} lookups at once`);
  assert.ok(downloads >= 2 && downloads <= 8, `${downloads} downloads at once`);
});
