import { chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createPublicationInspection, planPublication, snapshotFiles } from "./npm-publication.mjs";

// The release target is the working directory (or --cwd). Its publishable
// packages are every non-private package among the root, its workspaces and
// `file:` dependencies inside the repository. Repository-specific behavior is
// declared in the root package.json `jskitRelease` field:
//   prepare          command that regenerates derived files during preparation
//   nestedManifests  package subdirectories whose package.json pins follow the release
// and per package in its own `jskitRelease` field:
//   pack             command printing a custom tarball path (see npm-publication.mjs)
//   versionFiles     JSON files whose `version` must equal the package version
const USAGE = "Usage: jskit-release <prepare|publish|pin> [--cwd <dir>] [--dry-run] [--registry <url>] [--from <repoDir>...]";
const DEPENDENCY_FIELDS = Object.freeze([
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies"
]);
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
    registry: DEFAULT_REGISTRY,
    from: []
  };

  while (args.length > 0) {
    const argument = String(args.shift() || "");
    if (argument === "--dry-run") {
      options.dryRun = true;
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
    if (argument === "--registry") {
      options.registry = normalizeRegistryUrl(args.shift());
      continue;
    }
    if (argument.startsWith("--registry=")) {
      options.registry = normalizeRegistryUrl(argument.slice("--registry=".length));
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (intent === "pin" && options.from.length === 0) {
    throw new Error("pin requires at least one --from <repoDir>.");
  }

  return options;
}

function normalizeRegistryUrl(value = DEFAULT_REGISTRY) {
  const registry = String(value || "").trim();
  if (!registry) {
    throw new Error("--registry requires a URL.");
  }
  const withScheme = /^[a-z]+:\/\//iu.test(registry) ? registry : `https://${registry}`;
  return withScheme.replace(/\/+$/u, "");
}

async function fileExists(absolutePath) {
  try {
    await stat(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(absolutePath) {
  return JSON.parse(await readFile(absolutePath, "utf8"));
}

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function toPosixPath(value) {
  return String(value || "").split(path.sep).join("/");
}

// Values written as an exact version or a ^/~ range follow released versions,
// keeping their prefix. Protocol specs (file:, workspace:, git, ...) and other
// ranges are left alone.
function followVersion(declared, version) {
  const match = /^([~^]?)\d+\.\d+\.\d+$/u.exec(String(declared || ""));
  return match ? `${match[1]}${version}` : null;
}

function bumpPatch(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(String(version || "").trim());
  if (!match) {
    throw new Error(`Package versions must use x.y.z: ${version}`);
  }
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

async function expandWorkspacePattern(repoRoot, pattern) {
  const segments = String(pattern || "").replace(/^\.\//u, "").split("/").filter(Boolean);
  if (!segments.length || segments.includes("**")) return [];
  let directories = [repoRoot];
  for (const segment of segments) {
    const matcher = new RegExp(`^${segment.replace(/[.+^${}()|[\]\\]/gu, "\\$&").replace(/\*/gu, "[^/]*")}$`, "u");
    const next = [];
    for (const directory of directories) {
      for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
        if (entry.isDirectory() && entry.name !== "node_modules" && matcher.test(entry.name)) next.push(path.join(directory, entry.name));
      }
    }
    directories = next;
  }
  return directories;
}

// Every manifest the repository owns: the root, its workspaces and `file:`
// dependency directories inside the repository (followed transitively).
async function discoverManifests(repoRoot) {
  const root = path.resolve(repoRoot);
  const rootJson = await readJsonFile(path.join(root, "package.json"));
  const patterns = Array.isArray(rootJson.workspaces) ? rootJson.workspaces : rootJson.workspaces?.packages || [];
  const queue = [root];
  for (const pattern of patterns) {
    if (!String(pattern).startsWith("!")) queue.push(...(await expandWorkspacePattern(root, pattern)).sort());
  }
  const seen = new Set();
  const manifests = [];
  while (queue.length > 0) {
    const dir = queue.shift();
    const packageJsonPath = path.join(dir, "package.json");
    if (seen.has(dir) || !(await fileExists(packageJsonPath))) continue;
    seen.add(dir);
    const packageJson = await readJsonFile(packageJsonPath);
    manifests.push({ dir, packageJsonPath, packageJson });
    for (const field of DEPENDENCY_FIELDS) {
      for (const spec of Object.values(packageJson[field] || {})) {
        if (!String(spec).startsWith("file:")) continue;
        const target = path.resolve(dir, String(spec).slice("file:".length));
        if (target === root || target.startsWith(`${root}${path.sep}`)) queue.push(target);
      }
    }
  }
  return manifests;
}

async function discoverReleasePackages(repoRoot) {
  const records = [];
  for (const manifest of await discoverManifests(repoRoot)) {
    const name = String(manifest.packageJson.name || "").trim();
    if (!name || manifest.packageJson.private === true) continue;
    if (records.some(record => record.name === name)) throw new Error(`${name} is declared by more than one package directory.`);
    records.push({ name, ...manifest, localDependencies: new Set() });
  }
  return records.sort((left, right) => left.name.localeCompare(right.name));
}

async function releaseConfig(repoRoot) {
  const config = (await readJsonFile(path.join(repoRoot, "package.json"))).jskitRelease || {};
  return {
    prepare: String(config.prepare || ""),
    nestedManifests: Array.isArray(config.nestedManifests) ? config.nestedManifests.map(String) : []
  };
}

function collectPublishDependencies(packageJson, localNames) {
  const dependencies = new Set();
  for (const field of DEPENDENCY_FIELDS) {
    for (const dependencyName of Object.keys(packageJson?.[field] || {})) {
      if (localNames.has(dependencyName)) {
        dependencies.add(dependencyName);
      }
    }
  }
  return dependencies;
}

function hydrateLocalDependencies(records) {
  const localNames = new Set(records.map((record) => record.name));
  for (const record of records) {
    record.localDependencies = collectPublishDependencies(record.packageJson, localNames);
  }
}

function currentVersionMap(records) {
  return new Map(records.map((record) => {
    const version = String(record.packageJson.version || "").trim();
    if (!/^(\d+)\.(\d+)\.(\d+)$/u.test(version)) {
      throw new Error(`${record.name} must use an exact x.y.z version.`);
    }
    return [record.name, version];
  }));
}

function updatePackageDependencyVersions(packageJson, versions, changes = []) {
  let changed = false;
  for (const field of DEPENDENCY_FIELDS) {
    const dependencies = packageJson?.[field];
    if (!dependencies || typeof dependencies !== "object") {
      continue;
    }
    for (const dependencyName of Object.keys(dependencies)) {
      const declared = dependencies[dependencyName];
      const next = versions.has(dependencyName) ? followVersion(declared, versions.get(dependencyName)) : null;
      if (next === null || declared === next) {
        continue;
      }
      dependencies[dependencyName] = next;
      changes.push(`${field}.${dependencyName} ${declared} -> ${next}`);
      changed = true;
    }
  }

  return changed;
}

async function collectPatternPackageJsonPaths(packageRoot, nestedManifests = ["patterns", "examples"]) {
  const results = [];
  const directories = [];
  for (const name of nestedManifests) {
    const directory = path.join(packageRoot, name);
    if (await fileExists(directory)) directories.push(directory);
  }
  while (directories.length > 0) {
    const directory = directories.pop();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules") {
        directories.push(entryPath);
      } else if (entry.isFile() && entry.name === "package.json") {
        results.push(entryPath);
      }
    }
  }
  return results.sort();
}

function updatePatternPackageJsonContents(contents, versions) {
  const packageJson = JSON.parse(contents);
  const changed = updatePackageDependencyVersions(packageJson, versions);
  return { changed, contents: serializeJson(packageJson) };
}

async function prepareManifests(records, versions, repoRoot, config) {
  const changed = new Set();
  for (const record of records) {
    const dependenciesChanged = updatePackageDependencyVersions(record.packageJson, versions);
    const versionChanged = record.packageJson.version !== versions.get(record.name);
    record.packageJson.version = versions.get(record.name);
    if (dependenciesChanged || versionChanged) {
      await writeFile(record.packageJsonPath, serializeJson(record.packageJson), "utf8");
      changed.add(record.packageJsonPath);
    }
    for (const file of versionFilePaths(record)) {
      const json = await readJsonFile(file);
      if (json.version === record.packageJson.version) continue;
      json.version = record.packageJson.version;
      await writeFile(file, serializeJson(json), "utf8");
      changed.add(file);
    }
    for (const patternPath of await collectPatternPackageJsonPaths(record.dir, config.nestedManifests)) {
      const update = updatePatternPackageJsonContents(await readFile(patternPath, "utf8"), versions);
      if (update.changed) {
        await writeFile(patternPath, update.contents, "utf8");
        changed.add(patternPath);
      }
    }
  }
  const rootPackageJsonPath = path.join(repoRoot, "package.json");
  const rootPackageJson = await readJsonFile(rootPackageJsonPath);
  if (updatePackageDependencyVersions(rootPackageJson, versions)) {
    await writeFile(rootPackageJsonPath, serializeJson(rootPackageJson), "utf8");
    changed.add(rootPackageJsonPath);
  }
  return changed;
}

function versionFilePaths(record) {
  const files = record.packageJson.jskitRelease?.versionFiles || [];
  return files.map(file => path.join(record.dir, String(file)));
}

function topologicalPublishOrder(records) {
  const names = new Set(records.map((record) => record.name));
  const inDegree = new Map([...names].map((name) => [name, 0]));
  const consumers = new Map([...names].map((name) => [name, new Set()]));

  for (const record of records) {
    for (const dependencyName of record.localDependencies) {
      if (!names.has(dependencyName)) {
        continue;
      }
      consumers.get(dependencyName).add(record.name);
      inDegree.set(record.name, inDegree.get(record.name) + 1);
    }
  }

  const queue = [...inDegree]
    .filter(([, degree]) => degree === 0)
    .map(([name]) => name)
    .sort();
  const ordered = [];
  while (queue.length > 0) {
    const name = queue.shift();
    ordered.push(name);
    for (const consumer of [...consumers.get(name)].sort()) {
      const degree = inDegree.get(consumer) - 1;
      inDegree.set(consumer, degree);
      if (degree === 0) {
        queue.push(consumer);
        queue.sort();
      }
    }
  }

  if (ordered.length !== records.length) {
    const cycleMembers = [...inDegree]
      .filter(([, degree]) => degree > 0)
      .map(([name]) => name)
      .sort();
    throw new Error(`Package dependencies must be acyclic: ${cycleMembers.join(", ")}`);
  }
  return ordered;
}

function collectVersionMismatches(packageJson, versions, source) {
  const mismatches = [];
  for (const field of DEPENDENCY_FIELDS) {
    for (const [dependencyName, declaredVersion] of Object.entries(packageJson?.[field] || {})) {
      const expected = versions.has(dependencyName) ? followVersion(declaredVersion, versions.get(dependencyName)) : null;
      if (expected !== null && declaredVersion !== expected) {
        mismatches.push(`${source}#${field}.${dependencyName} is ${declaredVersion}; expected ${expected}`);
      }
    }
  }
  return mismatches;
}

async function validateReleaseState(records, repoRoot) {
  const config = await releaseConfig(repoRoot);
  const versions = currentVersionMap(records);
  const mismatches = [];
  for (const record of records) {
    mismatches.push(...collectVersionMismatches(record.packageJson, versions, record.name));
    for (const file of versionFilePaths(record)) {
      const { version } = await readJsonFile(file);
      if (version !== record.packageJson.version) {
        mismatches.push(`${toPosixPath(path.relative(repoRoot, file))} has version ${version}; expected ${record.packageJson.version}`);
      }
    }
    for (const patternPath of await collectPatternPackageJsonPaths(record.dir, config.nestedManifests)) {
      const contents = await readFile(patternPath, "utf8");
      if (updatePatternPackageJsonContents(contents, versions).changed) {
        mismatches.push(`${toPosixPath(path.relative(repoRoot, patternPath))} has stale package versions`);
      }
    }
  }

  const rootPackageJson = await readJsonFile(path.join(repoRoot, "package.json"));
  mismatches.push(...collectVersionMismatches(rootPackageJson, versions, "package.json"));
  if (mismatches.length > 0) {
    throw new Error(`Release source is not coordinated:\n- ${mismatches.join("\n- ")}`);
  }
  return versions;
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
    hydrateLocalDependencies(staged);
    topologicalPublishOrder(staged);
    const current = currentVersionMap(staged);
    const versions = new Map(current);
    const selected = new Map();
    const configPath = String(process.env.NPM_TOKEN || "").trim() ? await createNpmUserConfig(registry, directory, staged) : "";
    const inspection = createPublicationInspection({ directory, registry, configPath });

    await assertNoNewerVersions(staged, inspection);

    async function selectChanged(dependencyChanges, generatedChanges) {
      let bumped = 0;
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

function assertMainReleaseCheckout(repoRoot) {
  if (git(repoRoot, ["branch", "--show-current"]) !== "main") {
    throw new Error("Publish requires the main branch.");
  }
  if (git(repoRoot, ["status", "--porcelain", "--untracked-files=all"])) {
    throw new Error("Publish requires a clean checkout; commit all release changes first.");
  }
  const head = git(repoRoot, ["rev-parse", "HEAD"]);
  const remoteMain = git(repoRoot, ["ls-remote", "--exit-code", "origin", "refs/heads/main"]).split(/\s+/u)[0];
  if (head !== remoteMain) {
    throw new Error("Publish requires HEAD to match origin's main branch; reconcile and push main first.");
  }
}

// Moved from Vibe64 Online's deploy orchestrator: main can move while a
// release runs, so the commit is replayed on it and the push retried.
function commitAndPush(repoRoot, message) {
  if (!git(repoRoot, ["status", "--porcelain"])) return false;
  git(repoRoot, ["add", "-A"]);
  git(repoRoot, ["commit", "--quiet", "-m", message]);
  for (let attempt = 1; ; attempt++) {
    const push = spawnSync("git", ["push", "--quiet", "origin", "HEAD:main"], { cwd: repoRoot, encoding: "utf8" });
    if (push.status === 0) break;
    if (attempt >= 3) throw new Error(`git push failed in ${repoRoot}: ${push.stderr || push.stdout}`);
    process.stdout.write(`${path.basename(repoRoot)}: main moved; rebasing the release commit and retrying\n`);
    git(repoRoot, ["pull", "--quiet", "--rebase", "origin", "main"]);
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

async function publishRelease(records, { cwd: repoRoot, dryRun, registry }) {
  if (!dryRun) {
    assertMainReleaseCheckout(repoRoot);
  }
  await validateReleaseState(records, repoRoot);
  const order = topologicalPublishOrder(records);
  const recordsByName = new Map(records.map((record) => [record.name, record]));
  const directory = await mkdtemp(path.join(tmpdir(), "jskit-release-"));
  try {
    const configPath = !dryRun || String(process.env.NPM_TOKEN || "").trim()
      ? await createNpmUserConfig(registry, directory, records) : "";
    if (!dryRun) await runCommand("npm", ["whoami", "--registry", registry, "--userconfig", configPath]);
    const inspection = createPublicationInspection({ directory, registry, configPath });
    await assertNoNewerVersions(records, inspection);
    const plan = await planPublication(order.map(name => recordsByName.get(name)), { inspection });
    for (const entry of plan) {
      if (dryRun || entry.state === "skip") continue;
      const args = [
        "publish",
        entry.tarball,
        "--access",
        "public",
        "--tag",
        "latest",
        "--registry",
        registry,
        "--workspaces=false",
        "--userconfig", configPath
      ];
      await runCommand("npm", args);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  process.stdout.write(dryRun ? "Publish dry-run complete.\n" : "Publish complete.\n");
}

// publish: prepare the clean, current main checkout, commit and push the
// prepared release, then publish it. A dry run only reports the plan.
async function publishCommand(options) {
  if (options.dryRun) {
    await prepareRelease({ ...options, report: true });
    process.stdout.write("Publish dry-run complete.\n");
    return;
  }
  assertMainReleaseCheckout(options.cwd);
  const { plan } = await prepareRelease(options);
  commitAndPush(options.cwd, releaseCommitMessage(plan));
  const records = await discoverReleasePackages(options.cwd);
  hydrateLocalDependencies(records);
  await publishRelease(records, options);
}

// npm can take minutes to serve a just-published version everywhere.
// Moved from Vibe64 Online's deploy orchestrator.
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
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
}

// pin: make every dependency on a package published from the given
// repositories follow that package's current version, keeping ^/~, then
// install, commit and push. Moved from Vibe64 Online's deploy orchestrator.
async function pinCommand({ cwd: repoRoot, from, dryRun }) {
  const versions = new Map();
  for (const dir of from) {
    for (const record of await discoverReleasePackages(dir)) versions.set(record.name, record.packageJson.version);
  }
  if (!dryRun) assertMainReleaseCheckout(repoRoot);
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
  await installReleasedPins(repoRoot);
  commitAndPush(repoRoot, "Consume released packages");
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.intent === "prepare") await prepareRelease(options);
  else if (options.intent === "publish") await publishCommand(options);
  else await pinCommand(options);
}

export {
  assertMainReleaseCheckout,
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
