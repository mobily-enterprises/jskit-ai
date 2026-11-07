import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { publicationFixture } from "./npm-publication-fixture.mjs";
import { snapshotFiles } from "../src/npm-publication.mjs";
import { discoverReleasePackages, validateReleaseState } from "../src/release.mjs";

test("a root package and its file: dependency release together in dependency order", async t => {
  const f = await publicationFixture(t, "file-linked");
  const [compiler, stack] = f.packages;
  const pluginManifest = path.join(f.repo, "plugins/tool/plugin.json");
  await mkdir(path.dirname(pluginManifest), { recursive: true });
  await writeFile(pluginManifest, '{"name":"tool","version":"1.0.0"}\n');
  compiler.packageJson.jskitRelease = { versionFiles: ["plugins/tool/plugin.json"] };
  await writeFile(path.join(compiler.dir, "package.json"), JSON.stringify(compiler.packageJson) + "\n");
  await f.publishedAll();
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
  assert.equal(root.devDependencies["tool-stack"], "file:packages/tool-stack");
  assert.equal(JSON.parse(await readFile(path.join(stack.dir, "package.json"), "utf8")).version, "1.0.1");
  assert.equal(JSON.parse(await readFile(pluginManifest, "utf8")).version, "1.0.1");
  assert.equal(f.git("log", "-1", "--format=%s").toString().trim(), "Release tool-stack@1.0.1, tool-compiler@1.0.1");
  const publications = (await f.calls()).filter(call => call.args[0] === "publish");
  assert.deepEqual(publications.map(call => path.basename(call.args[1])), ["tool-stack-1.0.1.tgz", "tool-compiler-1.0.1.tgz"]);
});

test("a version file that disagrees with its package stops publication", async t => {
  const f = await publicationFixture(t, "file-linked");
  const [compiler] = f.packages;
  await writeFile(path.join(f.repo, "plugin.json"), '{"version":"0.9.0"}\n');
  compiler.packageJson.jskitRelease = { versionFiles: ["plugin.json"] };
  await writeFile(path.join(compiler.dir, "package.json"), JSON.stringify(compiler.packageJson) + "\n");
  await f.publishedAll();
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
  manifests["package-lock.json"] = { name: "consumer", lockfileVersion: 3, packages: {
    "": { name: "consumer" },
    "node_modules/@jskit-ai/a": { version: "0.9.0" },
    "node_modules/@jskit-ai/b": { version: "1.0.0" },
    "packages/x/node_modules/@jskit-ai/a": { version: "0.9.1" },
    "node_modules/left-pad": { version: "1.0.0" }
  } };
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
  execFileSync("git", ["init", "--bare", "--initial-branch=main", path.join(f.directory, "consumer.git")], { stdio: "pipe" });
  git("remote", "add", "origin", path.join(f.directory, "consumer.git"));
  git("push", "origin", "main");
  return { consumer, git };
}

test("pin --no-commit installs the released versions and leaves the edits uncommitted", async t => {
  const f = await publicationFixture(t, "jskit");
  const { consumer, git } = await consumerRepository(f);
  const head = git("rev-parse", "HEAD").toString();
  const result = f.run(["pin", "--from", f.repo, "--no-commit"], {}, consumer);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /pins installed; not committed/u);
  assert.equal((await f.calls()).filter(call => call.args[0] === "install").length, 1);
  assert.equal(JSON.parse(await readFile(path.join(consumer, "package.json"), "utf8")).dependencies["@jskit-ai/a"], "^1.0.0");
  assert.equal(git("rev-parse", "HEAD").toString(), head);
  assert.equal(git("ls-remote", "origin", "refs/heads/main").toString().split("\t")[0] + "\n", head);
  assert.match(git("status", "--porcelain").toString(), /package\.json/u);
  assert.deepEqual((await f.calls()).find(call => call.args[0] === "install").lockKeys,
    ["", "node_modules/left-pad"], "pinned packages are resolved afresh; other locked packages stay");
});

test("pin --no-commit accepts a clone ahead of origin's main and pushes nothing", async t => {
  const f = await publicationFixture(t, "jskit");
  const { consumer, git } = await consumerRepository(f);
  const main = git("rev-parse", "HEAD").toString();
  git("commit", "--allow-empty", "-m", "Local work");
  const head = git("rev-parse", "HEAD").toString();
  const result = f.run(["pin", "--from", f.repo, "--no-commit"], {}, consumer);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /pins installed; not committed/u);
  assert.equal(JSON.parse(await readFile(path.join(consumer, "package.json"), "utf8")).dependencies["@jskit-ai/a"], "^1.0.0");
  assert.equal(git("rev-parse", "HEAD").toString(), head);
  assert.equal(git("ls-remote", "origin", "refs/heads/main").toString().split("\t")[0] + "\n", main);
});

test("pin --no-commit refuses a clone behind or diverged from origin's main", async t => {
  const f = await publicationFixture(t, "jskit");
  const { consumer, git } = await consumerRepository(f);
  const assertRefused = async () => {
    const result = f.run(["pin", "--from", f.repo, "--no-commit"], {}, consumer);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /requires HEAD to contain origin's main branch/u);
    assert.equal((await f.calls()).filter(call => call.args[0] === "install").length, 0);
    assert.equal(JSON.parse(await readFile(path.join(consumer, "package.json"), "utf8")).dependencies["@jskit-ai/a"], "^0.9.0");
    assert.equal(git("status", "--porcelain").toString(), "");
  };
  const other = path.join(f.directory, "other");
  const otherGit = (...args) => execFileSync("git", args, { cwd: other, stdio: "pipe" });
  execFileSync("git", ["clone", path.join(f.directory, "consumer.git"), other], { stdio: "pipe" });
  otherGit("-c", "user.email=release-test@example.invalid", "-c", "user.name=Release test", "commit", "--allow-empty", "-m", "Moved on");
  otherGit("push", "origin", "main");

  await assertRefused(); // behind, and this clone has never seen the new commit
  git("fetch", "origin");
  await assertRefused(); // behind, with the new commit fetched
  git("commit", "--allow-empty", "-m", "Local work");
  await assertRefused(); // diverged
});

test("a pin that pushes still refuses a clone ahead of origin's main", async t => {
  const f = await publicationFixture(t, "jskit");
  const { consumer, git } = await consumerRepository(f);
  const main = git("rev-parse", "HEAD").toString();
  git("commit", "--allow-empty", "-m", "Local work");
  const result = f.run(["pin", "--from", f.repo], {}, consumer);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires HEAD to match origin's main branch/u);
  assert.equal((await f.calls()).filter(call => call.args[0] === "install").length, 0);
  assert.equal(git("ls-remote", "origin", "refs/heads/main").toString().split("\t")[0] + "\n", main);
});

// A consumer kept on a second branch beside main, as a project starter is.
async function starterBranch(f) {
  const repository = await consumerRepository(f);
  const { git } = repository;
  git("switch", "-c", "public");
  git("commit", "--allow-empty", "-m", "Starter");
  git("push", "origin", "public");
  const remoteHead = branch => git("ls-remote", "origin", `refs/heads/${branch}`).toString().split("\t")[0];
  return { ...repository, remoteHead, main: remoteHead("main"), starter: remoteHead("public") };
}

test("pin --branch pins a named branch, commits and pushes it, and leaves main alone", async t => {
  const f = await publicationFixture(t, "jskit");
  const { consumer, git, remoteHead, main, starter } = await starterBranch(f);
  const result = f.run(["pin", "--from", f.repo, "--branch", "public"], {}, consumer);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /consumer: pushed [0-9a-f]+ Consume released packages/u);
  assert.equal(JSON.parse(await readFile(path.join(consumer, "package.json"), "utf8")).dependencies["@jskit-ai/a"], "^1.0.0");
  assert.equal(git("rev-parse", "HEAD^").toString().trim(), starter, "the pin commit sits on the starter branch");
  assert.equal(remoteHead("public"), git("rev-parse", "HEAD").toString().trim());
  assert.equal(remoteHead("main"), main);

  const repeat = f.run(["pin", "--from", f.repo, "--branch", "public"], {}, consumer);
  assert.equal(repeat.status, 0, repeat.stderr);
  assert.match(repeat.stdout, /pins already match the released versions/u);
});

test("pin --branch refuses a checkout of another branch, and a pin without it still refuses that branch", async t => {
  const f = await publicationFixture(t, "jskit");
  const { consumer, git, remoteHead, main, starter } = await starterBranch(f);
  const refused = async (args, pattern) => {
    const result = f.run(["pin", "--from", f.repo, ...args], {}, consumer);
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, pattern);
    assert.equal((await f.calls()).filter(call => call.args[0] === "install").length, 0);
    assert.equal(git("status", "--porcelain").toString(), "");
  };
  await refused([], /Publish requires the main branch/u);
  git("switch", "main");
  await refused(["--branch", "public"], /pin --branch public requires the public branch/u);
  await refused(["--branch", "accounts"], /pin --branch accounts requires the accounts branch/u);
  assert.deepEqual([remoteHead("main"), remoteHead("public")], [main, starter]);
});

test("pin --branch --no-push commits the pin on the branch and pushes nothing", async t => {
  const f = await publicationFixture(t, "jskit");
  const { consumer, git, remoteHead, main, starter } = await starterBranch(f);
  const result = f.run(["pin", "--from", f.repo, "--branch", "public", "--no-push"], {}, consumer);
  assert.equal(result.status, 0, result.stderr);
  const head = git("rev-parse", "HEAD").toString().trim();
  assert.match(result.stdout, new RegExp(`consumer: committed ${head.slice(0, 7)}[0-9a-f]* Consume released packages on public; not pushed`, "u"));
  assert.equal(git("log", "-1", "--format=%s").toString().trim(), "Consume released packages");
  assert.equal(git("rev-parse", "HEAD^").toString().trim(), starter);
  assert.equal(git("status", "--porcelain").toString(), "");
  assert.deepEqual([remoteHead("main"), remoteHead("public")], [main, starter], "nothing pushed");

  // Its commit must sit directly on origin's branch, so a checkout ahead of it is refused.
  const again = f.run(["pin", "--from", f.repo, "--branch", "public", "--no-push"], {}, consumer);
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /pin --branch public requires HEAD to match origin's public branch/u);
});

test("pin --branch --no-commit installs on the named branch and leaves the edits uncommitted", async t => {
  const f = await publicationFixture(t, "jskit");
  const { consumer, git, remoteHead, starter } = await starterBranch(f);
  const result = f.run(["pin", "--from", f.repo, "--branch", "public", "--no-commit"], {}, consumer);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /pins installed; not committed/u);
  assert.equal(git("rev-parse", "HEAD").toString().trim(), starter);
  assert.match(git("status", "--porcelain").toString(), /package\.json/u);
  assert.equal(remoteHead("public"), starter);
});

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
