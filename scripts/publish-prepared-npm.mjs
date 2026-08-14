#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { resolvePackageIdInput } from "../tooling/jskit-cli/src/server/shared/packageIdHelpers.js";
import { createPublishablePackageManifest } from "./npm-publish-support.mjs";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");
const WORKSPACE_ROOTS = ["packages", "tooling"];
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const DEFAULT_TAG = "latest";
const DEFAULT_ACCESS = "public";
const STAGING_TAG = "jskit-staged";
const REGISTRY_VISIBILITY_TIMEOUT_MS = 120_000;
const REGISTRY_VISIBILITY_RETRY_MS = 1_000;

function normalizeRegistryUrl(registry) {
  const value = String(registry || "").trim();
  if (!value) {
    return DEFAULT_REGISTRY;
  }
  const withScheme = /^[a-z]+:\/\//iu.test(value) ? value : `https://${value}`;
  return withScheme.replace(/\/+$/u, "");
}

function parseOnlyPackages(value) {
  const entries = String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length < 1) {
    throw new Error("--only requires at least one exact package spec.");
  }
  return entries;
}

function parsePreparedArgs(argv) {
  const options = {
    only: [],
    registry: DEFAULT_REGISTRY,
    tag: DEFAULT_TAG,
    access: DEFAULT_ACCESS,
    publish: false,
    confirm: "",
    offline: false,
    dryRun: false,
    resume: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--publish") {
      options.publish = true;
      continue;
    }
    if (argument === "--offline") {
      options.offline = true;
      continue;
    }
    if (argument === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (argument === "--resume") {
      options.resume = true;
      continue;
    }
    if (argument === "--only" || argument === "--registry" || argument === "--tag" || argument === "--access" || argument === "--confirm") {
      const value = String(argv[index + 1] || "").trim();
      if (!value) {
        throw new Error(`${argument} requires a value.`);
      }
      if (argument === "--only") {
        options.only.push(...parseOnlyPackages(value));
      } else {
        options[argument.slice(2)] = value;
      }
      index += 1;
      continue;
    }
    const equalsMatch = /^--(only|registry|tag|access|confirm)=(.*)$/u.exec(argument);
    if (equalsMatch) {
      const [, name, rawValue] = equalsMatch;
      const value = rawValue.trim();
      if (!value) {
        throw new Error(`--${name} requires a value.`);
      }
      if (name === "only") {
        options.only.push(...parseOnlyPackages(value));
      } else {
        options[name] = value;
      }
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  options.registry = normalizeRegistryUrl(options.registry);
  options.only = Array.from(new Set(options.only));
  if (options.only.length < 1) {
    throw new Error("Prepared publication requires --only with exact package specs such as @jskit-ai/kernel@0.1.146.");
  }
  if (options.publish && options.dryRun) {
    throw new Error("--publish and --dry-run are mutually exclusive.");
  }
  if (options.publish && options.offline) {
    throw new Error("--publish cannot be used with --offline; registry validation is mandatory.");
  }
  if (options.resume && options.offline) {
    throw new Error("--resume cannot be used with --offline; existing registry artifacts must be verified.");
  }
  if (!options.publish && options.confirm) {
    throw new Error("--confirm is only accepted with --publish.");
  }
  return options;
}

function parseExactPackageSpec(value) {
  const input = String(value || "").trim();
  const separator = input.lastIndexOf("@");
  if (separator < 1) {
    throw new Error(`Prepared package specs must include an exact version: ${input}`);
  }
  const packageToken = input.slice(0, separator);
  const version = input.slice(separator + 1);
  if (!/^\d+\.\d+\.\d+$/u.test(version)) {
    throw new Error(`Prepared package specs require a stable x.y.z version: ${input}`);
  }
  return { packageToken, version };
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

async function discoverWorkspacePackages(repoRoot = REPO_ROOT) {
  const records = [];
  for (const workspaceRoot of WORKSPACE_ROOTS) {
    const absoluteRoot = path.join(repoRoot, workspaceRoot);
    let entries = [];
    try {
      entries = await readdir(absoluteRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const dir = path.join(absoluteRoot, entry.name);
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
        version: String(packageJson.version || "").trim(),
        dir,
        packageJson,
        dependencies: [],
        registryRequirements: []
      });
    }
  }
  records.sort((left, right) => left.name.localeCompare(right.name));
  return records;
}

function exactDependencyVersion(value) {
  if (typeof value === "string" && /^\d+\.\d+\.\d+$/u.test(value)) {
    return value;
  }
  if (value && typeof value === "object" && /^\d+\.\d+\.\d+$/u.test(String(value.version || ""))) {
    return String(value.version);
  }
  return "";
}

function addDependencyReference(referenceMap, { name, version, source, ordersBefore = true }) {
  if (!name) {
    return;
  }
  const existing = referenceMap.get(name);
  if (existing && existing.version && version && existing.version !== version) {
    throw new Error(
      `Conflicting exact dependency versions for ${name}: ${existing.version} (${existing.sources.join(", ")}) and ${version} (${source}).`
    );
  }
  if (existing) {
    if (!existing.version && version) {
      existing.version = version;
    }
    existing.ordersBefore ||= ordersBefore;
    existing.sources.push(source);
    return;
  }
  referenceMap.set(name, { name, version, ordersBefore, sources: [source] });
}

async function hydrateWorkspaceRecords(records, recordsToHydrate = records) {
  const recordByName = new Map(records.map((record) => [record.name, record]));
  for (const record of recordsToHydrate) {
    const references = new Map();
    for (const field of DEPENDENCY_FIELDS) {
      for (const [name, value] of Object.entries(record.packageJson[field] || {})) {
        if (!name.startsWith("@jskit-ai/") || name === record.name) {
          continue;
        }
        const version = exactDependencyVersion(value);
        if (!version) {
          throw new Error(`${record.name} has a non-exact local ${field} reference to ${name}: ${value}`);
        }
        addDependencyReference(references, { name, version, source: `package.json#${field}` });
      }
    }

    const runtimeMutations = record.packageJson?.jskit?.mutations?.dependencies?.runtime || {};
    const devMutations = record.packageJson?.jskit?.mutations?.dependencies?.dev || {};
    for (const [field, entries] of [["runtime", runtimeMutations], ["dev", devMutations]]) {
      for (const [name, value] of Object.entries(entries)) {
        if (!name.startsWith("@jskit-ai/") || name === record.name) {
          continue;
        }
        const version = exactDependencyVersion(value);
        if (!version) {
          throw new Error(`${record.name} has a non-exact package.json jskit ${field} reference to ${name}.`);
        }
        addDependencyReference(references, { name, version, source: `package.json#jskit.mutations.dependencies.${field}` });
      }
    }

    if (record.name === "@jskit-ai/jskit-catalog") {
      const catalogPath = path.join(record.dir, "catalog", "packages.json");
      const catalog = await readJsonFile(catalogPath);
      const registryRequirements = new Map();
      for (const entry of catalog.packages || []) {
        const name = String(entry?.packageId || "").trim();
        if (!name.startsWith("@jskit-ai/") || name === record.name) {
          continue;
        }
        const version = String(entry?.version || "").trim();
        if (!/^\d+\.\d+\.\d+$/u.test(version)) {
          throw new Error(`Catalog has a non-exact local package version for ${name}.`);
        }
        // Catalog entries are publication-closure references, not npm install
        // edges. Treating them as ordering edges would create the artificial
        // catalog -> CLI -> catalog cycle for tooling metadata.
        addDependencyReference(references, {
          name,
          version,
          source: "catalog/packages.json",
          ordersBefore: false
        });

        for (const field of ["runtime", "dev"]) {
          const mutations = entry?.jskit?.mutations?.dependencies?.[field] || {};
          for (const [dependencyName, value] of Object.entries(mutations)) {
            if (!dependencyName.startsWith("@jskit-ai/") || dependencyName === record.name) {
              continue;
            }
            const dependencyVersion = exactDependencyVersion(value);
            if (!dependencyVersion) {
              throw new Error(
                `Catalog entry ${entry.packageId} has a non-exact ${field} dependency on ${dependencyName}.`
              );
            }
            const key = `${dependencyName}@${dependencyVersion}`;
            const existing = registryRequirements.get(key);
            if (existing) {
              existing.sources.push(`catalog#${entry.packageId}.mutations.dependencies.${field}`);
            } else {
              registryRequirements.set(key, {
                name: dependencyName,
                version: dependencyVersion,
                sources: [`catalog#${entry.packageId}.mutations.dependencies.${field}`]
              });
            }
          }
        }
      }
      record.registryRequirements = Array.from(registryRequirements.values()).sort((left, right) =>
        left.name.localeCompare(right.name) || left.version.localeCompare(right.version)
      );
    }
    record.dependencies = Array.from(references.values()).sort((left, right) => left.name.localeCompare(right.name));
  }
  return recordByName;
}

function selectPreparedRecords(records, packageSpecs) {
  const recordByName = new Map(records.map((record) => [record.name, record]));
  const selected = new Map();
  for (const packageSpec of packageSpecs) {
    const { packageToken, version } = parseExactPackageSpec(packageSpec);
    const name = resolvePackageIdInput(packageToken, recordByName);
    if (!name) {
      throw new Error(`Unknown workspace package: ${packageToken}`);
    }
    const record = recordByName.get(name);
    if (record.version !== version) {
      throw new Error(`Prepared version mismatch for ${name}: requested ${version}, current source is ${record.version}.`);
    }
    const existing = selected.get(name);
    if (existing && existing.version !== version) {
      throw new Error(`Conflicting prepared versions selected for ${name}.`);
    }
    selected.set(name, record);
  }
  return selected;
}

function buildPreparedReleaseGraph(selected) {
  const adjacency = new Map();
  for (const name of selected.keys()) {
    adjacency.set(name, new Set());
  }
  function addEdge(dependencyName, dependantName) {
    if (adjacency.get(dependencyName).has(dependantName)) {
      return;
    }
    adjacency.get(dependencyName).add(dependantName);
  }

  for (const record of selected.values()) {
    for (const dependency of record.dependencies) {
      const selectedDependency = selected.get(dependency.name);
      if (!selectedDependency) {
        continue;
      }
      if (dependency.version !== selectedDependency.version) {
        throw new Error(
          `${record.name}@${record.version} requires ${dependency.name}@${dependency.version}, not selected ${selectedDependency.version}.`
        );
      }
      if (dependency.ordersBefore) {
        addEdge(dependency.name, record.name);
      }
    }
  }

  function isReachable(from, target) {
    const pending = [from];
    const visited = new Set();
    while (pending.length > 0) {
      const name = pending.pop();
      if (name === target) {
        return true;
      }
      if (visited.has(name)) {
        continue;
      }
      visited.add(name);
      pending.push(...adjacency.get(name));
    }
    return false;
  }

  // Closure-only metadata references still order referenced packages before
  // the metadata package unless that edge would create a real dependency
  // cycle (catalog -> CLI -> catalog is the expected example).
  for (const record of selected.values()) {
    for (const dependency of record.dependencies.filter((entry) => !entry.ordersBefore)) {
      if (!selected.has(dependency.name) || isReachable(record.name, dependency.name)) {
        continue;
      }
      addEdge(dependency.name, record.name);
    }
  }

  let nextIndex = 0;
  const indexes = new Map();
  const lowLinks = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];

  function connectComponent(name) {
    indexes.set(name, nextIndex);
    lowLinks.set(name, nextIndex);
    nextIndex += 1;
    stack.push(name);
    onStack.add(name);

    for (const dependant of Array.from(adjacency.get(name)).sort()) {
      if (!indexes.has(dependant)) {
        connectComponent(dependant);
        lowLinks.set(name, Math.min(lowLinks.get(name), lowLinks.get(dependant)));
      } else if (onStack.has(dependant)) {
        lowLinks.set(name, Math.min(lowLinks.get(name), indexes.get(dependant)));
      }
    }

    if (lowLinks.get(name) !== indexes.get(name)) {
      return;
    }
    const component = [];
    while (stack.length > 0) {
      const member = stack.pop();
      onStack.delete(member);
      component.push(member);
      if (member === name) {
        break;
      }
    }
    component.sort();
    components.push(component);
  }

  for (const name of Array.from(selected.keys()).sort()) {
    if (!indexes.has(name)) {
      connectComponent(name);
    }
  }

  const componentByName = new Map();
  const componentInDegree = new Map();
  const componentAdjacency = new Map();
  for (const [componentIndex, component] of components.entries()) {
    componentInDegree.set(componentIndex, 0);
    componentAdjacency.set(componentIndex, new Set());
    for (const name of component) {
      componentByName.set(name, componentIndex);
    }
  }
  for (const [dependency, dependants] of adjacency.entries()) {
    const dependencyComponent = componentByName.get(dependency);
    for (const dependant of dependants) {
      const dependantComponent = componentByName.get(dependant);
      if (
        dependencyComponent === dependantComponent
        || componentAdjacency.get(dependencyComponent).has(dependantComponent)
      ) {
        continue;
      }
      componentAdjacency.get(dependencyComponent).add(dependantComponent);
      componentInDegree.set(dependantComponent, componentInDegree.get(dependantComponent) + 1);
    }
  }

  const compareComponents = (left, right) => components[left][0].localeCompare(components[right][0]);
  const queue = Array.from(componentInDegree.entries())
    .filter(([, degree]) => degree === 0)
    .map(([componentIndex]) => componentIndex)
    .sort(compareComponents);
  const order = [];
  while (queue.length > 0) {
    const componentIndex = queue.shift();
    order.push(...components[componentIndex]);
    for (const dependant of Array.from(componentAdjacency.get(componentIndex)).sort(compareComponents)) {
      const degree = componentInDegree.get(dependant) - 1;
      componentInDegree.set(dependant, degree);
      if (degree === 0) {
        queue.push(dependant);
        queue.sort(compareComponents);
      }
    }
  }
  if (order.length !== selected.size) {
    throw new Error("Prepared release component ordering did not include every selected package.");
  }
  return order;
}

function previousPatchVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  if (!match || Number(match[3]) < 1) {
    throw new Error(`Prepared releases require a patch version with an immediate predecessor: ${version}`);
  }
  return `${match[1]}.${match[2]}.${Number(match[3]) - 1}`;
}

async function fetchRegistryMetadata(packageNames, registry, fetchImpl = fetch) {
  const names = Array.from(new Set(packageNames)).sort();
  const metadata = new Map();
  const concurrency = 12;
  let cursor = 0;
  async function worker() {
    while (cursor < names.length) {
      const name = names[cursor];
      cursor += 1;
      const url = `${registry}/${encodeURIComponent(name)}`;
      const response = await fetchImpl(url, {
        headers: { accept: "application/json", "cache-control": "no-cache" }
      });
      if (!response.ok) {
        throw new Error(`Registry metadata request failed for ${name}: HTTP ${response.status}.`);
      }
      const value = await response.json();
      if (value?.name && value.name !== name) {
        throw new Error(`Registry identity mismatch for ${name}: received ${value.name}.`);
      }
      metadata.set(name, value);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, names.length) }, () => worker()));
  return metadata;
}

function validatePreparedRegistryState(selected, registryMetadata, { allowExisting = false } = {}) {
  const hasExistingPreparedArtifact = [...selected.values()].some((record) => {
    return Boolean(registryMetadata.get(record.name)?.versions?.[record.version]);
  });
  if (allowExisting && !hasExistingPreparedArtifact) {
    throw new Error("Prepared release resume requires at least one existing target artifact.");
  }

  for (const record of selected.values()) {
    const versions = registryMetadata.get(record.name)?.versions || {};
    const previousVersion = previousPatchVersion(record.version);
    if (!versions[previousVersion] && !allowExisting) {
      throw new Error(`Registry is missing the prior version ${record.name}@${previousVersion}.`);
    }
    if (versions[record.version] && !allowExisting) {
      throw new Error(`Prepared version already exists and cannot be overwritten: ${record.name}@${record.version}.`);
    }
  }

  for (const record of selected.values()) {
    for (const dependency of record.dependencies) {
      const selectedDependency = selected.get(dependency.name);
      if (selectedDependency) {
        if (selectedDependency.version !== dependency.version) {
          throw new Error(
            `${record.name}@${record.version} requires ${dependency.name}@${dependency.version}, not selected ${selectedDependency.version}.`
          );
        }
        continue;
      }
      const dependencyVersions = registryMetadata.get(dependency.name)?.versions || {};
      if (!dependencyVersions[dependency.version]) {
        throw new Error(
          `Incomplete prepared release closure: ${record.name}@${record.version} requires unpublished ${dependency.name}@${dependency.version}.`
        );
      }
    }
    for (const requirement of record.registryRequirements || []) {
      const selectedDependency = selected.get(requirement.name);
      if (selectedDependency?.version === requirement.version) {
        continue;
      }
      const dependencyVersions = registryMetadata.get(requirement.name)?.versions || {};
      if (!dependencyVersions[requirement.version]) {
        throw new Error(
          `Incomplete catalog registry closure: ${record.name}@${record.version} embeds unpublished ${requirement.name}@${requirement.version}.`
        );
      }
    }
  }
}

function partitionPreparedRegistryArtifacts({ artifacts, order, registryMetadata }) {
  const missing = [];
  const existing = [];
  for (const name of order) {
    const artifact = artifacts.get(name);
    const manifest = registryMetadata.get(name)?.versions?.[artifact.version];
    if (!manifest) {
      missing.push(name);
      continue;
    }
    if (manifest.name !== name || manifest.version !== artifact.version) {
      throw new Error(`Existing registry identity mismatch for ${name}@${artifact.version}.`);
    }
    if (manifest.dist?.integrity !== artifact.integrity || manifest.dist?.shasum !== artifact.shasum) {
      throw new Error(`Existing registry integrity mismatch for ${name}@${artifact.version}; it cannot be resumed.`);
    }
    existing.push(name);
  }
  return { existing, missing };
}

function runCommand(command, args, { cwd, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(
        `${command} ${args[0] || ""} failed (code=${code}, signal=${signal || "none"}): ${stderr.trim()}`
      ));
    });
  });
}

function withoutPublishCredentials(environment) {
  const sanitized = { ...environment };
  delete sanitized.NPM_TOKEN;
  delete sanitized.NODE_AUTH_TOKEN;
  return sanitized;
}

function readTarballPackageManifest(bytes) {
  const archive = gunzipSync(bytes);
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) {
      break;
    }
    const readString = (start, length) => header
      .subarray(start, start + length)
      .toString("utf8")
      .replace(/\0.*$/su, "");
    const name = readString(0, 100);
    const prefix = readString(345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;
    const rawSize = readString(124, 12).trim();
    const size = Number.parseInt(rawSize || "0", 8);
    if (!Number.isFinite(size) || size < 0) {
      throw new Error("Packed artifact contains an invalid tar entry size.");
    }
    const dataOffset = offset + 512;
    if (fullName === "package/package.json") {
      return JSON.parse(archive.subarray(dataOffset, dataOffset + size).toString("utf8"));
    }
    offset = dataOffset + Math.ceil(size / 512) * 512;
  }
  throw new Error("Packed artifact is missing package/package.json.");
}

async function packPreparedRecords(selected, order, tempRoot) {
  const snapshotRoot = path.join(tempRoot, "snapshot");
  const artifactRoot = path.join(tempRoot, "artifacts");
  const artifacts = new Map();

  await Promise.all([
    mkdir(snapshotRoot, { recursive: true }),
    mkdir(artifactRoot, { recursive: true })
  ]);

  for (const name of order) {
    const record = selected.get(name);
    const safeName = name.replace(/[^a-z0-9._-]+/giu, "_");
    const snapshotDir = path.join(snapshotRoot, safeName);
    await cp(record.dir, snapshotDir, {
      recursive: true,
      filter: (sourcePath) => {
        const relative = path.relative(record.dir, sourcePath);
        return !relative.split(path.sep).some((entry) => entry === "node_modules" || entry === ".git");
      }
    });
    if (record.packageJson.private === true) {
      const snapshotManifestPath = path.join(snapshotDir, "package.json");
      const snapshotManifest = createPublishablePackageManifest(
        await readJsonFile(snapshotManifestPath)
      );
      await writeFile(
        snapshotManifestPath,
        `${JSON.stringify(snapshotManifest, null, 2)}\n`,
        "utf8"
      );
    }
    await stat(snapshotDir);
  }

  for (const name of order) {
    const record = selected.get(name);
    const safeName = name.replace(/[^a-z0-9._-]+/giu, "_");
    const snapshotDir = path.join(snapshotRoot, safeName);
    const { stdout } = await runCommand("npm", [
      "pack",
      "--json",
      "--ignore-scripts",
      "--pack-destination",
      artifactRoot
    ], { cwd: snapshotDir, env: withoutPublishCredentials(process.env) });
    let report;
    try {
      [report] = JSON.parse(stdout);
    } catch {
      throw new Error(`npm pack returned invalid JSON for ${name}.`);
    }
    if (report?.name !== name || report?.version !== record.version) {
      throw new Error(`Packed identity mismatch for ${name}@${record.version}.`);
    }
    const artifactPath = path.join(artifactRoot, report.filename);
    const bytes = await readFile(artifactPath);
    const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
    const shasum = createHash("sha1").update(bytes).digest("hex");
    if (report.integrity !== integrity || report.shasum !== shasum) {
      throw new Error(`npm pack integrity mismatch for ${name}@${record.version}.`);
    }
    const packedManifest = readTarballPackageManifest(bytes);
    if (packedManifest.name !== name || packedManifest.version !== record.version) {
      throw new Error(`Tarball manifest identity mismatch for ${name}@${record.version}.`);
    }
    artifacts.set(name, {
      name,
      version: record.version,
      path: artifactPath,
      filename: report.filename,
      size: bytes.length,
      integrity,
      shasum
    });
  }
  return artifacts;
}

function buildPlanFingerprint({ artifacts, order, registry, tag, access }) {
  const plan = {
    schemaVersion: 1,
    registry,
    stagingTag: STAGING_TAG,
    promotionTag: tag,
    access,
    packages: order.map((name) => {
      const artifact = artifacts.get(name);
      return {
        name: artifact.name,
        version: artifact.version,
        integrity: artifact.integrity,
        shasum: artifact.shasum
      };
    })
  };
  return `sha256:${createHash("sha256").update(JSON.stringify(plan)).digest("hex")}`;
}

function assertPublicationConfirmation({ publish, confirm, fingerprint }) {
  if (!publish) {
    return;
  }
  if (confirm !== fingerprint) {
    throw new Error(`Publication confirmation mismatch. Re-run with --publish --confirm ${fingerprint}`);
  }
}

async function createNpmUserConfig({ registry, token }) {
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) {
    throw new Error("NPM_TOKEN is required after prepared-release confirmation.");
  }
  const registryUrl = new URL(registry);
  const registryWithSlash = `${registryUrl.origin}${registryUrl.pathname}`.replace(/\/+$/u, "/");
  const authHost = `${registryUrl.host}${registryUrl.pathname}`.replace(/\/+$/u, "");
  const configDir = await mkdtemp(path.join(tmpdir(), "jskit-prepared-npmrc-"));
  const configPath = path.join(configDir, "npmrc");
  await writeFile(configPath, [
    `@jskit-ai:registry=${registryWithSlash}`,
    `registry=${registryWithSlash}`,
    `//${authHost}/:_authToken=${normalizedToken}`,
    ""
  ].join("\n"), "utf8");
  return configPath;
}

async function publishPreparedArtifacts({ artifacts, order, registry, tag, access, npmUserConfigPath }) {
  const publicationTag = tag === STAGING_TAG ? tag : STAGING_TAG;
  for (const name of order) {
    const artifact = artifacts.get(name);
    process.stdout.write(`Publishing verified ${name}@${artifact.version} with tag ${publicationTag}...\n`);
    await runCommand("npm", [
      "publish",
      artifact.path,
      "--registry",
      registry,
      "--tag",
      publicationTag,
      "--access",
      access,
      "--ignore-scripts",
      "--userconfig",
      npmUserConfigPath
    ]);
  }
}

async function waitForPublishedArtifactIdentities({ artifacts, order, registry }) {
  const pending = new Set(order);
  const deadline = Date.now() + REGISTRY_VISIBILITY_TIMEOUT_MS;
  while (pending.size > 0) {
    await Promise.all(Array.from(pending).map(async (name) => {
      const artifact = artifacts.get(name);
      const url = `${registry}/${encodeURIComponent(name)}/${encodeURIComponent(artifact.version)}`;
      try {
        const response = await fetch(url, {
          headers: { accept: "application/json", "cache-control": "no-cache" }
        });
        if (!response.ok) {
          return;
        }
        const manifest = await response.json();
        if (manifest.name !== name || manifest.version !== artifact.version) {
          throw new Error(`Published registry identity mismatch for ${name}@${artifact.version}.`);
        }
        if (manifest.dist?.integrity !== artifact.integrity || manifest.dist?.shasum !== artifact.shasum) {
          throw new Error(`Published registry integrity mismatch for ${name}@${artifact.version}.`);
        }
        pending.delete(name);
      } catch (error) {
        if (error instanceof Error && /identity mismatch|integrity mismatch/u.test(error.message)) {
          throw error;
        }
      }
    }));
    if (pending.size < 1) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Published artifacts did not become verifiable: ${Array.from(pending).sort().join(", ")}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, REGISTRY_VISIBILITY_RETRY_MS));
  }
}

async function promotePreparedArtifacts({ artifacts, order, registry, tag, npmUserConfigPath }) {
  if (tag === STAGING_TAG) {
    return;
  }
  for (const name of order) {
    const artifact = artifacts.get(name);
    await runCommand("npm", [
      "dist-tag",
      "add",
      `${name}@${artifact.version}`,
      tag,
      "--registry",
      registry,
      "--userconfig",
      npmUserConfigPath
    ]);
  }
}

async function main(argv = process.argv.slice(2)) {
  const options = parsePreparedArgs(argv);
  const records = await discoverWorkspacePackages();
  if (records.length < 1) {
    throw new Error("No @jskit-ai workspace packages found.");
  }
  const selected = selectPreparedRecords(records, options.only);
  await hydrateWorkspaceRecords(records, selected.values());
  const order = buildPreparedReleaseGraph(selected);
  const registryNames = new Set(selected.keys());
  for (const record of selected.values()) {
    for (const dependency of record.dependencies) {
      registryNames.add(dependency.name);
    }
    for (const requirement of record.registryRequirements || []) {
      registryNames.add(requirement.name);
    }
  }

  let registryMetadata = null;
  if (!options.offline) {
    registryMetadata = await fetchRegistryMetadata(registryNames, options.registry);
    validatePreparedRegistryState(selected, registryMetadata, { allowExisting: options.resume });
  }

  const tempRoot = await mkdtemp(path.join(tmpdir(), "jskit-prepared-release-"));
  let npmUserConfigPath = "";
  try {
    const artifacts = await packPreparedRecords(selected, order, tempRoot);
    const fingerprint = buildPlanFingerprint({
      artifacts,
      order,
      registry: options.registry,
      tag: options.tag,
      access: options.access
    });
    process.stdout.write("Prepared release plan (exact current sources):\n");
    for (const name of order) {
      const artifact = artifacts.get(name);
      process.stdout.write(`- ${name}@${artifact.version} ${artifact.integrity} (${artifact.size} bytes)\n`);
    }
    process.stdout.write(`Plan fingerprint: ${fingerprint}\n`);
    if (options.resume) {
      const partition = partitionPreparedRegistryArtifacts({ artifacts, order, registryMetadata });
      process.stdout.write(
        `Resume state: ${partition.existing.length} already verified; ${partition.missing.length} still unpublished.\n`
      );
    }

    if (!options.publish) {
      const networkNote = options.offline
        ? "Offline dry-run complete. No registry request or publish was attempted."
        : "Read-only preflight complete. Registry state was validated; nothing was published.";
      process.stdout.write(`${networkNote}\n`);
      return { fingerprint, order, artifacts };
    }
    assertPublicationConfirmation({
      publish: options.publish,
      confirm: options.confirm,
      fingerprint
    });

    const freshMetadata = await fetchRegistryMetadata(registryNames, options.registry);
    validatePreparedRegistryState(selected, freshMetadata, { allowExisting: options.resume });
    const partition = partitionPreparedRegistryArtifacts({
      artifacts,
      order,
      registryMetadata: freshMetadata
    });
    npmUserConfigPath = await createNpmUserConfig({ registry: options.registry, token: process.env.NPM_TOKEN });
    await publishPreparedArtifacts({
      artifacts,
      order: partition.missing,
      registry: options.registry,
      tag: options.tag,
      access: options.access,
      npmUserConfigPath
    });
    await waitForPublishedArtifactIdentities({ artifacts, order, registry: options.registry });
    await promotePreparedArtifacts({
      artifacts,
      order,
      registry: options.registry,
      tag: options.tag,
      npmUserConfigPath
    });
    process.stdout.write("Verified prepared publication complete.\n");
    return { fingerprint, order, artifacts };
  } finally {
    if (npmUserConfigPath) {
      await rm(path.dirname(npmUserConfigPath), { recursive: true, force: true });
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`publish-prepared-npm failed: ${message}\n`);
    process.exitCode = 1;
  });
}

export {
  STAGING_TAG,
  assertPublicationConfirmation,
  buildPlanFingerprint,
  buildPreparedReleaseGraph,
  hydrateWorkspaceRecords,
  main,
  parseExactPackageSpec,
  parsePreparedArgs,
  partitionPreparedRegistryArtifacts,
  previousPatchVersion,
  selectPreparedRecords,
  validatePreparedRegistryState
};
