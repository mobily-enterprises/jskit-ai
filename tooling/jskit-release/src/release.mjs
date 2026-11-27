import { chmod, cp, lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  DEPENDENCY_FIELDS,
  assertNoOutsidePathDependencies,
  bumpPatch,
  collectPatternPackageJsonPaths,
  collectPublishDependencies,
  collectVersionMismatches,
  currentVersionMap,
  discoverManifests,
  discoverReleasePackages,
  fileExists,
  prepareManifests,
  readJsonFile,
  releaseConfig,
  serializeJson,
  toPosixPath,
  topologicalPublishOrder,
  updatePackageDependencyVersions,
  updatePatternPackageJsonContents,
  validateReleaseState
} from "./manifests.mjs";
import { createPublicationInspection, fileState, inParallel, planPublication, snapshotFiles } from "./npm-publication.mjs";

// The release target is the working directory (or --cwd). Its publishable
// packages are every non-private package among the root, its workspaces and
// `file:` dependencies inside the repository; prepare and publish refuse one
// that depends on a local path outside it. Repository-specific behavior is
// declared in the root package.json `jskitRelease` field:
//   prepare          command that regenerates derived files during preparation
//   nestedManifests  package subdirectories whose package.json pins follow the release
//   manifests        further package directories (or `*` patterns) the repository owns
//                    without declaring them as npm workspaces
//   afterPin         a command and its arguments (an array, run without a shell) that `pin` runs in the repository
//                    root once the released versions are installed, with its node_modules/.bin first on PATH; the
//                    files it changes join the pin commit (a generated copy that must follow a pinned package, say)
// and per package in its own `jskitRelease` field:
//   pack             command printing a custom tarball path (see npm-publication.mjs)
//   versionFiles     JSON files whose `version` must equal the package version
const USAGE = "Usage: jskit-release <prepare|publish|pin> [--cwd <dir>] [--dry-run] [--registry <url>] [--from <repoDir>...] [--branch <name>] [--no-commit|--no-push]";
const DEFAULT_REGISTRY = "https://registry.npmjs.org";

function parseArgs(argv = []) {
  const args = [...argv];
  const intent = String(args.shift() || "").trim();
  if (!["prepare", "publish", "pin"].includes(intent)) {
    throw new Error(USAGE);
  }

  const options = {
    intent,
    cwd: process.cwd(),
    dryRun: false,
    noCommit: false,
    noPush: false,
    branch: "main",
    registry: DEFAULT_REGISTRY,
    from: []
  };

  while (args.length > 0) {
    const argument = String(args.shift() || "");
    if (argument === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (argument === "--no-commit" && intent === "pin") {
      options.noCommit = true;
      continue;
    }
    if (argument === "--no-push" && intent === "pin") {
      options.noPush = true;
      continue;
    }
    const [name, inline] = argument.startsWith("--") && argument.includes("=")
      ? [argument.slice(0, argument.indexOf("=")), argument.slice(argument.indexOf("=") + 1)] : [argument, undefined];
    if (name === "--cwd" || (name === "--from" && intent === "pin")) {
      const value = String(inline ?? args.shift() ?? "").trim();
      if (!value) throw new Error(`${name} requires a directory.`);
      if (name === "--cwd") options.cwd = path.resolve(value);
      else options.from.push(path.resolve(value));
      continue;
    }
    if (name === "--branch" && intent === "pin") {
      const value = String(inline ?? args.shift() ?? "").trim();
      if (!value || value.startsWith("-")) throw new Error("--branch requires a branch name.");
      options.branch = value;
      continue;
    }
    if (name === "--registry") {
      options.registry = normalizeRegistryUrl(inline ?? args.shift() ?? "");
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (intent === "pin" && options.from.length === 0) {
    throw new Error("pin requires at least one --from <repoDir>.");
  }
  if (options.noCommit && options.noPush) {
    throw new Error("--no-commit and --no-push cannot be combined: --no-commit leaves the edits uncommitted, --no-push commits them without pushing.");
  }

  return options;
}

function normalizeRegistryUrl(value) {
  const registry = String(value || "").trim();
  if (!registry) {
    throw new Error("--registry requires a URL.");
  }
  const withScheme = /^[a-z]+:\/\//iu.test(registry) ? registry : `https://${registry}`;
  return withScheme.replace(/\/+$/u, "");
}

async function runCommand(command, args, { cwd, env = process.env } = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed (code=${code}, signal=${signal || "none"})`));
    });
  });
}

function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}

async function assertNoNewerVersions(records, inspection) {
  const histories = await inParallel(records, record => inspection.versions(record));
  for (const [index, record] of records.entries()) {
    const history = histories[index].filter(version => /^\d+\.\d+\.\d+$/u.test(version));
    const current = record.packageJson.version;
    const newer = history.filter(version => compareVersions(version, current) > 0).sort(compareVersions).at(-1);
    if (newer) throw new Error(`${record.name}: checkout version ${current} is behind published ${newer}. Update the checkout before preparing or publishing a release.`);
  }
}

async function lockfileNeedsUpdate(records, repoRoot) {
  const file = path.join(repoRoot, "package-lock.json");
  if (!await fileExists(file)) return true;
  const lock = await readJsonFile(file);
  const manifests = [path.join(repoRoot, "package.json"), ...records.map(record => record.packageJsonPath)];
  for (const manifestPath of manifests) {
    const manifest = await readJsonFile(manifestPath);
    const key = toPosixPath(path.relative(repoRoot, path.dirname(manifestPath)));
    const installed = lock.packages?.[key];
    if (!installed || installed.version !== manifest.version) return true;
    for (const field of DEPENDENCY_FIELDS) {
      const expected = Object.entries(manifest[field] || {});
      if (expected.length !== Object.keys(installed[field] || {}).length ||
          expected.some(([name, value]) => installed[field]?.[name] !== value)) return true;
    }
  }
  return false;
}

// Runs the repository's declared prepare command in the staged source and
// returns the files it changed.
async function runPrepareCommand(source, config) {
  if (!config.prepare) return new Set();
  const before = await snapshotFiles(source);
  const result = spawnSync(config.prepare, { cwd: source, shell: true, encoding: "utf8", stdio: "pipe" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Release prepare command \`${config.prepare}\` failed with exit code ${result.status}. ${result.stderr || result.stdout || ""}`);
  }
  const after = await snapshotFiles(source);
  return new Set([...new Set([...before.keys(), ...after.keys()])]
    .filter(file => before.get(file) !== after.get(file)).map(file => path.join(source, file)));
}

// Whether the staged copy holds a path: all but Git, installed dependencies and
// root scratch/navigation data.
function stagedPath(relative) {
  const parts = relative.split(/[\\/]/u);
  return !parts.some(part => part === ".git" || part === "node_modules") && ![".tmp", ".genesis"].includes(parts[0]);
}

// Ignored outputs (builds, custom pack artifacts) produced while planning stay
// in the isolated source; only files Git would track are applied.
function withoutIgnored(repoRoot, files) {
  if (!files.length) return files;
  const result = spawnSync("git", ["check-ignore", "--stdin"], {
    cwd: repoRoot, input: files.join("\n"), encoding: "utf8"
  });
  if (result.status !== 0 && result.status !== 1) return files;
  const ignored = new Set(result.stdout.split("\n").filter(Boolean));
  return files.filter(file => !ignored.has(file));
}

// `carry` (a publish) keeps the planned tarballs for the publish after the release commit, with what they were packed
// from: the result's `carried`, until its `cleanup()`.
async function prepareRelease({ cwd: repoRoot, dryRun, registry, report = false, carry = false }) {
  const started = performance.now();
  const directory = await mkdtemp(path.join(tmpdir(), "jskit-prepare-"));
  const source = path.join(directory, "source");
  let kept = false;
  try {
    // Both modes plan in isolation. Included ignored files are copied too; only
    // Git, installed dependencies and root scratch/navigation data are omitted.
    await cp(repoRoot, source, {
      recursive: true, verbatimSymlinks: true,
      filter: file => stagedPath(path.relative(repoRoot, file))
    });
    const before = await snapshotFiles(source);
    const config = await releaseConfig(source);
    const staged = await discoverReleasePackages(source);
    assertNoOutsidePathDependencies(staged, source);
    if (await fileExists(path.join(repoRoot, "node_modules"))) {
      // A custom pack command builds from this copy. Linking node_modules would
      // resolve workspace links and dependencies outside the copy and change
      // the build, so it gets a real copy (workspace links stay relative).
      if (staged.some(record => record.packageJson.jskitRelease?.pack)) {
        await cp(path.join(repoRoot, "node_modules"), path.join(source, "node_modules"), { recursive: true, verbatimSymlinks: true });
      } else {
        await symlink(path.join(repoRoot, "node_modules"), path.join(source, "node_modules"), "dir");
      }
    }
    if (!staged.length) throw new Error(`No publishable packages found in ${repoRoot}.`);
    topologicalPublishOrder(staged);
    const current = currentVersionMap(staged);
    const versions = new Map(current);
    const selected = new Map();
    const configPath = String(process.env.NPM_TOKEN || "").trim() ? await createNpmUserConfig(registry, directory, staged) : "";
    const inspection = createPublicationInspection({ directory, registry, configPath });

    await assertNoNewerVersions(staged, inspection);

    // Registry reads run several at a time; packing stays one package at a time.
    async function selectChanged(dependencyChanges, generatedChanges) {
      const pending = staged.filter(record => !selected.has(record.name));
      const metadata = await inParallel(pending, record => inspection.version(record));
      const published = pending.filter((record, index) => {
        if (metadata[index] === null) selected.set(record.name, "unpublished current version");
        return metadata[index] !== null;
      });
      await inspection.packAll(published);
      const tarballs = [];
      for (const record of published) tarballs.push(await inspection.pack(record));
      const compared = await inParallel(published, (record, index) => inspection.compare(record, tarballs[index]));
      const changed = published.filter((record, index) => compared[index].state !== "skip");
      const next = changed.map(record => bumpPatch(current.get(record.name)));
      const occupied = await inParallel(changed, (record, index) => inspection.version(record, next[index]));
      for (const [index, record] of changed.entries()) {
        if (occupied[index] !== null) {
          throw new Error(`${record.name}: chosen next version ${next[index]} is already published. Update the checkout before preparing a release.`);
        }
        const { difference } = compared[published.indexOf(record)];
        const file = path.join(record.dir, difference.replace(/^package\//u, ""));
        const reason = dependencyChanges.has(file) ? "dependency update"
          : generatedChanges.has(file) ? "generated artifact change" : "direct content change";
        versions.set(record.name, next[index]);
        selected.set(record.name, reason);
      }
      return changed.length;
    }

    let changes = await prepareManifests(staged, versions, source, config);
    // Selection only grows, and each published package can be bumped once.
    // Regeneration (for JSKIT: catalog self-version and pattern-owner versions)
    // runs through the repository's declared prepare command.
    for (let pass = 0; pass <= staged.length; pass++) {
      const generated = await runPrepareCommand(source, config);
      if (!await selectChanged(changes, generated)) break;
      if (pass === staged.length) throw new Error("Selective release preparation did not converge.");
      changes = await prepareManifests(staged, versions, source, config);
    }
    await validateReleaseState(staged, source);
    // The lockfile is refreshed on the staged source, before its packages are packed, so every planned tarball,
    // a package holding the lockfile's included, is packed from exactly the files the release commits. A failed
    // refresh applies nothing.
    const updateLockfile = await lockfileNeedsUpdate(staged, source);
    if (!dryRun && updateLockfile) {
      await runCommand("npm", ["install", "--package-lock-only", "--ignore-scripts"], { cwd: source });
    }
    const order = topologicalPublishOrder(staged);
    const byName = new Map(staged.map(record => [record.name, record]));
    const plan = await planPublication(order.map(name => byName.get(name)), { inspection, report });
    const after = await snapshotFiles(source);
    const changedFiles = withoutIgnored(repoRoot, [...new Set([...before.keys(), ...after.keys()])]
      .filter(file => before.get(file) !== after.get(file)));
    for (const record of staged) {
      const old = current.get(record.name);
      const next = versions.get(record.name);
      const selection = selected.get(record.name);
      const state = !selection ? "Keep published" : old === next ? "Keep unpublished" : "New version";
      process.stdout.write(`${state}: ${record.name}@${old}${old !== next ? ` -> ${next}` : ""}${selection ? ` (${selection})` : ""}\n`);
    }
    const missing = plan.filter(entry => entry.state === "publish").length;
    process.stdout.write(`${missing}/${staged.length} packages need publication; ${changedFiles.length} source/generated files would change.\n`);
    if (updateLockfile) process.stdout.write("Lockfile refresh required (package-lock-only; no dependency reinstall).\n");
    if (!dryRun && changedFiles.length) {
      // Fail before applying if another writer changed any of these paths.
      const live = await snapshotFiles(repoRoot);
      for (const file of changedFiles) {
        if (live.get(file) !== before.get(file)) throw new Error(`${file} changed during preparation. Retry after that work finishes.`);
      }
      for (const file of changedFiles) {
        const destination = path.join(repoRoot, file);
        if (!after.has(file)) await rm(destination, { force: true });
        else {
          await mkdir(path.dirname(destination), { recursive: true });
          const stagedFile = path.join(source, file);
          const info = await lstat(stagedFile);
          if (info.isSymbolicLink()) {
            await rm(destination, { force: true });
            await symlink(await readlink(stagedFile), destination);
          } else {
            await cp(stagedFile, destination);
            await chmod(destination, info.mode & 0o7777);
          }
        }
      }
    }
    process.stdout.write(`${dryRun ? "Prepare dry-run complete" : "Release source prepared"}. ${(performance.now() - started).toFixed(0)} ms; ` +
      `${inspection.stats.packed} packs, ${inspection.stats.lookups} registry lookups, ${inspection.stats.downloaded} downloads; ` +
      `${inspection.stats.packReused} packs, ${inspection.stats.metadataReused} lookups, ${inspection.stats.downloadReused} downloads reused.\n`);
    process.stdout.write(`Subprocess time: packing ${inspection.stats.packMs.toFixed(0)} ms, registry metadata ${inspection.stats.lookupMs.toFixed(0)} ms, verified downloads ${inspection.stats.downloadMs.toFixed(0)} ms.\n`);
    const result = { plan: plan.filter(entry => entry.state === "publish"), changedFiles };
    if (!carry) return result;
    // Each planned tarball, with its package's directory, and the staged files it was packed from.
    result.carried = {
      entries: plan.map(entry => ({ ...entry, dir: toPosixPath(path.relative(source, byName.get(entry.name).dir)) })),
      staged: new Map([...after].map(([file, state]) => [toPosixPath(file), state]))
    };
    result.cleanup = () => rm(directory, { recursive: true, force: true });
    kept = true;
    await rm(source, { recursive: true, force: true });
    return result;
  } finally {
    if (!kept) await rm(directory, { recursive: true, force: true });
  }
}

async function createNpmUserConfig(registry, directory, records = []) {
  const token = String(process.env.NPM_TOKEN || "").trim();
  if (!token) {
    throw new Error("NPM_TOKEN is required for publish.");
  }
  const registryUrl = new URL(registry);
  const registryWithSlash = `${registryUrl.origin}${registryUrl.pathname}`.replace(/\/+$/u, "/");
  const authHost = `${registryUrl.host}${registryUrl.pathname}`.replace(/\/+$/u, "");
  const configPath = path.join(directory, "npmrc");
  const scopes = [...new Set(records.map(record => /^(@[^/]+)\//u.exec(record.name)?.[1]).filter(Boolean))].sort();
  await writeFile(
    configPath,
    `${scopes.map(scope => `${scope}:registry=${registryWithSlash}\n`).join("")}registry=${registryWithSlash}\n//${authHost}/:_authToken=${token}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  return configPath;
}

function git(repoRoot, args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000
  }).trim();
}

// The checkout a release writes from: on `branch` (main for every publish; a
// pin may name another with --branch), clean, and at origin's commit for that
// branch. The tool never switches or resets branches; the caller checks out.
// allowAhead is for a caller that pushes nothing: its local commits stay local,
// so only a checkout missing part of origin's branch is unsafe.
function assertReleaseCheckout(repoRoot, { allowAhead = false, branch = "main" } = {}) {
  const action = branch === "main" ? "Publish" : `pin --branch ${branch}`;
  if (git(repoRoot, ["branch", "--show-current"]) !== branch) {
    throw new Error(`${action} requires the ${branch} branch.`);
  }
  if (git(repoRoot, ["status", "--porcelain", "--untracked-files=all"])) {
    throw new Error(`${action} requires a clean checkout; commit all release changes first.`);
  }
  const head = git(repoRoot, ["rev-parse", "HEAD"]);
  let remoteHead;
  try {
    remoteHead = git(repoRoot, ["ls-remote", "--exit-code", "origin", `refs/heads/${branch}`]).split(/\s+/u)[0];
  } catch (error) {
    // --exit-code makes a missing branch exit 2; anything else is git's own failure.
    throw new Error(error.status === 2 ? `${action} requires origin to have a ${branch} branch.`
      : `${action} could not read origin's ${branch} branch: ${String(error.stderr || error.message).trim()}`);
  }
  if (head === remoteHead) return;
  if (!allowAhead) {
    throw new Error(`${action} requires HEAD to match origin's ${branch} branch; reconcile and push ${branch} first.`);
  }
  // A commit this clone never fetched makes git fail, which is also a refusal.
  const contained = spawnSync("git", ["merge-base", "--is-ancestor", remoteHead, "HEAD"], { cwd: repoRoot, stdio: "ignore" });
  if (contained.status !== 0) {
    throw new Error(`pin --no-commit requires HEAD to contain origin's ${branch} branch; this checkout is behind or diverged, so reconcile it first.`);
  }
}

function commitAll(repoRoot, message) {
  if (!git(repoRoot, ["status", "--porcelain"])) return false;
  git(repoRoot, ["add", "-A"]);
  git(repoRoot, ["commit", "--quiet", "-m", message]);
  return true;
}

// The branch can move while a release runs, so the commit is replayed on it
// and the push retried.
function commitAndPush(repoRoot, message, branch = "main") {
  if (!commitAll(repoRoot, message)) return false;
  for (let attempt = 1; ; attempt++) {
    const push = spawnSync("git", ["push", "--quiet", "origin", `HEAD:${branch}`], { cwd: repoRoot, encoding: "utf8" });
    if (push.status === 0) break;
    if (attempt >= 3) throw new Error(`git push failed in ${repoRoot}: ${push.stderr || push.stdout}`);
    process.stdout.write(`${path.basename(repoRoot)}: ${branch} moved; rebasing the release commit and retrying\n`);
    git(repoRoot, ["pull", "--quiet", "--rebase", "origin", branch]);
  }
  process.stdout.write(`${path.basename(repoRoot)}: pushed ${git(repoRoot, ["rev-parse", "--short", "HEAD"])} ${message.split("\n")[0]}\n`);
  return true;
}

function releaseCommitMessage(entries) {
  if (!entries.length) return "Refresh release metadata";
  const names = entries.map(entry => `${entry.name}@${entry.version}`);
  const subject = names.length <= 4 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
  return `Release ${subject}${names.length > 4 ? `\n\n${names.join("\n")}` : ""}`;
}

const CATALOG_PACKAGE = "@jskit-ai/jskit-catalog";

// The versions the catalog being published pins (its catalog/packages.json release), but its own.
async function catalogPins(record, entry) {
  const catalog = JSON.parse(await readFile(path.join(record.dir, "catalog", "packages.json"), "utf8"));
  return Object.entries(catalog?.release?.packages || {}).filter(([name]) => name !== entry.name);
}

// Waits until the registry serves every pinned version as its package's latest, as installReleasedPins waits for npm,
// reading several packages at a time, and refuses, naming each one, if it still does not.
async function waitUntilServedAsLatest(pins, inspection, catalog, {
  attempts = Number(process.env.JSKIT_RELEASE_SERVE_ATTEMPTS || 120),
  delayMs = Number(process.env.JSKIT_RELEASE_RETRY_DELAY_MS || 5_000)
} = {}) {
  let pending = pins;
  for (let attempt = 1; ; attempt++) {
    const serving = await inParallel(pending, ([name]) => inspection.serving(name));
    const unserved = pending.flatMap(([name, version], index) => {
      const { versions, latest } = serving[index];
      return versions.includes(version) && latest === version ? [] : [[name, version, versions.includes(version), latest]];
    });
    if (unserved.length === 0) return;
    if (attempt >= attempts) {
      throw new Error(`${catalog.name}@${catalog.version} is published under next; latest moves to it once npm serves every ` +
        `version it pins as latest, and it does not serve these yet:\n${
        unserved.map(([name, version, served, latest]) => `- ${name}@${version} (${served ? "served" : "not served"}, latest ${latest ?? "none"})`)
          .join("\n")}\nRerun the publish once npm serves them: the published packages are skipped and latest then moves to the catalog.`);
    }
    // Said when the count changes, and about once a minute while it does not.
    if (attempt === 1 || unserved.length !== pending.length || attempt % Math.max(1, Math.round(60_000 / (delayMs || 1))) === 0) {
      process.stdout.write(`npm does not serve ${unserved.length} pinned version(s) as latest yet; retrying in ${Math.round(delayMs / 1000)} s (${attempt}/${attempts})\n`);
    }
    pending = unserved.map(([name, version]) => [name, version]);
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
}

// `jskit update` installs the catalog npm calls latest, so latest names a catalog only once the registry serves every
// version it pins as that package's latest: the catalog goes up under next with the packages, and npm serves it by the
// time a consumer pins its exact version, while latest moves to it only after that wait. A publish whose wait failed
// left the catalog under next; a rerun, which uploads nothing, moves latest to it.
async function moveLatestToCatalog(entry, record, inspection, npmArgs) {
  if ((await inspection.serving(entry.name)).latest === entry.version) return;
  await waitUntilServedAsLatest(await catalogPins(record, entry), inspection, entry);
  await runCommand("npm", ["dist-tag", "add", `${entry.name}@${entry.version}`, "latest", ...npmArgs]);
}

// The tarballs preparation packed that this release commit publishes: a package's tarball only when every file under
// its directory is what preparation staged and packed it from (each file Git tracks there has the staged contents and
// mode, and the staged copy has no other file there that Git would track). The commit of an ordinary release is the
// staged tree; one rebased onto work that landed on main meanwhile can differ, and a package it differs in is packed
// again from the checkout, as every package was before. Installed dependencies are not compared: a release does not
// change them.
async function committedTarballs(repoRoot, records, { entries, staged }) {
  const byName = new Map(records.map(record => [record.name, record]));
  const carried = entries.filter(entry => byName.get(entry.name)?.packageJson.version === entry.version);
  const under = (file, dir) => dir === "" || file.startsWith(`${dir}/`);
  const relevant = file => stagedPath(file) && carried.some(entry => under(file, entry.dir));
  const tracked = execFileSync("git", ["ls-files", "--stage", "-z"], { cwd: repoRoot, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
    .split("\0").filter(Boolean).filter(line => !line.startsWith("160000 ")).map(line => line.slice(line.indexOf("\t") + 1))
    .filter(relevant);
  const states = await inParallel(tracked, file => fileState(path.join(repoRoot, file)), 32);
  const trackedFiles = new Set(tracked);
  const differing = [
    ...tracked.filter((file, index) => states[index] !== staged.get(file)),
    ...withoutIgnored(repoRoot, [...staged.keys()].filter(file => !trackedFiles.has(file) && relevant(file)))
  ].sort();
  const tarballs = new Map();
  for (const entry of carried) {
    const difference = differing.find(file => under(file, entry.dir));
    if (!difference) tarballs.set(entry.name, entry.tarball);
    else process.stdout.write(`${entry.name}@${entry.version}: the release commit's ${difference} differs from what preparation packed; packing it again from the checkout\n`);
  }
  process.stdout.write(`Publishing the tarballs preparation packed for ${tarballs.size}/${records.length} packages: ` +
    "the release commit holds exactly the files they were packed from.\n");
  return tarballs;
}

// Uploads each entry once every entry it requires is up, several at a time, level by level: as in one-at-a-time
// dependency order, npm never serves a package before a version it requires.
async function uploadInDependencyOrder(entries, recordsByName, upload) {
  const names = new Set(entries.map(entry => entry.name));
  const levels = new Map();
  for (const entry of entries) {
    const required = [...recordsByName.get(entry.name).localDependencies].filter(name => names.has(name));
    levels.set(entry.name, Math.max(-1, ...required.map(name => levels.get(name))) + 1);
  }
  for (let level = 0; level < entries.length; level++) {
    const ready = entries.filter(entry => levels.get(entry.name) === level);
    if (!ready.length) break;
    await inParallel(ready, upload);
  }
}

// `carried` (from a publish's preparation) supplies tarballs already packed; publish still rechecks every exact
// version against npm before any upload.
async function publishRelease(records, { cwd: repoRoot, registry }, carried = null) {
  assertReleaseCheckout(repoRoot);
  assertNoOutsidePathDependencies(records, repoRoot);
  await validateReleaseState(records, repoRoot);
  const order = topologicalPublishOrder(records);
  const recordsByName = new Map(records.map((record) => [record.name, record]));
  const directory = await mkdtemp(path.join(tmpdir(), "jskit-release-"));
  try {
    const configPath = await createNpmUserConfig(registry, directory, records);
    const npmArgs = ["--registry", registry, "--workspaces=false", "--userconfig", configPath];
    await runCommand("npm", ["whoami", "--registry", registry, "--userconfig", configPath]);
    const inspection = createPublicationInspection({ directory, registry, configPath });
    await assertNoNewerVersions(records, inspection);
    const tarballs = carried ? await committedTarballs(repoRoot, records, carried) : new Map();
    const plan = await planPublication(order.map(name => recordsByName.get(name)), { inspection, tarballs });
    const upload = (entry, tag) => runCommand("npm", ["publish", entry.tarball, "--access", "public", "--tag", tag, ...npmArgs]);
    await uploadInDependencyOrder(plan.filter(entry => entry.state !== "skip" && entry.name !== CATALOG_PACKAGE), recordsByName,
      entry => upload(entry, "latest"));
    const catalog = plan.find(entry => entry.name === CATALOG_PACKAGE);
    if (catalog) {
      if (catalog.state !== "skip") await upload(catalog, "next");
      await moveLatestToCatalog(catalog, recordsByName.get(CATALOG_PACKAGE), inspection, npmArgs);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  process.stdout.write("Publish complete.\n");
}

// publish: prepare the clean, current main checkout, commit and push the
// prepared release, then publish it. A dry run only reports the plan.
async function publishCommand(options) {
  if (options.dryRun) {
    await prepareRelease({ ...options, report: true });
    process.stdout.write("Publish dry-run complete.\n");
    return;
  }
  assertReleaseCheckout(options.cwd);
  const prepared = await prepareRelease({ ...options, carry: true });
  try {
    commitAndPush(options.cwd, releaseCommitMessage(prepared.plan));
    await publishRelease(await discoverReleasePackages(options.cwd), options, prepared.carried);
  } finally {
    await prepared.cleanup();
  }
}

// npm cannot move exactly pinned packages that require each other in
// lockstep (assistant-core and assistant-runtime, say): the locked old
// versions still demand the old peers, and install stops with ERESOLVE.
// Forgetting only the pinned packages' lock entries lets npm resolve them
// afresh while every other locked dependency stays as it was.
async function forgetPinnedLockEntries(repoRoot, names) {
  const lockPath = path.join(repoRoot, "package-lock.json");
  let lock;
  try {
    lock = JSON.parse(await readFile(lockPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const key of Object.keys(lock.packages || {})) {
    const name = key.split("node_modules/").at(-1);
    if (key.includes("node_modules/") && names.has(name)) delete lock.packages[key];
  }
  await writeFile(lockPath, serializeJson(lock), "utf8");
}

// npm can take minutes to serve a just-published version everywhere. A retry reads the registry through a throwaway
// cache: --prefer-online still reuses a cached package list that predates the release (observed in a real deploy),
// and cleaning the operator's own cache instead made every later install download everything again.
async function installReleasedPins(repoRoot, { attempts = 20, delayMs = Number(process.env.JSKIT_RELEASE_RETRY_DELAY_MS || 10_000) } = {}) {
  for (let attempt = 1; ; attempt++) {
    const cache = attempt > 1 ? await mkdtemp(path.join(tmpdir(), "jskit-pin-cache-")) : "";
    let result;
    try {
      result = spawnSync("npm", ["install", "--no-audit", "--no-fund", "--prefer-online", ...(cache ? ["--cache", cache] : [])],
        { cwd: repoRoot, encoding: "utf8" });
    } finally {
      if (cache) await rm(cache, { recursive: true, force: true });
    }
    if (result.status === 0) return;
    const output = `${result.stdout || ""}${result.stderr || ""}`;
    if (!/ETARGET|notarget|E404/u.test(output) || attempt >= attempts) {
      process.stderr.write(output);
      throw new Error(`npm install failed in ${repoRoot}.`);
    }
    process.stdout.write(`npm does not serve the new versions yet; retrying in ${Math.round(delayMs / 1000)} s (${attempt}/${attempts})\n`);
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
}

const PIN_COMMIT_MESSAGE = "Consume released packages";

const CATALOG = "@jskit-ai/jskit-catalog";

/** Whether the repository's own manifest declares the JSKIT catalog, whose block its AGENTS.md carries. */
async function declaresCatalog(repoRoot) {
  const manifest = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  return Boolean(manifest.dependencies?.[CATALOG] || manifest.devDependencies?.[CATALOG]);
}

/** Runs a step of the pin on the installed versions, showing its output; a failure stops the pin before its commit. */
function runPinStep(repoRoot, name, argv, env = process.env) {
  const ran = spawnSync(argv[0], argv.slice(1), { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env });
  const output = `${ran.stdout || ""}${ran.stderr || ""}`.trim();
  if (ran.error || ran.status !== 0) {
    throw new Error(`${name} ${ran.error ? `could not start (${ran.error.message})`
      : `failed with exit code ${ran.status ?? ran.signal}`}, so the pin was not committed.${output ? ` ${output}` : ""}`);
  }
  if (output) process.stdout.write(`${output}\n`);
}

/** The installed catalog's `jskit agents`, so the pin commit carries the block its `jskit check` asks AGENTS.md for. */
async function writeInstalledAgentsBlock(repoRoot) {
  const catalogRoot = path.join(repoRoot, "node_modules", ...CATALOG.split("/"));
  const manifest = await readFile(path.join(catalogRoot, "package.json"), "utf8").catch(error => {
    throw new Error(`${CATALOG} is not installed in ${repoRoot} (${error.message}), so the pin was not committed.`);
  });
  const { bin } = JSON.parse(manifest);
  process.stdout.write(`${path.basename(repoRoot)}: writing the installed catalog's JSKIT block in AGENTS.md (jskit agents)\n`);
  runPinStep(repoRoot, "jskit agents", [process.execPath, path.join(catalogRoot, typeof bin === "string" ? bin : bin.jskit), "agents"]);
}

// pin: make every dependency on a package published from the given
// repositories follow that package's current version, keeping ^/~, then
// install, write the installed catalog's JSKIT block in AGENTS.md when the
// repository declares @jskit-ai/jskit-catalog (jskit agents), commit and push.
// --branch <name> pins that branch instead of main (a project starter kept on
// its own branch, say): the checkout must be on it and current with origin's,
// and the commit is pushed to it.
// --no-commit stops after the install, leaving the edits for the caller to
// build from and discard (a deploy rehearsal, or a release clone proving
// unpushed commits on the new versions). It pushes nothing, so it also accepts
// a checkout ahead of origin's branch; a real pin would push those commits.
// --no-push commits the pin but pushes nothing, for a caller that pushes the
// commit elsewhere first (a deploy proves it on a candidate branch, then moves
// the branch to it). Its commit sits directly on origin's branch, so the
// checkout must match origin's branch exactly.
async function pinCommand({ cwd: repoRoot, from, dryRun, noCommit, noPush, branch }) {
  const versions = new Map();
  for (const dir of from) {
    for (const record of await discoverReleasePackages(dir)) versions.set(record.name, record.packageJson.version);
  }
  const { afterPin } = await releaseConfig(repoRoot);
  if (!dryRun) assertReleaseCheckout(repoRoot, { allowAhead: noCommit, branch });
  const changes = [];
  for (const manifest of await discoverManifests(repoRoot)) {
    const manifestChanges = [];
    if (!updatePackageDependencyVersions(manifest.packageJson, versions, manifestChanges)) continue;
    const relative = toPosixPath(path.relative(repoRoot, manifest.packageJsonPath));
    changes.push(...manifestChanges.map(change => `${relative}: ${change}`));
    if (!dryRun) await writeFile(manifest.packageJsonPath, serializeJson(manifest.packageJson), "utf8");
  }
  if (!changes.length) {
    process.stdout.write(`${path.basename(repoRoot)}: pins already match the released versions\n`);
    return;
  }
  for (const change of changes) process.stdout.write(`${path.basename(repoRoot)}: ${change}\n`);
  // Shown as its argv, one line however its arguments are written.
  const after = JSON.stringify(afterPin);
  const catalog = await declaresCatalog(repoRoot);
  if (dryRun) {
    if (catalog) {
      process.stdout.write(`${path.basename(repoRoot)}: would write the installed catalog's JSKIT block in AGENTS.md (jskit agents) after the install\n`);
    }
    if (afterPin.length) process.stdout.write(`${path.basename(repoRoot)}: would run ${after} after the install (jskitRelease.afterPin)\n`);
    process.stdout.write("Pin dry-run complete.\n");
    return;
  }
  await forgetPinnedLockEntries(repoRoot, new Set(versions.keys()));
  await installReleasedPins(repoRoot);
  if (catalog) await writeInstalledAgentsBlock(repoRoot);
  if (afterPin.length) {
    // The repository's own step on the versions just installed; whatever it changes is committed with the pins.
    process.stdout.write(`${path.basename(repoRoot)}: running ${after} (jskitRelease.afterPin)\n`);
    const bin = path.join(repoRoot, "node_modules", ".bin");
    runPinStep(repoRoot, `jskitRelease.afterPin ${after}`, afterPin,
      { ...process.env, PATH: process.env.PATH ? `${bin}${path.delimiter}${process.env.PATH}` : bin });
  }
  if (noCommit) {
    process.stdout.write(`${path.basename(repoRoot)}: pins installed; not committed\n`);
    return;
  }
  if (noPush) {
    commitAll(repoRoot, PIN_COMMIT_MESSAGE);
    process.stdout.write(`${path.basename(repoRoot)}: committed ${git(repoRoot, ["rev-parse", "--short", "HEAD"])} ${PIN_COMMIT_MESSAGE} on ${branch}; not pushed\n`);
    return;
  }
  commitAndPush(repoRoot, PIN_COMMIT_MESSAGE, branch);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.intent === "prepare") await prepareRelease(options);
  else if (options.intent === "publish") await publishCommand(options);
  else await pinCommand(options);
}

export {
  assertNoOutsidePathDependencies,
  assertReleaseCheckout,
  bumpPatch,
  collectPublishDependencies,
  collectPatternPackageJsonPaths,
  collectVersionMismatches,
  commitAndPush,
  discoverManifests,
  discoverReleasePackages,
  main,
  parseArgs,
  topologicalPublishOrder,
  updatePackageDependencyVersions,
  updatePatternPackageJsonContents,
  validateReleaseState
};
