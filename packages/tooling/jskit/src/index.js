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
import { fileURLToPath, pathToFileURL } from "node:url";
import { createCliError, normalizeRelativePath } from "./schemas/validationHelpers.mjs";
import { ensureUniqueDescriptor } from "./schemas/descriptorRegistry.mjs";
import { normalizePackDescriptor } from "./schemas/packDescriptor.mjs";
import { normalizePackageDescriptor } from "./schemas/packageDescriptor.mjs";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKS_ROOT = path.join(PACKAGE_ROOT, "packs");
const PACKAGE_DESCRIPTORS_ROOT = path.join(PACKAGE_ROOT, "packages");
const MONOREPO_PACKAGES_ROOT = path.resolve(PACKAGE_ROOT, "..", "..", "..", "packages");
const LOCK_RELATIVE_PATH = ".jskit/lock.json";
const LOCK_VERSION = 2;

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


function parseArgs(argv) {
  const args = Array.isArray(argv) ? [...argv] : [];
  const command = String(args.shift() || "help").trim() || "help";

  const options = {
    dryRun: false,
    noInstall: false,
    json: false,
    all: false,
    help: false,
    packOptions: {}
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

      options.packOptions[optionName] = optionValue;
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
  stream.write("  list                      List available and installed packs\n");
  stream.write("  lint-descriptors          Validate pack/package descriptor files\n");
  stream.write("  add <packId>              Add one pack to current app\n");
  stream.write("  update <packId>           Re-apply one installed pack\n");
  stream.write("  update --all              Re-apply all installed packs\n");
  stream.write("  remove <packId>           Remove one installed pack\n");
  stream.write("  doctor                    Validate lockfile + managed files\n");
  stream.write("\n");
  stream.write("Options:\n");
  stream.write("  --dry-run                 Print planned changes only\n");
  stream.write("  --no-install              Skip npm install during add/update\n");
  stream.write("  --<option> <value>        Pack option (for example: --provider mysql)\n");
  stream.write("  --all                     Used with update to target all packs\n");
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
    installedPacks: {},
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
        " Remove the lock file and re-run jskit commands for a clean v2 lock."
    );
  }

  if (!lock?.installedPacks || typeof lock.installedPacks !== "object") {
    throw createCliError(`Invalid ${LOCK_RELATIVE_PATH}: installedPacks must be an object.`);
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

async function discoverAvailablePacks() {
  const entries = await readdir(PACKS_ROOT, { withFileTypes: true });
  const packs = new Map();

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) {
      continue;
    }

    const packRoot = path.join(PACKS_ROOT, entry.name);
    const descriptorPath = path.join(packRoot, "pack.descriptor.mjs");
    if (!(await fileExists(descriptorPath))) {
      continue;
    }

    const module = await import(pathToFileURL(descriptorPath).href);
    const descriptor = normalizePackDescriptor(module?.default, descriptorPath);

    const existing = packs.get(descriptor.packId);
    ensureUniqueDescriptor(existing, descriptor.packId, descriptorPath, "pack");

    packs.set(descriptor.packId, {
      descriptor,
      packRoot,
      descriptorPath
    });
  }

  return packs;
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
  const packs = await discoverAvailablePacks();
  const packages = await discoverAvailablePackages(appRoot);
  return {
    command: "lint-descriptors",
    packCount: packs.size,
    packageCount: packages.size
  };
}

function ensurePlainObjectRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function getInstalledPackState(lock, packId) {
  return ensurePlainObjectRecord(lock.installedPacks)[packId] || null;
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

function isPackageReferencedByOtherPack(lock, currentPackId, packageId) {
  for (const [packId, state] of Object.entries(ensurePlainObjectRecord(lock.installedPacks))) {
    if (packId === currentPackId) {
      continue;
    }

    const packageIds = Array.isArray(state?.packageIds) ? state.packageIds : [];
    if (packageIds.includes(packageId)) {
      return packId;
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
      const otherPackageManager = isKeyManagedByOtherPackage(
        lock,
        packageId,
        section.packageJsonKey,
        name,
        String(desiredValue)
      );
      if (otherPackageManager && String(currentSection[name] ?? "") !== String(desiredValue)) {
        conflicts.push(
          createIssue(
            `Cannot set ${section.packageJsonKey}.${name} to ${desiredValue}; managed by package ${otherPackageManager}.`
          )
        );
        continue;
      }

      const previousManaged = getManagedPackageJsonEntry(previousState, section.packageJsonKey, name);
      const hadPrevious = previousManaged
        ? Boolean(previousManaged.hadPrevious)
        : Object.prototype.hasOwnProperty.call(currentSection, name);
      const previousValue = previousManaged
        ? previousManaged.previousValue
        : hadPrevious
          ? String(currentSection[name])
          : "";

      const currentValue = Object.prototype.hasOwnProperty.call(currentSection, name)
        ? String(currentSection[name])
        : null;

      if (currentValue !== String(desiredValue)) {
        currentSection[name] = String(desiredValue);
        changed = true;
        if (section.packageJsonKey === "dependencies" || section.packageJsonKey === "devDependencies") {
          dependenciesTouched = true;
        }
      }

      managed[section.packageJsonKey][name] = {
        value: String(desiredValue),
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

  for (const [processType, command] of Object.entries(packageDescriptor.mutations.procfile)) {
    const existingCommand = findProcfileCommand(nextSource, processType);
    const previousManagedEntry = previousState?.managed?.procfile?.[processType] || null;
    const hadPrevious = previousManagedEntry ? Boolean(previousManagedEntry.hadPrevious) : existingCommand !== null;
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
    managed
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

function resolvePackSelection({ packDescriptor, installedPackState, providedOptions }) {
  const optionsSchema = ensurePlainObjectRecord(packDescriptor.options);
  const selectedOptions = {};

  for (const [optionName] of Object.entries(optionsSchema)) {
    const currentInstalledValue = String(installedPackState?.options?.[optionName] || "").trim();
    if (currentInstalledValue) {
      selectedOptions[optionName] = currentInstalledValue;
    }
  }

  for (const [optionName, optionValue] of Object.entries(ensurePlainObjectRecord(providedOptions))) {
    if (!Object.prototype.hasOwnProperty.call(optionsSchema, optionName)) {
      throw createCliError(`Pack ${packDescriptor.packId} does not support option --${optionName}.`);
    }

    selectedOptions[optionName] = String(optionValue || "").trim();
  }

  for (const [optionName, schema] of Object.entries(optionsSchema)) {
    const value = String(selectedOptions[optionName] || "").trim();
    if (!value && schema.required) {
      const valuesSuffix = schema.values.length > 0 ? ` (${schema.values.join(" | ")})` : "";
      throw createCliError(
        `Pack ${packDescriptor.packId} requires option ${optionName}. Provide --${optionName} <value>${valuesSuffix}.`
      );
    }
    if (value && schema.values.length > 0 && !schema.values.includes(value)) {
      throw createCliError(
        `Invalid ${optionName} for pack ${packDescriptor.packId}: ${value}. Allowed: ${schema.values.join(", "
        )}.`
      );
    }
    if (value) {
      selectedOptions[optionName] = value;
    }
  }

  const rootPackageIds = [];
  for (const packageEntry of packDescriptor.packages) {
    if (!packageEntry.when) {
      rootPackageIds.push(packageEntry.packageId);
      continue;
    }

    const optionValue = String(selectedOptions[packageEntry.when.option] || "").trim();
    if (optionValue === packageEntry.when.equals) {
      rootPackageIds.push(packageEntry.packageId);
    }
  }

  const uniqueRootPackageIds = [...new Set(rootPackageIds)];
  if (uniqueRootPackageIds.length < 1) {
    throw createCliError(`Pack ${packDescriptor.packId} resolved to zero packages with current options.`);
  }

  return {
    options: selectedOptions,
    rootPackageIds: uniqueRootPackageIds
  };
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
      throw createCliError(`Package dependency cycle detected: ${[...lineage, packageId].join(" -> ")}`);
    }

    const packageEntry = availablePackages.get(packageId);
    if (!packageEntry) {
      throw createCliError(`Unknown package in dependency graph: ${packageId}`);
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

function getCapabilityIssues(lock, availablePackages) {
  const issues = [];
  const installedPackageIds = Object.keys(ensurePlainObjectRecord(lock.installedPackages));
  const providerIndex = buildCapabilityProviderIndex(installedPackageIds, availablePackages);

  for (const packageId of installedPackageIds) {
    const packageEntry = availablePackages.get(packageId);
    if (!packageEntry) {
      continue;
    }

    for (const requiredCapabilityId of packageEntry.descriptor.capabilities.requires) {
      const providers = providerIndex.get(requiredCapabilityId);
      if (!providers || providers.size < 1) {
        issues.push(
          createIssue(
            `Package ${packageId} requires capability ${requiredCapabilityId}, but no installed package provides it.`
          )
        );
      }
    }
  }

  return issues;
}

function assertCapabilitiesSatisfied(lock, availablePackages, contextMessage) {
  const issues = getCapabilityIssues(lock, availablePackages);
  if (issues.length > 0) {
    throw createCliError(
      `${contextMessage} violates capability requirements:\n- ${issues.map((issue) => issue.message).join("\n- ")}`
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
  transaction
}) {
  const packageId = packageEntry.descriptor.packageId;
  const existingState = getInstalledPackageState(lock, packageId);
  const filePlanMode = existingState ? "update" : "add";

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

  const conflicts = [...packagePlan.conflicts, ...filesPlan.conflicts];
  if (conflicts.length > 0) {
    throw createCliError(`Package ${packageId} has conflicts:\n- ${conflicts.map((issue) => issue.message).join("\n- ")}`);
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
    installedAt: new Date().toISOString()
  };

  const nextLock = JSON.parse(JSON.stringify(lock));
  nextLock.lockVersion = LOCK_VERSION;
  if (!nextLock.installedPackages || typeof nextLock.installedPackages !== "object") {
    nextLock.installedPackages = {};
  }
  if (!nextLock.installedPacks || typeof nextLock.installedPacks !== "object") {
    nextLock.installedPacks = {};
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
    nextLock,
    nextPackageJson
  };
}

async function validateDoctor({ appRoot, lock, availablePacks, availablePackages }) {
  const issues = [];

  for (const [packId, state] of Object.entries(ensurePlainObjectRecord(lock.installedPacks))) {
    if (!availablePacks.has(packId)) {
      issues.push(createIssue(`Installed pack ${packId} is not available in current catalog.`));
      continue;
    }

    const packageIds = Array.isArray(state?.packageIds) ? state.packageIds : [];
    for (const packageId of packageIds) {
      if (!lock.installedPackages?.[packageId]) {
        issues.push(createIssue(`Pack ${packId} references missing installed package ${packageId}.`));
      }
    }
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

  const capabilityIssues = getCapabilityIssues(lock, availablePackages);
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
    stdout.write("Available packs:\n");
    for (const entry of result.available) {
      stdout.write(`- ${entry.packId} (${entry.version})${entry.installed ? " [installed]" : ""}\n`);
    }
    return;
  }

  if (result.command === "lint-descriptors") {
    stdout.write(
      `Descriptor lint passed (${result.packCount} pack descriptors, ${result.packageCount} package descriptors).\n`
    );
    return;
  }

  if (result.command === "add" || result.command === "update") {
    const label = result.command === "add" ? "Added" : "Updated";
    stdout.write(`${label} pack ${result.packId}${result.dryRun ? " [dry-run]" : ""}.\n`);
    if (result.packageIds.length > 0) {
      stdout.write(`Resolved packages (${result.packageIds.length}):\n`);
      for (const packageId of result.packageIds) {
        stdout.write(`- ${packageId}\n`);
      }
    }
    if (result.command === "update" && result.removedPackages && result.removedPackages.length > 0) {
      stdout.write(`Removed packages (${result.removedPackages.length}):\n`);
      for (const packageId of result.removedPackages) {
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

  if (result.command === "remove") {
    stdout.write(`Removed pack ${result.packId}${result.dryRun ? " [dry-run]" : ""}.\n`);
    if (result.removedPackages.length > 0) {
      stdout.write(`Removed packages (${result.removedPackages.length}):\n`);
      for (const packageId of result.removedPackages) {
        stdout.write(`- ${packageId}\n`);
      }
    }
    if (result.skippedSharedPackages.length > 0) {
      stdout.write(`Kept shared packages (${result.skippedSharedPackages.length}):\n`);
      for (const packageId of result.skippedSharedPackages) {
        stdout.write(`- ${packageId}\n`);
      }
    }
    if (result.removedFiles.length > 0) {
      stdout.write(`Removed files (${result.removedFiles.length}):\n`);
      for (const file of result.removedFiles) {
        stdout.write(`- ${file}\n`);
      }
    }
    if (result.issues.length > 0) {
      stdout.write("Issues:\n");
      for (const issue of result.issues) {
        stdout.write(`- ${issue.message}\n`);
      }
    }
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

async function applyPackOperation({
  mode,
  appRoot,
  pack,
  availablePackages,
  lock,
  lockPath,
  packageJson,
  packageJsonPath,
  dryRun,
  noInstall,
  packOptions,
  stdout
}) {
  const packId = pack.descriptor.packId;
  const existingState = getInstalledPackState(lock, packId);

  if (mode === "add" && existingState) {
    throw createCliError(`Pack ${packId} is already installed. Use jskit update ${packId}.`);
  }
  if (mode === "update" && !existingState) {
    throw createCliError(`Pack ${packId} is not installed. Use jskit add ${packId}.`);
  }

  const selection = resolvePackSelection({
    packDescriptor: pack.descriptor,
    installedPackState: existingState,
    providedOptions: packOptions
  });

  const packageIds = resolvePackageInstallOrder(selection.rootPackageIds, availablePackages);
  const targetPackageIdSet = new Set(packageIds);
  const previousPackageIds = Array.isArray(existingState?.packageIds) ? existingState.packageIds : [];
  const removeOrder = [...previousPackageIds]
    .reverse()
    .filter((packageId) => !targetPackageIdSet.has(packageId));

  const packageResults = [];
  const removedPackages = [];
  const skippedSharedPackages = [];
  const removedFiles = [];
  let nextLock = lock;
  let nextPackageJson = packageJson;
  const transaction = dryRun ? null : createTransaction(appRoot);

  try {
    for (const packageId of removeOrder) {
      const sharedByPackId = isPackageReferencedByOtherPack(nextLock, packId, packageId);
      if (sharedByPackId) {
        skippedSharedPackages.push(packageId);
        continue;
      }

      const removalResult = await removeInstalledPackage({
        appRoot,
        packageId,
        lock: nextLock,
        packageJson: nextPackageJson,
        packageJsonPath,
        dryRun,
        transaction
      });

      if (removalResult.issues.length > 0) {
        throw createCliError(
          `Cannot update pack ${packId}; failed to remove package ${packageId} cleanly:\n- ${removalResult.issues
            .map((issue) => issue.message)
            .join("\n- ")}`
        );
      }

      removedPackages.push(packageId);
      removedFiles.push(...removalResult.removedFiles);
      nextLock = removalResult.nextLock;
      nextPackageJson = removalResult.nextPackageJson;
    }

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
        transaction
      });

      packageResults.push(packageResult);
      nextLock = packageResult.nextLock;
      nextPackageJson = packageResult.nextPackageJson;
    }

    const nextLockWithPack = JSON.parse(JSON.stringify(nextLock));
    if (!nextLockWithPack.installedPacks || typeof nextLockWithPack.installedPacks !== "object") {
      nextLockWithPack.installedPacks = {};
    }
    nextLockWithPack.installedPacks[packId] = {
      packId,
      version: pack.descriptor.version,
      options: selection.options,
      rootPackageIds: selection.rootPackageIds,
      packageIds,
      installedAt: new Date().toISOString()
    };

    assertCapabilitiesSatisfied(nextLockWithPack, availablePackages, `Pack ${packId} ${mode}`);

    const dependenciesTouched = packageResults.some((entry) => entry.dependenciesTouched);
    if (!dryRun && dependenciesTouched && !noInstall) {
      await runNpmInstall(appRoot, { stdout });
    }

    if (!dryRun) {
      await writeJsonFileWithTransaction(transaction, lockPath, nextLockWithPack);
    }

    return {
      packId,
      mode,
      dryRun,
      noInstall,
      packageIds,
      removedPackages: toSortedUniqueStrings(removedPackages),
      skippedSharedPackages: toSortedUniqueStrings(skippedSharedPackages),
      packageJsonChanged: packageResults.some((entry) => entry.packageJsonChanged),
      procfileChanged: packageResults.some((entry) => entry.procfileChanged),
      filesTouched: toSortedUniqueStrings([
        ...removedFiles,
        ...packageResults.flatMap((entry) => entry.filesTouched)
      ]),
      npmInstallRan: dependenciesTouched && !noInstall && !dryRun,
      lockPath: LOCK_RELATIVE_PATH,
      nextPackageJson,
      nextLock: nextLockWithPack
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

    if (Object.keys(parsed.options.packOptions).length > 0 && parsed.command !== "add" && parsed.command !== "update") {
      throw createCliError(`Pack options are supported only for jskit add/update.`, {
        showUsage: true
      });
    }

    const { packageJson, packageJsonPath } = await loadAppPackageJson(appRoot);
    const { lock, lockPath } = await loadLockFile(appRoot);
    const availablePacks = await discoverAvailablePacks();
    const availablePackages = await discoverAvailablePackages(appRoot);

    let result = null;

    if (parsed.command === "list") {
      if (parsed.positional.length > 0) {
        throw createCliError("jskit list does not accept positional arguments.", {
          showUsage: true
        });
      }

      const installedPackIds = new Set(Object.keys(ensurePlainObjectRecord(lock.installedPacks)));
      result = {
        command: "list",
        available: [...availablePacks.values()].map((entry) => ({
          packId: entry.descriptor.packId,
          version: entry.descriptor.version,
          description: entry.descriptor.description,
          installed: installedPackIds.has(entry.descriptor.packId)
        }))
      };
      formatResult(result, {
        json: parsed.options.json,
        stdout
      });
      return 0;
    }

    if (parsed.command === "add") {
      if (parsed.positional.length !== 1) {
        throw createCliError("jskit add requires exactly one <packId>.", {
          showUsage: true
        });
      }

      const packId = parsed.positional[0];
      const pack = availablePacks.get(packId);
      if (!pack) {
        throw createCliError(`Unknown pack: ${packId}`);
      }

      result = await applyPackOperation({
        mode: "add",
        appRoot,
        pack,
        availablePackages,
        lock,
        lockPath,
        packageJson,
        packageJsonPath,
        dryRun: parsed.options.dryRun,
        noInstall: parsed.options.noInstall,
        packOptions: parsed.options.packOptions,
        stdout
      });
      result.command = "add";

      formatResult(result, {
        json: parsed.options.json,
        stdout
      });
      return 0;
    }

    if (parsed.command === "update") {
      if (parsed.options.all && parsed.positional.length > 0) {
        throw createCliError("jskit update --all does not accept <packId>.", {
          showUsage: true
        });
      }

      if (parsed.options.all && Object.keys(parsed.options.packOptions).length > 0) {
        throw createCliError("jskit update --all does not support pack options.", {
          showUsage: true
        });
      }

      const installedPackIds = Object.keys(ensurePlainObjectRecord(lock.installedPacks));
      const targetPackIds = parsed.options.all
        ? installedPackIds
        : parsed.positional.length === 1
          ? [parsed.positional[0]]
          : [];

      if (targetPackIds.length === 0) {
        throw createCliError("jskit update requires <packId> or --all.", {
          showUsage: true
        });
      }

      const results = [];
      let nextLock = lock;
      let nextPackageJson = packageJson;

      for (const packId of targetPackIds) {
        const pack = availablePacks.get(packId);
        if (!pack) {
          throw createCliError(`Unknown pack: ${packId}`);
        }

        const updateResult = await applyPackOperation({
          mode: "update",
          appRoot,
          pack,
          availablePackages,
          lock: nextLock,
          lockPath,
          packageJson: nextPackageJson,
          packageJsonPath,
          dryRun: parsed.options.dryRun,
          noInstall: parsed.options.noInstall,
          packOptions: parsed.options.all ? {} : parsed.options.packOptions,
          stdout
        });

        results.push(updateResult);
        nextLock = updateResult.nextLock;
        nextPackageJson = updateResult.nextPackageJson;
      }

      result = {
        command: "update",
        updated: results.map((entry) => ({
          packId: entry.packId,
          packageIds: entry.packageIds,
          removedPackages: entry.removedPackages,
          filesTouched: entry.filesTouched,
          npmInstallRan: entry.npmInstallRan,
          dryRun: entry.dryRun
        }))
      };

      if (parsed.options.json) {
        formatResult(result, {
          json: true,
          stdout
        });
      } else {
        for (const entry of results) {
          formatResult(
            {
              ...entry,
              command: "update"
            },
            { json: false, stdout }
          );
        }
      }

      return 0;
    }

    if (parsed.command === "remove") {
      if (parsed.positional.length !== 1) {
        throw createCliError("jskit remove requires exactly one <packId>.", {
          showUsage: true
        });
      }

      const packId = parsed.positional[0];
      const installedPack = getInstalledPackState(lock, packId);
      if (!installedPack) {
        throw createCliError(`Pack ${packId} is not installed.`);
      }

      const packPackageIds = Array.isArray(installedPack.packageIds) ? installedPack.packageIds : [];
      const removeOrder = [...packPackageIds].reverse();

      const removedPackages = [];
      const skippedSharedPackages = [];
      const removedFiles = [];
      const issues = [];

      let nextLock = JSON.parse(JSON.stringify(lock));
      let nextPackageJson = packageJson;
      const transaction = parsed.options.dryRun ? null : createTransaction(appRoot);

      try {
        for (const packageId of removeOrder) {
          const sharedByPackId = isPackageReferencedByOtherPack(nextLock, packId, packageId);
          if (sharedByPackId) {
            skippedSharedPackages.push(packageId);
            continue;
          }

          const removalResult = await removeInstalledPackage({
            appRoot,
            packageId,
            lock: nextLock,
            packageJson: nextPackageJson,
            packageJsonPath,
            dryRun: parsed.options.dryRun,
            transaction
          });

          removedPackages.push(packageId);
          removedFiles.push(...removalResult.removedFiles);
          issues.push(...removalResult.issues);
          nextLock = removalResult.nextLock;
          nextPackageJson = removalResult.nextPackageJson;
        }

        delete nextLock.installedPacks[packId];
        assertCapabilitiesSatisfied(nextLock, availablePackages, `Removing pack ${packId}`);

        if (!parsed.options.dryRun) {
          const hasPacks = Object.keys(ensurePlainObjectRecord(nextLock.installedPacks)).length > 0;
          const hasPackages = Object.keys(ensurePlainObjectRecord(nextLock.installedPackages)).length > 0;

          if (hasPacks || hasPackages) {
            await writeJsonFileWithTransaction(transaction, lockPath, nextLock);
          } else if (await fileExists(lockPath)) {
            await rmFileWithTransaction(transaction, lockPath);
          }
        }
      } catch (error) {
        await rollbackTransaction(transaction);
        throw error;
      }

      result = {
        command: "remove",
        packId,
        dryRun: parsed.options.dryRun,
        removedPackages: toSortedUniqueStrings(removedPackages),
        skippedSharedPackages: toSortedUniqueStrings(skippedSharedPackages),
        removedFiles: toSortedUniqueStrings(removedFiles),
        issues,
        lockPath: LOCK_RELATIVE_PATH,
        nextLock
      };

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
        availablePacks,
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
