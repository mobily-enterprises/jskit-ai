import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

// The release's packages and their versions: discovering the manifests a
// repository owns, ordering them for publication, and moving every pin on a
// released package to its new version.
const DEPENDENCY_FIELDS = Object.freeze([
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies"
]);
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

// Every manifest the repository owns: the root, its workspaces, its declared
// `jskitRelease.manifests` and `file:` dependency directories inside the
// repository (followed transitively).
async function discoverManifests(repoRoot) {
  const root = path.resolve(repoRoot);
  const rootJson = await readJsonFile(path.join(root, "package.json"));
  const workspaces = Array.isArray(rootJson.workspaces) ? rootJson.workspaces : rootJson.workspaces?.packages || [];
  const declared = Array.isArray(rootJson.jskitRelease?.manifests) ? rootJson.jskitRelease.manifests : [];
  const patterns = [...workspaces, ...declared];
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
    records.push({ name, ...manifest });
  }
  const localNames = new Set(records.map(record => record.name));
  for (const record of records) record.localDependencies = collectPublishDependencies(record.packageJson, localNames);
  return records.sort((left, right) => left.name.localeCompare(right.name));
}

// The local path a dependency spec names, as npm reads it: after file:, link: or portal:, or a bare path (./, ../,
// /, ~/ or a drive letter); null for a registry, git, alias or workspace spec.
function localDependencyPath(spec) {
  const value = String(spec || "").trim();
  const protocol = /^(?:file|link|portal):/u.exec(value);
  if (protocol) return value.slice(protocol[0].length);
  return /^(?:\.|~[/\\]|[/\\]|[a-zA-Z]:)/u.test(value) ? value : null;
}

// npm publishes a manifest's dependency specs as written, so a local path outside the repository (a temporary
// file:/tmp/... pin, say) would reach every installer, where it names a directory they lack. A relative path inside
// the repository (a vendored package the release also publishes) is the repository's own; an absolute or home path
// names this machine wherever it points.
function assertNoOutsidePathDependencies(records, repoRoot) {
  const root = path.resolve(repoRoot);
  const problems = [];
  for (const record of records) {
    for (const field of DEPENDENCY_FIELDS) {
      for (const [dependencyName, spec] of Object.entries(record.packageJson[field] || {})) {
        const localPath = localDependencyPath(spec);
        if (localPath === null) continue;
        if (/^(?:[/\\~]|[a-zA-Z]:)/u.test(localPath)) {
          problems.push(`${record.name}: ${field}.${dependencyName} is ${spec}, an absolute path on this machine`);
          continue;
        }
        const target = path.resolve(record.dir, localPath);
        if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
          problems.push(`${record.name}: ${field}.${dependencyName} is ${spec}, a path outside the repository`);
        }
      }
    }
  }
  if (problems.length > 0) {
    throw new Error("Publishable packages depend on local paths that npm would publish as written:\n- " +
      `${problems.join("\n- ")}\nDepend on a released version (or a path inside the repository) before preparing or publishing.`);
  }
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

export {
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
};
