import { spawn } from "node:child_process";
import {
  access,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";

const JSKIT_SCOPE_PREFIX = "@jskit-ai/";
const CATALOG_PACKAGE_ID = "@jskit-ai/jskit-catalog";
const DEPENDENCY_FIELDS = Object.freeze([
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies"
]);
const SKIPPED_DIRECTORY_NAMES = new Set([
  ".git",
  ".cache",
  ".next",
  ".nuxt",
  ".output",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "tmp"
]);
const UPDATE_SCRIPT = "npx --yes @jskit-ai/jskit-catalog@latest update";
const CHECK_SCRIPT = "jskit check";

function toPosixPath(value = "") {
  return String(value || "").split(path.sep).join("/");
}

function normalizeWorkspacePatterns(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === "object" && Array.isArray(value.packages)) {
    return value.packages;
  }
  return [];
}

function globToRegExp(pattern = "") {
  const source = toPosixPath(pattern).replace(/^\.\//u, "").replace(/\/$/u, "");
  let expression = "^";

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "*") {
      if (source[index + 1] === "*") {
        index += 1;
        if (source[index + 1] === "/") {
          index += 1;
          expression += "(?:.*/)?";
        } else {
          expression += ".*";
        }
      } else {
        expression += "[^/]*";
      }
      continue;
    }
    if (character === "?") {
      expression += "[^/]";
      continue;
    }
    expression += /[.+^${}()|[\]\\]/u.test(character) ? `\\${character}` : character;
  }

  return new RegExp(`${expression}$`, "u");
}

function createWorkspaceMatcher(workspaces) {
  const patterns = normalizeWorkspacePatterns(workspaces)
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
  const includes = patterns
    .filter((entry) => !entry.startsWith("!"))
    .map(globToRegExp);
  const excludes = patterns
    .filter((entry) => entry.startsWith("!"))
    .map((entry) => globToRegExp(entry.slice(1)));

  return function matchesWorkspace(relativeDirectory = "") {
    const normalized = toPosixPath(relativeDirectory).replace(/^\.\//u, "").replace(/\/$/u, "");
    return includes.some((matcher) => matcher.test(normalized)) &&
      !excludes.some((matcher) => matcher.test(normalized));
  };
}

async function fileExists(absolutePath) {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonRecord(absolutePath) {
  const contents = await readFile(absolutePath, "utf8");
  let value;
  try {
    value = JSON.parse(contents);
  } catch (error) {
    throw new Error(`${absolutePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${absolutePath} must contain a JSON object.`);
  }
  return { absolutePath, contents, value };
}

async function collectNestedPackageJsonPaths(directory, results = []) {
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || SKIPPED_DIRECTORY_NAMES.has(entry.name) || entry.name.startsWith(".")) {
      continue;
    }
    const childDirectory = path.join(directory, entry.name);
    const manifestPath = path.join(childDirectory, "package.json");
    if (await fileExists(manifestPath)) {
      results.push(manifestPath);
    }
    await collectNestedPackageJsonPaths(childDirectory, results);
  }
  return results;
}

async function discoverProjectManifests(projectRoot, additionalManifests = []) {
  const root = path.resolve(projectRoot);
  const rootManifestPath = path.join(root, "package.json");
  if (!(await fileExists(rootManifestPath))) {
    throw new Error(`JSKIT project root has no package.json: ${root}`);
  }
  const rootManifest = await readJsonRecord(rootManifestPath);
  const matchesWorkspace = createWorkspaceMatcher(rootManifest.value.workspaces);
  const nestedPaths = await collectNestedPackageJsonPaths(root);
  const workspacePaths = nestedPaths
    .filter((manifestPath) => matchesWorkspace(path.relative(root, path.dirname(manifestPath))))
    .sort((left, right) => left.localeCompare(right));
  const manifests = [rootManifest];
  for (const manifestPath of new Set([...workspacePaths, ...additionalManifests.map((file) => path.resolve(root, file))])) {
    if (manifestPath === rootManifestPath) continue;
    manifests.push(await readJsonRecord(manifestPath));
  }
  return Object.freeze(manifests);
}

function normalizeCatalog(catalog = {}) {
  const releasePackages = catalog?.release?.packages;
  if (!releasePackages || typeof releasePackages !== "object" || Array.isArray(releasePackages)) {
    throw new Error("JSKIT catalog does not contain release.packages; install a catalog that supports project updates.");
  }
  const versions = new Map();
  for (const [packageId, version] of Object.entries(releasePackages)) {
    const normalizedPackageId = String(packageId || "").trim();
    const normalizedVersion = String(version || "").trim();
    if (!normalizedPackageId.startsWith(JSKIT_SCOPE_PREFIX) || !/^\d+\.\d+\.\d+$/u.test(normalizedVersion)) {
      throw new Error(`JSKIT catalog contains an invalid release entry: ${packageId}@${version}`);
    }
    versions.set(normalizedPackageId, normalizedVersion);
  }
  const singletonPackages = new Set(
    (Array.isArray(catalog?.release?.singletonPackages) ? catalog.release.singletonPackages : [])
      .map((entry) => String(entry || "").trim())
      .filter((entry) => versions.has(entry))
  );
  return Object.freeze({ versions, singletonPackages });
}

function serializePackageJson(value, originalContents = "") {
  const indentMatch = /\n([ \t]+)"/u.exec(String(originalContents || ""));
  const indentation = indentMatch?.[1] || "  ";
  return `${JSON.stringify(value, null, indentation)}\n`;
}

function collectManifestDeclarations(manifests, projectRoot) {
  const declarations = [];
  for (const manifest of manifests) {
    const source = toPosixPath(path.relative(projectRoot, manifest.absolutePath)) || "package.json";
    for (const field of DEPENDENCY_FIELDS) {
      for (const [packageId, declaredVersion] of Object.entries(manifest.value?.[field] || {})) {
        if (!packageId.startsWith(JSKIT_SCOPE_PREFIX)) {
          continue;
        }
        declarations.push(Object.freeze({
          manifest,
          source,
          field,
          packageId,
          declaredVersion: String(declaredVersion || "")
        }));
      }
    }
  }
  return Object.freeze(declarations);
}

function collectLocalPackageNames(manifests) {
  return new Set(
    manifests
      .map((manifest) => String(manifest.value?.name || "").trim())
      .filter(Boolean)
  );
}

function resolveLockPackageName(packagePath = "", record = {}) {
  const explicitName = String(record?.name || "").trim();
  if (explicitName.startsWith(JSKIT_SCOPE_PREFIX)) {
    return explicitName;
  }
  const normalizedPath = toPosixPath(packagePath);
  const match = /(?:^|\/)node_modules\/(@jskit-ai\/[^/]+)$/u.exec(normalizedPath);
  return match?.[1] || "";
}

function collectLockInstallations(packageLock = {}) {
  const installations = [];
  if (packageLock?.packages && typeof packageLock.packages === "object") {
    for (const [packagePath, record] of Object.entries(packageLock.packages)) {
      if (!record || typeof record !== "object" || record.link === true) {
        continue;
      }
      const packageId = resolveLockPackageName(packagePath, record);
      if (!packageId) {
        continue;
      }
      installations.push(Object.freeze({
        packageId,
        version: String(record.version || "").trim(),
        path: toPosixPath(packagePath)
      }));
    }
    return Object.freeze(installations);
  }

  function visitDependencies(dependencies = {}, parentPath = "") {
    for (const [packageId, record] of Object.entries(dependencies || {})) {
      const packagePath = parentPath ? `${parentPath}/node_modules/${packageId}` : `node_modules/${packageId}`;
      if (packageId.startsWith(JSKIT_SCOPE_PREFIX)) {
        installations.push(Object.freeze({
          packageId,
          version: String(record?.version || "").trim(),
          path: packagePath
        }));
      }
      visitDependencies(record?.dependencies, packagePath);
    }
  }
  visitDependencies(packageLock?.dependencies);
  return Object.freeze(installations);
}

function collectJskitOverridePaths(value, currentPath = "overrides", results = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return results;
  }
  for (const [key, child] of Object.entries(value)) {
    const nextPath = `${currentPath}.${key}`;
    if (key.startsWith(JSKIT_SCOPE_PREFIX)) {
      results.push(nextPath);
    }
    if (child && typeof child === "object" && !Array.isArray(child)) {
      collectJskitOverridePaths(child, nextPath, results);
    }
  }
  return results;
}

async function checkProject({ projectRoot = process.cwd(), catalog, additionalManifests = [], checkInstalled = false, sourcePackages = {} } = {}) {
  const root = path.resolve(projectRoot);
  const normalizedCatalog = normalizeCatalog(catalog);
  const manifests = await discoverProjectManifests(root, additionalManifests);
  const localPackageNames = collectLocalPackageNames(manifests);
  const declarations = collectManifestDeclarations(manifests, root)
    .filter((entry) => !localPackageNames.has(entry.packageId) && !Object.hasOwn(sourcePackages, entry.packageId));
  const issues = [];

  for (const declaration of declarations) {
    const expectedVersion = normalizedCatalog.versions.get(declaration.packageId);
    if (!expectedVersion) {
      issues.push(`${declaration.source}#${declaration.field}.${declaration.packageId} is not in the coordinated catalog.`);
      continue;
    }
    if (declaration.declaredVersion !== expectedVersion) {
      issues.push(
        `${declaration.source}#${declaration.field}.${declaration.packageId} is ${declaration.declaredVersion}; ` +
        `expected ${expectedVersion}.`
      );
    }
  }

  for (const manifest of manifests) {
    const source = toPosixPath(path.relative(root, manifest.absolutePath)) || "package.json";
    for (const overridePath of collectJskitOverridePaths(manifest.value?.overrides)) {
      issues.push(`${source}#${overridePath} must be removed; coordinated JSKIT versions cannot be overridden privately.`);
    }
  }

  const packageLockPath = path.join(root, "package-lock.json");
  let installations = [];
  if (!(await fileExists(packageLockPath))) {
    issues.push("package-lock.json is missing; run npm install after aligning the JSKIT release cohort.");
  } else {
    const packageLock = (await readJsonRecord(packageLockPath)).value;
    installations = collectLockInstallations(packageLock);
    if (checkInstalled) {
      for (const [packagePath, record] of Object.entries(packageLock.packages || {})) {
        if (!packagePath || record.link || !packagePath.includes("node_modules/")) continue;
        if (Object.hasOwn(sourcePackages, resolveLockPackageName(packagePath, record))) continue;
        const installedPath = path.join(root, packagePath, "package.json");
        if (!(await fileExists(installedPath))) {
          if (!record.optional) issues.push(`${packagePath} is missing; lockfile requires ${record.version}. Run npm ci.`);
          continue;
        }
        const installed = (await readJsonRecord(installedPath)).value;
        if (installed.version !== record.version) {
          issues.push(`${packagePath} installed ${installed.version}; lockfile requires ${record.version}. Run npm ci.`);
        }
      }
      for (const manifest of manifests) {
        const directory = toPosixPath(path.relative(root, path.dirname(manifest.absolutePath)));
        const record = packageLock.packages?.[directory];
        // Separately composed manifests deliberately have no entry in this root lockfile.
        if (!record && additionalManifests.some((file) => path.resolve(root, file) === manifest.absolutePath)) continue;
        for (const field of DEPENDENCY_FIELDS) {
          const declared = manifest.value[field] || {};
          const locked = record?.[field] || {};
          for (const name of new Set([...Object.keys(declared), ...Object.keys(locked)])) {
            if (Object.hasOwn(sourcePackages, name)) continue;
            if (declared[name] !== locked[name]) issues.push(`${manifest.absolutePath}#${field}.${name} is ${declared[name] || "absent"}; lockfile records ${locked[name] || "absent"}. Run npm install and commit the lockfile.`);
          }
        }
      }
    }
    const byPackageId = new Map();
    for (const installation of installations) {
      // Selected sources replace these installations in the composed graph,
      // where their exact paths and singleton identity are checked separately.
      if (Object.hasOwn(sourcePackages, installation.packageId)) continue;
      const expectedVersion = normalizedCatalog.versions.get(installation.packageId);
      if (!expectedVersion) {
        issues.push(`${installation.path} resolves unknown JSKIT package ${installation.packageId}@${installation.version}.`);
        continue;
      }
      if (installation.version !== expectedVersion) {
        issues.push(
          `${installation.path} resolves ${installation.packageId}@${installation.version}; expected ${expectedVersion}.`
        );
      }
      const entries = byPackageId.get(installation.packageId) || [];
      entries.push(installation);
      byPackageId.set(installation.packageId, entries);
    }

    for (const [packageId, entries] of byPackageId) {
      const versions = [...new Set(entries.map((entry) => entry.version))].sort();
      if (versions.length > 1) {
        issues.push(`${packageId} resolves multiple release versions: ${versions.join(", ")}.`);
      }
      if (normalizedCatalog.singletonPackages.has(packageId) && entries.length > 1) {
        issues.push(
          `${packageId} is a singleton client runtime but resolves at ${entries.length} private install paths: ` +
          `${entries.map((entry) => entry.path).join(", ")}.`
        );
      }
    }

    const resolvedPackageIds = new Set(installations.map((entry) => entry.packageId));
    for (const packageId of new Set(declarations
      .filter((entry) => !additionalManifests.some((file) => path.resolve(root, file) === entry.manifest.absolutePath))
      .map((entry) => entry.packageId))) {
      if (!resolvedPackageIds.has(packageId)) {
        issues.push(`${packageId} is declared but has no resolved package-lock installation.`);
      }
    }
  }

  return Object.freeze({
    ok: issues.length < 1,
    issues: Object.freeze(issues),
    manifests,
    declarations,
    installations: Object.freeze(installations)
  });
}

// Resolve package manifests without relying on a package exporting package.json.
// Following real paths matches Node's normal symlink resolution.
async function resolveInstalledPackage(consumerDirectory, packageId) {
  let directory = await realpath(consumerDirectory);
  while (true) {
    const candidate = path.join(directory, "node_modules", packageId, "package.json");
    if (await fileExists(candidate)) return realpath(candidate);
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

async function checkInstalledGraph({ catalog, manifestPaths = [], sourcePackages = {} } = {}) {
  const { versions, singletonPackages } = normalizeCatalog(catalog);
  const issues = [];
  const installations = new Map();
  const visited = new Set();
  const pending = [...manifestPaths];
  const sourceManifests = new Map();
  for (const [name, directory] of Object.entries(sourcePackages)) {
    const file = await realpath(path.join(directory, "package.json"));
    const manifest = (await readJsonRecord(file)).value;
    if (manifest.name !== name) throw new Error(`Selected source ${directory} must provide ${name}.`);
    sourceManifests.set(name, file);
    pending.push(file);
  }
  while (pending.length) {
    const manifestPath = await realpath(pending.pop());
    if (visited.has(manifestPath)) continue;
    visited.add(manifestPath);
    const manifest = (await readJsonRecord(manifestPath)).value;
    const selectedSource = sourceManifests.get(manifest.name);
    if (selectedSource && manifestPath !== selectedSource) {
      issues.push(`${manifest.name} resolves at ${manifestPath}, not its selected source ${selectedSource}.`);
    }
    if (manifest.name?.startsWith(JSKIT_SCOPE_PREFIX)) {
      const expected = versions.get(manifest.name);
      if (!selectedSource && manifest.version !== expected) issues.push(`${manifestPath} provides ${manifest.name}@${manifest.version}; catalog requires ${expected || "no such package"}.`);
      const paths = installations.get(manifest.name) || new Map();
      paths.set(manifestPath, manifest.version);
      installations.set(manifest.name, paths);
    }
    for (const [name, required] of Object.entries({ ...manifest.peerDependencies, ...manifest.dependencies, ...manifest.optionalDependencies })) {
      const resolved = await resolveInstalledPackage(path.dirname(manifestPath), name);
      const optional = Object.hasOwn(manifest.optionalDependencies || {}, name)
        || (manifest.peerDependenciesMeta?.[name]?.optional === true && !Object.hasOwn(manifest.dependencies || {}, name));
      if (!resolved) {
        if (!optional) issues.push(`${manifestPath} requires ${name}@${required}, but it is unavailable from that consumer.`);
        continue;
      }
      if (sourceManifests.has(name) && resolved !== sourceManifests.get(name)) {
        issues.push(`${manifestPath} requires ${name}, but resolves ${resolved}, not its selected source ${sourceManifests.get(name)}.`);
      }
      // Check the consumer's JSKIT contract as well as the installed version.
      if (!sourceManifests.has(name) && name.startsWith(JSKIT_SCOPE_PREFIX) && !String(required).startsWith("file:") && required !== versions.get(name)) {
        issues.push(`${manifestPath} requires ${name}@${required}; catalog requires ${versions.get(name) || "no such package"}.`);
      }
      pending.push(resolved);
    }
  }
  for (const [name, paths] of installations) {
    const distinctVersions = new Set(paths.values());
    if (distinctVersions.size > 1 || (singletonPackages.has(name) && paths.size > 1)) {
      issues.push(`${name} has ${singletonPackages.has(name) ? "duplicate singleton" : "conflicting"} installations: ${[...paths].map(([file, version]) => `${version} at ${file}`).join(", ")}.`);
    }
  }
  return { ok: issues.length === 0, issues, installations };
}

async function writeManifestUpdates(updates = []) {
  const temporaryPaths = [];
  const committed = [];
  try {
    for (const [index, update] of updates.entries()) {
      const temporaryPath = `${update.manifest.absolutePath}.jskit-${process.pid}-${index}.tmp`;
      await writeFile(temporaryPath, update.contents, "utf8");
      temporaryPaths.push(temporaryPath);
    }
    for (const [index, update] of updates.entries()) {
      await rename(temporaryPaths[index], update.manifest.absolutePath);
      committed.push(update);
    }
  } catch (error) {
    for (const update of committed) {
      await writeFile(update.manifest.absolutePath, update.manifest.contents, "utf8");
    }
    throw error;
  } finally {
    await Promise.all(temporaryPaths.map((temporaryPath) => rm(temporaryPath, { force: true })));
  }
}

async function readOptionalFile(absolutePath) {
  try {
    return Object.freeze({
      contents: await readFile(absolutePath, "utf8"),
      exists: true
    });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return Object.freeze({
        contents: "",
        exists: false
      });
    }
    throw error;
  }
}

async function restoreProjectFiles(updates, packageLockPath, packageLockSnapshot) {
  const rollbackUpdates = updates.map((update) => Object.freeze({
    contents: update.manifest.contents,
    manifest: Object.freeze({
      ...update.manifest,
      contents: update.contents
    })
  }));
  await writeManifestUpdates(rollbackUpdates);
  if (packageLockSnapshot.exists) {
    const temporaryPath = `${packageLockPath}.jskit-${process.pid}-rollback.tmp`;
    try {
      await writeFile(temporaryPath, packageLockSnapshot.contents, "utf8");
      await rename(temporaryPath, packageLockPath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
    return;
  }
  await rm(packageLockPath, { force: true });
}

function removeJskitDependencyRecords(dependencies = {}, localPackageNames = new Set()) {
  for (const [packageId, record] of Object.entries(dependencies || {})) {
    if (packageId.startsWith(JSKIT_SCOPE_PREFIX) && !localPackageNames.has(packageId)) {
      delete dependencies[packageId];
      continue;
    }
    if (record && typeof record === "object" && !Array.isArray(record)) {
      removeJskitDependencyRecords(record.dependencies, localPackageNames);
    }
  }
}

function alignLockManifestRecord(lockRecord, manifest, localPackageNames) {
  if (!lockRecord || typeof lockRecord !== "object" || Array.isArray(lockRecord)) {
    return;
  }
  for (const field of DEPENDENCY_FIELDS) {
    const nextDeclarations = {
      ...(lockRecord[field] && typeof lockRecord[field] === "object" ? lockRecord[field] : {})
    };
    for (const packageId of Object.keys(nextDeclarations)) {
      if (packageId.startsWith(JSKIT_SCOPE_PREFIX) && !localPackageNames.has(packageId)) {
        delete nextDeclarations[packageId];
      }
    }
    for (const [packageId, version] of Object.entries(manifest.value?.[field] || {})) {
      if (packageId.startsWith(JSKIT_SCOPE_PREFIX) && !localPackageNames.has(packageId)) {
        nextDeclarations[packageId] = version;
      }
    }
    if (Object.keys(nextDeclarations).length > 0) {
      lockRecord[field] = nextDeclarations;
    } else {
      delete lockRecord[field];
    }
  }
}

async function preparePackageLockForInstall(projectRoot, manifests, packageLockPath) {
  if (!(await fileExists(packageLockPath))) {
    return;
  }
  const packageLock = await readJsonRecord(packageLockPath);
  const next = structuredClone(packageLock.value);
  const localPackageNames = collectLocalPackageNames(manifests);
  if (next.packages && typeof next.packages === "object" && !Array.isArray(next.packages)) {
    for (const [packagePath, record] of Object.entries(next.packages)) {
      const packageId = resolveLockPackageName(packagePath, record);
      if (packageId && record?.link !== true && !localPackageNames.has(packageId)) {
        delete next.packages[packagePath];
      }
    }
    for (const manifest of manifests) {
      const relativeDirectory = toPosixPath(
        path.relative(projectRoot, path.dirname(manifest.absolutePath))
      );
      alignLockManifestRecord(next.packages[relativeDirectory], manifest, localPackageNames);
    }
  }
  removeJskitDependencyRecords(next.dependencies, localPackageNames);
  const temporaryPath = `${packageLockPath}.jskit-${process.pid}-install.tmp`;
  try {
    await writeFile(temporaryPath, serializePackageJson(next, packageLock.contents), "utf8");
    await rename(temporaryPath, packageLockPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function spawnNpmInstall(projectRoot) {
  await new Promise((resolve, reject) => {
    const child = spawn("npm", ["install"], {
      cwd: projectRoot,
      env: process.env,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`npm install failed (code=${code}, signal=${signal || "none"}).`));
    });
  });
}

async function runNpmInstall(projectRoot) {
  const nodeModulesPath = path.join(projectRoot, "node_modules");
  const hadNodeModules = await fileExists(nodeModulesPath);
  const backupRoot = hadNodeModules
    ? await mkdtemp(path.join(projectRoot, ".jskit-update-"))
    : null;
  // Preserve the dependency directory name so development watchers keep excluding it.
  const backupPath = backupRoot ? path.join(backupRoot, "node_modules") : null;
  if (hadNodeModules) {
    try {
      await rename(nodeModulesPath, backupPath);
    } catch (error) {
      await rm(backupRoot, { force: true, recursive: true });
      throw error;
    }
  }

  let settled = false;
  const transaction = Object.freeze({
    async commit() {
      if (settled) {
        return;
      }
      if (backupRoot) {
        await rm(backupRoot, { force: true, recursive: true });
      }
      settled = true;
    },
    async rollback() {
      if (settled) {
        return;
      }
      try {
        await rm(nodeModulesPath, { force: true, recursive: true });
        if (backupPath) {
          await rename(backupPath, nodeModulesPath);
        }
      } catch (error) {
        if (backupPath) {
          throw new Error(`Could not restore node_modules; backup retained at ${backupPath}.`, { cause: error });
        }
        throw error;
      }
      if (backupRoot) {
        await rm(backupRoot, { force: true, recursive: true });
      }
      settled = true;
    }
  });

  try {
    await spawnNpmInstall(projectRoot);
    return transaction;
  } catch (error) {
    try {
      await transaction.rollback();
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        `npm install failed and the previous node_modules directory could not be restored. ${rollbackError.message}`
      );
    }
    throw error;
  }
}

async function updateProject({
  projectRoot = process.cwd(),
  catalog,
  install = true,
  installProject = runNpmInstall,
  additionalManifests = []
} = {}) {
  const root = path.resolve(projectRoot);
  const normalizedCatalog = normalizeCatalog(catalog);
  const manifests = await discoverProjectManifests(root, additionalManifests);
  const localPackageNames = collectLocalPackageNames(manifests);
  const declarations = collectManifestDeclarations(manifests, root)
    .filter((entry) => !localPackageNames.has(entry.packageId));
  const unknownPackageIds = [...new Set(
    declarations
      .map((entry) => entry.packageId)
      .filter((packageId) => !normalizedCatalog.versions.has(packageId))
  )].sort();
  if (unknownPackageIds.length > 0) {
    throw new Error(`Cannot update JSKIT packages missing from the coordinated catalog: ${unknownPackageIds.join(", ")}.`);
  }

  const overrideLocations = manifests.flatMap((manifest) => {
    const source = toPosixPath(path.relative(root, manifest.absolutePath)) || "package.json";
    return collectJskitOverridePaths(manifest.value?.overrides)
      .map((overridePath) => `${source}#${overridePath}`);
  });
  if (overrideLocations.length > 0) {
    throw new Error(
      "Cannot update while private JSKIT overrides are present; remove these entries first: " +
      `${overrideLocations.sort().join(", ")}.`
    );
  }

  const catalogVersion = normalizedCatalog.versions.get(CATALOG_PACKAGE_ID);
  if (!catalogVersion) {
    throw new Error(`Coordinated catalog is missing ${CATALOG_PACKAGE_ID}.`);
  }

  const updates = [];
  for (const [index, manifest] of manifests.entries()) {
    const next = structuredClone(manifest.value);
    let changed = false;
    for (const field of DEPENDENCY_FIELDS) {
      for (const packageId of Object.keys(next?.[field] || {})) {
        if (!packageId.startsWith(JSKIT_SCOPE_PREFIX) || localPackageNames.has(packageId)) {
          continue;
        }
        const expectedVersion = normalizedCatalog.versions.get(packageId);
        if (next[field][packageId] !== expectedVersion) {
          next[field][packageId] = expectedVersion;
          changed = true;
        }
      }
    }

    if (index === 0) {
      next.devDependencies = next.devDependencies && typeof next.devDependencies === "object"
        ? next.devDependencies
        : {};
      if (next.devDependencies[CATALOG_PACKAGE_ID] !== catalogVersion) {
        next.devDependencies[CATALOG_PACKAGE_ID] = catalogVersion;
        changed = true;
      }
      next.scripts = next.scripts && typeof next.scripts === "object" ? next.scripts : {};
      if (!next.scripts["jskit:update"]) {
        next.scripts["jskit:update"] = UPDATE_SCRIPT;
        changed = true;
      }
      if (!next.scripts["jskit:check"]) {
        next.scripts["jskit:check"] = CHECK_SCRIPT;
        changed = true;
      }
    }

    if (changed) {
      updates.push(Object.freeze({
        manifest,
        contents: serializePackageJson(next, manifest.contents)
      }));
    }
  }

  const packageLockPath = path.join(root, "package-lock.json");
  const packageLockSnapshot = install ? await readOptionalFile(packageLockPath) : null;
  await writeManifestUpdates(updates);
  let installTransaction = null;
  try {
    if (install) {
      const updatedManifests = await discoverProjectManifests(root, additionalManifests);
      await preparePackageLockForInstall(root, updatedManifests, packageLockPath);
      installTransaction = await installProject(root);
      const result = await checkProject({ projectRoot: root, catalog, additionalManifests });
      if (!result.ok) {
        throw new Error(`JSKIT graph remains inconsistent after npm install:\n- ${result.issues.join("\n- ")}`);
      }
      await installTransaction?.commit?.();
    }
  } catch (error) {
    const rollbackErrors = [];
    try {
      await installTransaction?.rollback?.();
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError);
    }
    try {
      await restoreProjectFiles(updates, packageLockPath, packageLockSnapshot);
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError);
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "JSKIT update failed and its previous project state could not be fully restored.\n" +
        rollbackErrors.map((rollbackError) => rollbackError.message).join("\n")
      );
    }
    throw error;
  }

  return Object.freeze({
    changedFiles: Object.freeze(
      updates.map((update) => toPosixPath(path.relative(root, update.manifest.absolutePath)))
    ),
    catalogVersion
  });
}

export {
  CATALOG_PACKAGE_ID,
  CHECK_SCRIPT,
  DEPENDENCY_FIELDS,
  UPDATE_SCRIPT,
  checkProject,
  checkInstalledGraph,
  resolveInstalledPackage,
  collectLockInstallations,
  discoverProjectManifests,
  normalizeCatalog,
  updateProject
};
