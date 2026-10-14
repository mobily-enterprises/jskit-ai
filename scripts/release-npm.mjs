#!/usr/bin/env node
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";
import { createPublicationInspection, planPublication, snapshotFiles } from "./npm-publication.mjs";
import { changedGeneratedPaths, snapshotGeneratedFiles, runGenerators } from "./check-generated-files.mjs";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");
const WORKSPACE_ROOTS = Object.freeze(["packages", "tooling"]);
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
  if (intent !== "prepare" && intent !== "publish") {
    throw new Error("Usage: release-npm.mjs <prepare|publish> [--dry-run] [--registry <url>]");
  }

  const options = {
    intent,
    dryRun: false,
    registry: DEFAULT_REGISTRY
  };

  while (args.length > 0) {
    const argument = String(args.shift() || "");
    if (argument === "--dry-run") {
      options.dryRun = true;
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

function bumpPatch(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(String(version || "").trim());
  if (!match) {
    throw new Error(`Package versions must use x.y.z: ${version}`);
  }
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

async function discoverWorkspacePackages(repoRoot = REPO_ROOT) {
  const records = [];

  for (const workspaceRoot of WORKSPACE_ROOTS) {
    const parentDirectory = path.join(repoRoot, workspaceRoot);
    for (const entry of await readdir(parentDirectory, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const dir = path.join(parentDirectory, entry.name);
      const packageJsonPath = path.join(dir, "package.json");
      if (!(await fileExists(packageJsonPath))) {
        continue;
      }
      const packageJson = await readJsonFile(packageJsonPath);
      const name = String(packageJson.name || "").trim();
      if (!name.startsWith("@jskit-ai/")) {
        continue;
      }
      records.push({
        name,
        dir,
        packageJsonPath,
        packageJson,
        localDependencies: new Set()
      });
    }
  }

  return records.sort((left, right) => left.name.localeCompare(right.name));
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

function updatePackageDependencyVersions(packageJson, versions) {
  let changed = false;
  for (const field of DEPENDENCY_FIELDS) {
    const dependencies = packageJson?.[field];
    if (!dependencies || typeof dependencies !== "object") {
      continue;
    }
    for (const dependencyName of Object.keys(dependencies)) {
      if (!versions.has(dependencyName) || dependencies[dependencyName] === versions.get(dependencyName)) {
        continue;
      }
      dependencies[dependencyName] = versions.get(dependencyName);
      changed = true;
    }
  }

  return changed;
}

async function collectPatternPackageJsonPaths(packageRoot) {
  const results = [];
  const directories = [];
  for (const name of ["patterns", "examples"]) {
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

async function prepareManifests(records, versions, repoRoot = REPO_ROOT) {
  const changed = new Set();
  for (const record of records) {
    const dependenciesChanged = updatePackageDependencyVersions(record.packageJson, versions);
    const versionChanged = record.packageJson.version !== versions.get(record.name);
    record.packageJson.version = versions.get(record.name);
    if (dependenciesChanged || versionChanged) {
      await writeFile(record.packageJsonPath, serializeJson(record.packageJson), "utf8");
      changed.add(record.packageJsonPath);
    }
    for (const patternPath of await collectPatternPackageJsonPaths(record.dir)) {
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
    throw new Error(`JSKIT package dependencies must be acyclic: ${cycleMembers.join(", ")}`);
  }
  return ordered;
}

function collectVersionMismatches(packageJson, versions, source) {
  const mismatches = [];
  for (const field of DEPENDENCY_FIELDS) {
    for (const [dependencyName, declaredVersion] of Object.entries(packageJson?.[field] || {})) {
      if (versions.has(dependencyName) && declaredVersion !== versions.get(dependencyName)) {
        mismatches.push(`${source}#${field}.${dependencyName} is ${declaredVersion}; expected ${versions.get(dependencyName)}`);
      }
    }
  }
  return mismatches;
}

async function validateReleaseState(records, repoRoot = REPO_ROOT) {
  const versions = currentVersionMap(records);
  const mismatches = [];
  for (const record of records) {
    if (record.packageJson.private === true) {
      mismatches.push(`${record.name} is private and cannot be published`);
    }
    mismatches.push(...collectVersionMismatches(record.packageJson, versions, record.name));
    for (const patternPath of await collectPatternPackageJsonPaths(record.dir)) {
      const contents = await readFile(patternPath, "utf8");
      if (updatePatternPackageJsonContents(contents, versions).changed) {
        mismatches.push(`${toPosixPath(path.relative(REPO_ROOT, patternPath))} has stale JSKIT versions`);
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

async function runCommand(command, args, { cwd = REPO_ROOT, env = process.env } = {}) {
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

async function prepareRelease({ dryRun, registry }) {
  const started = performance.now();
  const directory = await mkdtemp(path.join(tmpdir(), "jskit-prepare-"));
  const source = path.join(directory, "source");
  try {
    // Both modes plan in isolation. Included ignored files are copied too; only
    // Git, installed dependencies and root scratch/navigation data are omitted.
    await cp(REPO_ROOT, source, {
      recursive: true, verbatimSymlinks: true,
      filter: file => {
        const parts = path.relative(REPO_ROOT, file).split(path.sep);
        return !parts.some(part => part === ".git" || part === "node_modules") &&
          ![".tmp", ".genesis"].includes(parts[0]);
      }
    });
    const before = await snapshotFiles(source);
    if (await fileExists(path.join(REPO_ROOT, "node_modules"))) {
      await symlink(path.join(REPO_ROOT, "node_modules"), path.join(source, "node_modules"), "dir");
    }
    const staged = await discoverWorkspacePackages(source);
    if (!staged.length) throw new Error("No @jskit-ai workspace packages found.");
    hydrateLocalDependencies(staged);
    topologicalPublishOrder(staged);
    for (const record of staged) if (record.packageJson.private === true) throw new Error(`${record.name} is private and cannot be published.`);
    const current = currentVersionMap(staged);
    const versions = new Map(current);
    const selected = new Map();
    const configPath = String(process.env.NPM_TOKEN || "").trim() ? await createNpmUserConfig(registry, directory) : "";
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

    let changes = await prepareManifests(staged, versions, source);
    // Selection only grows, and each published package can be bumped once.
    // Regeneration includes catalog self-version and pattern-owner versions.
    for (let pass = 0; pass <= staged.length; pass++) {
      const generatedBefore = await snapshotGeneratedFiles(source);
      runGenerators(source, { quiet: true });
      const generated = new Set(changedGeneratedPaths(generatedBefore, await snapshotGeneratedFiles(source))
        .map(file => path.join(source, file)));
      if (!await selectChanged(changes, generated)) break;
      if (pass === staged.length) throw new Error("Selective release preparation did not converge.");
      changes = await prepareManifests(staged, versions, source);
    }
    await validateReleaseState(staged, source);
    const plan = await planPublication(staged, { inspection, report: false });
    const after = await snapshotFiles(source);
    const changedFiles = [...new Set([...before.keys(), ...after.keys()])]
      .filter(file => before.get(file) !== after.get(file));
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
      const live = await snapshotFiles(REPO_ROOT);
      for (const file of changedFiles) {
        if (live.get(file) !== before.get(file)) throw new Error(`${file} changed during preparation. Retry after that work finishes.`);
      }
      for (const file of changedFiles) {
        const destination = path.join(REPO_ROOT, file);
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
      await runCommand("npm", ["install", "--package-lock-only", "--ignore-scripts"]);
    }
    process.stdout.write(`${dryRun ? "Prepare dry-run complete" : "Release source prepared"}. ${(performance.now() - started).toFixed(0)} ms; ` +
      `${inspection.stats.packed} packs, ${inspection.stats.lookups} registry lookups, ${inspection.stats.downloaded} downloads; ` +
      `${inspection.stats.packReused} packs, ${inspection.stats.metadataReused} lookups, ${inspection.stats.downloadReused} downloads reused.\n`);
    process.stdout.write(`Subprocess time: packing ${inspection.stats.packMs.toFixed(0)} ms, registry metadata ${inspection.stats.lookupMs.toFixed(0)} ms, verified downloads ${inspection.stats.downloadMs.toFixed(0)} ms.\n`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function createNpmUserConfig(registry, directory) {
  const token = String(process.env.NPM_TOKEN || "").trim();
  if (!token) {
    throw new Error("NPM_TOKEN is required for publish.");
  }
  const registryUrl = new URL(registry);
  const registryWithSlash = `${registryUrl.origin}${registryUrl.pathname}`.replace(/\/+$/u, "/");
  const authHost = `${registryUrl.host}${registryUrl.pathname}`.replace(/\/+$/u, "");
  const configPath = path.join(directory, "npmrc");
  await writeFile(
    configPath,
    `@jskit-ai:registry=${registryWithSlash}\nregistry=${registryWithSlash}\n//${authHost}/:_authToken=${token}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  return configPath;
}

function assertMainReleaseCheckout(repoRoot = REPO_ROOT) {
  const git = (args) => execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000
  }).trim();
  if (git(["branch", "--show-current"]) !== "main") {
    throw new Error("Publish requires the main branch.");
  }
  if (git(["status", "--porcelain", "--untracked-files=all"])) {
    throw new Error("Publish requires a clean checkout; commit all release changes first.");
  }
  const head = git(["rev-parse", "HEAD"]);
  const remoteMain = git(["ls-remote", "--exit-code", "origin", "refs/heads/main"]).split(/\s+/u)[0];
  if (head !== remoteMain) {
    throw new Error("Publish requires HEAD to match origin's main branch; reconcile and push main first.");
  }
}

async function publishRelease(records, { dryRun, registry }) {
  if (!dryRun) {
    assertMainReleaseCheckout();
  }
  await validateReleaseState(records);
  const order = topologicalPublishOrder(records);
  const recordsByName = new Map(records.map((record) => [record.name, record]));
  const directory = await mkdtemp(path.join(tmpdir(), "jskit-release-"));
  try {
    const configPath = !dryRun || String(process.env.NPM_TOKEN || "").trim()
      ? await createNpmUserConfig(registry, directory) : "";
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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.intent === "prepare") {
    await prepareRelease(options);
    return;
  }
  const records = await discoverWorkspacePackages();
  if (records.length === 0) {
    throw new Error("No @jskit-ai workspace packages found.");
  }
  hydrateLocalDependencies(records);

  await publishRelease(records, options);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    process.stderr.write(`release-npm failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

export {
  assertMainReleaseCheckout,
  bumpPatch,
  collectPublishDependencies,
  collectPatternPackageJsonPaths,
  collectVersionMismatches,
  discoverWorkspacePackages,
  parseArgs,
  topologicalPublishOrder,
  updatePackageDependencyVersions,
  updatePatternPackageJsonContents,
  validateReleaseState
};
