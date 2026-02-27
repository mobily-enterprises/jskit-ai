import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  constants as fsConstants,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createCliError, normalizeRelativePath } from "./schemas/validationHelpers.mjs";
import { ensureUniqueDescriptor } from "./schemas/descriptorRegistry.mjs";
import { normalizeBundleDescriptor } from "./schemas/bundleDescriptor.mjs";
import { normalizePackageDescriptor } from "./schemas/packageDescriptor.mjs";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BUNDLES_ROOT = path.join(PACKAGE_ROOT, "bundles");
const PACKAGE_DESCRIPTORS_ROOT = path.join(PACKAGE_ROOT, "packages");
const MONOREPO_PACKAGES_ROOT = path.resolve(PACKAGE_ROOT, "..", "..", "..", "packages");
const LOCK_RELATIVE_PATH = ".jskit/lock.json";
const LOCK_VERSION = 3;

function createIssue(message) {
  return {
    message: String(message || "Unknown issue")
  };
}

function toSortedUniqueStrings(values) {
  return [...new Set(values.map((value) => String(value)))].sort((left, right) => left.localeCompare(right));
}

function hashString(content) {
  return createHash("sha256").update(String(content || "")).digest("hex");
}

function createConflictError(conflictClass, message, issues = []) {
  const detailLines = Array.isArray(issues) && issues.length > 0
    ? `\n- ${issues.map((issue) => issue.message).join("\n- ")}`
    : "";
  return createCliError(`[${conflictClass}] ${message}${detailLines}`);
}

async function promptForRequiredOption({
  ownerType,
  ownerId,
  optionName,
  optionSchema,
  stdin = process.stdin,
  stdout = process.stdout
}) {
  if (!stdin?.isTTY || !stdout?.isTTY) {
    const valuesSuffix = optionSchema.values.length > 0 ? ` (${optionSchema.values.join(" | ")})` : "";
    throw createCliError(
      `${ownerType} ${ownerId} requires option ${optionName}. Non-interactive mode requires --${optionName} <value>${valuesSuffix}.`
    );
  }

  const valuesHint = optionSchema.values.length > 0 ? ` (${optionSchema.values.join(" / ")})` : "";
  const rl = createInterface({
    input: stdin,
    output: stdout
  });

  try {
    const answer = String(await rl.question(`Select ${optionName} for ${ownerType} ${ownerId}${valuesHint}: `)).trim();
    if (!answer) {
      throw createCliError(`${ownerType} ${ownerId} requires option ${optionName}.`);
    }
    return answer;
  } finally {
    rl.close();
  }
}

function getInstalledPackageDependents(lock, packageId, availablePackages, { excluding = new Set() } = {}) {
  const dependents = [];

  for (const installedPackageId of Object.keys(ensurePlainObjectRecord(lock.installedPackages))) {
    if (installedPackageId === packageId || excluding.has(installedPackageId)) {
      continue;
    }

    const installedPackageEntry = availablePackages.get(installedPackageId);
    if (!installedPackageEntry) {
      continue;
    }

    if (installedPackageEntry.descriptor.dependsOn.includes(packageId)) {
      dependents.push(installedPackageId);
    }
  }

  return dependents.sort((left, right) => left.localeCompare(right));
}

function parseArgs(argv) {
  const args = Array.isArray(argv) ? [...argv] : [];
  const command = String(args.shift() || "help").trim() || "help";

  const options = {
    dryRun: false,
    noInstall: false,
    json: false,
    all: false,
    help: false,
    inlineOptions: {}
  };

  const positional = [];

  while (args.length > 0) {
    const token = String(args.shift() || "");

    if (token === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (token === "--no-install") {
      options.noInstall = true;
      continue;
    }
    if (token === "--json") {
      options.json = true;
      continue;
    }
    if (token === "--all") {
      options.all = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      options.help = true;
      continue;
    }
    if (token.startsWith("--")) {
      const withoutPrefix = token.slice(2);
      if (!withoutPrefix) {
        throw createCliError(`Unknown option: ${token}`, {
          showUsage: true
        });
      }

      const hasInlineValue = withoutPrefix.includes("=");
      const optionName = hasInlineValue
        ? withoutPrefix.slice(0, withoutPrefix.indexOf("="))
        : withoutPrefix;
      const optionValue = hasInlineValue
        ? withoutPrefix.slice(withoutPrefix.indexOf("=") + 1).trim()
        : String(args.shift() || "").trim();

      if (!/^[a-z][a-z0-9-]*$/.test(optionName)) {
        throw createCliError(`Unknown option: ${token}`, {
          showUsage: true
        });
      }
      if (!optionValue || optionValue.startsWith("-")) {
        throw createCliError(`--${optionName} requires a value.`, {
          showUsage: true
        });
      }

      options.inlineOptions[optionName] = optionValue;
      continue;
    }

    if (token.startsWith("-")) {
      throw createCliError(`Unknown option: ${token}`, {
        showUsage: true
      });
    }

    positional.push(token);
  }

  return {
    command,
    options,
    positional
  };
}

function printUsage(stream = process.stderr) {
  stream.write("Usage: jskit <command> [options]\n\n");
  stream.write("Commands:\n");
  stream.write("  list [bundles|packages]   List available bundles/packages and installed status\n");
  stream.write("  lint-descriptors          Validate bundle/package descriptor files\n");
  stream.write("  add bundle <bundleId>     Add one bundle (bundle is a package shortcut)\n");
  stream.write("  add package <packageId>   Add one package to current app\n");
  stream.write("  update package <packageId> Re-apply one installed package\n");
  stream.write("  remove package <packageId> Remove one installed package\n");
  stream.write("  doctor                    Validate lockfile + managed files\n");
  stream.write("\n");
  stream.write("Options:\n");
  stream.write("  --dry-run                 Print planned changes only\n");
  stream.write("  --no-install              Skip npm install during add/update\n");
  stream.write("  --<option> <value>        Package option (for packages requiring input)\n");
  stream.write("  --json                    Print structured output\n");
  stream.write("  -h, --help                Show help\n");
}

async function fileExists(absolutePath) {
  try {
    await access(absolutePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(absolutePath) {
  const source = await readFile(absolutePath, "utf8");
  return JSON.parse(source);
}

async function writeJsonFile(absolutePath, value) {
  await mkdir(path.dirname(absolutePath), { recursive: true });
  const source = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(absolutePath, source, "utf8");
}

async function loadAppPackageJson(appRoot) {
  const packageJsonPath = path.join(appRoot, "package.json");
  const packageJson = await readJsonFile(packageJsonPath);
  return {
    packageJsonPath,
    packageJson
  };
}

function createDefaultLock() {
  return {
    lockVersion: LOCK_VERSION,
    installedPackages: {}
  };
}

async function loadLockFile(appRoot) {
  const lockPath = path.join(appRoot, LOCK_RELATIVE_PATH);
  if (!(await fileExists(lockPath))) {
    return {
      lockPath,
      lock: createDefaultLock()
    };
  }

  const lock = await readJsonFile(lockPath);
  if (Number(lock?.lockVersion) !== LOCK_VERSION) {
    throw createCliError(
      `Unsupported ${LOCK_RELATIVE_PATH} lockVersion ${lock?.lockVersion}. Expected ${LOCK_VERSION}.` +
        " Remove the lock file and re-run jskit commands for a clean v3 lock."
    );
  }

  if (!lock?.installedPackages || typeof lock.installedPackages !== "object") {
    throw createCliError(`Invalid ${LOCK_RELATIVE_PATH}: installedPackages must be an object.`);
  }

  return {
    lockPath,
    lock
  };
}

function normalizeProcessType(value) {
  const normalized = String(value || "").trim();
  if (!normalized || !/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw createCliError(`Invalid Procfile process type: ${value}`);
  }
  return normalized;
}

function parseProcfileLines(source) {
  return String(source || "")
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
}

function parseProcfileEntry(line) {
  const match = String(line || "").match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
  if (!match) {
    return null;
  }
  return {
    processType: match[1],
    command: match[2]
  };
}

function findProcfileCommand(source, processType) {
  const normalizedProcessType = normalizeProcessType(processType);
  for (const line of parseProcfileLines(source)) {
    const entry = parseProcfileEntry(line);
    if (entry && entry.processType === normalizedProcessType) {
      return entry.command;
    }
  }
  return null;
}

function upsertProcfileCommand(source, processType, command) {
  const normalizedProcessType = normalizeProcessType(processType);
  const lines = parseProcfileLines(source);
  const replacement = `${normalizedProcessType}: ${String(command || "").trim()}`;

  let found = false;
  const updated = lines.map((line) => {
    const entry = parseProcfileEntry(line);
    if (entry && entry.processType === normalizedProcessType) {
      found = true;
      return replacement;
    }
    return line;
  });

  if (!found) {
    if (normalizedProcessType === "release") {
      updated.unshift(replacement);
    } else {
      updated.push(replacement);
    }
  }

  return `${updated.join("\n")}\n`;
}

function removeProcfileCommand(source, processType) {
  const normalizedProcessType = normalizeProcessType(processType);
  const lines = parseProcfileLines(source);
  const filtered = lines.filter((line) => {
    const entry = parseProcfileEntry(line);
    return !entry || entry.processType !== normalizedProcessType;
  });
  return filtered.length > 0 ? `${filtered.join("\n")}\n` : "";
}

async function discoverAvailableBundles() {
  const entries = await readdir(BUNDLES_ROOT, { withFileTypes: true });
  const bundles = new Map();

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) {
      continue;
    }

    const bundleRoot = path.join(BUNDLES_ROOT, entry.name);
    const descriptorPath = path.join(bundleRoot, "bundle.descriptor.mjs");
    if (!(await fileExists(descriptorPath))) {
      continue;
    }

    const module = await import(pathToFileURL(descriptorPath).href);
    const descriptor = normalizeBundleDescriptor(module?.default, descriptorPath);

    const existing = bundles.get(descriptor.bundleId);
    ensureUniqueDescriptor(existing, descriptor.bundleId, descriptorPath, "bundle");

    bundles.set(descriptor.bundleId, {
      descriptor,
      bundleRoot,
      descriptorPath
    });
  }

  return bundles;
}

function getPackageDescriptorSearchRoots(appRoot) {
  const roots = new Set([
    PACKAGE_DESCRIPTORS_ROOT,
    MONOREPO_PACKAGES_ROOT,
    path.join(appRoot, "packages"),
    path.resolve(appRoot, "..", "packages")
  ]);

  return [...roots]
    .map((entry) => path.resolve(entry))
    .filter((entry, index, all) => all.indexOf(entry) === index);
}

async function findDescriptorFiles(rootPath, relativePath = "") {
  const absolutePath = relativePath ? path.join(rootPath, relativePath) : rootPath;
  const entries = await readdir(absolutePath, { withFileTypes: true }).catch(() => []);
  const files = [];

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist" || entry.name === "coverage") {
      continue;
    }

    const entryRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name;
    if (entry.isDirectory()) {
      const nested = await findDescriptorFiles(rootPath, entryRelativePath);
      files.push(...nested);
      continue;
    }

    if (entry.isFile() && entry.name === "package.descriptor.mjs") {
      files.push(path.join(rootPath, entryRelativePath));
    }
  }

  return files;
}

async function discoverAvailablePackages(appRoot) {
  const packages = new Map();
  const roots = getPackageDescriptorSearchRoots(appRoot);
  const descriptorPaths = [];

  for (const rootPath of roots) {
    if (!(await fileExists(rootPath))) {
      continue;
    }

    const found = await findDescriptorFiles(rootPath);
    descriptorPaths.push(...found);
  }

  const orderedDescriptorPaths = [...new Set(descriptorPaths.map((entry) => path.resolve(entry)))].sort((left, right) =>
    left.localeCompare(right)
  );

  for (const descriptorPath of orderedDescriptorPaths) {
    const module = await import(pathToFileURL(descriptorPath).href);
    const descriptor = normalizePackageDescriptor(module?.default, descriptorPath);
    const packageRoot = path.dirname(descriptorPath);

    const existing = packages.get(descriptor.packageId);
    ensureUniqueDescriptor(existing, descriptor.packageId, descriptorPath, "package");

    packages.set(descriptor.packageId, {
      descriptor,
      packageRoot,
      descriptorPath
    });
  }

  return packages;
}

async function lintDescriptors({ appRoot }) {
  const bundles = await discoverAvailableBundles();
  const packages = await discoverAvailablePackages(appRoot);
  return {
    command: "lint-descriptors",
    bundleCount: bundles.size,
    packageCount: packages.size
  };
}

function ensurePlainObjectRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function getInstalledPackageState(lock, packageId) {
  return ensurePlainObjectRecord(lock.installedPackages)[packageId] || null;
}

function getManagedPackageJsonEntry(installedPackageState, sectionName, key) {
  return (
    installedPackageState?.managed?.packageJson?.[sectionName] &&
    installedPackageState.managed.packageJson[sectionName][key]
  );
}

function isKeyManagedByOtherPackage(lock, currentPackageId, sectionName, key, expectedValue) {
  const installedPackages = ensurePlainObjectRecord(lock.installedPackages);

  for (const [packageId, state] of Object.entries(installedPackages)) {
    if (packageId === currentPackageId) {
      continue;
    }

    const section = state?.managed?.packageJson?.[sectionName];
    if (!section || typeof section !== "object") {
      continue;
    }

    const managedEntry = section[key];
    if (!managedEntry) {
      continue;
    }

    if (typeof expectedValue === "undefined" || String(managedEntry.value) === String(expectedValue)) {
      return packageId;
    }
  }

  return null;
}

function isManagedByOtherPackage(lock, currentPackageId, matcher) {
  for (const [packageId, state] of Object.entries(ensurePlainObjectRecord(lock.installedPackages))) {
    if (packageId === currentPackageId) {
      continue;
    }
    if (matcher(state, packageId)) {
      return packageId;
    }
  }
  return null;
}

function buildPackageJsonMutationPlan({ packageJson, packageDescriptor, lock, packageId }) {
  const clonedPackageJson = JSON.parse(JSON.stringify(packageJson));
  if (!clonedPackageJson.dependencies || typeof clonedPackageJson.dependencies !== "object") {
    clonedPackageJson.dependencies = {};
  }
  if (!clonedPackageJson.devDependencies || typeof clonedPackageJson.devDependencies !== "object") {
    clonedPackageJson.devDependencies = {};
  }
  if (!clonedPackageJson.scripts || typeof clonedPackageJson.scripts !== "object") {
    clonedPackageJson.scripts = {};
  }

  const previousState = getInstalledPackageState(lock, packageId);
  const managed = {
    dependencies: {},
    devDependencies: {},
    scripts: {}
  };
  const conflicts = [];
  let changed = false;
  let dependenciesTouched = false;

  const sections = [
    {
      descriptorMap: packageDescriptor.mutations.dependencies.runtime,
      packageJsonKey: "dependencies"
    },
    {
      descriptorMap: packageDescriptor.mutations.dependencies.dev,
      packageJsonKey: "devDependencies"
    },
    {
      descriptorMap: packageDescriptor.mutations.packageJson.scripts,
      packageJsonKey: "scripts"
    }
  ];

  for (const section of sections) {
    const currentSection = clonedPackageJson[section.packageJsonKey];
    managed[section.packageJsonKey] = {};

    for (const [name, desiredValue] of Object.entries(section.descriptorMap)) {
      const desiredString = String(desiredValue);
      const hasCurrentValue = Object.prototype.hasOwnProperty.call(currentSection, name);
      const currentValue = hasCurrentValue ? String(currentSection[name]) : null;
      const previousManaged = getManagedPackageJsonEntry(previousState, section.packageJsonKey, name);

      if (previousManaged && currentValue !== String(previousManaged.value)) {
        conflicts.push(
          createIssue(
            `Cannot set ${section.packageJsonKey}.${name}; value changed since install (expected ${previousManaged.value}, found ${currentValue ?? "<missing>"}).`
          )
        );
        continue;
      }

      const otherPackageManager = isKeyManagedByOtherPackage(
        lock,
        packageId,
        section.packageJsonKey,
        name,
        desiredString
      );
      if (otherPackageManager && currentValue !== desiredString) {
        conflicts.push(
          createIssue(
            `Cannot set ${section.packageJsonKey}.${name} to ${desiredValue}; managed by package ${otherPackageManager}.`
          )
        );
        continue;
      }

      const hadPrevious = previousManaged
        ? Boolean(previousManaged.hadPrevious)
        : otherPackageManager
          ? false
          : hasCurrentValue;
      const previousValue = previousManaged
        ? previousManaged.previousValue
        : hadPrevious
          ? String(currentSection[name])
          : "";

      if (currentValue !== desiredString) {
        currentSection[name] = desiredString;
        changed = true;
        if (section.packageJsonKey === "dependencies" || section.packageJsonKey === "devDependencies") {
          dependenciesTouched = true;
        }
      }

      managed[section.packageJsonKey][name] = {
        value: desiredString,
        hadPrevious,
        previousValue: hadPrevious ? previousValue : ""
      };
    }

    if (Object.keys(managed[section.packageJsonKey]).length === 0) {
      delete managed[section.packageJsonKey];
    }
  }

  return {
    packageJson: clonedPackageJson,
    managed,
    changed,
    dependenciesTouched,
    conflicts
  };
}

async function readProcfile(appRoot) {
  const procfilePath = path.join(appRoot, "Procfile");
  if (!(await fileExists(procfilePath))) {
    return {
      procfilePath,
      source: ""
    };
  }

  const source = await readFile(procfilePath, "utf8");
  return {
    procfilePath,
    source
  };
}

function buildProcfileMutationPlan({ procfileSource, packageDescriptor, lock, packageId }) {
  const previousState = getInstalledPackageState(lock, packageId);
  let nextSource = String(procfileSource || "");
  let changed = false;
  const managed = {};
  const conflicts = [];

  for (const [processType, command] of Object.entries(packageDescriptor.mutations.procfile)) {
    const existingCommand = findProcfileCommand(nextSource, processType);
    const previousManagedEntry = previousState?.managed?.procfile?.[processType] || null;
    if (previousManagedEntry && existingCommand !== String(previousManagedEntry.value)) {
      conflicts.push(
        createIssue(
          `Cannot set Procfile ${processType}; value changed since install (expected ${previousManagedEntry.value}, found ${existingCommand ?? "<missing>"}).`
        )
      );
      continue;
    }

    const otherPackageManager = isManagedByOtherPackage(lock, packageId, (state) => {
      const entry = state?.managed?.procfile?.[processType];
      return Boolean(entry && String(entry.value) === String(command));
    });

    const hadPrevious = previousManagedEntry
      ? Boolean(previousManagedEntry.hadPrevious)
      : otherPackageManager
        ? false
        : existingCommand !== null;
    const previousValue = previousManagedEntry
      ? previousManagedEntry.previousValue
      : hadPrevious
        ? String(existingCommand)
        : "";

    if (existingCommand !== String(command)) {
      nextSource = upsertProcfileCommand(nextSource, processType, String(command));
      changed = true;
    }

    managed[processType] = {
      value: String(command),
      hadPrevious,
      previousValue: hadPrevious ? previousValue : ""
    };
  }

  return {
    source: nextSource,
    changed,
    managed,
    conflicts
  };
}

async function buildFileMutationPlan({ appRoot, packageDescriptor, packageRoot, lock, packageId, mode }) {
  const previousState = getInstalledPackageState(lock, packageId);
  const previousManagedFiles = new Map(
    (Array.isArray(previousState?.managed?.files) ? previousState.managed.files : []).map((entry) => [entry.path, entry])
  );

  const conflicts = [];
  const operations = [];

  for (const fileEntry of packageDescriptor.mutations.files) {
    const relativeTargetPath = normalizeRelativePath(fileEntry.to);
    const targetPath = path.join(appRoot, relativeTargetPath);
    const sourcePath = path.join(packageRoot, normalizeRelativePath(fileEntry.from));

    const sourceContent = await readFile(sourcePath, "utf8");
    const sourceHash = hashString(sourceContent);

    const exists = await fileExists(targetPath);
    const previousManaged = previousManagedFiles.get(relativeTargetPath) || null;

    let currentHash = "";

    if (exists) {
      const currentContent = await readFile(targetPath, "utf8");
      currentHash = hashString(currentContent);
    }

    if (mode === "add" && exists && currentHash !== sourceHash && !previousManaged) {
      conflicts.push(
        createIssue(
          `Cannot apply file ${relativeTargetPath}: file already exists with different content.`
        )
      );
      continue;
    }

    if (mode === "update" && previousManaged && exists && currentHash !== previousManaged.hash) {
      conflicts.push(
        createIssue(
          `Cannot update file ${relativeTargetPath}: file changed since package install.`
        )
      );
      continue;
    }

    const shouldWrite = !exists || currentHash !== sourceHash;
    const createdByPackage = previousManaged ? Boolean(previousManaged.created) : !exists;

    operations.push({
      sourcePath,
      targetPath,
      relativeTargetPath,
      sourceHash,
      shouldWrite,
      created: createdByPackage
    });
  }

  return {
    operations,
    conflicts
  };
}

async function applyFileMutationPlan({ operations, dryRun, transaction }) {
  const managedFiles = [];

  for (const operation of operations) {
    if (operation.shouldWrite && !dryRun) {
      await copyFileWithTransaction(transaction, operation.sourcePath, operation.targetPath);
    }

    managedFiles.push({
      path: operation.relativeTargetPath,
      hash: operation.sourceHash,
      created: operation.created
    });
  }

  return managedFiles;
}

async function runNpmInstall(appRoot, { stdout = process.stdout } = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn("npm", ["install"], {
      cwd: appRoot,
      stdio: "inherit"
    });

    child.once("error", (error) => reject(error));
    child.once("close", (code, signal) => {
      if (typeof signal === "string" && signal.length > 0) {
        reject(createCliError(`npm install terminated by signal ${signal}.`));
        return;
      }

      if (code !== 0) {
        reject(createCliError(`npm install failed with exit code ${code}.`));
        return;
      }

      resolve();
    });
  });

  stdout.write("Ran npm install\n");
}

function createTransaction(appRoot) {
  return {
    appRoot,
    backups: new Map()
  };
}

async function backupPathForTransaction(transaction, absolutePath) {
  if (!transaction || transaction.backups.has(absolutePath)) {
    return;
  }

  const exists = await fileExists(absolutePath);
  const source = exists ? await readFile(absolutePath, "utf8") : "";

  transaction.backups.set(absolutePath, {
    exists,
    source
  });
}

async function writeJsonFileWithTransaction(transaction, absolutePath, value) {
  if (transaction) {
    await backupPathForTransaction(transaction, absolutePath);
  }
  await writeJsonFile(absolutePath, value);
}

async function writeTextFileWithTransaction(transaction, absolutePath, source) {
  if (transaction) {
    await backupPathForTransaction(transaction, absolutePath);
  }
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, source, "utf8");
}

async function copyFileWithTransaction(transaction, sourcePath, targetPath) {
  if (transaction) {
    await backupPathForTransaction(transaction, targetPath);
  }
  await mkdir(path.dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
}

async function rmFileWithTransaction(transaction, absolutePath) {
  if (transaction) {
    await backupPathForTransaction(transaction, absolutePath);
  }
  await rm(absolutePath, { force: true });
}

async function rollbackTransaction(transaction) {
  if (!transaction) {
    return;
  }

  const entries = [...transaction.backups.entries()].reverse();
  for (const [absolutePath, backup] of entries) {
    if (backup.exists) {
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, backup.source, "utf8");
      continue;
    }

    await rm(absolutePath, { force: true, recursive: true });
    await pruneEmptyDirectories(absolutePath, transaction.appRoot);
  }
}

function resolvePackageInstallOrder(rootPackageIds, availablePackages) {
  const visiting = new Set();
  const visited = new Set();
  const ordered = [];

  function visit(packageId, lineage = []) {
    if (visited.has(packageId)) {
      return;
    }
    if (visiting.has(packageId)) {
      throw createConflictError(
        "unresolved-dependency",
        `Package dependency cycle detected: ${[...lineage, packageId].join(" -> ")}`
      );
    }

    const packageEntry = availablePackages.get(packageId);
    if (!packageEntry) {
      throw createConflictError(
        "unresolved-dependency",
        `Unknown package in dependency graph: ${packageId}`
      );
    }

    visiting.add(packageId);
    for (const dependencyId of packageEntry.descriptor.dependsOn) {
      visit(dependencyId, [...lineage, packageId]);
    }
    visiting.delete(packageId);
    visited.add(packageId);
    ordered.push(packageId);
  }

  for (const packageId of rootPackageIds) {
    visit(packageId, []);
  }

  return ordered;
}

function buildBundleMetadata(bundleDescriptor, availablePackages) {
  const uniqueRootPackageIds = toSortedUniqueStrings(bundleDescriptor.packages);
  let resolvedPackageIds = uniqueRootPackageIds;
  try {
    resolvedPackageIds = toSortedUniqueStrings(resolvePackageInstallOrder(uniqueRootPackageIds, availablePackages));
  } catch {
    resolvedPackageIds = uniqueRootPackageIds;
  }

  const requiredCapabilities = new Set();
  const providedCapabilities = new Set();
  for (const packageId of resolvedPackageIds) {
    const packageEntry = availablePackages.get(packageId);
    if (!packageEntry) {
      continue;
    }
    for (const capabilityId of packageEntry.descriptor.capabilities.requires) {
      requiredCapabilities.add(capabilityId);
    }
    for (const capabilityId of packageEntry.descriptor.capabilities.provides) {
      providedCapabilities.add(capabilityId);
    }
  }

  return {
    packageCount: resolvedPackageIds.length,
    packages: resolvedPackageIds,
    requiredCapabilities: [...requiredCapabilities].sort((left, right) => left.localeCompare(right)),
    providedCapabilities: [...providedCapabilities].sort((left, right) => left.localeCompare(right))
  };
}

function buildOptionOwnerIndex(packageIds, availablePackages) {
  const owners = new Map();
  for (const packageId of packageIds) {
    const packageEntry = availablePackages.get(packageId);
    if (!packageEntry) {
      continue;
    }

    for (const optionName of Object.keys(ensurePlainObjectRecord(packageEntry.descriptor.options))) {
      if (!owners.has(optionName)) {
        owners.set(optionName, []);
      }
      owners.get(optionName).push(packageId);
    }
  }
  return owners;
}

function bindOptionsToPackages({ packageIds, availablePackages, providedOptions }) {
  const provided = ensurePlainObjectRecord(providedOptions);
  const optionOwners = buildOptionOwnerIndex(packageIds, availablePackages);
  const packageOptionMap = new Map();

  for (const packageId of packageIds) {
    packageOptionMap.set(packageId, {});
  }

  for (const [optionName, optionValue] of Object.entries(provided)) {
    const owners = optionOwners.get(optionName) || [];
    if (owners.length < 1) {
      throw createCliError(
        `Unknown option --${optionName} for selected packages.`
      );
    }
    if (owners.length > 1) {
      throw createCliError(
        `Ambiguous option --${optionName}: defined by multiple selected packages (${owners.join(", ")}).`
      );
    }

    packageOptionMap.set(owners[0], {
      ...ensurePlainObjectRecord(packageOptionMap.get(owners[0])),
      [optionName]: String(optionValue || "").trim()
    });
  }

  return packageOptionMap;
}

async function resolvePackageOptions({
  packageDescriptor,
  installedPackageState,
  providedOptions,
  stdin,
  stdout
}) {
  const optionsSchema = ensurePlainObjectRecord(packageDescriptor.options);
  const selectedOptions = {};

  for (const [optionName] of Object.entries(optionsSchema)) {
    const currentInstalledValue = String(installedPackageState?.options?.[optionName] || "").trim();
    if (currentInstalledValue) {
      selectedOptions[optionName] = currentInstalledValue;
    }
  }

  for (const [optionName, optionValue] of Object.entries(ensurePlainObjectRecord(providedOptions))) {
    if (!Object.prototype.hasOwnProperty.call(optionsSchema, optionName)) {
      throw createCliError(`Package ${packageDescriptor.packageId} does not support option --${optionName}.`);
    }
    selectedOptions[optionName] = String(optionValue || "").trim();
  }

  for (const [optionName, schema] of Object.entries(optionsSchema)) {
    let value = String(selectedOptions[optionName] || "").trim();
    if (!value && schema.required) {
      value = await promptForRequiredOption({
        ownerType: "package",
        ownerId: packageDescriptor.packageId,
        optionName,
        optionSchema: schema,
        stdin,
        stdout
      });
    }
    if (value && schema.values.length > 0 && !schema.values.includes(value)) {
      throw createCliError(
        `Invalid ${optionName} for package ${packageDescriptor.packageId}: ${value}. Allowed: ${schema.values.join(", ")}.`
      );
    }
    if (value) {
      selectedOptions[optionName] = value;
    }
  }

  return selectedOptions;
}

function buildCapabilityProviderIndex(installedPackageIds, availablePackages) {
  const providerIndex = new Map();

  for (const packageId of installedPackageIds) {
    const packageEntry = availablePackages.get(packageId);
    if (!packageEntry) {
      continue;
    }

    for (const capabilityId of packageEntry.descriptor.capabilities.provides) {
      if (!providerIndex.has(capabilityId)) {
        providerIndex.set(capabilityId, new Set());
      }
      providerIndex.get(capabilityId).add(packageId);
    }
  }

  return providerIndex;
}

function buildBundleProviderIndex(availableBundles, availablePackages) {
  const providerIndex = new Map();

  for (const bundleEntry of availableBundles.values()) {
    let resolvedPackageIds = [];
    try {
      resolvedPackageIds = resolvePackageInstallOrder(bundleEntry.descriptor.packages, availablePackages);
    } catch {
      resolvedPackageIds = [...bundleEntry.descriptor.packages];
    }

    for (const packageId of resolvedPackageIds) {
      const packageEntry = availablePackages.get(packageId);
      if (!packageEntry) {
        continue;
      }
      for (const capabilityId of packageEntry.descriptor.capabilities.provides) {
        if (!providerIndex.has(capabilityId)) {
          providerIndex.set(capabilityId, new Set());
        }
        providerIndex.get(capabilityId).add(bundleEntry.descriptor.bundleId);
      }
    }
  }

  return providerIndex;
}

function getCapabilityIssues(lock, availablePackages, { availableBundles = new Map() } = {}) {
  const issues = [];
  const installedPackageIds = Object.keys(ensurePlainObjectRecord(lock.installedPackages));
  const providerIndex = buildCapabilityProviderIndex(installedPackageIds, availablePackages);
  const bundleProviderIndex = buildBundleProviderIndex(availableBundles, availablePackages);

  for (const packageId of installedPackageIds) {
    const packageEntry = availablePackages.get(packageId);
    if (!packageEntry) {
      continue;
    }

    for (const requiredCapabilityId of packageEntry.descriptor.capabilities.requires) {
      const providers = providerIndex.get(requiredCapabilityId);
      if (!providers || providers.size < 1) {
        const suggestedBundles = toSortedUniqueStrings([...(bundleProviderIndex.get(requiredCapabilityId) || new Set())]);
        const suggestion =
          suggestedBundles.length > 0
            ? ` Install one provider bundle first: ${suggestedBundles.map((bundleId) => `jskit add bundle ${bundleId}`).join(" or ")}.`
            : "";
        issues.push(
          createIssue(
            `Package ${packageId} requires capability ${requiredCapabilityId}, but no installed package provides it.${suggestion}`
          )
        );
        continue;
      }

      if (providers.size > 1) {
        const providerList = toSortedUniqueStrings([...providers]);
        issues.push(
          createIssue(
            `Package ${packageId} requires capability ${requiredCapabilityId}, but multiple installed providers were found (${providerList.join(", ")}). Keep exactly one provider package.`
          )
        );
      }
    }
  }

  return issues;
}

function assertCapabilitiesSatisfied(lock, availablePackages, contextMessage, { availableBundles = new Map() } = {}) {
  const issues = getCapabilityIssues(lock, availablePackages, { availableBundles });
  if (issues.length > 0) {
    throw createConflictError(
      "capability-violation",
      `${contextMessage} violates capability requirements.`,
      issues
    );
  }
}

async function applyPackage({
  appRoot,
  packageEntry,
  lock,
  packageJson,
  packageJsonPath,
  dryRun,
  transaction,
  packageOptions = {},
  stdin = process.stdin,
  stdout = process.stdout
}) {
  const packageId = packageEntry.descriptor.packageId;
  const existingState = getInstalledPackageState(lock, packageId);
  const filePlanMode = existingState ? "update" : "add";
  const selectedOptions = await resolvePackageOptions({
    packageDescriptor: packageEntry.descriptor,
    installedPackageState: existingState,
    providedOptions: packageOptions,
    stdin,
    stdout
  });

  const packagePlan = buildPackageJsonMutationPlan({
    packageJson,
    packageDescriptor: packageEntry.descriptor,
    lock,
    packageId
  });

  const procfile = await readProcfile(appRoot);
  const procfilePlan = buildProcfileMutationPlan({
    procfileSource: procfile.source,
    packageDescriptor: packageEntry.descriptor,
    lock,
    packageId
  });

  const filesPlan = await buildFileMutationPlan({
    appRoot,
    packageDescriptor: packageEntry.descriptor,
    packageRoot: packageEntry.packageRoot,
    lock,
    packageId,
    mode: filePlanMode
  });

  if (packagePlan.conflicts.length > 0) {
    throw createConflictError(
      "managed-script-drift",
      `Package ${packageId} has package.json mutation conflicts.`,
      packagePlan.conflicts
    );
  }

  if (procfilePlan.conflicts.length > 0) {
    throw createConflictError(
      "managed-script-drift",
      `Package ${packageId} has Procfile mutation conflicts.`,
      procfilePlan.conflicts
    );
  }

  if (filesPlan.conflicts.length > 0) {
    throw createConflictError(
      "managed-file-drift",
      `Package ${packageId} has file mutation conflicts.`,
      filesPlan.conflicts
    );
  }

  const managedFiles = await applyFileMutationPlan({
    operations: filesPlan.operations,
    dryRun,
    transaction
  });

  const nextInstalledState = {
    packageId,
    version: packageEntry.descriptor.version,
    source: {
      type: "builtin",
      descriptorPath: path.relative(PACKAGE_ROOT, packageEntry.descriptorPath).replaceAll("\\", "/")
    },
    managed: {
      packageJson: packagePlan.managed,
      procfile: procfilePlan.managed,
      files: managedFiles
    },
    options: selectedOptions,
    installedAt: new Date().toISOString()
  };

  const nextLock = JSON.parse(JSON.stringify(lock));
  nextLock.lockVersion = LOCK_VERSION;
  if (!nextLock.installedPackages || typeof nextLock.installedPackages !== "object") {
    nextLock.installedPackages = {};
  }
  nextLock.installedPackages[packageId] = nextInstalledState;

  if (!dryRun) {
    if (packagePlan.changed) {
      await writeJsonFileWithTransaction(transaction, packageJsonPath, packagePlan.packageJson);
    }

    if (procfilePlan.changed) {
      await writeTextFileWithTransaction(transaction, procfile.procfilePath, procfilePlan.source);
    }
  }

  return {
    packageId,
    dryRun,
    packageJsonChanged: packagePlan.changed,
    procfileChanged: procfilePlan.changed,
    filesTouched: filesPlan.operations.map((operation) => operation.relativeTargetPath),
    dependenciesTouched: packagePlan.dependenciesTouched,
    journal: {
      packageId,
      mode: filePlanMode,
      options: selectedOptions,
      packageJsonChanged: packagePlan.changed,
      procfileChanged: procfilePlan.changed,
      filesTouched: filesPlan.operations.map((operation) => operation.relativeTargetPath),
      dependenciesTouched: packagePlan.dependenciesTouched
    },
    nextPackageJson: packagePlan.packageJson,
    nextLock
  };
}

function pruneEmptyDirectories(startPath, stopPath) {
  const normalizedStop = path.resolve(stopPath);

  async function prune(currentPath) {
    const normalizedCurrent = path.resolve(currentPath);
    if (!normalizedCurrent.startsWith(normalizedStop) || normalizedCurrent === normalizedStop) {
      return;
    }

    let entries;
    try {
      entries = await readdir(normalizedCurrent);
    } catch {
      return;
    }

    if (entries.length > 0) {
      return;
    }

    await rm(normalizedCurrent, { recursive: true, force: true });
    await prune(path.dirname(normalizedCurrent));
  }

  return prune(path.dirname(startPath));
}

async function removeInstalledPackage({
  appRoot,
  packageId,
  lock,
  packageJson,
  packageJsonPath,
  dryRun,
  transaction
}) {
  const installedState = getInstalledPackageState(lock, packageId);
  if (!installedState) {
    return {
      packageId,
      dryRun,
      removedFiles: [],
      issues: [createIssue(`Package ${packageId} was not installed.`)],
      journal: {
        packageId,
        removedFiles: []
      },
      nextLock: lock,
      nextPackageJson: packageJson
    };
  }

  const nextPackageJson = JSON.parse(JSON.stringify(packageJson));
  const packageConflicts = [];

  for (const sectionName of ["dependencies", "devDependencies", "scripts"]) {
    if (!nextPackageJson[sectionName] || typeof nextPackageJson[sectionName] !== "object") {
      nextPackageJson[sectionName] = {};
    }

    const managedEntries = ensurePlainObjectRecord(installedState?.managed?.packageJson?.[sectionName]);
    for (const [name, meta] of Object.entries(managedEntries)) {
      const currentValue = Object.prototype.hasOwnProperty.call(nextPackageJson[sectionName], name)
        ? String(nextPackageJson[sectionName][name])
        : null;

      const otherPackageManager = isManagedByOtherPackage(lock, packageId, (state) => {
        const entry = state?.managed?.packageJson?.[sectionName]?.[name];
        return Boolean(entry && String(entry.value) === String(meta.value));
      });

      if (otherPackageManager) {
        continue;
      }

      if (currentValue !== String(meta.value)) {
        packageConflicts.push(
          createIssue(
            `Skipped ${sectionName}.${name}: value changed from managed value ${meta.value}.`
          )
        );
        continue;
      }

      if (meta.hadPrevious) {
        nextPackageJson[sectionName][name] = meta.previousValue;
      } else {
        delete nextPackageJson[sectionName][name];
      }
    }
  }

  const procfile = await readProcfile(appRoot);
  let nextProcfileSource = procfile.source;
  const procfileConflicts = [];

  const procfileManaged = ensurePlainObjectRecord(installedState?.managed?.procfile);
  for (const [processType, meta] of Object.entries(procfileManaged)) {
    const currentCommand = findProcfileCommand(nextProcfileSource, processType);
    if (currentCommand !== String(meta.value)) {
      procfileConflicts.push(
        createIssue(`Skipped Procfile ${processType}: value changed from managed value ${meta.value}.`)
      );
      continue;
    }

    const otherPackageManager = isManagedByOtherPackage(lock, packageId, (state) => {
      const entry = state?.managed?.procfile?.[processType];
      return Boolean(entry && String(entry.value) === String(meta.value));
    });

    if (otherPackageManager) {
      continue;
    }

    if (meta.hadPrevious) {
      nextProcfileSource = upsertProcfileCommand(nextProcfileSource, processType, String(meta.previousValue));
    } else {
      nextProcfileSource = removeProcfileCommand(nextProcfileSource, processType);
    }
  }

  const fileConflicts = [];
  const removedFiles = [];

  for (const fileEntry of Array.isArray(installedState?.managed?.files) ? installedState.managed.files : []) {
    const relativePath = normalizeRelativePath(fileEntry.path);
    const absolutePath = path.join(appRoot, relativePath);
    const exists = await fileExists(absolutePath);
    if (!exists) {
      continue;
    }

    const otherPackageManager = isManagedByOtherPackage(lock, packageId, (state) => {
      const files = Array.isArray(state?.managed?.files) ? state.managed.files : [];
      return files.some((entry) => String(entry.path) === relativePath && String(entry.hash) === String(fileEntry.hash));
    });

    if (otherPackageManager) {
      continue;
    }

    const currentSource = await readFile(absolutePath, "utf8");
    const currentHash = hashString(currentSource);
    if (currentHash !== String(fileEntry.hash)) {
      fileConflicts.push(createIssue(`Skipped file ${relativePath}: file changed since install.`));
      continue;
    }

    if (fileEntry.created) {
      if (!dryRun) {
        await rmFileWithTransaction(transaction, absolutePath);
        await pruneEmptyDirectories(absolutePath, appRoot);
      }
      removedFiles.push(relativePath);
    }
  }

  const nextLock = JSON.parse(JSON.stringify(lock));
  delete nextLock.installedPackages[packageId];

  if (!dryRun) {
    await writeJsonFileWithTransaction(transaction, packageJsonPath, nextPackageJson);

    if (nextProcfileSource.trim().length > 0) {
      await writeTextFileWithTransaction(transaction, procfile.procfilePath, nextProcfileSource);
    } else if (await fileExists(procfile.procfilePath)) {
      await rmFileWithTransaction(transaction, procfile.procfilePath);
    }
  }

  return {
    packageId,
    dryRun,
    removedFiles: toSortedUniqueStrings(removedFiles),
    issues: [...packageConflicts, ...procfileConflicts, ...fileConflicts],
    journal: {
      packageId,
      removedFiles: toSortedUniqueStrings(removedFiles),
      issues: [...packageConflicts, ...procfileConflicts, ...fileConflicts]
    },
    nextLock,
    nextPackageJson
  };
}

async function validateDoctor({ appRoot, lock, availableBundles, availablePackages }) {
  const issues = [];
  const legacyManifestPath = path.join(appRoot, "framework", "app.manifest.mjs");
  if (await fileExists(legacyManifestPath)) {
    issues.push(
      createIssue(
        "[legacy-surface] Legacy framework manifest detected (app.manifest.mjs). Remove it and install bundles via jskit add."
      )
    );
  }

  for (const [packageId, state] of Object.entries(ensurePlainObjectRecord(lock.installedPackages))) {
    if (!availablePackages.has(packageId)) {
      issues.push(createIssue(`Installed package ${packageId} is not available in current catalog.`));
      continue;
    }

    const files = Array.isArray(state?.managed?.files) ? state.managed.files : [];
    for (const fileEntry of files) {
      const absolutePath = path.join(appRoot, normalizeRelativePath(fileEntry.path));
      if (!(await fileExists(absolutePath))) {
        issues.push(createIssue(`Managed file missing: ${fileEntry.path}`));
        continue;
      }

      const source = await readFile(absolutePath, "utf8");
      const hash = hashString(source);
      if (hash !== String(fileEntry.hash)) {
        issues.push(createIssue(`Managed file drift detected: ${fileEntry.path}`));
      }
    }
  }

  const capabilityIssues = getCapabilityIssues(lock, availablePackages, { availableBundles });
  issues.push(...capabilityIssues);

  return {
    ok: issues.length === 0,
    issues
  };
}

function formatResult(result, { json, stdout }) {
  if (json) {
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (result.command === "list") {
    if (result.availableBundles) {
      stdout.write("Available bundles:\n");
      for (const entry of result.availableBundles) {
        stdout.write(`- ${entry.bundleId} (${entry.version})${entry.installed ? " [installed]" : ""}\n`);
      }
    }
    if (result.availablePackages) {
      stdout.write("Available packages:\n");
      for (const entry of result.availablePackages) {
        stdout.write(`- ${entry.packageId} (${entry.version})${entry.installed ? " [installed]" : ""}\n`);
      }
    }
    return;
  }

  if (result.command === "lint-descriptors") {
    stdout.write(
      `Descriptor lint passed (${result.bundleCount} bundle descriptors, ${result.packageCount} package descriptors).\n`
    );
    return;
  }

  if (result.command === "add-bundle") {
    stdout.write(`Added bundle ${result.bundleId}${result.dryRun ? " [dry-run]" : ""}.\n`);
    if (result.packageIds.length > 0) {
      stdout.write(`Resolved packages (${result.packageIds.length}):\n`);
      for (const packageId of result.packageIds) {
        stdout.write(`- ${packageId}\n`);
      }
    }
    if (result.filesTouched.length > 0) {
      stdout.write(`Touched files (${result.filesTouched.length}):\n`);
      for (const file of result.filesTouched) {
        stdout.write(`- ${file}\n`);
      }
    }
    if (result.npmInstallRan) {
      stdout.write("Dependencies installed via npm install.\n");
    }
    stdout.write(`Lock file: ${result.lockPath}\n`);
    return;
  }

  if (result.command === "add-package" || result.command === "update-package") {
    const label = result.command === "add-package" ? "Added" : "Updated";
    stdout.write(`${label} package ${result.packageId}${result.dryRun ? " [dry-run]" : ""}.\n`);
    if (result.packageIds.length > 0) {
      stdout.write(`Applied packages (${result.packageIds.length}):\n`);
      for (const appliedPackageId of result.packageIds) {
        stdout.write(`- ${appliedPackageId}\n`);
      }
    }
    if (result.filesTouched.length > 0) {
      stdout.write(`Touched files (${result.filesTouched.length}):\n`);
      for (const file of result.filesTouched) {
        stdout.write(`- ${file}\n`);
      }
    }
    if (result.npmInstallRan) {
      stdout.write("Dependencies installed via npm install.\n");
    }
    stdout.write(`Lock file: ${result.lockPath}\n`);
    return;
  }

  if (result.command === "remove-package") {
    stdout.write(`Removed package ${result.packageId}${result.dryRun ? " [dry-run]" : ""}.\n`);
    if (result.removedFiles.length > 0) {
      stdout.write(`Removed files (${result.removedFiles.length}):\n`);
      for (const file of result.removedFiles) {
        stdout.write(`- ${file}\n`);
      }
    }
    stdout.write(`Lock file: ${result.lockPath}\n`);
    return;
  }

  if (result.command === "doctor") {
    if (result.ok) {
      stdout.write("OK: no lockfile or managed-file issues detected.\n");
    } else {
      stdout.write("Doctor issues:\n");
      for (const issue of result.issues) {
        stdout.write(`- ${issue.message}\n`);
      }
    }
    return;
  }
}

async function applyBundleOperation({
  appRoot,
  bundle,
  availableBundles,
  availablePackages,
  lock,
  lockPath,
  packageJson,
  packageJsonPath,
  dryRun,
  noInstall,
  inlineOptions,
  stdin,
  stdout
}) {
  const bundleId = bundle.descriptor.bundleId;
  const packageIds = resolvePackageInstallOrder(bundle.descriptor.packages, availablePackages);
  const packageOptionMap = bindOptionsToPackages({
    packageIds,
    availablePackages,
    providedOptions: inlineOptions
  });

  const packageResults = [];
  let nextLock = lock;
  let nextPackageJson = packageJson;
  const transaction = dryRun ? null : createTransaction(appRoot);

  try {
    for (const packageId of packageIds) {
      const packageEntry = availablePackages.get(packageId);
      if (!packageEntry) {
        throw createCliError(`Unknown package: ${packageId}`);
      }

      const packageResult = await applyPackage({
        appRoot,
        packageEntry,
        lock: nextLock,
        packageJson: nextPackageJson,
        packageJsonPath,
        dryRun,
        transaction,
        packageOptions: packageOptionMap.get(packageId),
        stdin,
        stdout
      });

      packageResults.push(packageResult);
      nextLock = packageResult.nextLock;
      nextPackageJson = packageResult.nextPackageJson;
    }

    assertCapabilitiesSatisfied(nextLock, availablePackages, `Bundle ${bundleId} add`, {
      availableBundles
    });

    const dependenciesTouched = packageResults.some((entry) => entry.dependenciesTouched);
    if (!dryRun && dependenciesTouched && !noInstall) {
      await runNpmInstall(appRoot, { stdout });
    }

    if (!dryRun) {
      await writeJsonFileWithTransaction(transaction, lockPath, nextLock);
    }

    return {
      bundleId,
      dryRun,
      noInstall,
      packageIds,
      packageJsonChanged: packageResults.some((entry) => entry.packageJsonChanged),
      procfileChanged: packageResults.some((entry) => entry.procfileChanged),
      filesTouched: toSortedUniqueStrings(packageResults.flatMap((entry) => entry.filesTouched)),
      npmInstallRan: dependenciesTouched && !noInstall && !dryRun,
      journal: {
        operation: "add-bundle",
        bundleId,
        packageApplyOrder: packageIds,
        packageOperations: packageResults.map((entry) => entry.journal)
      },
      lockPath: LOCK_RELATIVE_PATH,
      nextPackageJson,
      nextLock
    };
  } catch (error) {
    await rollbackTransaction(transaction);
    throw error;
  }
}

function throwOnRemovalIssues(packageId, issues, contextMessage) {
  if (!Array.isArray(issues) || issues.length === 0) {
    return;
  }

  const hasFileConflict = issues.some((issue) => String(issue?.message || "").includes("file "));
  throw createConflictError(
    hasFileConflict ? "managed-file-drift" : "managed-script-drift",
    `${contextMessage} for package ${packageId} has conflicts.`,
    issues
  );
}

async function applySinglePackageOperation({
  mode,
  appRoot,
  packageId,
  availableBundles,
  availablePackages,
  lock,
  lockPath,
  packageJson,
  packageJsonPath,
  dryRun,
  noInstall,
  inlineOptions,
  stdin,
  stdout
}) {
  const packageEntry = availablePackages.get(packageId);
  if (!packageEntry) {
    throw createConflictError("unresolved-dependency", `Unknown package: ${packageId}`);
  }

  const existingState = getInstalledPackageState(lock, packageId);
  if (mode === "add" && existingState) {
    throw createCliError(`Package ${packageId} is already installed. Use jskit update package ${packageId}.`);
  }
  if (mode === "update" && !existingState) {
    throw createCliError(`Package ${packageId} is not installed. Use jskit add package ${packageId}.`);
  }

  const packageIds = resolvePackageInstallOrder([packageId], availablePackages);
  const packageOptionMap = bindOptionsToPackages({
    packageIds,
    availablePackages,
    providedOptions: inlineOptions
  });
  const packageResults = [];
  let nextLock = lock;
  let nextPackageJson = packageJson;
  const transaction = dryRun ? null : createTransaction(appRoot);

  try {
    for (const targetPackageId of packageIds) {
      const targetEntry = availablePackages.get(targetPackageId);
      if (!targetEntry) {
        throw createConflictError("unresolved-dependency", `Unknown package in apply list: ${targetPackageId}`);
      }

      const applyResult = await applyPackage({
        appRoot,
        packageEntry: targetEntry,
        lock: nextLock,
        packageJson: nextPackageJson,
        packageJsonPath,
        dryRun,
        transaction,
        packageOptions: packageOptionMap.get(targetPackageId),
        stdin,
        stdout
      });

      packageResults.push(applyResult);
      nextLock = applyResult.nextLock;
      nextPackageJson = applyResult.nextPackageJson;
    }

    assertCapabilitiesSatisfied(nextLock, availablePackages, `Package ${packageId} ${mode}`, {
      availableBundles
    });

    const dependenciesTouched = packageResults.some((entry) => entry.dependenciesTouched);
    if (!dryRun && dependenciesTouched && !noInstall) {
      await runNpmInstall(appRoot, { stdout });
    }

    if (!dryRun) {
      await writeJsonFileWithTransaction(transaction, lockPath, nextLock);
    }

    return {
      packageId,
      mode,
      dryRun,
      noInstall,
      packageIds,
      packageJsonChanged: packageResults.some((entry) => entry.packageJsonChanged),
      procfileChanged: packageResults.some((entry) => entry.procfileChanged),
      filesTouched: toSortedUniqueStrings(packageResults.flatMap((entry) => entry.filesTouched)),
      npmInstallRan: dependenciesTouched && !noInstall && !dryRun,
      journal: {
        operation: mode,
        packageId,
        packageApplyOrder: packageIds,
        packageOperations: packageResults.map((entry) => entry.journal)
      },
      lockPath: LOCK_RELATIVE_PATH,
      nextPackageJson,
      nextLock
    };
  } catch (error) {
    await rollbackTransaction(transaction);
    throw error;
  }
}

async function removeSinglePackageOperation({
  appRoot,
  packageId,
  availableBundles,
  availablePackages,
  lock,
  lockPath,
  packageJson,
  packageJsonPath,
  dryRun
}) {
  const installedState = getInstalledPackageState(lock, packageId);
  if (!installedState) {
    throw createCliError(`Package ${packageId} is not installed.`);
  }

  const dependents = getInstalledPackageDependents(lock, packageId, availablePackages);
  if (dependents.length > 0) {
    throw createConflictError(
      "unresolved-dependency",
      `Cannot remove package ${packageId}; required by installed packages.`,
      dependents.map((dependentId) => createIssue(`Required by package ${dependentId}.`))
    );
  }

  const transaction = dryRun ? null : createTransaction(appRoot);
  try {
    const removalResult = await removeInstalledPackage({
      appRoot,
      packageId,
      lock,
      packageJson,
      packageJsonPath,
      dryRun,
      transaction
    });

    throwOnRemovalIssues(packageId, removalResult.issues, "Removing package");
    const nextLock = removalResult.nextLock;
    assertCapabilitiesSatisfied(nextLock, availablePackages, `Removing package ${packageId}`, {
      availableBundles
    });

    if (!dryRun) {
      const hasPackages = Object.keys(ensurePlainObjectRecord(nextLock.installedPackages)).length > 0;
      if (hasPackages) {
        await writeJsonFileWithTransaction(transaction, lockPath, nextLock);
      } else if (await fileExists(lockPath)) {
        await rmFileWithTransaction(transaction, lockPath);
      }
    }

    return {
      packageId,
      dryRun,
      removedPackages: [packageId],
      removedFiles: removalResult.removedFiles,
      journal: {
        operation: "remove",
        packageId,
        removedFiles: removalResult.removedFiles,
        packageOperations: [removalResult.journal]
      },
      lockPath: LOCK_RELATIVE_PATH,
      nextLock
    };
  } catch (error) {
    await rollbackTransaction(transaction);
    throw error;
  }
}

export async function runCli(
  argv,
  {
    cwd = process.cwd(),
    stdin = process.stdin,
    stdout = process.stdout,
    stderr = process.stderr
  } = {}
) {
  try {
    const parsed = parseArgs(argv);
    const appRoot = path.resolve(cwd);

    if (parsed.options.help || parsed.command === "help") {
      printUsage(stdout);
      return 0;
    }

    if (parsed.command === "lint-descriptors") {
      if (parsed.positional.length > 0) {
        throw createCliError("jskit lint-descriptors does not accept positional arguments.", {
          showUsage: true
        });
      }

      const result = await lintDescriptors({ appRoot });
      formatResult(result, {
        json: parsed.options.json,
        stdout
      });
      return 0;
    }

    if (parsed.options.all) {
      throw createCliError("The --all flag is not supported by the bundle/package command model.", {
        showUsage: true
      });
    }

    const inlineOptionCount = Object.keys(parsed.options.inlineOptions).length;
    const allowsInlineOptions =
      (parsed.command === "add" && parsed.positional[0] === "bundle") ||
      (parsed.command === "add" && parsed.positional[0] === "package") ||
      (parsed.command === "update" && parsed.positional[0] === "package");
    if (inlineOptionCount > 0 && !allowsInlineOptions) {
      throw createCliError("Inline options are supported only for add bundle/package and update package.", {
        showUsage: true
      });
    }

    const { packageJson, packageJsonPath } = await loadAppPackageJson(appRoot);
    const { lock, lockPath } = await loadLockFile(appRoot);
    const availableBundles = await discoverAvailableBundles();
    const availablePackages = await discoverAvailablePackages(appRoot);

    let result = null;

    if (parsed.command === "list") {
      if (parsed.positional.length > 1) {
        throw createCliError("jskit list accepts at most one selector: bundles or packages.", {
          showUsage: true
        });
      }

      const selector = String(parsed.positional[0] || "all").trim();
      if (!["all", "bundles", "packages"].includes(selector)) {
        throw createCliError(`Unknown list selector: ${selector}. Expected bundles or packages.`, {
          showUsage: true
        });
      }

      const installedPackageIds = new Set(Object.keys(ensurePlainObjectRecord(lock.installedPackages)));
      const availableBundleEntries = [...availableBundles.values()].map((entry) => {
        const metadata = buildBundleMetadata(entry.descriptor, availablePackages);
        const installed = metadata.packages.every((packageId) => installedPackageIds.has(packageId));
        return {
          bundleId: entry.descriptor.bundleId,
          version: entry.descriptor.version,
          description: entry.descriptor.description,
          installed,
          ...metadata
        };
      });

      const availablePackageEntries = [...availablePackages.values()].map((entry) => ({
        packageId: entry.descriptor.packageId,
        version: entry.descriptor.version,
        description: entry.descriptor.description,
        installed: installedPackageIds.has(entry.descriptor.packageId),
        options: entry.descriptor.options,
        dependsOn: entry.descriptor.dependsOn,
        requiredCapabilities: entry.descriptor.capabilities.requires,
        providedCapabilities: entry.descriptor.capabilities.provides
      }));

      result = {
        command: "list",
        availableBundles: selector === "all" || selector === "bundles" ? availableBundleEntries : null,
        availablePackages: selector === "all" || selector === "packages" ? availablePackageEntries : null
      };
      formatResult(result, {
        json: parsed.options.json,
        stdout
      });
      return 0;
    }

    if (parsed.command === "add") {
      if (parsed.positional.length !== 2) {
        throw createCliError("jskit add requires a scope and id: bundle <bundleId> or package <packageId>.", {
          showUsage: true
        });
      }

      const scope = parsed.positional[0];
      const targetId = parsed.positional[1];

      if (scope === "bundle") {
        const bundle = availableBundles.get(targetId);
        if (!bundle) {
          throw createCliError(`Unknown bundle: ${targetId}`);
        }

        result = await applyBundleOperation({
          appRoot,
          bundle,
          availableBundles,
          availablePackages,
          lock,
          lockPath,
          packageJson,
          packageJsonPath,
          dryRun: parsed.options.dryRun,
          noInstall: parsed.options.noInstall,
          inlineOptions: parsed.options.inlineOptions,
          stdin,
          stdout
        });
        result.command = "add-bundle";
      } else if (scope === "package") {
        result = await applySinglePackageOperation({
          mode: "add",
          appRoot,
          packageId: targetId,
          availableBundles,
          availablePackages,
          lock,
          lockPath,
          packageJson,
          packageJsonPath,
          dryRun: parsed.options.dryRun,
          noInstall: parsed.options.noInstall,
          inlineOptions: parsed.options.inlineOptions,
          stdin,
          stdout
        });
        result.command = "add-package";
      } else {
        throw createCliError(`Unknown add scope: ${scope}. Expected bundle or package.`, {
          showUsage: true
        });
      }

      formatResult(result, {
        json: parsed.options.json,
        stdout
      });
      return 0;
    }

    if (parsed.command === "update") {
      if (parsed.positional.length !== 2 || parsed.positional[0] !== "package") {
        throw createCliError("jskit update supports only package scope: update package <packageId>.", {
          showUsage: true
        });
      }

      result = await applySinglePackageOperation({
        mode: "update",
        appRoot,
        packageId: parsed.positional[1],
        availableBundles,
        availablePackages,
        lock,
        lockPath,
        packageJson,
        packageJsonPath,
        dryRun: parsed.options.dryRun,
        noInstall: parsed.options.noInstall,
        inlineOptions: parsed.options.inlineOptions,
        stdin,
        stdout
      });
      result.command = "update-package";

      formatResult(result, {
        json: parsed.options.json,
        stdout
      });
      return 0;
    }

    if (parsed.command === "remove") {
      if (parsed.positional.length !== 2 || parsed.positional[0] !== "package") {
        throw createCliError("jskit remove supports only package scope: remove package <packageId>.", {
          showUsage: true
        });
      }

      result = await removeSinglePackageOperation({
        appRoot,
        packageId: parsed.positional[1],
        availableBundles,
        availablePackages,
        lock,
        lockPath,
        packageJson,
        packageJsonPath,
        dryRun: parsed.options.dryRun
      });
      result.command = "remove-package";

      formatResult(result, {
        json: parsed.options.json,
        stdout
      });
      return 0;
    }

    if (parsed.command === "doctor") {
      if (parsed.positional.length > 0) {
        throw createCliError("jskit doctor does not accept positional arguments.", {
          showUsage: true
        });
      }

      result = await validateDoctor({
        appRoot,
        lock,
        availableBundles,
        availablePackages
      });
      result.command = "doctor";

      formatResult(result, {
        json: parsed.options.json,
        stdout
      });
      return result.ok ? 0 : 1;
    }

    throw createCliError(`Unknown command: ${parsed.command}`, {
      showUsage: true
    });
  } catch (error) {
    stderr.write(`Error: ${error?.message || String(error)}\n`);
    if (error?.showUsage) {
      stderr.write("\n");
      printUsage(stderr);
    }
    return Number.isInteger(error?.exitCode) ? error.exitCode : 1;
  }
}

export async function runCommand(command, options = {}) {
  return runCli(command, options);
}
