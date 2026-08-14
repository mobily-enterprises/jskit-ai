#!/usr/bin/env node
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");
const WORKSPACE_ROOTS = Object.freeze(["packages", "tooling"]);
const DEPENDENCY_FIELDS = Object.freeze([
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies"
]);
const MUTATION_DEPENDENCY_FIELDS = Object.freeze(["runtime", "dev"]);
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

async function discoverWorkspacePackages() {
  const records = [];

  for (const workspaceRoot of WORKSPACE_ROOTS) {
    const parentDirectory = path.join(REPO_ROOT, workspaceRoot);
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

function mutationDependencyVersion(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return String(value.version || "");
  }
  return "";
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

function nextVersionMap(records) {
  return new Map(
    [...currentVersionMap(records)].map(([name, version]) => [name, bumpPatch(version)])
  );
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

  for (const field of MUTATION_DEPENDENCY_FIELDS) {
    const dependencies = packageJson?.jskit?.mutations?.dependencies?.[field];
    if (!dependencies || typeof dependencies !== "object") {
      continue;
    }
    for (const dependencyName of Object.keys(dependencies)) {
      if (!versions.has(dependencyName)) {
        continue;
      }
      const nextVersion = versions.get(dependencyName);
      const value = dependencies[dependencyName];
      if (typeof value === "string") {
        if (value !== nextVersion) {
          dependencies[dependencyName] = nextVersion;
          changed = true;
        }
        continue;
      }
      if (value && typeof value === "object" && !Array.isArray(value) && value.version !== nextVersion) {
        value.version = nextVersion;
        changed = true;
      }
    }
  }
  return changed;
}

async function collectTemplatePackageJsonPaths(packageRoot) {
  const templatesRoot = path.join(packageRoot, "templates");
  if (!(await fileExists(templatesRoot))) {
    return [];
  }

  const results = [];
  const directories = [templatesRoot];
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

function updateTemplatedPackageJsonContents(contents, versions) {
  try {
    const packageJson = JSON.parse(contents);
    const changed = updatePackageDependencyVersions(packageJson, versions);
    return { changed, contents: serializeJson(packageJson) };
  } catch (error) {
    if (!(error instanceof SyntaxError) || !/__JSKIT_[A-Z0-9_]+__/u.test(contents)) {
      throw error;
    }
  }

  let changed = false;
  const updated = contents.replace(
    /"(@jskit-ai\/[^"\\]+)"(\s*:\s*)"([^"]*)"/gu,
    (match, dependencyName, separator, currentVersion) => {
      const nextVersion = versions.get(dependencyName);
      if (!nextVersion || currentVersion === nextVersion) {
        return match;
      }
      changed = true;
      return `"${dependencyName}"${separator}"${nextVersion}"`;
    }
  );
  return { changed, contents: updated };
}

async function writePreparedFile(absolutePath, contents, { dryRun }) {
  const relativePath = toPosixPath(path.relative(REPO_ROOT, absolutePath));
  if (dryRun) {
    process.stdout.write(`[dry-run] update ${relativePath}\n`);
    return;
  }
  await writeFile(absolutePath, contents, "utf8");
}

async function prepareManifests(records, versions, { dryRun }) {
  for (const record of records) {
    updatePackageDependencyVersions(record.packageJson, versions);
    record.packageJson.version = versions.get(record.name);
    await writePreparedFile(record.packageJsonPath, serializeJson(record.packageJson), { dryRun });

    for (const templatePath of await collectTemplatePackageJsonPaths(record.dir)) {
      const update = updateTemplatedPackageJsonContents(await readFile(templatePath, "utf8"), versions);
      if (update.changed) {
        await writePreparedFile(templatePath, update.contents, { dryRun });
      }
    }
  }

  const rootPackageJsonPath = path.join(REPO_ROOT, "package.json");
  const rootPackageJson = await readJsonFile(rootPackageJsonPath);
  if (updatePackageDependencyVersions(rootPackageJson, versions)) {
    await writePreparedFile(rootPackageJsonPath, serializeJson(rootPackageJson), { dryRun });
  }
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
  for (const field of MUTATION_DEPENDENCY_FIELDS) {
    for (const [dependencyName, value] of Object.entries(packageJson?.jskit?.mutations?.dependencies?.[field] || {})) {
      if (!versions.has(dependencyName)) {
        continue;
      }
      const declaredVersion = mutationDependencyVersion(value);
      if (declaredVersion !== versions.get(dependencyName)) {
        mismatches.push(
          `${source}#jskit.mutations.dependencies.${field}.${dependencyName} is ${declaredVersion || "missing"}; expected ${versions.get(dependencyName)}`
        );
      }
    }
  }
  return mismatches;
}

async function validateReleaseState(records) {
  const versions = currentVersionMap(records);
  const mismatches = [];
  for (const record of records) {
    if (record.packageJson.private === true) {
      mismatches.push(`${record.name} is private and cannot be published`);
    }
    mismatches.push(...collectVersionMismatches(record.packageJson, versions, record.name));
    for (const templatePath of await collectTemplatePackageJsonPaths(record.dir)) {
      const contents = await readFile(templatePath, "utf8");
      if (updateTemplatedPackageJsonContents(contents, versions).changed) {
        mismatches.push(`${toPosixPath(path.relative(REPO_ROOT, templatePath))} has stale JSKIT versions`);
      }
    }
  }

  const rootPackageJson = await readJsonFile(path.join(REPO_ROOT, "package.json"));
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

async function prepareRelease(records, { dryRun }) {
  const currentVersions = currentVersionMap(records);
  const nextVersions = nextVersionMap(records);
  topologicalPublishOrder(records);

  process.stdout.write("Preparing coordinated patch versions:\n");
  for (const record of records) {
    process.stdout.write(`- ${record.name}: ${currentVersions.get(record.name)} -> ${nextVersions.get(record.name)}\n`);
  }
  await prepareManifests(records, nextVersions, { dryRun });

  for (const args of [
    ["install", "--package-lock-only", "--ignore-scripts"],
    ["run", "catalog:build"],
    ["run", "agent-docs:build"]
  ]) {
    if (dryRun) {
      process.stdout.write(`[dry-run] npm ${args.join(" ")}\n`);
    } else {
      await runCommand("npm", args);
    }
  }
  process.stdout.write(dryRun ? "Prepare dry-run complete.\n" : "Release source prepared.\n");
}

async function createNpmUserConfig(registry) {
  const token = String(process.env.NPM_TOKEN || "").trim();
  if (!token) {
    throw new Error("NPM_TOKEN is required for publish.");
  }
  const registryUrl = new URL(registry);
  const registryWithSlash = `${registryUrl.origin}${registryUrl.pathname}`.replace(/\/+$/u, "/");
  const authHost = `${registryUrl.host}${registryUrl.pathname}`.replace(/\/+$/u, "");
  const directory = await mkdtemp(path.join(tmpdir(), "jskit-npmrc-"));
  const configPath = path.join(directory, "npmrc");
  await writeFile(
    configPath,
    `@jskit-ai:registry=${registryWithSlash}\nregistry=${registryWithSlash}\n//${authHost}/:_authToken=${token}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  return { configPath, directory };
}

async function publishRelease(records, { dryRun, registry }) {
  const versions = await validateReleaseState(records);
  const order = topologicalPublishOrder(records);
  const recordsByName = new Map(records.map((record) => [record.name, record]));
  process.stdout.write(`${dryRun ? "Checking" : "Publishing"} coordinated source:\n`);
  for (const name of order) {
    process.stdout.write(`- ${name}@${versions.get(name)}\n`);
  }

  let npmConfig = null;
  if (!dryRun) {
    npmConfig = await createNpmUserConfig(registry);
  }
  try {
    for (const name of order) {
      const args = [
        "publish",
        "--access",
        "public",
        "--tag",
        "latest",
        "--registry",
        registry,
        "--workspaces=false"
      ];
      if (dryRun) {
        args.push("--dry-run");
      } else {
        args.push("--userconfig", npmConfig.configPath);
      }
      await runCommand("npm", args, { cwd: recordsByName.get(name).dir });
    }
  } finally {
    if (npmConfig) {
      await rm(npmConfig.directory, { recursive: true, force: true });
    }
  }
  process.stdout.write(dryRun ? "Publish dry-run complete.\n" : "Publish complete.\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const records = await discoverWorkspacePackages();
  if (records.length === 0) {
    throw new Error("No @jskit-ai workspace packages found.");
  }
  hydrateLocalDependencies(records);

  if (options.intent === "prepare") {
    await prepareRelease(records, options);
    return;
  }
  await publishRelease(records, options);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    process.stderr.write(`release-npm failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

export {
  bumpPatch,
  collectPublishDependencies,
  collectTemplatePackageJsonPaths,
  collectVersionMismatches,
  discoverWorkspacePackages,
  mutationDependencyVersion,
  parseArgs,
  topologicalPublishOrder,
  updatePackageDependencyVersions,
  updateTemplatedPackageJsonContents,
  validateReleaseState
};
