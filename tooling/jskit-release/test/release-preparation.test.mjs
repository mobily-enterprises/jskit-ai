import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fixtureVersions, publicationFixture, publishFixtureBaseline } from "./npm-publication-fixture.mjs";
import { snapshotFiles } from "../src/npm-publication.mjs";

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
