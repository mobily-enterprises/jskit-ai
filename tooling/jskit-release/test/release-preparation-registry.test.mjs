import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fixtureVersions, publicationFixture, publishFixtureBaseline } from "./npm-publication-fixture.mjs";
import { snapshotFiles } from "../src/npm-publication.mjs";

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
  // Each package is packed once, both by one npm process, and each published tarball is downloaded once.
  assert.match(result.stdout, /; 2 packs, \d+ registry lookups, 2 downloads; 2 packs, \d+ lookups, 2 downloads reused\./u);
  const calls = await f.calls();
  assert.equal(calls.filter(call => call.args[0] === "pack" && call.args[1].startsWith("--")).length, 1);
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
