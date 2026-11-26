import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
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
  // The first install reads through the operator's npm cache; the retry through a throwaway one, so a stale package
  // list cached before the release is not read again and the operator's cache stays warm for later installs.
  assert.equal(calls.some(call => call.args[0] === "cache"), false, "the operator's npm cache is never cleaned");
  assert.ok(installs[0].args.includes("--prefer-online"));
  assert.equal(installs[0].args.includes("--cache"), false);
  const cache = installs[1].args[installs[1].args.indexOf("--cache") + 1];
  assert.ok(installs[1].args.includes("--cache") && path.isAbsolute(cache), installs[1].args.join(" "));
  assert.equal(existsSync(cache), false, "the throwaway cache is removed");
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

// The consumer's root package.json declares an after-pin command, committed and pushed as a release needs it.
async function declareAfterPin(consumer, git, afterPin) {
  const file = path.join(consumer, "package.json");
  const root = JSON.parse(await readFile(file, "utf8"));
  root.jskitRelease = { ...root.jskitRelease, afterPin };
  await writeFile(file, JSON.stringify(root, null, 2) + "\n");
  git("commit", "-am", "Declare an after-pin command"); git("push", "origin", "main");
}

// What a run of the after-pin command saw: where it ran, how many installs the pin had made by then, and PATH's first entry.
const AFTER_PIN_SCRIPT = `
const fs = require("node:fs");
const path = require("node:path");
const installs = fs.readFileSync(process.env.RELEASE_TEST_LOG, "utf8").trim().split("\\n").filter(line => JSON.parse(line).args[0] === "install").length;
fs.appendFileSync("after-pin.jsonl", JSON.stringify({ cwd: process.cwd(), installs, firstPath: process.env.PATH.split(path.delimiter)[0] }) + "\\n");
console.log("synced the files that follow the pins");
`;

test("pin runs the repository's afterPin command on the installed versions, and its changes join the pin commit", async t => {
  const f = await publicationFixture(t, "jskit");
  const { consumer, git } = await consumerRepository(f);
  await declareAfterPin(consumer, git, [process.execPath, "-e", AFTER_PIN_SCRIPT]);
  const runs = async () => existsSync(path.join(consumer, "after-pin.jsonl"))
    ? (await readFile(path.join(consumer, "after-pin.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line)) : [];

  const dry = f.run(["pin", "--from", f.repo, "--dry-run"], {}, consumer);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /consumer: would run .+ after the install \(jskitRelease\.afterPin\)/u);
  assert.deepEqual(await runs(), [], "a dry run runs nothing");

  const result = f.run(["pin", "--from", f.repo], {}, consumer);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /synced the files that follow the pins/u, "its output is shown");
  const root = await realpath(consumer);
  assert.deepEqual(await runs(), [{ cwd: root, installs: 1, firstPath: path.join(root, "node_modules", ".bin") }],
    "it ran once, in the repository root, after the install, with the repository's installed bins first");
  assert.equal(git("log", "-1", "--format=%s").toString().trim(), "Consume released packages");
  const committed = git("show", "--name-only", "--format=", "HEAD").toString().trim().split("\n");
  assert.ok(["after-pin.jsonl", "package.json", "packages/x/package.json"].every(file => committed.includes(file)), committed.join(", "));
  assert.equal(git("rev-parse", "HEAD").toString(), git("ls-remote", "origin", "refs/heads/main").toString().split("\t")[0] + "\n");

  const repeat = f.run(["pin", "--from", f.repo], {}, consumer);
  assert.equal(repeat.status, 0, repeat.stderr);
  assert.match(repeat.stdout, /pins already match the released versions/u);
  assert.equal((await runs()).length, 1, "nothing pinned, nothing run");
});

test("pin --no-commit and --no-push run the afterPin command too, leaving or committing its changes with the pins", async t => {
  {
    const f = await publicationFixture(t, "jskit");
    const { consumer, git } = await consumerRepository(f);
    await declareAfterPin(consumer, git, [process.execPath, "-e", AFTER_PIN_SCRIPT]);
    const head = git("rev-parse", "HEAD").toString();
    const rehearsal = f.run(["pin", "--from", f.repo, "--no-commit"], {}, consumer);
    assert.equal(rehearsal.status, 0, rehearsal.stderr);
    assert.match(rehearsal.stdout, /pins installed; not committed/u);
    assert.equal(git("rev-parse", "HEAD").toString(), head);
    assert.match(git("status", "--porcelain").toString(), /\?\? after-pin\.jsonl/u);
  }
  {
    const f = await publicationFixture(t, "jskit");
    const { consumer, git } = await consumerRepository(f);
    await declareAfterPin(consumer, git, [process.execPath, "-e", AFTER_PIN_SCRIPT]);
    const origin = git("ls-remote", "origin", "refs/heads/main").toString().split("\t")[0];
    const committed = f.run(["pin", "--from", f.repo, "--no-push"], {}, consumer);
    assert.equal(committed.status, 0, committed.stderr);
    assert.match(git("show", "--name-only", "--format=", "HEAD").toString(), /^after-pin\.jsonl$/mu);
    assert.equal(git("status", "--porcelain").toString(), "");
    assert.equal(git("ls-remote", "origin", "refs/heads/main").toString().split("\t")[0], origin, "nothing pushed");
  }
});

test("a failing afterPin command fails the pin before its commit, showing its output, and a malformed one is refused before any change", async t => {
  const f = await publicationFixture(t, "jskit");
  const { consumer, git } = await consumerRepository(f);
  await declareAfterPin(consumer, git, [process.execPath, "-e", "console.error('the copies could not be synced'); process.exit(3)"]);
  const head = git("rev-parse", "HEAD").toString();
  const failed = f.run(["pin", "--from", f.repo], {}, consumer);
  assert.notEqual(failed.status, 0, failed.stdout);
  assert.match(failed.stderr, /jskitRelease\.afterPin `.+` failed with exit code 3, so the pin was not committed\. the copies could not be synced/u);
  assert.equal(git("rev-parse", "HEAD").toString(), head);
  assert.equal(git("ls-remote", "origin", "refs/heads/main").toString().split("\t")[0] + "\n", head, "nothing pushed");

  for (const afterPin of ["genesis skills sync", [], ["genesis", 3], ["genesis", " "], null]) {
    const g = await publicationFixture(t, "jskit");
    const other = await consumerRepository(g);
    await declareAfterPin(other.consumer, other.git, afterPin);
    for (const args of [[], ["--dry-run"], ["--no-commit"]]) {
      const refused = g.run(["pin", "--from", g.repo, ...args], {}, other.consumer);
      assert.notEqual(refused.status, 0, `${JSON.stringify(afterPin)} ${args}: ${refused.stdout}`);
      assert.match(refused.stderr, /package\.json jskitRelease\.afterPin must be a command and its arguments, a non-empty array of non-empty strings run without a shell/u);
    }
    assert.equal((await g.calls()).filter(call => call.args[0] === "install").length, 0, "nothing installed");
    assert.equal(other.git("status", "--porcelain").toString(), "", "nothing changed");
  }
});
