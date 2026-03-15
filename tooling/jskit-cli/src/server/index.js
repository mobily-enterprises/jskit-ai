import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  constants as fsConstants,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { createCliError } from "./cliError.js";
import {
  ensureArray,
  ensureObject,
  sortStrings
} from "./collectionUtils.js";
import {
  createColorFormatter,
  resolveWrapWidth,
  writeWrappedItems
} from "./outputFormatting.js";
import {
  BUNDLES_ROOT,
  CATALOG_PACKAGES_PATH,
  CLI_PACKAGE_ROOT,
  MODULES_ROOT,
  WORKSPACE_ROOT
} from "./pathResolution.js";
import {
  appendTextSnippet,
  escapeRegExp,
  interpolateOptionValue,
  normalizeSkipChecks,
  promptForRequiredOption
} from "./optionInterpolation.js";
import { createCommandHandlers } from "./commandHandlers.js";

const LOCK_RELATIVE_PATH = ".jskit/lock.json";
const LOCK_VERSION = 1;
const PACKAGE_INSTALL_MODE_INSTALLABLE = "installable";
const PACKAGE_INSTALL_MODE_CLONE_ONLY = "clone-only";
const PACKAGE_INSTALL_MODES = Object.freeze([PACKAGE_INSTALL_MODE_INSTALLABLE, PACKAGE_INSTALL_MODE_CLONE_ONLY]);
const MATERIALIZED_PACKAGE_ROOTS = new Map();
const MATERIALIZED_PACKAGE_TEMP_DIRECTORIES = new Set();
const BUILTIN_CAPABILITY_PROVIDERS = Object.freeze({
  "runtime.actions": Object.freeze(["@jskit-ai/kernel"])
});
const KNOWN_COMMANDS = new Set([
  "help",
  "create",
  "list",
  "show",
  "view",
  "add",
  "update",
  "remove",
  "doctor",
  "lint-descriptors"
]);

function normalizeFileMutationRecord(value) {
  const record = ensureObject(value);
  const op = String(record.op || "copy-file").trim().toLowerCase() || "copy-file";
  const extension = String(record.extension || "").trim();
  return {
    op,
    from: String(record.from || "").trim(),
    to: String(record.to || "").trim(),
    toDir: String(record.toDir || "").trim(),
    slug: String(record.slug || "").trim(),
    extension: extension
      ? extension.startsWith(".")
        ? extension
        : `.${extension}`
      : "",
    preserveOnRemove: record.preserveOnRemove === true,
    id: String(record.id || "").trim(),
    category: String(record.category || "").trim(),
    reason: String(record.reason || "").trim(),
    when: normalizeMutationWhen(record.when)
  };
}

function normalizeMutationWhen(value) {
  const source = ensureObject(value);
  const option = String(source.option || "").trim();
  const equals = String(source.equals || "").trim();
  const notEquals = String(source.notEquals || "").trim();
  const includes = ensureArray(source.in).map((entry) => String(entry || "").trim()).filter(Boolean);
  const excludes = ensureArray(source.notIn).map((entry) => String(entry || "").trim()).filter(Boolean);

  if (!option) {
    return null;
  }

  return {
    option,
    equals,
    notEquals,
    includes,
    excludes
  };
}

function shouldApplyMutationWhen(when, options = {}) {
  if (!when || typeof when !== "object") {
    return true;
  }

  const optionName = String(when.option || "").trim();
  if (!optionName) {
    return true;
  }

  const optionValue = String(options[optionName] || "").trim();
  const equals = String(when.equals || "").trim();
  const notEquals = String(when.notEquals || "").trim();
  const includes = ensureArray(when.includes).map((entry) => String(entry || "").trim()).filter(Boolean);
  const excludes = ensureArray(when.excludes).map((entry) => String(entry || "").trim()).filter(Boolean);

  if (equals && optionValue !== equals) {
    return false;
  }
  if (notEquals && optionValue === notEquals) {
    return false;
  }
  if (includes.length > 0 && !includes.includes(optionValue)) {
    return false;
  }
  if (excludes.length > 0 && excludes.includes(optionValue)) {
    return false;
  }

  return true;
}

function buildFileWriteGroups(fileMutations) {
  const groups = [];
  const groupsByKey = new Map();

  for (const mutation of ensureArray(fileMutations)) {
    const normalized = normalizeFileMutationRecord(mutation);
    if (normalized.op === "install-migration") {
      if (!normalized.from || !normalized.slug) {
        continue;
      }
    } else if (!normalized.from || !normalized.to) {
      continue;
    }

    const key = normalized.id
      ? `id:${normalized.id}`
      : normalized.category || normalized.reason
        ? `meta:${normalized.category}::${normalized.reason}`
        : `path:${normalized.to}`;

    let group = groupsByKey.get(key);
    if (!group) {
      group = {
        id: normalized.id,
        category: normalized.category,
        reason: normalized.reason,
        files: []
      };
      groupsByKey.set(key, group);
      groups.push(group);
    } else {
      if (!group.category && normalized.category) {
        group.category = normalized.category;
      }
      if (!group.reason && normalized.reason) {
        group.reason = normalized.reason;
      }
    }

    if (normalized.op === "install-migration") {
      const toDir = normalized.toDir || "migrations";
      const extension = normalized.extension || ".cjs";
      group.files.push({
        from: normalized.from,
        to: `${toDir}/<timestamp>_${normalized.slug}${extension}`
      });
      continue;
    }

    group.files.push({
      from: normalized.from,
      to: normalized.to
    });
  }

  return groups;
}

function normalizeRelativePath(fromRoot, absolutePath) {
  return path.relative(fromRoot, absolutePath).split(path.sep).join("/");
}

function hashBuffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function formatMigrationTimestamp(date = new Date()) {
  const source = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const year = source.getUTCFullYear();
  const month = String(source.getUTCMonth() + 1).padStart(2, "0");
  const day = String(source.getUTCDate()).padStart(2, "0");
  const hours = String(source.getUTCHours()).padStart(2, "0");
  const minutes = String(source.getUTCMinutes()).padStart(2, "0");
  const seconds = String(source.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

function normalizeMigrationSlug(value, packageId) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!normalized) {
    throw createCliError(`Invalid install-migration mutation in ${packageId}: \"slug\" is required.`);
  }
  return normalized;
}

function normalizeMigrationExtension(value = "", fallback = ".cjs") {
  const normalizedFallback = String(fallback || ".cjs").trim() || ".cjs";
  const raw = String(value || "").trim();
  const candidate = raw ? (raw.startsWith(".") ? raw : `.${raw}`) : normalizedFallback;
  if (!/^\.[a-z0-9]+$/i.test(candidate)) {
    throw createCliError(`Invalid install-migration extension: ${candidate}`);
  }
  return candidate.toLowerCase();
}

const JSKIT_MIGRATION_ID_PATTERN = /JSKIT_MIGRATION_ID:\s*([A-Za-z0-9._-]+)/i;

function extractMigrationIdFromSource(source) {
  const content = String(source || "");
  const match = content.match(JSKIT_MIGRATION_ID_PATTERN);
  if (!match) {
    return "";
  }
  return String(match[1] || "").trim();
}

async function findExistingMigrationById({ appRoot, migrationsDirectory, migrationId }) {
  const normalizedMigrationId = String(migrationId || "").trim();
  if (!normalizedMigrationId) {
    return null;
  }

  const absoluteDirectory = path.join(appRoot, migrationsDirectory);
  if (!(await fileExists(absoluteDirectory))) {
    return null;
  }

  const entries = await readdir(absoluteDirectory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const absolutePath = path.join(absoluteDirectory, entry.name);
    const fileContent = await readFile(absolutePath, "utf8").catch(() => "");
    const fileMigrationId = extractMigrationIdFromSource(fileContent);
    if (!fileMigrationId || fileMigrationId !== normalizedMigrationId) {
      continue;
    }

    return {
      path: normalizeRelativePath(appRoot, absolutePath)
    };
  }

  return null;
}

function toScopedPackageId(input) {
  const raw = String(input || "").trim();
  if (!raw) {
    return "";
  }
  if (raw.startsWith("@")) {
    return raw;
  }
  return `@jskit-ai/${raw}`;
}

function resolvePackageIdInput(input, packageRegistry) {
  const raw = String(input || "").trim();
  if (!raw) {
    return "";
  }
  if (packageRegistry.has(raw)) {
    return raw;
  }
  const scoped = toScopedPackageId(raw);
  if (scoped && packageRegistry.has(scoped)) {
    return scoped;
  }
  return "";
}

function resolveInstalledPackageIdInput(input, installedPackages) {
  const raw = String(input || "").trim();
  if (!raw) {
    return "";
  }
  if (Object.prototype.hasOwnProperty.call(installedPackages, raw)) {
    return raw;
  }
  const scoped = toScopedPackageId(raw);
  if (scoped && Object.prototype.hasOwnProperty.call(installedPackages, scoped)) {
    return scoped;
  }
  return "";
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
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readFileBufferIfExists(absolutePath) {
  if (!(await fileExists(absolutePath))) {
    return {
      exists: false,
      buffer: Buffer.alloc(0)
    };
  }

  return {
    exists: true,
    buffer: await readFile(absolutePath)
  };
}

function parseArgs(argv) {
  const args = Array.isArray(argv) ? [...argv] : [];
  const firstToken = String(args[0] || "").trim();
  if (firstToken === "--help" || firstToken === "-h") {
    args.shift();
    return {
      command: "help",
      options: {
        dryRun: false,
        noInstall: false,
        full: false,
        expanded: false,
        details: false,
        debugExports: false,
        json: false,
        all: false,
        help: true,
        inlineOptions: {}
      },
      positional: []
    };
  }

  const rawCommand = String(args.shift() || "help").trim() || "help";
  const command = rawCommand === "view" ? "show" : rawCommand === "ls" ? "list" : rawCommand;

  if (!KNOWN_COMMANDS.has(command)) {
    throw createCliError(`Unknown command: ${rawCommand}`, { showUsage: true });
  }

  const options = {
    dryRun: false,
    noInstall: false,
    full: false,
    expanded: false,
    details: false,
    debugExports: false,
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
    if (token === "--full") {
      options.full = true;
      continue;
    }
    if (token === "--expanded") {
      options.expanded = true;
      continue;
    }
    if (token === "--details") {
      options.details = true;
      continue;
    }
    if (token === "--debug-exports") {
      options.debugExports = true;
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
      const hasInlineValue = withoutPrefix.includes("=");
      const optionName = hasInlineValue ? withoutPrefix.slice(0, withoutPrefix.indexOf("=")) : withoutPrefix;
      const optionValueRaw = hasInlineValue
        ? withoutPrefix.slice(withoutPrefix.indexOf("=") + 1)
        : args.shift();

      if (!/^[a-z][a-z0-9-]*$/.test(optionName)) {
        throw createCliError(`Unknown option: ${token}`, { showUsage: true });
      }
      if (typeof optionValueRaw !== "string") {
        throw createCliError(`--${optionName} requires a value.`, { showUsage: true });
      }
      const optionValue = optionValueRaw.trim();
      if (!hasInlineValue && optionValue.startsWith("-")) {
        throw createCliError(`--${optionName} requires a value.`, { showUsage: true });
      }

      options.inlineOptions[optionName] = optionValue;
      continue;
    }

    if (token.startsWith("-")) {
      throw createCliError(`Unknown option: ${token}`, { showUsage: true });
    }

    positional.push(token);
  }

  if (options.debugExports) {
    options.details = true;
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
  stream.write("  create package <name>        Scaffold app-local package under packages/ and install it\n");
  stream.write("  list [bundles [all]|packages] List available bundles/packages and installed status\n");
  stream.write("  lint-descriptors             Validate bundle/package descriptor files\n");
  stream.write("  add bundle <bundleId>        Add one bundle (bundle is a package shortcut)\n");
  stream.write("  add package <packageId>      Add one package to current app (catalog/app-local/installed external)\n");
  stream.write("  show <id>                    Show details for bundle id or package id\n");
  stream.write("  view <id>                    Alias of show <id>\n");
  stream.write("  update package <packageId>   Re-apply one installed package\n");
  stream.write("  remove package <packageId>   Remove one installed package\n");
  stream.write("  doctor                       Validate lockfile + managed files\n");
  stream.write("\n");
  stream.write("Options:\n");
  stream.write("  --dry-run                    Print planned changes only\n");
  stream.write("  --no-install                 Skip npm install during create/add/update/remove\n");
  stream.write("  --scope <scope>              (create package) override generated package scope\n");
  stream.write("  --package-id <id>            (create package) explicit @scope/name package id\n");
  stream.write("  --description <text>         (create package) descriptor description text\n");
  stream.write("  --full                       Show bundle package ids (declared packages)\n");
  stream.write("  --expanded                   Show expanded/transitive package ids\n");
  stream.write("  --details                    Show extra capability detail in show output\n");
  stream.write("  --debug-exports              Show export provenance/re-export source details in show output\n");
  stream.write("  --<option> <value>           Package option (for packages requiring input)\n");
  stream.write("  --json                       Print structured output\n");
  stream.write("  -h, --help                   Show help\n");
}

async function resolveAppRootFromCwd(cwd) {
  const startDirectory = path.resolve(String(cwd || process.cwd()));
  let currentDirectory = startDirectory;

  while (true) {
    const packageJsonPath = path.join(currentDirectory, "package.json");
    if (await fileExists(packageJsonPath)) {
      return currentDirectory;
    }

    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      throw createCliError(
        `Could not locate package.json starting from ${startDirectory}. Run jskit from an app directory (or a child directory of one).`
      );
    }
    currentDirectory = parentDirectory;
  }
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
  const installedPackages = ensureObject(lock?.installedPackages);
  const lockVersion = Number(lock?.lockVersion);
  return {
    lockPath,
    lock: {
      lockVersion: Number.isFinite(lockVersion) && lockVersion > 0 ? lockVersion : LOCK_VERSION,
      installedPackages
    }
  };
}

function createManagedPackageJsonChange(hadPrevious, previousValue, value) {
  return {
    hadPrevious: Boolean(hadPrevious),
    previousValue: hadPrevious ? String(previousValue) : "",
    value: String(value)
  };
}

function ensurePackageJsonSection(packageJson, sectionName) {
  const sectionValue = ensureObject(packageJson[sectionName]);
  packageJson[sectionName] = sectionValue;
  return sectionValue;
}

function applyPackageJsonField(packageJson, sectionName, key, value) {
  const section = ensurePackageJsonSection(packageJson, sectionName);
  const nextValue = String(value);
  const hadPrevious = Object.prototype.hasOwnProperty.call(section, key);
  const previousValue = hadPrevious ? String(section[key]) : "";
  const changed = !hadPrevious || previousValue !== nextValue;
  section[key] = nextValue;
  return {
    changed,
    managed: createManagedPackageJsonChange(hadPrevious, previousValue, nextValue)
  };
}

function removePackageJsonField(packageJson, sectionName, key) {
  const section = ensureObject(packageJson[sectionName]);
  if (!Object.prototype.hasOwnProperty.call(section, key)) {
    return false;
  }
  delete section[key];
  if (Object.keys(section).length < 1) {
    delete packageJson[sectionName];
  }
  return true;
}

function restorePackageJsonField(packageJson, sectionName, key, managedChange) {
  const section = ensurePackageJsonSection(packageJson, sectionName);
  const currentValue = Object.prototype.hasOwnProperty.call(section, key) ? String(section[key]) : "";
  if (currentValue !== String(managedChange?.value || "")) {
    return false;
  }

  if (managedChange?.hadPrevious) {
    section[key] = String(managedChange.previousValue || "");
  } else {
    delete section[key];
  }
  return true;
}

function parseEnvLineValue(line, key) {
  const pattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`);
  if (!pattern.test(line)) {
    return null;
  }
  const index = line.indexOf("=");
  if (index === -1) {
    return "";
  }
  return line.slice(index + 1);
}

function upsertEnvValue(content, key, value) {
  const lines = String(content || "").split(/\r?\n/);
  const lookupPattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`);
  let index = -1;

  for (let cursor = 0; cursor < lines.length; cursor += 1) {
    if (lookupPattern.test(lines[cursor])) {
      index = cursor;
      break;
    }
  }

  const hadPrevious = index >= 0;
  const previousValue = hadPrevious ? String(parseEnvLineValue(lines[index], key) || "") : "";
  const nextLine = `${key}=${value}`;

  if (hadPrevious) {
    lines[index] = nextLine;
  } else {
    if (lines.length === 1 && lines[0] === "") {
      lines[0] = nextLine;
    } else {
      lines.push(nextLine);
    }
  }

  const normalized = `${lines.join("\n").replace(/\n+$/, "")}\n`;
  return {
    hadPrevious,
    previousValue,
    content: normalized
  };
}

function removeEnvValue(content, key, expectedValue, previous) {
  const lines = String(content || "").split(/\r?\n/);
  const lookupPattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`);
  let index = -1;

  for (let cursor = 0; cursor < lines.length; cursor += 1) {
    if (lookupPattern.test(lines[cursor])) {
      index = cursor;
      break;
    }
  }

  if (index < 0) {
    return {
      changed: false,
      content: content
    };
  }

  const currentValue = String(parseEnvLineValue(lines[index], key) || "");
  if (currentValue !== String(expectedValue || "")) {
    return {
      changed: false,
      content: content
    };
  }

  if (previous?.hadPrevious) {
    lines[index] = `${key}=${String(previous.previousValue || "")}`;
  } else {
    lines.splice(index, 1);
  }

  const normalized = `${lines.join("\n").replace(/\n+$/, "")}\n`;
  return {
    changed: true,
    content: normalized
  };
}

function normalizePackageInstallationMode(rawValue, descriptorPath) {
  const normalized = String(rawValue || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return PACKAGE_INSTALL_MODE_INSTALLABLE;
  }
  if (!PACKAGE_INSTALL_MODES.includes(normalized)) {
    throw createCliError(
      `Invalid package descriptor at ${descriptorPath}: installationMode must be one of: ${PACKAGE_INSTALL_MODES.join(", ")}.`
    );
  }
  return normalized;
}

function validatePackageDescriptorShape(descriptor, descriptorPath) {
  const normalized = ensureObject(descriptor);
  const packageId = String(normalized.packageId || "").trim();
  const version = String(normalized.version || "").trim();

  if (!packageId.startsWith("@jskit-ai/")) {
    throw createCliError(`Invalid package descriptor at ${descriptorPath}: packageId must start with @jskit-ai/.`);
  }
  if (!version) {
    throw createCliError(`Invalid package descriptor at ${descriptorPath}: missing version.`);
  }

  const runtime = ensureObject(normalized.runtime);
  const server = ensureObject(runtime.server);
  const client = ensureObject(runtime.client);
  const hasServerProviders = Array.isArray(server.providers);
  const hasClientProviders = Array.isArray(client.providers);
  if (!hasServerProviders && !hasClientProviders) {
    throw createCliError(
      `Invalid package descriptor at ${descriptorPath}: runtime.server.providers or runtime.client.providers must be declared.`
    );
  }

  return {
    ...normalized,
    installationMode: normalizePackageInstallationMode(normalized.installationMode, descriptorPath)
  };
}

function isCloneOnlyPackageEntry(packageEntry) {
  const descriptor = ensureObject(packageEntry?.descriptor);
  return String(descriptor.installationMode || "").trim().toLowerCase() === PACKAGE_INSTALL_MODE_CLONE_ONLY;
}

function validateAppLocalPackageDescriptorShape(descriptor, descriptorPath, { expectedPackageId = "", fallbackVersion = "" } = {}) {
  const normalized = ensureObject(descriptor);
  const packageId = String(normalized.packageId || "").trim();
  const version = String(normalized.version || "").trim() || String(fallbackVersion || "").trim();

  if (!packageId) {
    throw createCliError(`Invalid app-local package descriptor at ${descriptorPath}: missing packageId.`);
  }
  if (expectedPackageId && packageId !== expectedPackageId) {
    throw createCliError(
      `Descriptor/package mismatch at ${descriptorPath}: package.descriptor.mjs has ${packageId} but package.json has ${expectedPackageId}.`
    );
  }
  if (!version) {
    throw createCliError(`Invalid app-local package descriptor at ${descriptorPath}: missing version.`);
  }

  return {
    ...normalized,
    packageId,
    version
  };
}

function createPackageEntry({
  packageId,
  version,
  descriptor,
  rootDir = "",
  relativeDir = "",
  descriptorRelativePath = "",
  packageJson = {},
  sourceType = "",
  source = {}
}) {
  const normalizedSourceType = String(sourceType || "").trim() || "package";
  const normalizedDescriptorPath = String(descriptorRelativePath || "").trim();
  const normalizedSource = {
    type: normalizedSourceType,
    ...ensureObject(source)
  };
  if (!normalizedSource.descriptorPath && normalizedDescriptorPath) {
    normalizedSource.descriptorPath = normalizedDescriptorPath;
  }
  return {
    packageId: String(packageId || "").trim(),
    version: String(version || "").trim(),
    descriptor: ensureObject(descriptor),
    rootDir: String(rootDir || "").trim(),
    relativeDir: String(relativeDir || "").trim(),
    descriptorRelativePath: normalizedDescriptorPath,
    packageJson: ensureObject(packageJson),
    sourceType: normalizedSourceType,
    source: normalizedSource
  };
}

function mergePackageRegistries(...registries) {
  const merged = new Map();
  for (const registry of registries) {
    if (!(registry instanceof Map)) {
      continue;
    }
    for (const [packageId, packageEntry] of registry.entries()) {
      merged.set(packageId, packageEntry);
    }
  }
  return merged;
}

function validateBundleDescriptorShape(descriptor, descriptorPath) {
  const normalized = ensureObject(descriptor);
  const bundleId = String(normalized.bundleId || "").trim();
  const version = String(normalized.version || "").trim();
  const packages = ensureArray(normalized.packages).map((value) => String(value));

  if (!bundleId) {
    throw createCliError(`Invalid bundle descriptor at ${descriptorPath}: missing bundleId.`);
  }
  if (!version) {
    throw createCliError(`Invalid bundle descriptor at ${descriptorPath}: missing version.`);
  }
  if (packages.length < 2) {
    throw createCliError(`Invalid bundle descriptor at ${descriptorPath}: bundles must contain at least two packages.`);
  }

  return normalized;
}

async function loadWorkspacePackageRegistry() {
  if (!MODULES_ROOT || !(await fileExists(MODULES_ROOT))) {
    return new Map();
  }

  const directories = [];
  const levelOne = await readdir(MODULES_ROOT, { withFileTypes: true });

  for (const entry of levelOne) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (entry.name.startsWith(".") || entry.name.endsWith(".LEGACY")) {
      continue;
    }

    const absolute = path.join(MODULES_ROOT, entry.name);
    const descriptorPath = path.join(absolute, "package.descriptor.mjs");
    if (await fileExists(descriptorPath)) {
      directories.push(absolute);
      continue;
    }

    const nested = await readdir(absolute, { withFileTypes: true }).catch(() => []);
    for (const child of nested) {
      if (!child.isDirectory() || child.name.startsWith(".")) {
        continue;
      }
      const nestedAbsolute = path.join(absolute, child.name);
      const nestedDescriptor = path.join(nestedAbsolute, "package.descriptor.mjs");
      if (await fileExists(nestedDescriptor)) {
        directories.push(nestedAbsolute);
      }
    }
  }

  const uniqueDirectories = sortStrings([...new Set(directories)]);
  const registry = new Map();

  for (const packageRoot of uniqueDirectories) {
    const descriptorPath = path.join(packageRoot, "package.descriptor.mjs");
    const descriptorModule = await import(pathToFileURL(descriptorPath).href);
    const descriptor = validatePackageDescriptorShape(descriptorModule?.default, descriptorPath);

    const packageJsonPath = path.join(packageRoot, "package.json");
    if (!(await fileExists(packageJsonPath))) {
      throw createCliError(`Missing package.json for ${descriptor.packageId} at ${packageRoot}.`);
    }
    const packageJson = await readJsonFile(packageJsonPath);
    const packageName = String(packageJson?.name || "").trim();
    if (packageName !== descriptor.packageId) {
      throw createCliError(
        `Descriptor/package mismatch at ${packageRoot}: package.descriptor.mjs has ${descriptor.packageId} but package.json has ${packageName || "(empty)"}.`
      );
    }

    const relativeDir = normalizeRelativePath(WORKSPACE_ROOT || MODULES_ROOT, packageRoot);
    const descriptorRelativePath = normalizeRelativePath(WORKSPACE_ROOT || MODULES_ROOT, descriptorPath);
    registry.set(
      descriptor.packageId,
      createPackageEntry({
        packageId: descriptor.packageId,
        version: descriptor.version,
        descriptor,
        rootDir: packageRoot,
        relativeDir,
        descriptorRelativePath,
        packageJson,
        sourceType: "packages-directory",
        source: {
          descriptorPath: descriptorRelativePath
        }
      })
    );
  }

  return registry;
}

async function loadAppLocalPackageRegistry(appRoot) {
  const localPackagesRoot = path.join(appRoot, "packages");
  if (!(await fileExists(localPackagesRoot))) {
    return new Map();
  }

  const registry = new Map();
  const entries = await readdir(localPackagesRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }

    const packageRoot = path.join(localPackagesRoot, entry.name);
    const packageJsonPath = path.join(packageRoot, "package.json");
    const descriptorPath = path.join(packageRoot, "package.descriptor.mjs");
    if (!(await fileExists(packageJsonPath)) || !(await fileExists(descriptorPath))) {
      continue;
    }

    const packageJson = await readJsonFile(packageJsonPath);
    const packageId = String(packageJson?.name || "").trim();
    if (!packageId) {
      throw createCliError(`Invalid app-local package at ${normalizeRelativePath(appRoot, packageRoot)}: package.json missing name.`);
    }

    const descriptorModule = await import(pathToFileURL(descriptorPath).href + `?t=${Date.now()}_${Math.random()}`);
    const descriptor = validateAppLocalPackageDescriptorShape(descriptorModule?.default, descriptorPath, {
      expectedPackageId: packageId,
      fallbackVersion: String(packageJson?.version || "").trim()
    });

    const relativeDir = normalizeRelativePath(appRoot, packageRoot);
    const descriptorRelativePath = normalizeRelativePath(appRoot, descriptorPath);
    registry.set(
      packageId,
      createPackageEntry({
        packageId: descriptor.packageId,
        version: descriptor.version,
        descriptor,
        rootDir: packageRoot,
        relativeDir,
        descriptorRelativePath,
        packageJson,
        sourceType: "app-local-package",
        source: {
          packagePath: normalizeRelativePosixPath(relativeDir),
          descriptorPath: descriptorRelativePath
        }
      })
    );
  }

  return registry;
}

async function loadCatalogPackageRegistry() {
  if (!(await fileExists(CATALOG_PACKAGES_PATH))) {
    return new Map();
  }

  const catalog = await readJsonFile(CATALOG_PACKAGES_PATH);
  const packageRecords = ensureArray(catalog?.packages);
  const registry = new Map();

  for (const packageRecord of packageRecords) {
    const record = ensureObject(packageRecord);
    const packageId = String(record.packageId || "").trim();
    const descriptorPath = `${normalizeRelativePath(CLI_PACKAGE_ROOT, CATALOG_PACKAGES_PATH)}#${packageId || "unknown"}`;
    const descriptor = validatePackageDescriptorShape(record.descriptor, descriptorPath);
    if (!packageId) {
      throw createCliError(`Invalid catalog package entry at ${descriptorPath}: missing packageId.`);
    }
    if (descriptor.packageId !== packageId) {
      throw createCliError(
        `Invalid catalog package entry at ${descriptorPath}: descriptor packageId ${descriptor.packageId} does not match catalog packageId ${packageId}.`
      );
    }

    const version = String(record.version || descriptor.version || "").trim();
    if (!version) {
      throw createCliError(`Invalid catalog package entry at ${descriptorPath}: missing version.`);
    }

    registry.set(
      packageId,
      createPackageEntry({
        packageId,
        version,
        descriptor: {
          ...descriptor,
          version
        },
        rootDir: "",
        relativeDir: "",
        descriptorRelativePath: descriptorPath,
        packageJson: {
          name: packageId,
          version
        },
        sourceType: "catalog",
        source: {
          descriptorPath
        }
      })
    );
  }

  return registry;
}

async function loadPackageRegistry() {
  const workspaceRegistry = await loadWorkspacePackageRegistry();
  const catalogRegistry = await loadCatalogPackageRegistry();
  const merged = mergePackageRegistries(catalogRegistry, workspaceRegistry);

  if (merged.size === 0) {
    throw createCliError(
      "Unable to load package registry. Provide JSKIT_REPO_ROOT for workspace mode or ensure @jskit-ai/jskit-catalog is installed (or set JSKIT_CATALOG_PACKAGES_PATH)."
    );
  }

  return merged;
}

async function loadInstalledNodeModulePackageEntry({ appRoot, packageId }) {
  const normalizedPackageId = String(packageId || "").trim();
  if (!normalizedPackageId) {
    return null;
  }

  const packageRoot = path.resolve(appRoot, "node_modules", ...normalizedPackageId.split("/"));
  const packageJsonPath = path.join(packageRoot, "package.json");
  if (!(await fileExists(packageJsonPath))) {
    return null;
  }

  const packageJson = await readJsonFile(packageJsonPath);
  const resolvedPackageId = String(packageJson?.name || "").trim() || normalizedPackageId;
  const descriptorPath = path.join(packageRoot, "package.descriptor.mjs");
  if (!(await fileExists(descriptorPath))) {
    return null;
  }

  const descriptorModule = await import(pathToFileURL(descriptorPath).href + `?t=${Date.now()}_${Math.random()}`);
  const descriptor = validateAppLocalPackageDescriptorShape(descriptorModule?.default, descriptorPath, {
    expectedPackageId: resolvedPackageId,
    fallbackVersion: String(packageJson?.version || "").trim()
  });
  const relativeDir = normalizeRelativePath(appRoot, packageRoot);
  const descriptorRelativePath = normalizeRelativePath(appRoot, descriptorPath);

  return createPackageEntry({
    packageId: descriptor.packageId,
    version: descriptor.version,
    descriptor,
    rootDir: packageRoot,
    relativeDir,
    descriptorRelativePath,
    packageJson,
    sourceType: "npm-installed-package",
    source: {
      packagePath: normalizeRelativePosixPath(relativeDir),
      descriptorPath: descriptorRelativePath
    }
  });
}

async function resolveInstalledNodeModulePackageEntry({ appRoot, packageId }) {
  const raw = String(packageId || "").trim();
  if (!raw) {
    return null;
  }

  const candidates = [];
  const seen = new Set();
  const appendCandidate = (value) => {
    const candidate = String(value || "").trim();
    if (!candidate || seen.has(candidate)) {
      return;
    }
    seen.add(candidate);
    candidates.push(candidate);
  };

  appendCandidate(raw);
  appendCandidate(toScopedPackageId(raw));

  for (const candidateId of candidates) {
    const entry = await loadInstalledNodeModulePackageEntry({
      appRoot,
      packageId: candidateId
    });
    if (entry) {
      return entry;
    }
  }

  return null;
}

async function hydratePackageRegistryFromInstalledNodeModules({
  appRoot,
  packageRegistry,
  seedPackageIds = []
}) {
  const queue = ensureArray(seedPackageIds)
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const visited = new Set();

  while (queue.length > 0) {
    const packageId = queue.shift();
    if (!packageId || visited.has(packageId)) {
      continue;
    }
    visited.add(packageId);

    let packageEntry = packageRegistry.get(packageId);
    if (!packageEntry) {
      const resolvedEntry = await resolveInstalledNodeModulePackageEntry({
        appRoot,
        packageId
      });
      if (!resolvedEntry) {
        continue;
      }

      packageRegistry.set(resolvedEntry.packageId, resolvedEntry);
      packageEntry = resolvedEntry;
      if (resolvedEntry.packageId !== packageId && !visited.has(resolvedEntry.packageId)) {
        queue.push(resolvedEntry.packageId);
      }
    }

    const dependsOn = ensureArray(packageEntry?.descriptor?.dependsOn).map((value) => String(value || "").trim()).filter(Boolean);
    for (const dependencyId of dependsOn) {
      if (!visited.has(dependencyId)) {
        queue.push(dependencyId);
      }
    }
  }
}

async function loadBundleRegistry() {
  if (!(await fileExists(BUNDLES_ROOT))) {
    return new Map();
  }

  const bundles = new Map();
  const entries = await readdir(BUNDLES_ROOT, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }

    const descriptorPath = path.join(BUNDLES_ROOT, entry.name, "bundle.descriptor.mjs");
    if (!(await fileExists(descriptorPath))) {
      continue;
    }

    const descriptorModule = await import(pathToFileURL(descriptorPath).href);
    const descriptor = validateBundleDescriptorShape(descriptorModule?.default, descriptorPath);
    bundles.set(descriptor.bundleId, descriptor);
  }

  return bundles;
}

function resolvePackageDependencySpecifier(packageEntry, { existingValue = "" } = {}) {
  const source = ensureObject(packageEntry?.source);
  const sourceType = String(source.type || packageEntry?.sourceType || "").trim();
  if (sourceType === "app-local-package" || sourceType === "local-package") {
    const packagePath = normalizeRelativePosixPath(String(source.packagePath || packageEntry?.relativeDir || "").trim());
    if (!packagePath) {
      throw createCliError(`Unable to resolve local package path for ${String(packageEntry?.packageId || "unknown package")}.`);
    }
    return toFileDependencySpecifier(packagePath);
  }
  if (sourceType === "npm-installed-package") {
    const normalizedExisting = String(existingValue || "").trim();
    if (normalizedExisting) {
      return normalizedExisting;
    }
  }

  const descriptorVersion = String(packageEntry?.version || "").trim();
  if (descriptorVersion) {
    return descriptorVersion;
  }
  const packageJsonVersion = String(packageEntry?.packageJson?.version || "").trim();
  if (packageJsonVersion) {
    return packageJsonVersion;
  }
  throw createCliError(`Unable to resolve dependency specifier for ${String(packageEntry?.packageId || "unknown package")}.`);
}

function normalizePackageNameSegment(rawValue, { label = "package name" } = {}) {
  const lowered = String(rawValue || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
  if (!lowered) {
    throw createCliError(`Invalid ${label}. Use letters, numbers, dash, underscore, or dot.`);
  }
  return lowered;
}

function normalizeScopeName(rawScope) {
  const normalized = String(rawScope || "").trim().replace(/^@+/, "");
  return normalizePackageNameSegment(normalized, { label: "scope" });
}

function resolveDefaultLocalScopeFromAppName(appPackageName) {
  const appName = String(appPackageName || "").trim();
  if (!appName) {
    return "app";
  }

  const unscoped = appName.startsWith("@")
    ? appName.slice(appName.indexOf("/") + 1)
    : appName;
  return normalizeScopeName(unscoped || "app");
}

function normalizeRelativePosixPath(pathValue) {
  return String(pathValue || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");
}

function toFileDependencySpecifier(relativePath) {
  const normalized = normalizeRelativePosixPath(relativePath);
  if (!normalized) {
    throw createCliError("Cannot create file: dependency specifier from empty relative path.");
  }
  return `file:${normalized}`;
}

function resolveLocalPackageId({ rawName, appPackageName, inlineOptions }) {
  const explicitPackageId = String(inlineOptions["package-id"] || "").trim();
  if (explicitPackageId) {
    const scopedPattern = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;
    if (!scopedPattern.test(explicitPackageId)) {
      throw createCliError(
        `Invalid --package-id ${explicitPackageId}. Expected format: @scope/name (lowercase alphanumeric, ., _, -).`
      );
    }
    const packageName = explicitPackageId.slice(explicitPackageId.indexOf("/") + 1);
    return {
      packageId: explicitPackageId,
      packageDirName: normalizePackageNameSegment(packageName)
    };
  }

  const packageDirName = normalizePackageNameSegment(rawName);
  const scopeName = String(inlineOptions.scope || "").trim()
    ? normalizeScopeName(inlineOptions.scope)
    : resolveDefaultLocalScopeFromAppName(appPackageName);
  return {
    packageId: `@${scopeName}/${packageDirName}`,
    packageDirName
  };
}

function createLocalPackageDescriptorTemplate({ packageId, description }) {
  return `export default Object.freeze({
  packageVersion: 1,
  packageId: "${packageId}",
  version: "0.1.0",
  description: ${JSON.stringify(String(description || ""))},
  dependsOn: [
    // "@jskit-ai/kernel"
  ],
  capabilities: {
    provides: [
      // "example.feature"
    ],
    requires: [
      // "example.dependency"
    ]
  },
  options: {
    // "example-option": {
    //   required: true,
    //   promptLabel: "Enter option value",
    //   promptHint: "Used by mutations.text interpolation",
    //   defaultValue: "example"
    // }
  },
  runtime: {
    server: {
      providers: [
        // {
        //   entrypoint: "src/server/providers/ExampleServerProvider.js",
        //   export: "ExampleServerProvider"
        // }
      ]
    },
    client: {
      providers: [
        // {
        //   entrypoint: "src/client/providers/ExampleClientProvider.js",
        //   export: "ExampleClientProvider"
        // }
      ]
    }
  },
  metadata: {
    server: {
      routes: [
        // {
        //   method: "GET",
        //   path: "/api/example",
        //   summary: "Describe server route validator"
        // }
      ]
    },
    ui: {
      routes: [
        // {
        //   id: "example.route",
        //   path: "/example",
        //   scope: "global",
        //   name: "example-route",
        //   componentKey: "example-route",
        //   autoRegister: true,
        //   guard: {
        //     policy: "public"
        //   },
        //   purpose: "Describe what this route is for."
        // }
      ],
      elements: [
        // {
        //   key: "example-route",
        //   export: "ExampleView",
        //   entrypoint: "src/client/views/ExampleView.vue",
        //   purpose: "UI element exposed by this package."
        // }
      ],
      overrides: [
        // {
        //   targetId: "some.existing.route",
        //   mode: "replace",
        //   reason: "Explain override intent."
        // }
      ]
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        // "@example/runtime-dependency": "^1.0.0"
      },
      dev: {
        // "@example/dev-dependency": "^1.0.0"
      }
    },
    packageJson: {
      scripts: {
        // "lint:example": "eslint src/example"
      }
    },
    procfile: {
      // worker: "node ./bin/worker.js"
    },
    text: [
      // {
      //   op: "upsert-env",
      //   file: ".env",
      //   key: "EXAMPLE_ENV",
      //   value: "\${option:example-option}",
      //   reason: "Explain why this env var is needed.",
      //   category: "runtime-config",
      //   id: "example-env"
      // }
    ],
    files: [
      // {
      //   from: "templates/src/pages/example/index.vue",
      //   to: "src/pages/example/index.vue",
      //   reason: "Explain what is scaffolded.",
      //   category: "example",
      //   id: "example-file"
      // }
    ]
  }
});
`;
}

function createLocalPackageScaffoldFiles({ packageId, packageDescription }) {
  return [
    {
      relativePath: "package.json",
      content: `${JSON.stringify(
        {
          name: packageId,
          version: "0.1.0",
          private: true,
          type: "module",
          exports: {
            ".": "./src/index.js",
            "./client": "./src/client/index.js",
            "./server": "./src/server/index.js",
            "./shared": "./src/shared/index.js"
          }
        },
        null,
        2
      )}\n`
    },
    {
      relativePath: "package.descriptor.mjs",
      content: createLocalPackageDescriptorTemplate({
        packageId,
        description: packageDescription
      })
    },
    {
      relativePath: "src/index.js",
      content: "export {};\n"
    },
    {
      relativePath: "src/server/index.js",
      content: "export {};\n"
    },
    {
      relativePath: "src/client/index.js",
      content: [
        "const routeComponents = Object.freeze({});",
        "",
        "async function bootClient({ logger } = {}) {",
        "  if (logger && typeof logger.debug === \"function\") {",
        `    logger.debug({ packageId: ${JSON.stringify(packageId)} }, "bootClient executed.");`,
        "  }",
        "}",
        "",
        "export { routeComponents, bootClient };",
        ""
      ].join("\n")
    },
    {
      relativePath: "src/shared/index.js",
      content: "export {};\n"
    },
    {
      relativePath: "README.md",
      content: [
        `# ${packageId}`,
        "",
        "App-local JSKIT module scaffold.",
        "",
        "## Next Steps",
        "",
        "- Define runtime providers in `package.descriptor.mjs`.",
        "- Add client/server exports under `src/`.",
        "- Keep package version in sync with descriptor version.",
        ""
      ].join("\n")
    }
  ];
}

function resolveLocalDependencyOrder(initialPackageIds, packageRegistry) {
  const ordered = [];
  const visited = new Set();
  const visiting = new Set();
  const externalDependencies = new Set();

  function visit(packageId, lineage = []) {
    if (visited.has(packageId)) {
      return;
    }
    if (visiting.has(packageId)) {
      const cyclePath = [...lineage, packageId].join(" -> ");
      throw createCliError(`Dependency cycle detected: ${cyclePath}`);
    }

    const packageEntry = packageRegistry.get(packageId);
    if (!packageEntry) {
      throw createCliError(`Unknown package: ${packageId}`);
    }

    visiting.add(packageId);
    for (const dependencyId of ensureArray(packageEntry.descriptor.dependsOn).map((value) => String(value))) {
      if (packageRegistry.has(dependencyId)) {
        visit(dependencyId, [...lineage, packageId]);
      } else {
        externalDependencies.add(dependencyId);
      }
    }
    visiting.delete(packageId);
    visited.add(packageId);
    ordered.push(packageId);
  }

  for (const packageId of initialPackageIds) {
    visit(packageId);
  }

  return {
    ordered,
    externalDependencies: sortStrings([...externalDependencies])
  };
}

function listDeclaredCapabilities(capabilitiesSection, fieldName) {
  const section = ensureObject(capabilitiesSection);
  const source = ensureArray(section[fieldName]);
  const normalized = [];
  const seen = new Set();
  for (const value of source) {
    const capabilityId = String(value || "").trim();
    if (!capabilityId || seen.has(capabilityId)) {
      continue;
    }
    seen.add(capabilityId);
    normalized.push(capabilityId);
  }
  return normalized;
}

function buildCapabilityGraph(packageRegistry) {
  const graph = new Map();
  const ensureNode = (capabilityId) => {
    if (!graph.has(capabilityId)) {
      graph.set(capabilityId, {
        providers: new Set(),
        requirers: new Set()
      });
    }
    return graph.get(capabilityId);
  };

  for (const [packageId, packageEntry] of packageRegistry.entries()) {
    const capabilities = ensureObject(packageEntry?.descriptor?.capabilities);
    for (const capabilityId of listDeclaredCapabilities(capabilities, "provides")) {
      ensureNode(capabilityId).providers.add(packageId);
    }
    for (const capabilityId of listDeclaredCapabilities(capabilities, "requires")) {
      ensureNode(capabilityId).requirers.add(packageId);
    }
  }

  for (const [capabilityId, providers] of Object.entries(BUILTIN_CAPABILITY_PROVIDERS)) {
    const node = ensureNode(capabilityId);
    for (const providerId of ensureArray(providers).map((value) => String(value || "").trim()).filter(Boolean)) {
      node.providers.add(providerId);
    }
  }

  const normalizedGraph = new Map();
  for (const [capabilityId, node] of graph.entries()) {
    normalizedGraph.set(capabilityId, {
      providers: sortStrings([...node.providers]),
      requirers: sortStrings([...node.requirers])
    });
  }
  return normalizedGraph;
}

function createCapabilityPackageDetail(packageId, packageRegistry) {
  const packageEntry = packageRegistry.get(packageId);
  return {
    packageId,
    version: String(packageEntry?.version || packageEntry?.descriptor?.version || "").trim(),
    descriptorPath: String(packageEntry?.descriptorRelativePath || "").trim()
  };
}

function buildCapabilityDetailsForPackage({ packageRegistry, packageId, dependsOn = [], provides = [], requires = [] }) {
  const graph = buildCapabilityGraph(packageRegistry);
  const dependsOnSet = new Set(ensureArray(dependsOn).map((value) => String(value || "").trim()).filter(Boolean));

  function buildCapabilityRecord(capabilityId) {
    const node = graph.get(capabilityId) || {
      providers: [],
      requirers: []
    };
    const providers = sortStrings(ensureArray(node.providers));
    const requirers = sortStrings(ensureArray(node.requirers));
    const providersInDependsOn = providers.filter((providerId) => dependsOnSet.has(providerId));
    return {
      capabilityId,
      providers,
      requirers,
      providersInDependsOn,
      providerDetails: providers.map((providerId) => createCapabilityPackageDetail(providerId, packageRegistry)),
      requirerDetails: requirers.map((requirerId) => createCapabilityPackageDetail(requirerId, packageRegistry)),
      isProvidedByCurrentPackage: providers.includes(packageId),
      isRequiredByCurrentPackage: requirers.includes(packageId)
    };
  }

  return {
    provides: ensureArray(provides).map((capabilityId) => buildCapabilityRecord(capabilityId)),
    requires: ensureArray(requires).map((capabilityId) => buildCapabilityRecord(capabilityId))
  };
}

function escapeRegexLiteral(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseQuotedStringLiteral(value) {
  const source = String(value || "").trim();
  if (source.length < 2) {
    return null;
  }

  const quote = source[0];
  if ((quote !== "\"" && quote !== "'") || source[source.length - 1] !== quote) {
    return null;
  }

  if (quote === "\"") {
    try {
      return JSON.parse(source);
    } catch {
      return null;
    }
  }

  return source
    .slice(1, -1)
    .replace(/\\\\/g, "\\")
    .replace(/\\'/g, "'")
    .replace(/\\"/g, "\"")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t");
}

function resolveLineNumberAtIndex(source, index) {
  const text = String(source || "");
  const maxIndex = Math.max(0, Math.min(Number(index) || 0, text.length));
  let line = 1;
  for (let cursor = 0; cursor < maxIndex; cursor += 1) {
    if (text[cursor] === "\n") {
      line += 1;
    }
  }
  return line;
}

function findMatchingBraceIndex(source, openBraceIndex) {
  const text = String(source || "");
  const startIndex = Number(openBraceIndex);
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= text.length || text[startIndex] !== "{") {
    return -1;
  }

  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inTemplateQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let cursor = startIndex; cursor < text.length; cursor += 1) {
    const current = text[cursor];
    const next = text[cursor + 1] || "";

    if (inLineComment) {
      if (current === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (current === "*" && next === "/") {
        inBlockComment = false;
        cursor += 1;
      }
      continue;
    }

    if (inSingleQuote) {
      if (current === "\\") {
        cursor += 1;
        continue;
      }
      if (current === "'") {
        inSingleQuote = false;
      }
      continue;
    }

    if (inDoubleQuote) {
      if (current === "\\") {
        cursor += 1;
        continue;
      }
      if (current === "\"") {
        inDoubleQuote = false;
      }
      continue;
    }

    if (inTemplateQuote) {
      if (current === "\\") {
        cursor += 1;
        continue;
      }
      if (current === "`") {
        inTemplateQuote = false;
      }
      continue;
    }

    if (current === "/" && next === "/") {
      inLineComment = true;
      cursor += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      inBlockComment = true;
      cursor += 1;
      continue;
    }
    if (current === "'") {
      inSingleQuote = true;
      continue;
    }
    if (current === "\"") {
      inDoubleQuote = true;
      continue;
    }
    if (current === "`") {
      inTemplateQuote = true;
      continue;
    }

    if (current === "{") {
      depth += 1;
      continue;
    }
    if (current === "}") {
      depth -= 1;
      if (depth === 0) {
        return cursor;
      }
    }
  }

  return -1;
}

function extractProviderLifecycleMethodRanges(source, providerExportName) {
  const text = String(source || "");
  const providerName = String(providerExportName || "").trim();
  if (!text) {
    return [];
  }

  const fallback = [
    {
      lifecycle: "unknown",
      start: 0,
      end: text.length
    }
  ];
  if (!providerName) {
    return fallback;
  }

  const classPattern = new RegExp(`\\bclass\\s+${escapeRegexLiteral(providerName)}\\b`);
  const classMatch = classPattern.exec(text);
  if (!classMatch) {
    return fallback;
  }

  const classOpenBraceIndex = text.indexOf("{", classMatch.index + classMatch[0].length);
  if (classOpenBraceIndex < 0) {
    return fallback;
  }
  const classCloseBraceIndex = findMatchingBraceIndex(text, classOpenBraceIndex);
  if (classCloseBraceIndex < 0) {
    return fallback;
  }

  const classBody = text.slice(classOpenBraceIndex + 1, classCloseBraceIndex);
  const methodPattern = /\b(?:async\s+)?(register|boot)\s*\([^)]*\)\s*\{/g;
  const ranges = [];
  let methodMatch = methodPattern.exec(classBody);
  while (methodMatch) {
    const lifecycle = String(methodMatch[1] || "").trim() || "unknown";
    const methodOpenOffset = methodMatch[0].lastIndexOf("{");
    if (methodOpenOffset < 0) {
      methodMatch = methodPattern.exec(classBody);
      continue;
    }
    const methodOpenIndex = classOpenBraceIndex + 1 + methodMatch.index + methodOpenOffset;
    const methodCloseIndex = findMatchingBraceIndex(text, methodOpenIndex);
    if (methodCloseIndex < 0) {
      methodMatch = methodPattern.exec(classBody);
      continue;
    }
    ranges.push({
      lifecycle,
      start: methodOpenIndex + 1,
      end: methodCloseIndex
    });
    methodMatch = methodPattern.exec(classBody);
  }

  if (ranges.length > 0) {
    return ranges;
  }
  return [
    {
      lifecycle: "class",
      start: classOpenBraceIndex + 1,
      end: classCloseBraceIndex
    }
  ];
}

function collectConstTokenAssignments(source) {
  const text = String(source || "");
  const assignments = new Map();
  const pattern = /^\s*const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([^;]+);\s*$/gm;
  let match = pattern.exec(text);
  while (match) {
    const identifier = String(match[1] || "").trim();
    const expression = String(match[2] || "").trim();
    if (identifier && expression) {
      assignments.set(identifier, expression);
    }
    match = pattern.exec(text);
  }
  return assignments;
}

function resolveTokenFromExpression(expression, constAssignments, visited = new Set()) {
  let normalized = String(expression || "").trim();
  if (!normalized) {
    return {
      token: "",
      resolved: false,
      kind: "empty"
    };
  }

  while (normalized.startsWith("(") && normalized.endsWith(")")) {
    normalized = normalized.slice(1, -1).trim();
  }

  const quoted = parseQuotedStringLiteral(normalized);
  if (quoted !== null) {
    return {
      token: quoted,
      resolved: true,
      kind: "string"
    };
  }

  const symbolMatch = /^Symbol\.for\(\s*(['"])(.*?)\1\s*\)$/.exec(normalized);
  if (symbolMatch) {
    return {
      token: `Symbol.for(${symbolMatch[2]})`,
      resolved: true,
      kind: "symbol"
    };
  }

  if (/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+$/.test(normalized)) {
    return {
      token: normalized,
      resolved: true,
      kind: "member"
    };
  }

  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(normalized)) {
    const identifier = normalized;
    if (visited.has(identifier)) {
      return {
        token: identifier,
        resolved: false,
        kind: "cyclic-identifier"
      };
    }
    const nextExpression = constAssignments.get(identifier);
    if (nextExpression) {
      return resolveTokenFromExpression(nextExpression, constAssignments, new Set([...visited, identifier]));
    }
    return {
      token: identifier,
      resolved: false,
      kind: "identifier"
    };
  }

  return {
    token: normalized,
    resolved: false,
    kind: "expression"
  };
}

function collectContainerBindingsFromProviderSource({ source, providerLabel, entrypoint, providerExportName }) {
  const text = String(source || "");
  if (!text) {
    return [];
  }

  const constAssignments = collectConstTokenAssignments(text);
  const methodRanges = extractProviderLifecycleMethodRanges(text, providerExportName);
  const records = [];

  for (const range of methodRanges) {
    const lifecycle = String(range?.lifecycle || "unknown").trim() || "unknown";
    const start = Number(range?.start) || 0;
    const end = Number(range?.end) || text.length;
    const slice = text.slice(start, end);
    const bindingPattern = /\bapp\.(singleton|bind|scoped|instance)\s*\(\s*([\s\S]*?)\s*,/g;
    let match = bindingPattern.exec(slice);
    while (match) {
      const binding = String(match[1] || "").trim();
      const tokenExpression = String(match[2] || "")
        .replace(/\s+/g, " ")
        .trim();
      if (!tokenExpression) {
        match = bindingPattern.exec(slice);
        continue;
      }
      const tokenResolution = resolveTokenFromExpression(tokenExpression, constAssignments);
      const line = resolveLineNumberAtIndex(text, start + match.index);
      records.push({
        provider: providerLabel,
        entrypoint: String(entrypoint || "").trim(),
        exportName: String(providerExportName || "").trim(),
        lifecycle,
        binding,
        token: String(tokenResolution.token || "").trim(),
        tokenExpression,
        tokenResolved: Boolean(tokenResolution.resolved),
        tokenKind: String(tokenResolution.kind || "").trim(),
        location: `${String(entrypoint || "").trim()}:${line}`,
        line
      });
      match = bindingPattern.exec(slice);
    }
  }

  return records;
}

function collectPackageExportEntries(exportsField) {
  const entries = [];
  const normalizeExportSubpath = (subpath) => {
    const normalized = String(subpath || ".").trim() || ".";
    if (normalized === "." || normalized === "./") {
      return {
        normalized: ".",
        segments: []
      };
    }

    const withoutPrefix = normalized.startsWith("./") ? normalized.slice(2) : normalized;
    const segments = withoutPrefix.split("/").map((value) => String(value || "").trim()).filter(Boolean);
    return {
      normalized: normalized.startsWith("./") ? normalized : `./${withoutPrefix}`,
      segments
    };
  };

  const resolveSubpathSortPriority = (subpath) => {
    const normalized = normalizeExportSubpath(subpath);
    const firstSegment = String(normalized.segments[0] || "").trim();
    if (firstSegment === "client") {
      return 0;
    }
    if (firstSegment === "server") {
      return 1;
    }
    if (firstSegment === "shared") {
      return 2;
    }
    if (normalized.normalized === ".") {
      return 3;
    }
    return 10;
  };

  const appendEntry = (subpath, conditions, target) => {
    const normalizedSubpath = String(subpath || ".").trim() || ".";
    const normalizedTarget = String(target || "").trim();
    if (!normalizedTarget) {
      return;
    }
    const normalizedConditions = ensureArray(conditions).map((value) => String(value || "").trim()).filter(Boolean);
    entries.push({
      subpath: normalizedSubpath,
      condition: normalizedConditions.length > 0 ? normalizedConditions.join(".") : "default",
      target: normalizedTarget
    });
  };

  const visit = (subpath, value, conditionStack = []) => {
    if (typeof value === "string") {
      appendEntry(subpath, conditionStack, value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(subpath, item, conditionStack);
      }
      return;
    }
    if (!value || typeof value !== "object") {
      return;
    }
    for (const [conditionName, nested] of Object.entries(value)) {
      visit(subpath, nested, [...conditionStack, conditionName]);
    }
  };

  if (typeof exportsField === "string" || Array.isArray(exportsField)) {
    visit(".", exportsField, []);
  } else if (exportsField && typeof exportsField === "object") {
    const root = ensureObject(exportsField);
    const rootKeys = Object.keys(root);
    const hasSubpathKeys = rootKeys.some((key) => key.startsWith("."));
    if (hasSubpathKeys) {
      for (const [subpath, value] of Object.entries(root)) {
        visit(subpath, value, []);
      }
    } else {
      visit(".", root, []);
    }
  }

  const deduplicated = [];
  const seen = new Set();
  for (const entry of entries) {
    const key = `${entry.subpath}::${entry.condition}::${entry.target}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduplicated.push(entry);
  }
  return deduplicated.sort((left, right) => {
    const leftPriority = resolveSubpathSortPriority(left.subpath);
    const rightPriority = resolveSubpathSortPriority(right.subpath);
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    const leftParts = normalizeExportSubpath(left.subpath);
    const rightParts = normalizeExportSubpath(right.subpath);
    const leftRoot = String(leftParts.segments[0] || "");
    const rightRoot = String(rightParts.segments[0] || "");
    const rootComparison = leftRoot.localeCompare(rightRoot);
    if (rootComparison !== 0) {
      return rootComparison;
    }

    const depthComparison = leftParts.segments.length - rightParts.segments.length;
    if (depthComparison !== 0) {
      return depthComparison;
    }

    const subpathComparison = left.subpath.localeCompare(right.subpath);
    if (subpathComparison !== 0) {
      return subpathComparison;
    }
    const conditionComparison = left.condition.localeCompare(right.condition);
    if (conditionComparison !== 0) {
      return conditionComparison;
    }
    return left.target.localeCompare(right.target);
  });
}

async function describePackageExports({ packageRoot, packageJson }) {
  const rootDir = String(packageRoot || "").trim();
  if (!rootDir) {
    return [];
  }

  const exportsField = ensureObject(packageJson).exports;
  const entries = collectPackageExportEntries(exportsField);
  const records = [];

  for (const entry of entries) {
    const subpath = String(entry.subpath || ".").trim() || ".";
    const condition = String(entry.condition || "default").trim() || "default";
    const target = String(entry.target || "").trim();
    const isPattern = subpath.includes("*") || target.includes("*");
    const isRelativeTarget = target.startsWith("./");
    let targetExists = null;
    if (isRelativeTarget && !isPattern) {
      const absoluteTargetPath = path.resolve(rootDir, target);
      targetExists = await fileExists(absoluteTargetPath);
    }

    records.push({
      subpath,
      condition,
      target,
      targetType: isPattern ? "pattern" : isRelativeTarget ? "file" : "external",
      targetExists
    });
  }

  return records;
}

function parseNamedExportSpecifiers(specifierSource) {
  const source = String(specifierSource || "");
  return source
    .split(",")
    .map((entry) => entry.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/g, "").trim())
    .filter(Boolean)
    .map((entry) => entry.replace(/\s+/g, " "))
    .map((entry) => {
      const aliasMatch = /^(.+?)\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(entry);
      if (aliasMatch) {
        return aliasMatch[2];
      }
      return entry;
    })
    .filter((entry) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(entry));
}

function parseExportedSymbolsFromSource(source) {
  const text = String(source || "");
  const symbols = new Set();
  const starReExports = new Set();
  const namedReExports = new Set();

  const namespaceStarPattern = /export\s+\*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)\s+from\s+["']([^"']+)["']\s*;?/g;
  let match = namespaceStarPattern.exec(text);
  while (match) {
    symbols.add(String(match[1] || "").trim());
    starReExports.add(String(match[2] || "").trim());
    match = namespaceStarPattern.exec(text);
  }

  const starPattern = /export\s+\*\s+from\s+["']([^"']+)["']\s*;?/g;
  match = starPattern.exec(text);
  while (match) {
    starReExports.add(String(match[1] || "").trim());
    match = starPattern.exec(text);
  }

  const namedPattern = /export\s*\{([\s\S]*?)\}\s*(?:from\s*["']([^"']+)["'])?\s*;?/g;
  match = namedPattern.exec(text);
  while (match) {
    const listSource = String(match[1] || "");
    for (const symbol of parseNamedExportSpecifiers(listSource)) {
      symbols.add(symbol);
    }
    if (match[2]) {
      namedReExports.add(String(match[2] || "").trim());
    }
    match = namedPattern.exec(text);
  }

  const functionPattern = /export\s+(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/g;
  match = functionPattern.exec(text);
  while (match) {
    symbols.add(String(match[1] || "").trim());
    match = functionPattern.exec(text);
  }

  const classPattern = /export\s+class\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/g;
  match = classPattern.exec(text);
  while (match) {
    symbols.add(String(match[1] || "").trim());
    match = classPattern.exec(text);
  }

  const variablePattern = /export\s+(?:const|let|var)\s+([\s\S]*?);/g;
  match = variablePattern.exec(text);
  while (match) {
    const declaration = String(match[1] || "");
    const names = declaration.split(",").map((entry) => String(entry || "").trim());
    for (const name of names) {
      const declarationMatch = /^([A-Za-z_$][A-Za-z0-9_$]*)\b/.exec(name);
      if (declarationMatch) {
        symbols.add(String(declarationMatch[1] || "").trim());
      }
    }
    match = variablePattern.exec(text);
  }

  const hasDefaultExport = /\bexport\s+default\b/.test(text);
  return {
    symbols: sortStrings([...symbols]),
    starReExports: sortStrings([...starReExports]),
    namedReExports: sortStrings([...namedReExports]),
    hasDefaultExport
  };
}

function classifyExportedSymbols(symbols = []) {
  const source = ensureArray(symbols).map((value) => String(value || "").trim()).filter(Boolean);
  const providers = [];
  const constants = [];
  const functions = [];
  const classesOrTypes = [];
  const internals = [];
  const others = [];

  for (const symbol of source) {
    if (/Provider$/.test(symbol)) {
      providers.push(symbol);
      continue;
    }
    if (/^__/.test(symbol)) {
      internals.push(symbol);
      continue;
    }
    if (/^[A-Z0-9_]+$/.test(symbol)) {
      constants.push(symbol);
      continue;
    }
    if (/^[a-z]/.test(symbol)) {
      functions.push(symbol);
      continue;
    }
    if (/^[A-Z]/.test(symbol)) {
      classesOrTypes.push(symbol);
      continue;
    }
    others.push(symbol);
  }

  return {
    providers: sortStrings(providers),
    constants: sortStrings(constants),
    functions: sortStrings(functions),
    classesOrTypes: sortStrings(classesOrTypes),
    internals: sortStrings(internals),
    others: sortStrings(others)
  };
}

function formatPackageSubpathImport(packageId, subpath) {
  const normalizedPackageId = String(packageId || "").trim();
  const normalizedSubpath = String(subpath || "").trim();
  if (!normalizedPackageId) {
    return normalizedSubpath;
  }
  if (!normalizedSubpath || normalizedSubpath === ".") {
    return normalizedPackageId;
  }
  if (normalizedSubpath.startsWith("./")) {
    return `${normalizedPackageId}/${normalizedSubpath.slice(2)}`;
  }
  if (normalizedSubpath.startsWith("/")) {
    return `${normalizedPackageId}${normalizedSubpath}`;
  }
  return `${normalizedPackageId}/${normalizedSubpath}`;
}

function normalizePlacementOutlets(value) {
  const outlets = [];
  const source = ensureArray(value);
  for (const entry of source) {
    const record = ensureObject(entry);
    const slot = String(record.slot || "").trim();
    if (!slot) {
      continue;
    }

    const surfaces = [...new Set(ensureArray(record.surfaces).map((item) => String(item || "").trim()).filter(Boolean))];
    const description = String(record.description || "").trim();
    const sourceLabel = String(record.source || "").trim();
    outlets.push(
      Object.freeze({
        slot,
        surfaces: Object.freeze(surfaces),
        description,
        source: sourceLabel
      })
    );
  }

  return Object.freeze(
    [...outlets].sort((left, right) => left.slot.localeCompare(right.slot))
  );
}

function normalizePlacementContributions(value) {
  const contributions = [];
  for (const entry of ensureArray(value)) {
    const record = ensureObject(entry);
    const id = String(record.id || "").trim();
    const slot = String(record.slot || "").trim();
    if (!id || !slot) {
      continue;
    }

    const surface = String(record.surface || "").trim();
    const componentToken = String(record.componentToken || "").trim();
    const when = String(record.when || "").trim();
    const description = String(record.description || "").trim();
    const source = String(record.source || "").trim();
    const parsedOrder = Number(record.order);
    const order = Number.isFinite(parsedOrder) ? Math.trunc(parsedOrder) : null;
    contributions.push(
      Object.freeze({
        id,
        slot,
        surface,
        order,
        componentToken,
        when,
        description,
        source
      })
    );
  }

  return Object.freeze(
    [...contributions].sort((left, right) => {
      const slotCompare = left.slot.localeCompare(right.slot);
      if (slotCompare !== 0) {
        return slotCompare;
      }
      const leftOrder = Number.isFinite(left.order) ? left.order : Number.POSITIVE_INFINITY;
      const rightOrder = Number.isFinite(right.order) ? right.order : Number.POSITIVE_INFINITY;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return left.id.localeCompare(right.id);
    })
  );
}

function deriveCanonicalExportTargetForSubpath(subpath) {
  const normalizedSubpath = String(subpath || "").trim();
  if (!normalizedSubpath) {
    return "";
  }
  if (normalizedSubpath === ".") {
    return "./src/index.js";
  }
  if (!normalizedSubpath.startsWith("./")) {
    return "";
  }

  const bareSubpath = normalizedSubpath.slice(2);
  if (!bareSubpath) {
    return "";
  }
  if (bareSubpath === "client" || bareSubpath === "server" || bareSubpath === "shared") {
    return `./src/${bareSubpath}/index.js`;
  }

  const roots = ["client", "server", "shared"];
  for (const root of roots) {
    if (!bareSubpath.startsWith(`${root}/`)) {
      continue;
    }
    const suffix = bareSubpath.slice(root.length + 1);
    if (!suffix) {
      return "";
    }
    const hasJsExtension = /\.(?:c|m)?js$/.test(suffix);
    const normalizedSuffix = hasJsExtension ? suffix : `${suffix}.js`;
    return `./src/${root}/${normalizedSuffix}`;
  }

  return "";
}

function shouldShowPackageExportTarget({ subpath, target, targetType }) {
  if (String(targetType || "").trim() !== "file") {
    return true;
  }

  const canonicalTarget = deriveCanonicalExportTargetForSubpath(subpath);
  if (!canonicalTarget) {
    return true;
  }

  const normalizeTarget = (value) => {
    const raw = String(value || "").trim();
    if (!raw) {
      return "";
    }
    const withoutPrefix = raw.startsWith("./") ? raw.slice(2) : raw;
    return `./${normalizeRelativePosixPath(withoutPrefix)}`;
  };

  return normalizeTarget(target) !== normalizeTarget(canonicalTarget);
}

function deriveProviderDisplayName(bindingRecord) {
  const binding = ensureObject(bindingRecord);
  const providerLabel = String(binding.provider || "").trim();
  if (!providerLabel) {
    return "";
  }

  const hashIndex = providerLabel.lastIndexOf("#");
  if (hashIndex > -1 && hashIndex < providerLabel.length - 1) {
    return providerLabel.slice(hashIndex + 1);
  }

  const entrypoint = String(binding.entrypoint || "").trim();
  if (!entrypoint) {
    return providerLabel;
  }
  const basename = path.posix.basename(entrypoint);
  return basename.replace(/\.(?:c|m)?js$/i, "") || providerLabel;
}

async function collectExportFileSymbolSummaries({ packageRoot, packageExports, notes }) {
  const rootDir = String(packageRoot || "").trim();
  if (!rootDir) {
    return [];
  }

  const exportTargets = new Map();
  for (const entry of ensureArray(packageExports)) {
    const record = ensureObject(entry);
    if (record.targetType !== "file" || record.targetExists !== true) {
      continue;
    }

    const target = String(record.target || "").trim();
    if (!target.startsWith("./")) {
      continue;
    }
    const normalizedTarget = normalizeRelativePosixPath(target.replace(/^\.\//, ""));
    const basename = path.posix.basename(normalizedTarget);
    if (!/\.(?:js|mjs|cjs)$/i.test(basename)) {
      continue;
    }

    if (!exportTargets.has(normalizedTarget)) {
      exportTargets.set(normalizedTarget, {
        file: normalizedTarget,
        subpaths: new Set(),
        conditions: new Set()
      });
    }
    const bucket = exportTargets.get(normalizedTarget);
    bucket.subpaths.add(String(record.subpath || ".").trim() || ".");
    const condition = String(record.condition || "default").trim() || "default";
    if (condition !== "default") {
      bucket.conditions.add(condition);
    }
  }

  const summaries = [];
  for (const [relativeTargetPath, bucket] of exportTargets.entries()) {
    const absoluteTargetPath = path.resolve(rootDir, relativeTargetPath);
    if (!(await fileExists(absoluteTargetPath))) {
      ensureArray(notes).push(`Export file missing: ${relativeTargetPath}`);
      continue;
    }

    let source = "";
    try {
      source = await readFile(absoluteTargetPath, "utf8");
    } catch (error) {
      ensureArray(notes).push(
        `Failed to read export file ${relativeTargetPath}: ${String(error?.message || error || "unknown error")}`
      );
      continue;
    }

    const summary = parseExportedSymbolsFromSource(source);
    summaries.push({
      file: normalizeRelativePosixPath(relativeTargetPath),
      subpaths: sortStrings([...bucket.subpaths]),
      conditions: sortStrings([...bucket.conditions]),
      symbols: ensureArray(summary.symbols),
      hasDefaultExport: Boolean(summary.hasDefaultExport),
      starReExports: ensureArray(summary.starReExports),
      namedReExports: ensureArray(summary.namedReExports)
    });
  }

  return summaries.sort((left, right) => String(left.file || "").localeCompare(String(right.file || "")));
}

async function inspectPackageOfferings({ packageEntry }) {
  const rootDir = String(packageEntry?.rootDir || "").trim();
  const notes = [];
  const details = {
    available: Boolean(rootDir),
    notes,
    packageExports: [],
    containerBindings: {
      server: [],
      client: []
    },
    exportedSymbols: []
  };

  if (!rootDir) {
    notes.push("Source files are unavailable for static introspection (catalog metadata only).");
    return details;
  }

  const packageJson = ensureObject(packageEntry?.packageJson);
  details.packageExports = await describePackageExports({
    packageRoot: rootDir,
    packageJson
  });

  const runtime = ensureObject(packageEntry?.descriptor?.runtime);
  const runtimeSides = [
    {
      side: "server",
      providers: ensureArray(ensureObject(runtime.server).providers)
    },
    {
      side: "client",
      providers: ensureArray(ensureObject(runtime.client).providers)
    }
  ];

  for (const runtimeSide of runtimeSides) {
    const side = String(runtimeSide.side || "").trim();
    if (!side) {
      continue;
    }
    const bindings = [];
    for (const provider of runtimeSide.providers) {
      const record = ensureObject(provider);
      const entrypoint = String(record.entrypoint || "").trim();
      const exportName = String(record.export || "").trim();
      if (!entrypoint) {
        continue;
      }

      const providerLabel = exportName ? `${entrypoint}#${exportName}` : entrypoint;
      if (entrypoint.includes("*")) {
        notes.push(`Skipped wildcard provider entrypoint during introspection: ${providerLabel}`);
        continue;
      }

      const providerPath = path.resolve(rootDir, entrypoint);
      if (!(await fileExists(providerPath))) {
        notes.push(`Provider file missing during introspection: ${providerLabel}`);
        continue;
      }

      let source = "";
      try {
        source = await readFile(providerPath, "utf8");
      } catch (error) {
        notes.push(`Failed reading provider ${providerLabel}: ${String(error?.message || error || "unknown error")}`);
        continue;
      }

      bindings.push(
        ...collectContainerBindingsFromProviderSource({
          source,
          providerLabel,
          entrypoint,
          providerExportName: exportName
        })
      );
    }

    details.containerBindings[side] = bindings.sort((left, right) => {
      const tokenComparison = String(left?.token || "").localeCompare(String(right?.token || ""));
      if (tokenComparison !== 0) {
        return tokenComparison;
      }
      const providerComparison = String(left?.provider || "").localeCompare(String(right?.provider || ""));
      if (providerComparison !== 0) {
        return providerComparison;
      }
      return Number(left?.line || 0) - Number(right?.line || 0);
    });
  }

  details.exportedSymbols = await collectExportFileSymbolSummaries({
    packageRoot: rootDir,
    packageExports: details.packageExports,
    notes
  });

  return details;
}

function collectPlannedCapabilityIssues(plannedPackageIds, packageRegistry) {
  const selectedPackageIds = sortStrings(
    [...new Set(ensureArray(plannedPackageIds).map((value) => String(value || "").trim()).filter(Boolean))]
  );
  const selectedPackageSet = new Set(selectedPackageIds);
  const providersByCapability = new Map();

  for (const [capabilityId, providers] of Object.entries(BUILTIN_CAPABILITY_PROVIDERS)) {
    if (!providersByCapability.has(capabilityId)) {
      providersByCapability.set(capabilityId, new Set());
    }
    for (const providerId of ensureArray(providers).map((value) => String(value || "").trim()).filter(Boolean)) {
      providersByCapability.get(capabilityId).add(providerId);
    }
  }

  for (const packageId of selectedPackageIds) {
    const packageEntry = packageRegistry.get(packageId);
    if (!packageEntry) {
      continue;
    }
    const provides = listDeclaredCapabilities(packageEntry.descriptor.capabilities, "provides");
    for (const capabilityId of provides) {
      if (!providersByCapability.has(capabilityId)) {
        providersByCapability.set(capabilityId, new Set());
      }
      providersByCapability.get(capabilityId).add(packageId);
    }
  }

  const issues = [];
  for (const packageId of selectedPackageIds) {
    const packageEntry = packageRegistry.get(packageId);
    if (!packageEntry) {
      continue;
    }
    const requires = listDeclaredCapabilities(packageEntry.descriptor.capabilities, "requires");
    for (const capabilityId of requires) {
      const selectedProviders = providersByCapability.get(capabilityId);
      if (selectedProviders && selectedProviders.size > 0) {
        continue;
      }

      const availableProviders = [];
      for (const [candidatePackageId, candidatePackageEntry] of packageRegistry.entries()) {
        if (selectedPackageSet.has(candidatePackageId)) {
          continue;
        }
        const candidateProvides = listDeclaredCapabilities(candidatePackageEntry.descriptor.capabilities, "provides");
        if (candidateProvides.includes(capabilityId)) {
          availableProviders.push(candidatePackageId);
        }
      }

      issues.push({
        packageId,
        capabilityId,
        availableProviders: sortStrings(availableProviders)
      });
    }
  }

  return issues;
}

function validatePlannedCapabilityClosure(plannedPackageIds, packageRegistry, actionLabel) {
  const issues = collectPlannedCapabilityIssues(plannedPackageIds, packageRegistry);
  if (issues.length === 0) {
    return;
  }

  const lines = [`Cannot ${actionLabel}: capability requirements are not satisfied.`];
  for (const issue of issues) {
    const providersHint = issue.availableProviders.length > 0
      ? ` Available providers: ${issue.availableProviders.join(", ")}.`
      : "";
    lines.push(
      `- ${issue.packageId} requires capability ${issue.capabilityId}, but no selected package provides it.${providersHint}`
    );
  }

  throw createCliError(lines.join("\n"));
}

async function resolvePackageOptions(packageEntry, inlineOptions, io) {
  const optionSchemas = ensureObject(packageEntry.descriptor.options);
  const optionNames = Object.keys(optionSchemas);
  const resolved = {};
  const inlineOptionValues = ensureObject(inlineOptions);
  const hasInlineOption = (name) => Object.prototype.hasOwnProperty.call(inlineOptionValues, name);

  for (const optionName of optionNames) {
    const schema = ensureObject(optionSchemas[optionName]);
    const allowEmpty = schema.allowEmpty === true;
    if (hasInlineOption(optionName)) {
      const inlineValue = String(inlineOptionValues[optionName] || "").trim();
      if (inlineValue || allowEmpty) {
        resolved[optionName] = inlineValue;
        continue;
      }
      if (schema.required) {
        throw createCliError(`Package ${packageEntry.packageId} option ${optionName} requires a non-empty value.`);
      }
    }

    if (typeof schema.defaultValue === "string" && schema.defaultValue.trim()) {
      resolved[optionName] = schema.defaultValue.trim();
      continue;
    }

    if (schema.required) {
      resolved[optionName] = await promptForRequiredOption({
        ownerType: "package",
        ownerId: packageEntry.packageId,
        optionName,
        optionSchema: schema,
        stdin: io.stdin,
        stdout: io.stdout
      });
      continue;
    }

    resolved[optionName] = "";
  }

  return resolved;
}

function validateInlineOptionsForPackage(packageEntry, inlineOptions) {
  const optionSchemas = ensureObject(packageEntry?.descriptor?.options);
  const allowedOptionNames = Object.keys(optionSchemas);
  const allowed = new Set(allowedOptionNames);
  const providedOptionNames = Object.keys(ensureObject(inlineOptions));
  const unknownOptionNames = providedOptionNames.filter((optionName) => !allowed.has(optionName));

  if (unknownOptionNames.length < 1) {
    return;
  }

  const sortedUnknown = sortStrings(unknownOptionNames);
  const suffix = allowedOptionNames.length > 0
    ? ` Allowed options: ${sortStrings(allowedOptionNames).join(", ")}.`
    : " This package does not accept inline options.";

  throw createCliError(
    `Unknown option(s) for package ${packageEntry.packageId}: ${sortedUnknown.join(", ")}.${suffix}`
  );
}

function createManagedRecordBase(packageEntry, options) {
  const sourceRecord = {
    type: String(packageEntry?.sourceType || "packages-directory"),
    ...ensureObject(packageEntry?.source)
  };
  if (!sourceRecord.descriptorPath && String(packageEntry?.descriptorRelativePath || "").trim()) {
    sourceRecord.descriptorPath = String(packageEntry.descriptorRelativePath).trim();
  }

  return {
    packageId: packageEntry.packageId,
    version: packageEntry.version,
    source: sourceRecord,
    managed: {
      packageJson: {
        dependencies: {},
        devDependencies: {},
        scripts: {}
      },
      text: {},
      files: [],
      migrations: []
    },
    options,
    installedAt: new Date().toISOString()
  };
}

async function runCommandCapture(command, args, { cwd } = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve({
          stdout,
          stderr
        });
        return;
      }
      const details = String(stderr || stdout || "").trim();
      reject(createCliError(`${command} ${args.join(" ")} failed with exit code ${code}.${details ? ` ${details}` : ""}`));
    });
  });
}

function extractPackTarballName(packStdout) {
  const lines = String(packStdout || "")
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines[lines.length - 1] : "";
}

async function materializePackageRootFromRegistry({ packageEntry, appRoot }) {
  const cacheKey = `${packageEntry.packageId}@${packageEntry.version}`;
  if (MATERIALIZED_PACKAGE_ROOTS.has(cacheKey)) {
    return MATERIALIZED_PACKAGE_ROOTS.get(cacheKey);
  }

  const tempRoot = await mkdtemp(path.join(tmpdir(), "jskit-cli-pack-"));
  MATERIALIZED_PACKAGE_TEMP_DIRECTORIES.add(tempRoot);
  const packageSpec = `${packageEntry.packageId}@${packageEntry.version}`;
  const packResult = await runCommandCapture(
    "npm",
    ["pack", packageSpec, "--silent", "--pack-destination", tempRoot],
    { cwd: appRoot }
  );
  const tarballName = extractPackTarballName(packResult.stdout);
  if (!tarballName) {
    throw createCliError(`Unable to materialize ${packageSpec}: npm pack produced no tarball name.`);
  }

  const tarballPath = path.join(tempRoot, tarballName);
  if (!(await fileExists(tarballPath))) {
    throw createCliError(`Unable to materialize ${packageSpec}: tarball missing at ${tarballPath}.`);
  }

  const extractedRoot = path.join(tempRoot, "extracted");
  await mkdir(extractedRoot, { recursive: true });
  await runCommandCapture("tar", ["-xzf", tarballPath, "-C", extractedRoot], { cwd: appRoot });
  const packageRoot = path.join(extractedRoot, "package");
  const descriptorPath = path.join(packageRoot, "package.descriptor.mjs");
  if (!(await fileExists(descriptorPath))) {
    throw createCliError(`Materialized package ${packageSpec} does not contain package.descriptor.mjs.`);
  }

  MATERIALIZED_PACKAGE_ROOTS.set(cacheKey, packageRoot);
  return packageRoot;
}

async function resolvePackageTemplateRoot({ packageEntry, appRoot }) {
  const packageRoot = String(packageEntry?.rootDir || "").trim();
  if (packageRoot) {
    return packageRoot;
  }
  return await materializePackageRootFromRegistry({ packageEntry, appRoot });
}

async function cleanupMaterializedPackageRoots() {
  for (const tempDirectory of MATERIALIZED_PACKAGE_TEMP_DIRECTORIES) {
    await rm(tempDirectory, { recursive: true, force: true }).catch(() => {});
  }
  MATERIALIZED_PACKAGE_TEMP_DIRECTORIES.clear();
  MATERIALIZED_PACKAGE_ROOTS.clear();
}

function interpolateFileMutationRecord(mutation, options, packageId) {
  const mutationKey = String(mutation?.id || mutation?.slug || mutation?.to || mutation?.from || "files").trim();
  const interpolate = (value, field) =>
    interpolateOptionValue(String(value || ""), options, packageId, `${mutationKey}.${field}`);

  return {
    ...mutation,
    from: interpolate(mutation.from, "from"),
    to: interpolate(mutation.to, "to"),
    toDir: interpolate(mutation.toDir, "toDir"),
    slug: interpolate(mutation.slug, "slug"),
    extension: interpolate(mutation.extension, "extension"),
    id: interpolate(mutation.id, "id"),
    category: interpolate(mutation.category, "category"),
    reason: interpolate(mutation.reason, "reason")
  };
}

async function copyTemplateFile(sourcePath, targetPath, options, packageId, interpolationKey) {
  const sourceContent = await readFile(sourcePath, "utf8");
  const renderedContent = sourceContent.includes("${")
    ? interpolateOptionValue(sourceContent, options, packageId, interpolationKey)
    : sourceContent;

  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, renderedContent, "utf8");
}

async function applyFileMutations(
  packageEntry,
  options,
  appRoot,
  fileMutations,
  managedFiles,
  managedMigrations,
  touchedFiles,
  warnings = []
) {
  for (const mutationValue of fileMutations) {
    const normalizedMutation = normalizeFileMutationRecord(mutationValue);
    if (!shouldApplyMutationWhen(normalizedMutation.when, options)) {
      continue;
    }

    const mutation = interpolateFileMutationRecord(normalizedMutation, options, packageEntry.packageId);
    const operation = mutation.op || "copy-file";

    if (operation === "install-migration") {
      const rawMutation = ensureObject(mutationValue);
      if (Object.hasOwn(rawMutation, "preserveOnRemove")) {
        warnings.push(
          `${packageEntry.packageId}: install-migration ignores preserveOnRemove (migrations are always preserved on remove).`
        );
      }

      const from = mutation.from;
      const toDir = mutation.toDir || "migrations";
      if (!from) {
        throw createCliError(`Invalid install-migration mutation in ${packageEntry.packageId}: \"from\" is required.`);
      }

      const slug = normalizeMigrationSlug(mutation.slug, packageEntry.packageId);
      const sourcePath = path.join(packageEntry.rootDir, from);
      if (!(await fileExists(sourcePath))) {
        throw createCliError(`Missing migration template source ${sourcePath} for ${packageEntry.packageId}.`);
      }

      const sourceContent = await readFile(sourcePath, "utf8");
      const renderedSourceContent = sourceContent.includes("${")
        ? interpolateOptionValue(sourceContent, options, packageEntry.packageId, `${mutation.id || slug}.source`)
        : sourceContent;
      const sourceExtension = normalizeMigrationExtension(path.extname(from), ".cjs");
      const extension = normalizeMigrationExtension(mutation.extension, sourceExtension);
      const migrationId =
        String(mutation.id || "").trim() ||
        extractMigrationIdFromSource(renderedSourceContent) ||
        `${packageEntry.packageId}:${slug}`;
      const existingMigration = await findExistingMigrationById({
        appRoot,
        migrationsDirectory: toDir,
        migrationId
      });

      if (existingMigration) {
        warnings.push(
          `${packageEntry.packageId}: skipped migration ${migrationId} (already installed at ${existingMigration.path}).`
        );
        managedMigrations.push({
          id: migrationId,
          path: existingMigration.path,
          skipped: true,
          reason: mutation.reason,
          category: mutation.category
        });
        continue;
      }

      const migrationsDirectoryAbsolute = path.join(appRoot, toDir);
      await mkdir(migrationsDirectoryAbsolute, { recursive: true });

      const baseNow = Date.now();
      let targetPath = "";
      let offsetSeconds = 0;
      while (offsetSeconds < 86400) {
        const timestamp = formatMigrationTimestamp(new Date(baseNow + offsetSeconds * 1000));
        const fileName = `${timestamp}_${slug}${extension}`;
        const candidatePath = path.join(migrationsDirectoryAbsolute, fileName);
        if (!(await fileExists(candidatePath))) {
          targetPath = candidatePath;
          break;
        }
        offsetSeconds += 1;
      }

      if (!targetPath) {
        throw createCliError(`Unable to allocate migration filename for ${packageEntry.packageId}:${migrationId}.`);
      }

      await writeFile(targetPath, renderedSourceContent, "utf8");
      const relativePath = normalizeRelativePath(appRoot, targetPath);
      touchedFiles.add(relativePath);
      managedMigrations.push({
        id: migrationId,
        path: relativePath,
        skipped: false,
        reason: mutation.reason,
        category: mutation.category
      });
      continue;
    }

    if (operation !== "copy-file") {
      throw createCliError(`Unsupported files mutation op \"${operation}\" in ${packageEntry.packageId}.`);
    }

    const from = mutation.from;
    const to = mutation.to;
    if (!from || !to) {
      throw createCliError(`Invalid files mutation in ${packageEntry.packageId}: \"from\" and \"to\" are required.`);
    }

    const sourcePath = path.join(packageEntry.rootDir, from);
    if (!(await fileExists(sourcePath))) {
      throw createCliError(`Missing template source ${sourcePath} for ${packageEntry.packageId}.`);
    }

    const targetPath = path.join(appRoot, to);
    const previous = await readFileBufferIfExists(targetPath);
    await copyTemplateFile(
      sourcePath,
      targetPath,
      options,
      packageEntry.packageId,
      `${mutation.id || to || from}.source`
    );
    const nextBuffer = await readFile(targetPath);

    managedFiles.push({
      path: normalizeRelativePath(appRoot, targetPath),
      hash: hashBuffer(nextBuffer),
      hadPrevious: previous.exists,
      previousContentBase64: previous.exists ? previous.buffer.toString("base64") : "",
      preserveOnRemove: mutation.preserveOnRemove,
      reason: mutation.reason,
      category: mutation.category,
      id: mutation.id
    });
    touchedFiles.add(normalizeRelativePath(appRoot, targetPath));
  }
}

async function applyTextMutations(packageEntry, appRoot, textMutations, options, managedText, touchedFiles) {
  for (const mutation of textMutations) {
    const when = normalizeMutationWhen(mutation?.when);
    if (!shouldApplyMutationWhen(when, options)) {
      continue;
    }

    const operation = String(mutation?.op || "").trim();
    if (operation === "upsert-env") {
      const relativeFile = String(mutation?.file || "").trim();
      const key = String(mutation?.key || "").trim();
      if (!relativeFile || !key) {
        throw createCliError(`Invalid upsert-env mutation in ${packageEntry.packageId}: "file" and "key" are required.`);
      }

      const absoluteFile = path.join(appRoot, relativeFile);
      const previous = await readFileBufferIfExists(absoluteFile);
      const previousContent = previous.exists ? previous.buffer.toString("utf8") : "";
      const resolvedValue = interpolateOptionValue(mutation?.value || "", options, packageEntry.packageId, key);
      const upserted = upsertEnvValue(previousContent, key, resolvedValue);

      await mkdir(path.dirname(absoluteFile), { recursive: true });
      await writeFile(absoluteFile, upserted.content, "utf8");

      const recordKey = `${relativeFile}::${String(mutation?.id || key)}`;
      managedText[recordKey] = {
        file: relativeFile,
        op: "upsert-env",
        key,
        value: resolvedValue,
        hadPrevious: upserted.hadPrevious,
        previousValue: upserted.previousValue,
        reason: String(mutation?.reason || ""),
        category: String(mutation?.category || ""),
        id: String(mutation?.id || "")
      };
      touchedFiles.add(normalizeRelativePath(appRoot, absoluteFile));
      continue;
    }

    if (operation === "append-text") {
      const relativeFile = String(mutation?.file || "").trim();
      const snippet = String(mutation?.value || "");
      const position = String(mutation?.position || "bottom").trim().toLowerCase();
      if (!relativeFile) {
        throw createCliError(`Invalid append-text mutation in ${packageEntry.packageId}: "file" is required.`);
      }
      if (position !== "top" && position !== "bottom") {
        throw createCliError(`Invalid append-text mutation in ${packageEntry.packageId}: "position" must be "top" or "bottom".`);
      }

      const absoluteFile = path.join(appRoot, relativeFile);
      const previous = await readFileBufferIfExists(absoluteFile);
      const previousContent = previous.exists ? previous.buffer.toString("utf8") : "";
      const mutationId = String(mutation?.id || "").trim() || "append-text";
      const resolvedSnippet = interpolateOptionValue(snippet, options, packageEntry.packageId, mutationId);
      const skipChecks = normalizeSkipChecks(mutation?.skipIfContains)
        .map((entry) => interpolateOptionValue(entry, options, packageEntry.packageId, `${mutationId}.skipIfContains`))
        .filter((entry) => String(entry || "").trim().length > 0);

      const shouldSkip = skipChecks.some((pattern) => previousContent.includes(String(pattern)));
      if (shouldSkip) {
        continue;
      }

      const appended = appendTextSnippet(previousContent, resolvedSnippet, position);
      if (!appended.changed) {
        continue;
      }

      await mkdir(path.dirname(absoluteFile), { recursive: true });
      await writeFile(absoluteFile, appended.content, "utf8");

      const recordKey = `${relativeFile}::${mutationId}`;
      managedText[recordKey] = {
        file: relativeFile,
        op: "append-text",
        value: resolvedSnippet,
        position,
        reason: String(mutation?.reason || ""),
        category: String(mutation?.category || ""),
        id: String(mutation?.id || "")
      };
      touchedFiles.add(normalizeRelativePath(appRoot, absoluteFile));
      continue;
    }

    throw createCliError(`Unsupported text mutation op "${operation}" in ${packageEntry.packageId}.`);
  }
}

async function applyPackageInstall({
  packageEntry,
  packageOptions,
  appRoot,
  appPackageJson,
  lock,
  packageRegistry,
  touchedFiles
}) {
  const managedRecord = createManagedRecordBase(packageEntry, packageOptions);
  const cloneOnlyPackage = isCloneOnlyPackageEntry(packageEntry);
  const mutationWarnings = [];
  const mutations = ensureObject(packageEntry.descriptor.mutations);
  const templateRoot = await resolvePackageTemplateRoot({ packageEntry, appRoot });
  const packageEntryForMutations =
    templateRoot === packageEntry.rootDir
      ? packageEntry
      : {
          ...packageEntry,
          rootDir: templateRoot
        };
  const mutationDependencies = ensureObject(mutations.dependencies);
  const runtimeDependencies = ensureObject(mutationDependencies.runtime);
  const devDependencies = ensureObject(mutationDependencies.dev);
  const mutationScripts = ensureObject(ensureObject(mutations.packageJson).scripts);

  for (const [rawDependencyId, rawDependencyVersion] of Object.entries(runtimeDependencies)) {
    const dependencyId = interpolateOptionValue(
      rawDependencyId,
      packageOptions,
      packageEntry.packageId,
      `dependencies.runtime.${rawDependencyId}.id`
    );
    const dependencyVersion = interpolateOptionValue(
      String(rawDependencyVersion || ""),
      packageOptions,
      packageEntry.packageId,
      `dependencies.runtime.${rawDependencyId}.value`
    );
    if (!dependencyId) {
      throw createCliError(
        `Invalid runtime dependency key after option interpolation in ${packageEntry.packageId}: ${rawDependencyId}`
      );
    }

    const localPackage = packageRegistry.get(dependencyId);
    const existingRuntimeDependencyValue = String(ensureObject(appPackageJson.dependencies)[dependencyId] || "").trim();
    const resolvedValue = localPackage
      ? resolvePackageDependencySpecifier(localPackage, { existingValue: existingRuntimeDependencyValue })
      : String(dependencyVersion);
    const applied = applyPackageJsonField(appPackageJson, "dependencies", dependencyId, resolvedValue);
    if (applied.changed) {
      managedRecord.managed.packageJson.dependencies[dependencyId] = applied.managed;
      touchedFiles.add("package.json");
    }
  }

  for (const [rawDependencyId, rawDependencyVersion] of Object.entries(devDependencies)) {
    const dependencyId = interpolateOptionValue(
      rawDependencyId,
      packageOptions,
      packageEntry.packageId,
      `dependencies.dev.${rawDependencyId}.id`
    );
    const dependencyVersion = interpolateOptionValue(
      String(rawDependencyVersion || ""),
      packageOptions,
      packageEntry.packageId,
      `dependencies.dev.${rawDependencyId}.value`
    );
    if (!dependencyId) {
      throw createCliError(
        `Invalid dev dependency key after option interpolation in ${packageEntry.packageId}: ${rawDependencyId}`
      );
    }

    const localPackage = packageRegistry.get(dependencyId);
    const existingDevDependencyValue = String(ensureObject(appPackageJson.devDependencies)[dependencyId] || "").trim();
    const resolvedValue = localPackage
      ? resolvePackageDependencySpecifier(localPackage, { existingValue: existingDevDependencyValue })
      : String(dependencyVersion);
    const applied = applyPackageJsonField(appPackageJson, "devDependencies", dependencyId, resolvedValue);
    if (applied.changed) {
      managedRecord.managed.packageJson.devDependencies[dependencyId] = applied.managed;
      touchedFiles.add("package.json");
    }
  }

  if (cloneOnlyPackage) {
    const removedRuntimeDependency = removePackageJsonField(appPackageJson, "dependencies", packageEntry.packageId);
    const removedDevDependency = removePackageJsonField(appPackageJson, "devDependencies", packageEntry.packageId);
    if (removedRuntimeDependency || removedDevDependency) {
      touchedFiles.add("package.json");
    }
  } else {
    const existingSelfDependencyValue = String(ensureObject(appPackageJson.dependencies)[packageEntry.packageId] || "").trim();
    const selfDependencyValue = resolvePackageDependencySpecifier(packageEntry, {
      existingValue: existingSelfDependencyValue
    });
    const selfApplied = applyPackageJsonField(appPackageJson, "dependencies", packageEntry.packageId, selfDependencyValue);
    if (selfApplied.changed) {
      managedRecord.managed.packageJson.dependencies[packageEntry.packageId] = selfApplied.managed;
      touchedFiles.add("package.json");
    }
  }

  for (const [scriptName, scriptValue] of Object.entries(mutationScripts)) {
    const applied = applyPackageJsonField(appPackageJson, "scripts", scriptName, scriptValue);
    if (applied.changed) {
      managedRecord.managed.packageJson.scripts[scriptName] = applied.managed;
      touchedFiles.add("package.json");
    }
  }

  await applyFileMutations(
    packageEntryForMutations,
    packageOptions,
    appRoot,
    ensureArray(mutations.files),
    managedRecord.managed.files,
    managedRecord.managed.migrations,
    touchedFiles,
    mutationWarnings
  );

  await applyTextMutations(
    packageEntryForMutations,
    appRoot,
    ensureArray(mutations.text),
    packageOptions,
    managedRecord.managed.text,
    touchedFiles
  );

  if (cloneOnlyPackage) {
    delete lock.installedPackages[packageEntry.packageId];
  } else {
    lock.installedPackages[packageEntry.packageId] = managedRecord;
  }
  if (mutationWarnings.length > 0) {
    managedRecord.warnings = mutationWarnings;
  }
  return managedRecord;
}

async function adoptAppLocalPackageDependencies({
  appRoot,
  appPackageJson,
  lock
}) {
  const appLocalRegistry = await loadAppLocalPackageRegistry(appRoot);
  const runtimeDependencies = ensureObject(appPackageJson.dependencies);
  const adoptedPackageIds = [];

  for (const dependencyId of sortStrings(Object.keys(runtimeDependencies))) {
    if (lock.installedPackages[dependencyId]) {
      continue;
    }

    const localPackageEntry = appLocalRegistry.get(dependencyId);
    if (!localPackageEntry) {
      continue;
    }

    lock.installedPackages[dependencyId] = createManagedRecordBase(localPackageEntry, {});
    adoptedPackageIds.push(dependencyId);
  }

  return {
    appLocalRegistry,
    adoptedPackageIds: sortStrings(adoptedPackageIds)
  };
}

const commandHandlers = createCommandHandlers({
  createCliError,
  createColorFormatter,
  resolveWrapWidth,
  writeWrappedItems,
  normalizeRelativePath,
  normalizeRelativePosixPath,
  resolveAppRootFromCwd,
  loadLockFile,
  loadPackageRegistry,
  loadBundleRegistry,
  loadAppLocalPackageRegistry,
  mergePackageRegistries,
  resolvePackageIdInput,
  resolveInstalledPackageIdInput,
  resolveInstalledNodeModulePackageEntry,
  hydratePackageRegistryFromInstalledNodeModules,
  validateInlineOptionsForPackage,
  resolveLocalDependencyOrder,
  validatePlannedCapabilityClosure,
  resolvePackageOptions,
  applyPackageInstall,
  adoptAppLocalPackageDependencies,
  loadAppPackageJson,
  resolveLocalPackageId,
  createLocalPackageScaffoldFiles,
  fileExists,
  applyPackageJsonField,
  toFileDependencySpecifier,
  writeJsonFile,
  writeFile,
  mkdir,
  path,
  inspectPackageOfferings,
  buildFileWriteGroups,
  listDeclaredCapabilities,
  buildCapabilityDetailsForPackage,
  formatPackageSubpathImport,
  normalizePlacementOutlets,
  normalizePlacementContributions,
  shouldShowPackageExportTarget,
  classifyExportedSymbols,
  deriveProviderDisplayName,
  runCommandCapture,
  restorePackageJsonField,
  readFileBufferIfExists,
  removeEnvValue,
  hashBuffer,
  rm
});

async function runCli(argv = process.argv.slice(2), io = {}) {
  const cwd = io.cwd || process.cwd();
  const stdin = io.stdin || process.stdin;
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;

  try {
    const { command, options, positional } = parseArgs(argv);
    if (options.help || command === "help") {
      printUsage(stdout);
      return 0;
    }

    if (command === "create") {
      return await commandHandlers.commandCreate({
        positional,
        options,
        cwd,
        io: { stdin, stdout, stderr }
      });
    }
    if (command === "list") {
      return await commandHandlers.commandList({ positional, options, cwd, stdout });
    }
    if (command === "show") {
      return await commandHandlers.commandShow({ positional, options, stdout });
    }
    if (command === "add") {
      return await commandHandlers.commandAdd({
        positional,
        options,
        cwd,
        io: { stdin, stdout, stderr }
      });
    }
    if (command === "update") {
      return await commandHandlers.commandUpdate({
        positional,
        options,
        cwd,
        io: { stdin, stdout, stderr }
      });
    }
    if (command === "remove") {
      return await commandHandlers.commandRemove({
        positional,
        options,
        cwd,
        io: { stdin, stdout, stderr }
      });
    }
    if (command === "doctor") {
      return await commandHandlers.commandDoctor({ cwd, options, stdout });
    }
    if (command === "lint-descriptors") {
      return await commandHandlers.commandLintDescriptors({ options, stdout });
    }

    throw createCliError(`Unhandled command: ${command}`, { showUsage: true });
  } catch (error) {
    stderr.write(`jskit: ${error?.message || String(error)}\n`);
    if (error?.showUsage) {
      printUsage(stderr);
    }
    return 1;
  } finally {
    await cleanupMaterializedPackageRoots();
  }
}

export { runCli };
