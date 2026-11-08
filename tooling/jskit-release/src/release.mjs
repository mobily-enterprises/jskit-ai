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
import { createPublicationInspection, planPublication, snapshotFiles } from "./npm-publication.mjs";

// The release target is the working directory (or --cwd). Its publishable
// packages are every non-private package among the root, its workspaces and
// `file:` dependencies inside the repository; prepare and publish refuse one
// that depends on a local path outside it. Repository-specific behavior is
// declared in the root package.json `jskitRelease` field:
//   prepare          command that regenerates derived files during preparation
//   nestedManifests  package subdirectories whose package.json pins follow the release
//   manifests        further package directories (or `*` patterns) the repository owns
//                    without declaring them as npm workspaces
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
  for (const record of records) {
    const history = (await inspection.versions(record)).filter(version => /^\d+\.\d+\.\d+$/u.test(version));
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

async function prepareRelease({ cwd: repoRoot, dryRun, registry, report = false }) {
  const started = performance.now();
  const directory = await mkdtemp(path.join(tmpdir(), "jskit-prepare-"));
  const source = path.join(directory, "source");
  try {
    // Both modes plan in isolation. Included ignored files are copied too; only
    // Git, installed dependencies and root scratch/navigation data are omitted.
    await cp(repoRoot, source, {
      recursive: true, verbatimSymlinks: true,
      filter: file => {
        const parts = path.relative(repoRoot, file).split(path.sep);
        return !parts.some(part => part === ".git" || part === "node_modules") &&
          ![".tmp", ".genesis"].includes(parts[0]);
      }
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

    async function selectChanged(dependencyChanges, generatedChanges) {
      let bumped = 0;
      const published = [];
      for (const record of staged) {
        if (!selected.has(record.name) && await inspection.version(record) !== null) published.push(record);
      }
      await inspection.packAll(published);
      for (const record of staged) {
        if (selected.has(record.name)) continue;
        if (await inspection.version(record) === null) {
          selected.set(record.name, "unpublished current version");
          continue;
        }
        const { state, difference } = await inspection.compare(record, await inspection.pack(record));
        if (state === "skip") continue;
        const file = path.join(record.dir, difference.replace(/^package\//u, ""));
        const reason = dependencyChanges.has(file) ? "dependency update"
          : generatedChanges.has(file) ? "generated artifact change" : "direct content change";
        const next = bumpPatch(current.get(record.name));
        if (await inspection.version(record, next) !== null) {
          throw new Error(`${record.name}: chosen next version ${next} is already published. Update the checkout before preparing a release.`);
        }
        versions.set(record.name, next);
        selected.set(record.name, reason);
        bumped++;
      }
      return bumped;
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
    const updateLockfile = await lockfileNeedsUpdate(staged, source);
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
    if (!dryRun && updateLockfile) {
      await runCommand("npm", ["install", "--package-lock-only", "--ignore-scripts"], { cwd: repoRoot });
    }
    process.stdout.write(`${dryRun ? "Prepare dry-run complete" : "Release source prepared"}. ${(performance.now() - started).toFixed(0)} ms; ` +
      `${inspection.stats.packed} packs, ${inspection.stats.lookups} registry lookups, ${inspection.stats.downloaded} downloads; ` +
      `${inspection.stats.packReused} packs, ${inspection.stats.metadataReused} lookups, ${inspection.stats.downloadReused} downloads reused.\n`);
    process.stdout.write(`Subprocess time: packing ${inspection.stats.packMs.toFixed(0)} ms, registry metadata ${inspection.stats.lookupMs.toFixed(0)} ms, verified downloads ${inspection.stats.downloadMs.toFixed(0)} ms.\n`);
    return { plan: plan.filter(entry => entry.state === "publish"), changedFiles };
  } finally {
    await rm(directory, { recursive: true, force: true });
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
// and refuses, naming each one, if it still does not.
async function waitUntilServedAsLatest(pins, inspection, {
  attempts = Number(process.env.JSKIT_RELEASE_SERVE_ATTEMPTS || 20),
  delayMs = Number(process.env.JSKIT_RELEASE_RETRY_DELAY_MS || 30_000)
} = {}) {
  let pending = pins;
  for (let attempt = 1; ; attempt++) {
    const unserved = [];
    for (const [name, version] of pending) {
      const { versions, latest } = await inspection.serving(name);
      if (!versions.includes(version) || latest !== version) unserved.push([name, version, versions.includes(version), latest]);
    }
    if (unserved.length === 0) return;
    if (attempt >= attempts) {
      throw new Error(`The catalog is not published: the registry does not serve these pinned versions as latest yet:\n${
        unserved.map(([name, version, served, latest]) => `- ${name}@${version} (${served ? "served" : "not served"}, latest ${latest ?? "none"})`)
          .join("\n")}\nRerun the publish once npm serves them; the published packages are skipped.`);
    }
    process.stdout.write(`npm does not serve ${unserved.length} pinned version(s) as latest yet; retrying in ${Math.round(delayMs / 1000)} s (${attempt}/${attempts})\n`);
    pending = unserved.map(([name, version]) => [name, version]);
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
}

async function publishRelease(records, { cwd: repoRoot, registry }) {
  assertReleaseCheckout(repoRoot);
  assertNoOutsidePathDependencies(records, repoRoot);
  await validateReleaseState(records, repoRoot);
  const order = topologicalPublishOrder(records);
  const recordsByName = new Map(records.map((record) => [record.name, record]));
  const directory = await mkdtemp(path.join(tmpdir(), "jskit-release-"));
  try {
    const configPath = await createNpmUserConfig(registry, directory, records);
    await runCommand("npm", ["whoami", "--registry", registry, "--userconfig", configPath]);
    const inspection = createPublicationInspection({ directory, registry, configPath });
    await assertNoNewerVersions(records, inspection);
    const plan = await planPublication(order.map(name => recordsByName.get(name)), { inspection });
    const upload = entry => runCommand("npm", [
      "publish", entry.tarball, "--access", "public", "--tag", "latest", "--registry", registry, "--workspaces=false",
      "--userconfig", configPath
    ]);
    // The catalog is what `jskit update` installs as latest, so it goes last, once the registry serves every version
    // it pins as that package's latest: published before them, an update in between installs versions npm does not
    // serve yet, or a package whose latest still names something else (a placeholder its creator published).
    const catalog = plan.find(entry => entry.name === CATALOG_PACKAGE && entry.state !== "skip");
    for (const entry of plan) {
      if (entry.state !== "skip" && entry !== catalog) await upload(entry);
    }
    if (catalog) {
      await waitUntilServedAsLatest(await catalogPins(recordsByName.get(CATALOG_PACKAGE), catalog), inspection);
      await upload(catalog);
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
  const { plan } = await prepareRelease(options);
  commitAndPush(options.cwd, releaseCommitMessage(plan));
  await publishRelease(await discoverReleasePackages(options.cwd), options);
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

// npm can take minutes to serve a just-published version everywhere.
async function installReleasedPins(repoRoot, { attempts = 20, delayMs = Number(process.env.JSKIT_RELEASE_RETRY_DELAY_MS || 30_000) } = {}) {
  for (let attempt = 1; ; attempt++) {
    const result = spawnSync("npm", ["install", "--no-audit", "--no-fund", "--prefer-online"], { cwd: repoRoot, encoding: "utf8" });
    if (result.status === 0) return;
    const output = `${result.stdout || ""}${result.stderr || ""}`;
    if (!/ETARGET|notarget|E404/u.test(output) || attempt >= attempts) {
      process.stderr.write(output);
      throw new Error(`npm install failed in ${repoRoot}.`);
    }
    process.stdout.write(`npm does not serve the new versions yet; retrying in ${Math.round(delayMs / 1000)} s (${attempt}/${attempts})\n`);
    // --prefer-online still reuses a cached package list that predates the
    // release; observed in a real deploy. Drop it so the retry sees the registry.
    spawnSync("npm", ["cache", "clean", "--force"], { cwd: repoRoot, stdio: "ignore" });
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
}

const PIN_COMMIT_MESSAGE = "Consume released packages";

// pin: make every dependency on a package published from the given
// repositories follow that package's current version, keeping ^/~, then
// install, commit and push.
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
  if (dryRun) {
    process.stdout.write("Pin dry-run complete.\n");
    return;
  }
  await forgetPinnedLockEntries(repoRoot, new Set(versions.keys()));
  await installReleasedPins(repoRoot);
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
