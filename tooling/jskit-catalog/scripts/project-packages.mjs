import { spawn } from "node:child_process";
import {
  access,
  readFile,
  readdir,
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

async function discoverProjectManifests(projectRoot) {
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
  for (const manifestPath of workspacePaths) {
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

async function checkProject({ projectRoot = process.cwd(), catalog } = {}) {
  const root = path.resolve(projectRoot);
  const normalizedCatalog = normalizeCatalog(catalog);
  const manifests = await discoverProjectManifests(root);
  const localPackageNames = collectLocalPackageNames(manifests);
  const declarations = collectManifestDeclarations(manifests, root)
    .filter((entry) => !localPackageNames.has(entry.packageId));
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
    const byPackageId = new Map();
    for (const installation of installations) {
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
    for (const packageId of new Set(declarations.map((entry) => entry.packageId))) {
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

async function runNpmInstall(projectRoot) {
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

async function updateProject({
  projectRoot = process.cwd(),
  catalog,
  install = true,
  installProject = runNpmInstall
} = {}) {
  const root = path.resolve(projectRoot);
  const normalizedCatalog = normalizeCatalog(catalog);
  const manifests = await discoverProjectManifests(root);
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
      if (next.scripts["jskit:update"] !== UPDATE_SCRIPT) {
        next.scripts["jskit:update"] = UPDATE_SCRIPT;
        changed = true;
      }
      if (next.scripts["jskit:check"] !== CHECK_SCRIPT) {
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

  await writeManifestUpdates(updates);
  if (install) {
    await installProject(root);
    const result = await checkProject({ projectRoot: root, catalog });
    if (!result.ok) {
      throw new Error(`JSKIT graph remains inconsistent after npm install:\n- ${result.issues.join("\n- ")}`);
    }
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
  collectLockInstallations,
  discoverProjectManifests,
  normalizeCatalog,
  updateProject
};
