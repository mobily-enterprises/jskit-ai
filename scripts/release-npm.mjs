#!/usr/bin/env node
import { mkdtemp, readFile, readdir, rm, stat, writeFile, cp } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { resolvePackageIdInput } from "../tooling/jskit-cli/src/server/packageIdHelpers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const WORKSPACE_ROOTS = ["packages", "tooling"];
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const DEFAULT_TAG = "latest";
const DEFAULT_ACCESS = "public";
const DEFAULT_PUBLISH_CONCURRENCY = 20;

function parseArgs(argv) {
  const envPublishConcurrency = Number.parseInt(String(process.env.PUBLISH_CONCURRENCY || ""), 10);
  const options = {
    only: [],
    registry: DEFAULT_REGISTRY,
    tag: DEFAULT_TAG,
    access: DEFAULT_ACCESS,
    publishConcurrency: Number.isInteger(envPublishConcurrency) && envPublishConcurrency > 0
      ? envPublishConcurrency
      : DEFAULT_PUBLISH_CONCURRENCY,
    dryRun: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (argument === "--only") {
      const value = String(argv[index + 1] || "").trim();
      if (!value) {
        throw new Error("--only requires at least one package name.");
      }
      options.only.push(...parseOnlyPackages(value));
      index += 1;
      continue;
    }

    if (argument.startsWith("--only=")) {
      const value = argument.slice("--only=".length).trim();
      if (!value) {
        throw new Error("--only requires at least one package name.");
      }
      options.only.push(...parseOnlyPackages(value));
      continue;
    }

    if (argument === "--registry") {
      options.registry = String(argv[index + 1] || "").trim();
      index += 1;
      continue;
    }

    if (argument.startsWith("--registry=")) {
      options.registry = argument.slice("--registry=".length).trim();
      continue;
    }

    if (argument === "--tag") {
      options.tag = String(argv[index + 1] || "").trim();
      index += 1;
      continue;
    }

    if (argument.startsWith("--tag=")) {
      options.tag = argument.slice("--tag=".length).trim();
      continue;
    }

    if (argument === "--access") {
      options.access = String(argv[index + 1] || "").trim();
      index += 1;
      continue;
    }

    if (argument.startsWith("--access=")) {
      options.access = argument.slice("--access=".length).trim();
      continue;
    }

    if (argument === "--publish-concurrency") {
      options.publishConcurrency = parsePositiveInteger(argv[index + 1], "--publish-concurrency");
      index += 1;
      continue;
    }

    if (argument.startsWith("--publish-concurrency=")) {
      options.publishConcurrency = parsePositiveInteger(argument.slice("--publish-concurrency=".length), "--publish-concurrency");
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  options.registry = normalizeRegistryUrl(options.registry || DEFAULT_REGISTRY);
  options.only = Array.from(new Set(options.only));
  if (!options.tag) {
    throw new Error("Missing --tag value.");
  }

  if (!options.access) {
    throw new Error("Missing --access value.");
  }

  return options;
}

function parseOnlyPackages(value) {
  const tokens = String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (tokens.length < 1) {
    throw new Error("--only requires at least one package name.");
  }
  return tokens;
}

function parsePositiveInteger(value, flagName) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flagName} must be a positive integer.`);
  }
  return parsed;
}

function normalizeRegistryUrl(registry) {
  const value = String(registry || "").trim();
  if (!value) {
    return DEFAULT_REGISTRY;
  }
  const withScheme = /^[a-z]+:\/\//i.test(value) ? value : `https://${value}`;
  return withScheme.replace(/\/+$/, "");
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
  const raw = await readFile(absolutePath, "utf8");
  return JSON.parse(raw);
}

async function discoverWorkspacePackages() {
  const records = [];

  for (const workspaceRoot of WORKSPACE_ROOTS) {
    const workspaceAbsolute = path.join(REPO_ROOT, workspaceRoot);
    let entries = [];
    try {
      entries = await readdir(workspaceAbsolute, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const packageRoot = path.join(workspaceAbsolute, entry.name);
      const packageJsonPath = path.join(packageRoot, "package.json");
      if (!(await fileExists(packageJsonPath))) {
        continue;
      }

      const packageJson = await readJsonFile(packageJsonPath);
      const packageName = String(packageJson?.name || "").trim();
      if (!packageName.startsWith("@jskit-ai/")) {
        continue;
      }

      const descriptorPath = path.join(packageRoot, "package.descriptor.mjs");
      const hasDescriptor = await fileExists(descriptorPath);

      records.push({
        name: packageName,
        dir: packageRoot,
        relativeDir: toPosixPath(path.relative(REPO_ROOT, packageRoot)),
        packageJsonPath,
        packageJson,
        descriptorPath: hasDescriptor ? descriptorPath : "",
        descriptor: null,
        packageJsonLocalDeps: new Set(),
        descriptorLocalDeps: new Set()
      });
    }
  }

  records.sort((left, right) => left.name.localeCompare(right.name));
  return records;
}

function toPosixPath(value) {
  return String(value || "").split(path.sep).join("/");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function bumpPatch(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version || "").trim());
  if (!match) {
    throw new Error(`Unsupported version format for patch bump: ${version}`);
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  return `${major}.${minor}.${patch + 1}`;
}

function collectPackageJsonLocalDeps(packageJson, localNames) {
  const dependencies = new Set();

  for (const field of DEPENDENCY_FIELDS) {
    const entry = packageJson?.[field];
    if (!entry || typeof entry !== "object") {
      continue;
    }

    for (const dependencyName of Object.keys(entry)) {
      if (localNames.has(dependencyName)) {
        dependencies.add(dependencyName);
      }
    }
  }

  return dependencies;
}

function collectDescriptorLocalDeps(descriptor, localNames) {
  const dependencies = new Set();

  const dependsOn = Array.isArray(descriptor?.dependsOn) ? descriptor.dependsOn : [];
  for (const dependencyName of dependsOn) {
    const normalized = String(dependencyName || "").trim();
    if (localNames.has(normalized)) {
      dependencies.add(normalized);
    }
  }

  const runtimeDependencies = descriptor?.mutations?.dependencies?.runtime;
  const devDependencies = descriptor?.mutations?.dependencies?.dev;

  for (const entry of [runtimeDependencies, devDependencies]) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    for (const dependencyName of Object.keys(entry)) {
      const normalized = String(dependencyName || "").trim();
      if (localNames.has(normalized)) {
        dependencies.add(normalized);
      }
    }
  }

  return dependencies;
}

async function loadDescriptors(records) {
  for (const record of records) {
    if (!record.descriptorPath) {
      continue;
    }

    const descriptorUrl = `${pathToFileURL(record.descriptorPath).href}?t=${Date.now()}_${Math.random()}`;
    const moduleValue = await import(descriptorUrl);
    const descriptor = moduleValue?.default;
    if (!descriptor || typeof descriptor !== "object") {
      throw new Error(`Invalid descriptor default export in ${record.descriptorPath}`);
    }
    record.descriptor = descriptor;
  }
}

function hydrateLocalDependencyMaps(records) {
  const localNames = new Set(records.map((record) => record.name));
  for (const record of records) {
    const packageJsonDeps = collectPackageJsonLocalDeps(record.packageJson, localNames);
    const descriptorDeps = collectDescriptorLocalDeps(record.descriptor, localNames);

    record.packageJsonLocalDeps = packageJsonDeps;
    record.descriptorLocalDeps = descriptorDeps;
  }
}

function computeVersionMaps(records, publishSet) {
  const currentVersions = new Map();
  const nextVersions = new Map();

  for (const record of records) {
    const currentVersion = String(record.packageJson?.version || "").trim();
    if (!currentVersion) {
      throw new Error(`Missing package version in ${record.packageJsonPath}`);
    }

    currentVersions.set(record.name, currentVersion);
    nextVersions.set(record.name, publishSet.has(record.name) ? bumpPatch(currentVersion) : currentVersion);
  }

  return { currentVersions, nextVersions };
}

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function updateWorkspacePackageJsonFiles(records, publishSet, nextVersions, { dryRun, onlyMode = false }) {
  const recordsToProcess = onlyMode ? records.filter((record) => publishSet.has(record.name)) : records;

  for (const record of recordsToProcess) {
    const packageJson = record.packageJson;
    let changed = false;
    let dependencyChanged = false;

    const nextSelfVersion = nextVersions.get(record.name);
    if (publishSet.has(record.name) && packageJson.version !== nextSelfVersion) {
      packageJson.version = nextSelfVersion;
      changed = true;
    }

    for (const field of DEPENDENCY_FIELDS) {
      const fieldValue = packageJson?.[field];
      if (!fieldValue || typeof fieldValue !== "object") {
        continue;
      }

      for (const dependencyName of Object.keys(fieldValue)) {
        if (!nextVersions.has(dependencyName)) {
          continue;
        }

        const dependencyVersion = nextVersions.get(dependencyName);
        if (fieldValue[dependencyName] === dependencyVersion) {
          continue;
        }

        fieldValue[dependencyName] = dependencyVersion;
        changed = true;
        dependencyChanged = true;
      }
    }

    if (!onlyMode && dependencyChanged && !publishSet.has(record.name)) {
      throw new Error(
        `Internal dependency version changed for ${record.name} but package is not marked for publish. Expand dependency closure.`
      );
    }

    if (!changed) {
      continue;
    }

    const nextRaw = serializeJson(packageJson);
    if (dryRun) {
      process.stdout.write(`[dry-run] update ${toPosixPath(path.relative(REPO_ROOT, record.packageJsonPath))}\n`);
      continue;
    }

    await writeFile(record.packageJsonPath, nextRaw, "utf8");
  }
}

function updateDescriptorTextForPackage(text, packageName, nextVersion) {
  const doubleQuotedPattern = new RegExp(`(\\"${escapeRegExp(packageName)}\\"\\s*:\\s*\\")([^\\"]+)(\\")`, "g");
  const singleQuotedPattern = new RegExp(`('${escapeRegExp(packageName)}'\\s*:\\s*')([^']+)(')`, "g");

  let nextText = text.replace(doubleQuotedPattern, `$1${nextVersion}$3`);
  nextText = nextText.replace(singleQuotedPattern, `$1${nextVersion}$3`);
  return nextText;
}

function updateDescriptorVersion(text, nextVersion) {
  const versionPattern = /(^\s*(?:"version"|version)\s*:\s*")([^"]+)("\s*,?\s*$)/m;
  if (!versionPattern.test(text)) {
    throw new Error("Descriptor does not contain a top-level version field.");
  }
  return text.replace(versionPattern, `$1${nextVersion}$3`);
}

async function updateWorkspaceDescriptorFiles(records, publishSet, nextVersions, { dryRun, onlyMode = false }) {
  const recordsToProcess = onlyMode ? records.filter((record) => publishSet.has(record.name)) : records;

  for (const record of recordsToProcess) {
    if (!record.descriptorPath) {
      continue;
    }

    let text = await readFile(record.descriptorPath, "utf8");
    let nextText = text;

    if (publishSet.has(record.name)) {
      nextText = updateDescriptorVersion(nextText, nextVersions.get(record.name));
    }

    for (const [packageName, nextVersion] of nextVersions.entries()) {
      nextText = updateDescriptorTextForPackage(nextText, packageName, nextVersion);
    }

    if (nextText === text) {
      continue;
    }

    if (!onlyMode && !publishSet.has(record.name)) {
      throw new Error(
        `Descriptor dependency versions changed for ${record.name} but package is not marked for publish. Expand dependency closure.`
      );
    }

    if (dryRun) {
      process.stdout.write(`[dry-run] update ${toPosixPath(path.relative(REPO_ROOT, record.descriptorPath))}\n`);
      continue;
    }

    await writeFile(record.descriptorPath, nextText, "utf8");
  }
}

function topologicalPublishOrder(records, publishSet) {
  const { inDegree, adjacency } = buildPublishGraph(records, publishSet);
  const queue = Array.from(inDegree.entries())
    .filter(([, degree]) => degree === 0)
    .map(([name]) => name)
    .sort();

  const ordered = [];
  while (queue.length > 0) {
    const nextName = queue.shift();
    ordered.push(nextName);

    const neighbors = Array.from(adjacency.get(nextName) || []).sort();
    for (const neighbor of neighbors) {
      const currentDegree = (inDegree.get(neighbor) || 0) - 1;
      inDegree.set(neighbor, currentDegree);
      if (currentDegree === 0) {
        queue.push(neighbor);
        queue.sort();
      }
    }
  }

  if (ordered.length !== publishSet.size) {
    const missing = Array.from(publishSet).filter((name) => !ordered.includes(name)).sort();
    ordered.push(...missing);
  }

  return ordered;
}

function buildPublishGraph(records, publishSet) {
  const recordByName = new Map(records.map((record) => [record.name, record]));
  const inDegree = new Map();
  const adjacency = new Map();

  for (const packageName of publishSet) {
    inDegree.set(packageName, 0);
    adjacency.set(packageName, new Set());
  }

  for (const packageName of publishSet) {
    const record = recordByName.get(packageName);
    if (!record) {
      continue;
    }

    for (const dependencyName of record.packageJsonLocalDeps) {
      if (!publishSet.has(dependencyName)) {
        continue;
      }

      adjacency.get(dependencyName).add(packageName);
      inDegree.set(packageName, (inDegree.get(packageName) || 0) + 1);
    }
  }
  return { inDegree, adjacency };
}

async function createNpmUserConfig({ registry, token, dryRun }) {
  if (dryRun) {
    return "";
  }

  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) {
    throw new Error("NPM_TOKEN is required for publish.");
  }

  const registryUrl = new URL(registry);
  const registryWithSlash = `${registryUrl.origin}${registryUrl.pathname}`.replace(/\/+$/, "/");
  const authHost = `${registryUrl.host}${registryUrl.pathname}`.replace(/\/+$/, "");

  const npmrcPath = await mkdtemp(path.join(tmpdir(), "jskit-npmrc-"));
  const configPath = path.join(npmrcPath, "npmrc");
  const npmrcText = [
    `@jskit-ai:registry=${registryWithSlash}`,
    `registry=${registryWithSlash}`,
    `//${authHost}/:_authToken=${normalizedToken}`,
    "always-auth=true"
  ].join("\n");

  await writeFile(configPath, `${npmrcText}\n`, "utf8");
  return configPath;
}

async function withPublishDirectory(record, callback) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "jskit-publish-"));

  try {
    await cp(record.dir, tempDir, {
      recursive: true,
      filter: (sourcePath) => !toPosixPath(sourcePath).includes("/node_modules")
    });

    const tempPackageJsonPath = path.join(tempDir, "package.json");
    const packageJson = await readJsonFile(tempPackageJsonPath);
    if (packageJson.private) {
      delete packageJson.private;
      await writeFile(tempPackageJsonPath, serializeJson(packageJson), "utf8");
    }

    await callback(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function runPublishCommand({ cwd, npmUserConfigPath, registry, tag, access }) {
  const args = [
    "publish",
    "--registry",
    registry,
    "--tag",
    tag,
    "--access",
    access,
    "--workspaces=false",
    "--userconfig",
    npmUserConfigPath
  ];

  await new Promise((resolve, reject) => {
    const child = spawn("npm", args, {
      cwd,
      stdio: "inherit",
      env: process.env
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`npm publish failed in ${cwd} (code=${code}, signal=${signal || "none"})`));
    });
  });
}

async function publishPackages({
  records,
  publishSet,
  nextVersions,
  npmUserConfigPath,
  registry,
  tag,
  access,
  publishConcurrency
}) {
  const recordByName = new Map(records.map((record) => [record.name, record]));
  const { inDegree, adjacency } = buildPublishGraph(records, publishSet);
  const ready = Array.from(inDegree.entries())
    .filter(([, degree]) => degree === 0)
    .map(([name]) => name)
    .sort();

  const running = new Map();
  let completed = 0;

  const launchPublish = (packageName) => {
    const record = recordByName.get(packageName);
    if (!record) {
      throw new Error(`Missing record for ${packageName}`);
    }

    process.stdout.write(`Publishing ${packageName}@${nextVersions.get(packageName)}...\n`);
    const task = (async () => {
      await withPublishDirectory(record, async (publishDir) => {
        await runPublishCommand({
          cwd: publishDir,
          npmUserConfigPath,
          registry,
          tag,
          access
        });
      });
      process.stdout.write(`Published ${packageName}@${nextVersions.get(packageName)}\n`);
      return packageName;
    })();

    const tracked = task.then(
      (name) => ({ status: "fulfilled", name }),
      (error) => ({ status: "rejected", name: packageName, error })
    );
    running.set(packageName, tracked);
  };

  while (completed < publishSet.size) {
    while (running.size < publishConcurrency && ready.length > 0) {
      const packageName = ready.shift();
      launchPublish(packageName);
    }

    if (running.size === 0) {
      throw new Error("Publish scheduler deadlocked: no runnable packages remain.");
    }

    const result = await Promise.race(running.values());
    running.delete(result.name);

    if (result.status === "rejected") {
      throw result.error;
    }

    completed += 1;
    for (const dependentName of Array.from(adjacency.get(result.name) || []).sort()) {
      const remainingDeps = (inDegree.get(dependentName) || 0) - 1;
      inDegree.set(dependentName, remainingDeps);
      if (remainingDeps === 0) {
        ready.push(dependentName);
      }
    }
    ready.sort();
  }
}

function runCatalogBuild({ dryRun, enabled = true }) {
  if (!enabled) {
    process.stdout.write("Catalog build skipped.\n");
    return;
  }

  if (dryRun) {
    process.stdout.write("[dry-run] npm run catalog:build\n");
    return;
  }

  const result = spawnSync("npm", ["run", "catalog:build"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: process.env
  });

  if (result.status !== 0) {
    throw new Error("Catalog build failed.");
  }
}

function refreshPackageLock({ dryRun }) {
  if (dryRun) {
    process.stdout.write("[dry-run] npm install --package-lock-only\n");
    return;
  }

  const result = spawnSync("npm", ["install", "--package-lock-only"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: process.env
  });

  if (result.status !== 0) {
    throw new Error("package-lock refresh failed.");
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const records = await discoverWorkspacePackages();
  if (records.length === 0) {
    throw new Error("No @jskit-ai workspace packages found under packages/ and tooling/.");
  }

  await loadDescriptors(records);
  hydrateLocalDependencyMaps(records);
  const recordByName = new Map(records.map((record) => [record.name, record]));
  const onlyMode = options.only.length > 0;

  let publishSet = new Set();
  if (onlyMode) {
    for (const packageToken of options.only) {
      const packageName = resolvePackageIdInput(packageToken, recordByName);
      if (!packageName) {
        throw new Error(`Unknown package in --only: ${packageToken}`);
      }
      publishSet.add(packageName);
    }
  } else {
    publishSet = new Set(records.map((record) => record.name));
  }

  let { currentVersions, nextVersions } = computeVersionMaps(records, publishSet);

  const publishOrder = topologicalPublishOrder(records, publishSet);
  process.stdout.write("Release plan:\n");
  for (const packageName of publishOrder) {
    process.stdout.write(`- ${packageName}: ${currentVersions.get(packageName)} -> ${nextVersions.get(packageName)}\n`);
  }
  process.stdout.write(`Publish concurrency: ${options.publishConcurrency}\n`);

  await updateWorkspacePackageJsonFiles(records, publishSet, nextVersions, {
    dryRun: options.dryRun,
    onlyMode
  });
  await updateWorkspaceDescriptorFiles(records, publishSet, nextVersions, {
    dryRun: options.dryRun,
    onlyMode
  });

  refreshPackageLock({ dryRun: options.dryRun });

  runCatalogBuild({
    dryRun: options.dryRun,
    enabled: !onlyMode || publishSet.has("@jskit-ai/jskit-catalog")
  });

  if (options.dryRun) {
    process.stdout.write("Dry-run complete. No files published.\n");
    return;
  }

  const npmUserConfigPath = await createNpmUserConfig({
    registry: options.registry,
    token: process.env.NPM_TOKEN,
    dryRun: options.dryRun
  });

  try {
    await publishPackages({
      records,
      publishSet,
      nextVersions,
      npmUserConfigPath,
      registry: options.registry,
      tag: options.tag,
      access: options.access,
      publishConcurrency: options.publishConcurrency
    });
  } finally {
    if (npmUserConfigPath) {
      await rm(path.dirname(npmUserConfigPath), { recursive: true, force: true });
    }
  }

  process.stdout.write("Publish complete.\n");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`release-npm failed: ${message}\n`);
  process.exitCode = 1;
});
