import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  access,
  constants as fsConstants,
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const CLI_PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function isWorkspaceRoot(candidateRoot) {
  if (!candidateRoot) {
    return false;
  }
  return (
    existsSync(path.join(candidateRoot, "packages")) &&
    existsSync(path.join(candidateRoot, "packages", "kernel")) &&
    existsSync(path.join(candidateRoot, "tooling", "jskit-cli"))
  );
}

function collectAncestorDirectories(startDirectory) {
  const ancestors = [];
  let current = path.resolve(startDirectory);
  while (true) {
    ancestors.push(current);
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return ancestors;
}

function resolveWorkspaceRoot() {
  const candidates = [];
  const seen = new Set();
  const appendCandidate = (candidatePath) => {
    const raw = String(candidatePath || "").trim();
    if (!raw) {
      return;
    }
    const absolute = path.resolve(raw);
    if (seen.has(absolute)) {
      return;
    }
    seen.add(absolute);
    candidates.push(absolute);
  };

  appendCandidate(process.env.JSKIT_REPO_ROOT);
  appendCandidate(path.resolve(CLI_PACKAGE_ROOT, "../.."));
  appendCandidate(CLI_PACKAGE_ROOT);

  const cwdAncestors = collectAncestorDirectories(process.cwd());
  for (const ancestor of cwdAncestors) {
    appendCandidate(ancestor);
    appendCandidate(path.join(ancestor, "jskit-ai"));
  }

  for (const candidate of candidates) {
    if (isWorkspaceRoot(candidate)) {
      return candidate;
    }
  }

  return "";
}

const WORKSPACE_ROOT = resolveWorkspaceRoot();
const MODULES_ROOT = WORKSPACE_ROOT ? path.join(WORKSPACE_ROOT, "packages") : "";
const BUNDLES_ROOT = path.join(CLI_PACKAGE_ROOT, "bundles");
const require = createRequire(import.meta.url);

function resolveCatalogPackagesPath() {
  const explicitPath = String(process.env.JSKIT_CATALOG_PACKAGES_PATH || "").trim();
  if (explicitPath) {
    return path.resolve(explicitPath);
  }

  let catalogPackageJsonPath = "";
  try {
    catalogPackageJsonPath = require.resolve("@jskit-ai/jskit-catalog/package.json");
  } catch {}
  if (catalogPackageJsonPath) {
    return path.join(path.dirname(catalogPackageJsonPath), "catalog", "packages.json");
  }

  const workspaceCatalogPath = path.resolve(CLI_PACKAGE_ROOT, "../jskit-catalog/catalog/packages.json");
  if (existsSync(workspaceCatalogPath)) {
    return workspaceCatalogPath;
  }

  throw createCliError(
    "Unable to resolve @jskit-ai/jskit-catalog. Install it alongside @jskit-ai/jskit-cli or set JSKIT_CATALOG_PACKAGES_PATH."
  );
}

const CATALOG_PACKAGES_PATH = resolveCatalogPackagesPath();
const LOCK_RELATIVE_PATH = ".jskit/lock.json";
const LOCK_VERSION = 1;
const OPTION_INTERPOLATION_PATTERN = /\$\{(?:option:)?([a-z][a-z0-9-]*)\}/gi;
const MATERIALIZED_PACKAGE_ROOTS = new Map();
const MATERIALIZED_PACKAGE_TEMP_DIRECTORIES = new Set();
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

const ANSI_RESET = "\u001b[0m";
const ANSI_BOLD = "\u001b[1m";
const ANSI_DIM = "\u001b[2m";
const ANSI_CYAN = "\u001b[36m";
const ANSI_GREEN = "\u001b[32m";
const ANSI_YELLOW = "\u001b[33m";
const ANSI_WHITE = "\u001b[97m";

function createCliError(message, { showUsage = false } = {}) {
  const error = new Error(String(message || "Unknown CLI error"));
  error.name = "CliError";
  error.showUsage = Boolean(showUsage);
  return error;
}

function createColorFormatter(stream) {
  const noColor = Object.prototype.hasOwnProperty.call(process.env, "NO_COLOR");
  const term = String(process.env.TERM || "").toLowerCase();
  const forceColor = String(process.env.FORCE_COLOR || "").trim();
  const enableColor = (() => {
    if (forceColor === "0") {
      return false;
    }
    if (forceColor) {
      return true;
    }
    if (noColor || term === "dumb") {
      return false;
    }
    return Boolean(stream && stream.isTTY);
  })();

  const paint = (text, sequence) => {
    const value = String(text);
    if (!enableColor) {
      return value;
    }
    return `${sequence}${value}${ANSI_RESET}`;
  };

  return Object.freeze({
    heading: (text) => paint(text, `${ANSI_BOLD}${ANSI_WHITE}`),
    item: (text) => paint(text, ANSI_CYAN),
    version: (text) => paint(text, ANSI_DIM),
    installed: (text) => paint(text, ANSI_GREEN),
    provider: (text) => paint(text, ANSI_YELLOW),
    dim: (text) => paint(text, ANSI_DIM)
  });
}

function resolveWrapWidth(stream, fallbackWidth = 80) {
  const parsedFallback = Number(fallbackWidth);
  const fallback = Number.isFinite(parsedFallback) ? Math.max(20, Math.floor(parsedFallback)) : 80;
  const columns = Number(stream?.columns);
  if (!Number.isFinite(columns) || columns < 20) {
    return fallback;
  }
  return Math.floor(columns);
}

function writeWrappedItems({ stdout, heading, items, lineIndent = "  ", wrapWidth = 80 }) {
  const records = ensureArray(items)
    .map((entry) => {
      const normalized = ensureObject(entry);
      const text = String(normalized.text || "").trim();
      const rendered = String(normalized.rendered || text);
      if (!text) {
        return null;
      }
      return { text, rendered };
    })
    .filter(Boolean);

  if (records.length === 0) {
    return;
  }

  stdout.write(`${heading}\n`);
  const width = Math.max(20, Number(wrapWidth) || 80);
  let line = lineIndent;
  let lineLength = lineIndent.length;

  for (const record of records) {
    const separator = lineLength > lineIndent.length ? " " : "";
    const addedLength = separator.length + record.text.length;
    if (lineLength > lineIndent.length && lineLength + addedLength > width) {
      stdout.write(`${line}\n`);
      line = `${lineIndent}${record.rendered}`;
      lineLength = lineIndent.length + record.text.length;
      continue;
    }

    line = `${line}${separator}${record.rendered}`;
    lineLength += addedLength;
  }

  if (lineLength > lineIndent.length) {
    stdout.write(`${line}\n`);
  }
}

function normalizeFileMutationRecord(value) {
  const record = ensureObject(value);
  return {
    from: String(record.from || "").trim(),
    to: String(record.to || "").trim(),
    id: String(record.id || "").trim(),
    category: String(record.category || "").trim(),
    reason: String(record.reason || "").trim()
  };
}

function buildFileWriteGroups(fileMutations) {
  const groups = [];
  const groupsByKey = new Map();

  for (const mutation of ensureArray(fileMutations)) {
    const normalized = normalizeFileMutationRecord(mutation);
    if (!normalized.from || !normalized.to) {
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

    group.files.push({
      from: normalized.from,
      to: normalized.to
    });
  }

  return groups;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function ensureObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeRelativePath(fromRoot, absolutePath) {
  return path.relative(fromRoot, absolutePath).split(path.sep).join("/");
}

function hashBuffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function sortStrings(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
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
      const optionValue = hasInlineValue
        ? withoutPrefix.slice(withoutPrefix.indexOf("=") + 1).trim()
        : String(args.shift() || "").trim();

      if (!/^[a-z][a-z0-9-]*$/.test(optionName)) {
        throw createCliError(`Unknown option: ${token}`, { showUsage: true });
      }
      if (!optionValue || optionValue.startsWith("-")) {
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

function interpolateOptionValue(rawValue, options, ownerId, key) {
  return String(rawValue || "").replace(OPTION_INTERPOLATION_PATTERN, (_, optionName) => {
    if (Object.prototype.hasOwnProperty.call(options, optionName)) {
      return String(options[optionName]);
    }
    throw createCliError(
      `Missing required option ${optionName} while applying ${ownerId} mutation ${key}.`
    );
  });
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function promptForRequiredOption({
  ownerType,
  ownerId,
  optionName,
  optionSchema,
  stdin = process.stdin,
  stdout = process.stdout
}) {
  const defaultValue = String(optionSchema?.defaultValue || "").trim();
  const promptLabel = String(optionSchema?.promptLabel || "").trim();
  const promptHint = String(optionSchema?.promptHint || "").trim();
  const required = Boolean(optionSchema?.required);

  if (!stdin?.isTTY || !stdout?.isTTY) {
    if (defaultValue) {
      return defaultValue;
    }
    if (required) {
      throw createCliError(
        `${ownerType} ${ownerId} requires option ${optionName}. Non-interactive mode requires --${optionName} <value>.`
      );
    }
    return "";
  }

  const label = promptLabel || `Select ${optionName} for ${ownerType} ${ownerId}`;
  const defaultHint = defaultValue ? ` [default: ${defaultValue}]` : "";
  const hintSuffix = promptHint ? ` ${promptHint}` : "";
  const rl = createInterface({
    input: stdin,
    output: stdout
  });

  try {
    const answer = String(await rl.question(`${label}${defaultHint}${hintSuffix}: `)).trim();
    if (!answer && defaultValue) {
      return defaultValue;
    }
    if (!answer && required) {
      throw createCliError(`${ownerType} ${ownerId} requires option ${optionName}.`);
    }
    return answer || "";
  } finally {
    rl.close();
  }
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
  const hasServerProviders = ensureArray(server.providers).length > 0;
  const hasClientProviders = ensureArray(client.providers).length > 0;
  if (!hasServerProviders && !hasClientProviders) {
    throw createCliError(
      `Invalid package descriptor at ${descriptorPath}: runtime.server.providers or runtime.client.providers must be declared.`
    );
  }

  return normalized;
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
        //   summary: "Describe server route contract"
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
  const resolveSubpathSortPriority = (subpath) => {
    const normalized = String(subpath || "").trim();
    if (normalized === "./client") {
      return 0;
    }
    if (normalized === "./server") {
      return 1;
    }
    if (normalized === "./shared") {
      return 2;
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

async function collectIndexFileSymbolSummaries({ packageRoot, packageExports, notes }) {
  const rootDir = String(packageRoot || "").trim();
  if (!rootDir) {
    return [];
  }

  const indexTargets = new Map();
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
    if (!/^index\.(?:js|mjs|cjs)$/.test(basename)) {
      continue;
    }

    if (!indexTargets.has(normalizedTarget)) {
      indexTargets.set(normalizedTarget, {
        file: normalizedTarget,
        subpaths: new Set(),
        conditions: new Set()
      });
    }
    const bucket = indexTargets.get(normalizedTarget);
    bucket.subpaths.add(String(record.subpath || ".").trim() || ".");
    const condition = String(record.condition || "default").trim() || "default";
    if (condition !== "default") {
      bucket.conditions.add(condition);
    }
  }

  const summaries = [];
  for (const [relativeTargetPath, bucket] of indexTargets.entries()) {
    const absoluteTargetPath = path.resolve(rootDir, relativeTargetPath);
    if (!(await fileExists(absoluteTargetPath))) {
      ensureArray(notes).push(`Index export file missing: ${relativeTargetPath}`);
      continue;
    }

    let source = "";
    try {
      source = await readFile(absoluteTargetPath, "utf8");
    } catch (error) {
      ensureArray(notes).push(
        `Failed to read index export file ${relativeTargetPath}: ${String(error?.message || error || "unknown error")}`
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

  details.exportedSymbols = await collectIndexFileSymbolSummaries({
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
  const optionNames = sortStrings(Object.keys(optionSchemas));
  const resolved = {};

  for (const optionName of optionNames) {
    const schema = ensureObject(optionSchemas[optionName]);
    const inlineValue = inlineOptions[optionName];
    if (typeof inlineValue === "string" && inlineValue.trim()) {
      resolved[optionName] = inlineValue.trim();
      continue;
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
      files: []
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

async function applyFileMutations(packageEntry, appRoot, fileMutations, managedFiles, touchedFiles) {
  for (const mutation of fileMutations) {
    const from = String(mutation?.from || "").trim();
    const to = String(mutation?.to || "").trim();
    if (!from || !to) {
      throw createCliError(`Invalid files mutation in ${packageEntry.packageId}: "from" and "to" are required.`);
    }

    const sourcePath = path.join(packageEntry.rootDir, from);
    if (!(await fileExists(sourcePath))) {
      throw createCliError(`Missing template source ${sourcePath} for ${packageEntry.packageId}.`);
    }

    const targetPath = path.join(appRoot, to);
    const previous = await readFileBufferIfExists(targetPath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
    const nextBuffer = await readFile(targetPath);

    managedFiles.push({
      path: normalizeRelativePath(appRoot, targetPath),
      hash: hashBuffer(nextBuffer),
      hadPrevious: previous.exists,
      previousContentBase64: previous.exists ? previous.buffer.toString("base64") : "",
      reason: String(mutation?.reason || ""),
      category: String(mutation?.category || ""),
      id: String(mutation?.id || "")
    });
    touchedFiles.add(normalizeRelativePath(appRoot, targetPath));
  }
}

async function applyTextMutations(packageEntry, appRoot, textMutations, options, managedText, touchedFiles) {
  for (const mutation of textMutations) {
    const operation = String(mutation?.op || "").trim();
    if (operation !== "upsert-env") {
      throw createCliError(`Unsupported text mutation op "${operation}" in ${packageEntry.packageId}.`);
    }

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

  for (const [dependencyId, dependencyVersion] of Object.entries(runtimeDependencies)) {
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

  for (const [dependencyId, dependencyVersion] of Object.entries(devDependencies)) {
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

  const existingSelfDependencyValue = String(ensureObject(appPackageJson.dependencies)[packageEntry.packageId] || "").trim();
  const selfDependencyValue = resolvePackageDependencySpecifier(packageEntry, {
    existingValue: existingSelfDependencyValue
  });
  const selfApplied = applyPackageJsonField(appPackageJson, "dependencies", packageEntry.packageId, selfDependencyValue);
  if (selfApplied.changed) {
    managedRecord.managed.packageJson.dependencies[packageEntry.packageId] = selfApplied.managed;
    touchedFiles.add("package.json");
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
    appRoot,
    ensureArray(mutations.files),
    managedRecord.managed.files,
    touchedFiles
  );

  await applyTextMutations(
    packageEntryForMutations,
    appRoot,
    ensureArray(mutations.text),
    packageOptions,
    managedRecord.managed.text,
    touchedFiles
  );

  lock.installedPackages[packageEntry.packageId] = managedRecord;
  return managedRecord;
}

function renderResolvedSummary(commandType, targetId, resolvedPackageIds, touchedFiles, appRoot, lockPath, externalDependencies) {
  const lines = [];
  lines.push(`${commandType} ${targetId}.`);
  lines.push(`Resolved packages (${resolvedPackageIds.length}):`);
  for (const packageId of resolvedPackageIds) {
    lines.push(`- ${packageId}`);
  }

  if (externalDependencies.length > 0) {
    lines.push(`External dependencies (${externalDependencies.length}):`);
    for (const dependencyId of externalDependencies) {
      lines.push(`- ${dependencyId}`);
    }
  }

  lines.push(`Touched files (${touchedFiles.length}):`);
  for (const touchedFile of touchedFiles) {
    lines.push(`- ${touchedFile}`);
  }
  lines.push(`Lock file: ${normalizeRelativePath(appRoot, lockPath)}`);
  return lines.join("\n");
}

async function runNpmInstall(appRoot, stderr) {
  await new Promise((resolve, reject) => {
    const child = spawn("npm", ["install"], {
      cwd: appRoot,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(createCliError(`npm install failed with exit code ${code}.`));
      }
    });
  }).catch((error) => {
    stderr.write(`npm install failed: ${error.message}\n`);
    throw error;
  });
}

function getInstalledDependents(lock, packageId, packageRegistry) {
  const dependents = [];
  const installedPackageIds = Object.keys(ensureObject(lock.installedPackages));

  for (const installedId of installedPackageIds) {
    if (installedId === packageId) {
      continue;
    }
    const packageEntry = packageRegistry.get(installedId);
    if (!packageEntry) {
      continue;
    }
    const dependencies = ensureArray(packageEntry.descriptor.dependsOn).map((value) => String(value));
    if (dependencies.includes(packageId)) {
      dependents.push(installedId);
    }
  }

  return sortStrings(dependents);
}

async function commandList({ positional, options, cwd, stdout }) {
  const packageRegistry = await loadPackageRegistry();
  const bundleRegistry = await loadBundleRegistry();

  const appRoot = await resolveAppRootFromCwd(cwd);
  const appLocalRegistry = await loadAppLocalPackageRegistry(appRoot);
  const { lock } = await loadLockFile(appRoot);
  const installedPackageEntries = ensureObject(lock.installedPackages);
  const installedPackages = new Set(Object.keys(installedPackageEntries));
  const installedUnknownPackageIds = sortStrings(
    [...installedPackages].filter((packageId) => !packageRegistry.has(packageId))
  );
  const installedLocalPackageIds = sortStrings(
    installedUnknownPackageIds.filter((packageId) => {
      const lockEntry = ensureObject(installedPackageEntries[packageId]);
      const sourceType = String(ensureObject(lockEntry.source).type || "").trim();
      return sourceType === "local-package" || sourceType === "app-local-package" || appLocalRegistry.has(packageId);
    })
  );
  const installedExternalPackageIds = sortStrings(
    installedUnknownPackageIds.filter((packageId) => !installedLocalPackageIds.includes(packageId))
  );
  const availableLocalPackageIds = sortStrings(
    [...appLocalRegistry.keys()].filter((packageId) => !installedPackages.has(packageId))
  );

  const mode = String(positional[0] || "").trim();
  const shouldListBundles = !mode || mode === "bundles";
  const shouldListPackages = !mode || mode === "packages";

  if (!shouldListBundles && !shouldListPackages) {
    throw createCliError(`Unknown list mode: ${mode}`, { showUsage: true });
  }

  const color = createColorFormatter(stdout);
  const lines = [];
  if (shouldListBundles) {
    lines.push(color.heading("Available bundles:"));
    const bundleIds = sortStrings([...bundleRegistry.keys()]);
    for (const bundleId of bundleIds) {
      const bundle = bundleRegistry.get(bundleId);
      const packageIds = ensureArray(bundle.packages).map((value) => String(value));
      const isInstalled = packageIds.length > 0 && packageIds.every((packageId) => installedPackages.has(packageId));
      const providerLabel = Number(bundle.provider) === 1 ? " [provider]" : "";
      const installedLabel = isInstalled ? " (installed)" : "";
      lines.push(
        `- ${color.item(bundle.bundleId)} ${color.version(`(${bundle.version})`)}${isInstalled ? color.installed(installedLabel) : installedLabel}${providerLabel ? color.provider(providerLabel) : providerLabel}: ${String(bundle.description || "")}`
      );
      if (options.full || options.expanded) {
        for (const packageId of packageIds) {
          lines.push(`  - ${color.dim(packageId)}`);
        }
      }
    }
  }

  if (shouldListPackages) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push(color.heading("Available packages:"));
    const packageIds = sortStrings([...packageRegistry.keys()]);
    for (const packageId of packageIds) {
      const packageEntry = packageRegistry.get(packageId);
      const installedLabel = installedPackages.has(packageId) ? " (installed)" : "";
      lines.push(
        `- ${color.item(packageId)} ${color.version(`(${packageEntry.version})`)}${installedLabel ? color.installed(installedLabel) : ""}`
      );
    }

    if (installedLocalPackageIds.length > 0) {
      lines.push("");
      lines.push(color.heading("Installed local packages:"));
      for (const packageId of installedLocalPackageIds) {
        const lockEntry = ensureObject(installedPackageEntries[packageId]);
        const version = String(lockEntry.version || "").trim();
        const versionLabel = version ? ` ${color.version(`(${version})`)}` : "";
        lines.push(`- ${color.item(packageId)}${versionLabel}${color.installed(" (installed)")}`);
      }
    }

    if (installedExternalPackageIds.length > 0) {
      lines.push("");
      lines.push(color.heading("Installed external packages:"));
      for (const packageId of installedExternalPackageIds) {
        const lockEntry = ensureObject(installedPackageEntries[packageId]);
        const version = String(lockEntry.version || "").trim();
        const versionLabel = version ? ` ${color.version(`(${version})`)}` : "";
        lines.push(`- ${color.item(packageId)}${versionLabel}${color.installed(" (installed)")}`);
      }
    }

    if (availableLocalPackageIds.length > 0) {
      lines.push("");
      lines.push(color.heading("Available local packages (not installed):"));
      for (const packageId of availableLocalPackageIds) {
        const packageEntry = appLocalRegistry.get(packageId);
        const version = String(packageEntry?.version || "").trim();
        const versionLabel = version ? ` ${color.version(`(${version})`)}` : "";
        lines.push(`- ${color.item(packageId)}${versionLabel}`);
      }
    }
  }

  if (options.json) {
    const payload = {
      bundles: shouldListBundles
        ? sortStrings([...bundleRegistry.keys()]).map((bundleId) => {
          const bundle = bundleRegistry.get(bundleId);
          const packageIds = ensureArray(bundle.packages).map((value) => String(value));
          return {
            bundleId: bundle.bundleId,
            version: bundle.version,
            description: bundle.description || "",
            provider: Number(bundle.provider) === 1,
            installed: packageIds.length > 0 && packageIds.every((packageId) => installedPackages.has(packageId)),
            packages: packageIds
          };
        })
        : [],
      packages: shouldListPackages
        ? sortStrings([...packageRegistry.keys()]).map((packageId) => {
          const packageEntry = packageRegistry.get(packageId);
          return {
            packageId,
            version: packageEntry.version,
            installed: installedPackages.has(packageId)
          };
        })
        : [],
      installedLocalPackages: shouldListPackages
        ? installedLocalPackageIds.map((packageId) => {
          const lockEntry = ensureObject(installedPackageEntries[packageId]);
          return {
            packageId,
            version: String(lockEntry.version || "").trim()
          };
        })
        : [],
      installedExternalPackages: shouldListPackages
        ? installedExternalPackageIds.map((packageId) => {
          const lockEntry = ensureObject(installedPackageEntries[packageId]);
          return {
            packageId,
            version: String(lockEntry.version || "").trim(),
            source: ensureObject(lockEntry.source)
          };
        })
        : [],
      availableLocalPackages: shouldListPackages
        ? availableLocalPackageIds.map((packageId) => {
          const packageEntry = appLocalRegistry.get(packageId);
          return {
            packageId,
            version: String(packageEntry?.version || "").trim(),
            packagePath: normalizeRelativePosixPath(String(packageEntry?.relativeDir || ""))
          };
        })
        : []
    };
    stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    stdout.write(`${lines.join("\n")}\n`);
  }

  return 0;
}

async function commandShow({ positional, options, stdout }) {
  const id = String(positional[0] || "").trim();
  if (!id) {
    throw createCliError("show requires an id.", { showUsage: true });
  }

  const packageRegistry = await loadPackageRegistry();
  const bundleRegistry = await loadBundleRegistry();
  const color = createColorFormatter(stdout);
  const writeField = (label, value, formatValue = (raw) => raw) => {
    stdout.write(`${color.dim(`${label}:`)} ${formatValue(String(value || ""))}\n`);
  };
  const resolvedPackageId = resolvePackageIdInput(id, packageRegistry);

  if (resolvedPackageId) {
    const packageEntry = packageRegistry.get(resolvedPackageId);
    const descriptor = packageEntry.descriptor;
    const fileWriteGroups = buildFileWriteGroups(ensureArray(ensureObject(descriptor.mutations).files));
    const fileWriteCount = fileWriteGroups.reduce((total, group) => total + ensureArray(group.files).length, 0);
    const capabilities = ensureObject(descriptor.capabilities);
    const runtime = ensureObject(descriptor.runtime);
    const metadata = ensureObject(descriptor.metadata);
    const mutations = ensureObject(descriptor.mutations);
    const runtimeMutations = ensureObject(ensureObject(mutations.dependencies).runtime);
    const devMutations = ensureObject(ensureObject(mutations.dependencies).dev);
    const scriptMutations = ensureObject(ensureObject(mutations.packageJson).scripts);
    const textMutations = ensureArray(mutations.text);
    const packageInsights = await inspectPackageOfferings({ packageEntry });
    const payload = {
      kind: "package",
      packageId: descriptor.packageId,
      version: descriptor.version,
      description: String(descriptor.description || ""),
      dependsOn: ensureArray(descriptor.dependsOn).map((value) => String(value)),
      capabilities,
      options: ensureObject(descriptor.options),
      runtime,
      metadata,
      mutations,
      fileWritePlan: {
        groupCount: fileWriteGroups.length,
        fileCount: fileWriteCount,
        groups: fileWriteGroups
      },
      descriptorPath: packageEntry.descriptorRelativePath,
      introspection: {
        available: Boolean(packageInsights.available),
        notes: ensureArray(packageInsights.notes)
      },
      packageExports: ensureArray(packageInsights.packageExports),
      containerBindings: ensureObject(packageInsights.containerBindings),
      exportedSymbols: ensureArray(packageInsights.exportedSymbols)
    };
    const provides = listDeclaredCapabilities(payload.capabilities, "provides");
    const requires = listDeclaredCapabilities(payload.capabilities, "requires");
    const capabilityDetails = options.details
      ? buildCapabilityDetailsForPackage({
          packageRegistry,
          packageId: payload.packageId,
          dependsOn: payload.dependsOn,
          provides,
          requires
        })
      : null;
    if (capabilityDetails) {
      payload.capabilityDetails = capabilityDetails;
    }
    if (options.json) {
      stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      const runtimeMutationEntries = Object.entries(runtimeMutations);
      const devMutationEntries = Object.entries(devMutations);
      const scriptMutationEntries = Object.entries(scriptMutations);
      const wrapWidth = resolveWrapWidth(stdout, 80);
      const introspection = ensureObject(payload.introspection);
      const introspectionAvailable = introspection.available === true;
      const introspectionNotes = ensureArray(introspection.notes)
        .map((value) => String(value || "").trim())
        .filter(Boolean);
      const metadataApiSummary = ensureObject(ensureObject(payload.metadata).apiSummary);
      const summarySurfaces = ensureArray(metadataApiSummary.surfaces)
        .map((entry) => {
          const record = ensureObject(entry);
          return {
            subpath: String(record.subpath || "").trim(),
            summary: String(record.summary || "").trim()
          };
        })
        .filter((entry) => entry.subpath && entry.summary);
      const containerTokenSummary = ensureObject(metadataApiSummary.containerTokens);
      const quickServerTokens = ensureArray(containerTokenSummary.server).map((value) => String(value || "").trim()).filter(Boolean);
      const quickClientTokens = ensureArray(containerTokenSummary.client).map((value) => String(value || "").trim()).filter(Boolean);
      const packageExports = ensureArray(payload.packageExports);
      const exportedSymbols = ensureArray(payload.exportedSymbols);
      const bindingSections = ensureObject(payload.containerBindings);
      const serverBindings = ensureArray(bindingSections.server);
      const clientBindings = ensureArray(bindingSections.client);
      stdout.write(`${color.heading("Information")}\n`);
      writeField("Package", payload.packageId, color.item);
      writeField("Version", payload.version, color.installed);
      if (payload.description) {
        writeField("Description", payload.description);
      }
      writeField("Descriptor", payload.descriptorPath, color.dim);
      if (summarySurfaces.length > 0) {
        stdout.write(`${color.heading("Summary:")}\n`);
        for (const summaryEntry of summarySurfaces) {
          const importPath = formatPackageSubpathImport(payload.packageId, summaryEntry.subpath);
          stdout.write(`- ${color.item(`${importPath}:`)}\n`);
          stdout.write(`  ${summaryEntry.summary}\n`);
        }
      }
      if (quickServerTokens.length > 0 || quickClientTokens.length > 0) {
        stdout.write(`${color.heading("Container tokens (quick map):")}\n`);
        if (quickServerTokens.length > 0) {
          stdout.write(`- ${color.installed("server")}: ${quickServerTokens.map((token) => color.item(token)).join(", ")}\n`);
        }
        if (quickClientTokens.length > 0) {
          stdout.write(`- ${color.installed("client")}: ${quickClientTokens.map((token) => color.item(token)).join(", ")}\n`);
        }
      }
      if (introspectionAvailable) {
        stdout.write(`${color.heading(`Package exports (${packageExports.length}):`)}\n`);
        if (packageExports.length < 1) {
          stdout.write(`- ${color.dim("none declared")}\n`);
        } else {
          for (const packageExport of packageExports) {
            const record = ensureObject(packageExport);
            const subpath = String(record.subpath || ".").trim() || ".";
            const condition = String(record.condition || "default").trim() || "default";
            const target = String(record.target || "").trim();
            const targetType = String(record.targetType || "").trim();
            const conditionSuffix = condition !== "default" ? ` ${color.installed(`[${condition}]`)}` : "";
            const status = targetType === "file"
              ? record.targetExists === true
                ? color.installed("[ok]")
                : color.provider("[missing]")
              : targetType === "pattern"
                ? color.dim("[pattern]")
                : color.dim("[external]");
            stdout.write(`- ${color.item(subpath)}${conditionSuffix} -> ${color.item(target)} ${status}\n`);
          }
        }

        stdout.write(`${color.heading(`Exported symbols from index files (${exportedSymbols.length}):`)}\n`);
        if (exportedSymbols.length < 1) {
          stdout.write(`- ${color.dim("none detected")}\n`);
        } else {
          for (const summaryRecord of exportedSymbols) {
            const summary = ensureObject(summaryRecord);
            const file = String(summary.file || "").trim();
            const subpaths = ensureArray(summary.subpaths).map((value) => String(value)).filter(Boolean);
            const conditions = ensureArray(summary.conditions).map((value) => String(value)).filter(Boolean);
            const subpathLabel = subpaths.length > 0 ? subpaths.join(", ") : "(unmapped)";
            const conditionSuffix = conditions.length > 0 ? ` ${color.dim(`[conditions: ${conditions.join(", ")}]`)}` : "";
            stdout.write(`- ${color.heading(`${subpathLabel} -> ${file}`)}${conditionSuffix}\n`);

            const symbols = ensureArray(summary.symbols).map((value) => String(value)).filter(Boolean);
            const classifiedSymbols = classifyExportedSymbols(symbols);
            const writeClassifiedSymbols = (label, entries) => {
              const items = ensureArray(entries).map((entry) => String(entry || "").trim()).filter(Boolean);
              if (items.length < 1) {
                return;
              }
              writeWrappedItems({
                stdout,
                heading: `  ${color.installed(`${label} (${items.length}):`)}`,
                lineIndent: "    ",
                wrapWidth,
                items: items.map((symbol) => ({
                  text: symbol,
                  rendered: color.item(symbol)
                }))
              });
            };
            writeClassifiedSymbols("providers", classifiedSymbols.providers);
            writeClassifiedSymbols("functions/helpers", classifiedSymbols.functions);
            writeClassifiedSymbols("constants", classifiedSymbols.constants);
            writeClassifiedSymbols("classes/types", classifiedSymbols.classesOrTypes);
            writeClassifiedSymbols("internal/test hooks", classifiedSymbols.internals);
            writeClassifiedSymbols("other symbols", classifiedSymbols.others);

            if (summary.hasDefaultExport === true) {
              stdout.write(`  ${color.installed("default export: yes")}\n`);
            }
            const starReExports = ensureArray(summary.starReExports).map((value) => String(value)).filter(Boolean);
            const namedReExports = ensureArray(summary.namedReExports).map((value) => String(value)).filter(Boolean);
            const reExportSummary = [];
            if (namedReExports.length > 0) {
              reExportSummary.push(`named from ${namedReExports.length} files`);
            }
            if (starReExports.length > 0) {
              reExportSummary.push(`star from ${starReExports.length} files`);
            }
            if (reExportSummary.length > 0) {
              stdout.write(`  ${color.dim(`re-export sources: ${reExportSummary.join(", ")}`)}\n`);
            }
            if (!options.details) {
              continue;
            }

            if (starReExports.length > 0) {
              writeWrappedItems({
                stdout,
                heading: `  ${color.installed(`star re-exports (${starReExports.length}):`)}`,
                lineIndent: "    ",
                wrapWidth,
                items: starReExports.map((specifier) => ({
                  text: specifier,
                  rendered: color.item(specifier)
                }))
              });
            }
            if (namedReExports.length > 0) {
              writeWrappedItems({
                stdout,
                heading: `  ${color.installed(`named re-exports (${namedReExports.length}):`)}`,
                lineIndent: "    ",
                wrapWidth,
                items: namedReExports.map((specifier) => ({
                  text: specifier,
                  rendered: color.item(specifier)
                }))
              });
            }
          }
        }
      } else {
        stdout.write(`${color.heading("Code introspection:")}\n`);
        stdout.write(`- ${color.dim("Source files unavailable (descriptor metadata only).")}\n`);
      }
      if (payload.dependsOn.length > 0) {
        writeWrappedItems({
          stdout,
          heading: `${color.heading("Depends on")} ${color.installed(`(${payload.dependsOn.length})`)}:`,
          wrapWidth,
          items: payload.dependsOn.map((dependencyId) => {
            const text = String(dependencyId);
            return {
              text,
              rendered: color.item(text)
            };
          })
        });
      }
      if (runtimeMutationEntries.length > 0) {
        writeWrappedItems({
          stdout,
          heading: color.heading(`Dependency mutations runtime (${runtimeMutationEntries.length}):`),
          wrapWidth,
          items: runtimeMutationEntries.map(([dependencyId, versionSpec]) => {
            const dependencyText = String(dependencyId);
            const versionText = String(versionSpec);
            return {
              text: `${dependencyText} ${versionText}`,
              rendered: `${color.item(dependencyText)} ${color.installed(versionText)}`
            };
          })
        });
      }

      if (provides.length > 0 || requires.length > 0) {
        stdout.write(`${color.heading("Capabilities:")}\n`);
        if (provides.length > 0) {
          const providesText = provides.map((capabilityId) => color.item(capabilityId)).join(" ");
          stdout.write(`${color.installed("Provides:")} ${providesText}\n`);
        }
        if (requires.length > 0) {
          const requiresText = requires.map((capabilityId) => color.item(capabilityId)).join(" ");
          stdout.write(`${color.installed("Requires:")} ${requiresText}\n`);
        }
      }
      if (capabilityDetails && (capabilityDetails.provides.length > 0 || capabilityDetails.requires.length > 0)) {
        const formatPackageSummary = (detail) => {
          const packageId = String(detail?.packageId || "").trim();
          const version = String(detail?.version || "").trim();
          const descriptorPath = String(detail?.descriptorPath || "").trim();
          const versionSuffix = version ? `@${version}` : "";
          const pathSuffix = descriptorPath ? ` [${descriptorPath}]` : "";
          return `${packageId}${versionSuffix}${pathSuffix}`;
        };

        const writeCapabilityRecord = ({ heading, records, includeDependsOnProviders = false }) => {
          if (records.length < 1) {
            return;
          }
          stdout.write(`${color.heading(heading)}\n`);
          for (const record of records) {
            const capabilityId = String(record.capabilityId || "").trim();
            stdout.write(`- ${color.item(capabilityId)}\n`);

            const providerItems = ensureArray(record.providerDetails).map((detail) => ({
              text: formatPackageSummary(detail),
              rendered: color.item(formatPackageSummary(detail))
            }));
            if (providerItems.length > 0) {
              writeWrappedItems({
                stdout,
                heading: `  ${color.installed(`providers (${providerItems.length}):`)}`,
                lineIndent: "    ",
                wrapWidth,
                items: providerItems
              });
            }

            if (includeDependsOnProviders) {
              const providersInDependsOn = ensureArray(record.providersInDependsOn).map((packageId) => ({
                text: String(packageId),
                rendered: color.item(String(packageId))
              }));
              if (providersInDependsOn.length > 0) {
                writeWrappedItems({
                  stdout,
                  heading: `  ${color.installed(`providers in dependsOn (${providersInDependsOn.length}):`)}`,
                  lineIndent: "    ",
                  wrapWidth,
                  items: providersInDependsOn
                });
              }
            }

            const requirerItems = ensureArray(record.requirerDetails).map((detail) => ({
              text: formatPackageSummary(detail),
              rendered: color.item(formatPackageSummary(detail))
            }));
            if (requirerItems.length > 0) {
              writeWrappedItems({
                stdout,
                heading: `  ${color.installed(`required by (${requirerItems.length}):`)}`,
                lineIndent: "    ",
                wrapWidth,
                items: requirerItems
              });
            }
          }
        };

        stdout.write(`${color.heading("Capability details:")}\n`);
        writeCapabilityRecord({
          heading: `Provides detail (${capabilityDetails.provides.length}):`,
          records: capabilityDetails.provides,
          includeDependsOnProviders: false
        });
        writeCapabilityRecord({
          heading: `Requires detail (${capabilityDetails.requires.length}):`,
          records: capabilityDetails.requires,
          includeDependsOnProviders: true
        });
      }

      const uiRoutes = ensureArray(ensureObject(payload.metadata.ui).routes);
      if (uiRoutes.length > 0) {
        stdout.write(`${color.heading(`UI routes (${uiRoutes.length}):`)}\n`);
        for (const route of uiRoutes) {
          const record = ensureObject(route);
          const routePath = String(record.path || "").trim();
          const scope = String(record.scope || "").trim();
          const routeId = String(record.id || record.name || "").trim();
          const purpose = String(record.purpose || "").trim();
          const modeLabel = record.autoRegister === false ? "advisory" : "auto";
          const scopeLabel = scope ? ` (${scope})` : "";
          const modePart = ` ${color.installed(`[${modeLabel}]`)}`;
          const purposePart = purpose ? ` ${purpose}` : "";
          const idPart = routeId ? ` ${color.installed(`(id:${routeId})`)}` : "";
          stdout.write(`- ${color.item(routePath)}${color.installed(scopeLabel)}${modePart}${purposePart}${idPart}\n`);
        }
      }

      const serverRoutes = ensureArray(ensureObject(payload.metadata.server).routes);
      if (serverRoutes.length > 0) {
        stdout.write(`${color.heading(`Server routes (${serverRoutes.length}):`)}\n`);
        for (const route of serverRoutes) {
          const record = ensureObject(route);
          const method = String(record.method || "").trim().toUpperCase();
          const routePath = String(record.path || "").trim();
          const summary = String(record.summary || "").trim();
          const routeLabel = `${method} ${routePath}`.trim();
          const summarySuffix = summary ? `: ${summary}` : "";
          stdout.write(`- ${color.item(routeLabel)}${summarySuffix}\n`);
        }
      }

      const optionNames = Object.keys(payload.options);
      if (optionNames.length > 0) {
        stdout.write(`${color.heading(`Options (${optionNames.length}):`)}\n`);
        for (const optionName of optionNames) {
          const schema = ensureObject(payload.options[optionName]);
          const required = schema.required ? "required" : "optional";
          const defaultSuffix = schema.defaultValue ? ` (default: ${schema.defaultValue})` : "";
          stdout.write(`- ${color.item(optionName)} ${color.installed(`[${required}]`)}${color.dim(defaultSuffix)}\n`);
        }
      }

      if (devMutationEntries.length > 0) {
        writeWrappedItems({
          stdout,
          heading: color.heading(`Dependency mutations dev (${devMutationEntries.length}):`),
          wrapWidth,
          items: devMutationEntries.map(([dependencyId, versionSpec]) => {
            const dependencyText = String(dependencyId);
            const versionText = String(versionSpec);
            return {
              text: `${dependencyText} ${versionText}`,
              rendered: `${color.item(dependencyText)} ${color.installed(versionText)}`
            };
          })
        });
      }
      if (scriptMutationEntries.length > 0) {
        stdout.write(`${color.heading(`Script mutations (${scriptMutationEntries.length}):`)}\n`);
        for (const [scriptName, scriptValue] of scriptMutationEntries) {
          stdout.write(`- ${color.item(scriptName)}: ${String(scriptValue)}\n`);
        }
      }
      if (textMutations.length > 0) {
        stdout.write(`${color.heading(`Text mutations (${textMutations.length}):`)}\n`);
        for (const mutation of textMutations) {
          const record = ensureObject(mutation);
          const op = String(record.op || "").trim();
          const file = String(record.file || "").trim();
          const key = String(record.key || "").trim();
          const reason = String(record.reason || "").trim();
          const reasonSuffix = reason ? `: ${reason}` : "";
          stdout.write(`- ${color.item(`${op} ${file} ${key}`.trim())}${reasonSuffix}\n`);
        }
      }

      if (payload.fileWritePlan.fileCount > 0) {
        stdout.write(`${color.heading(`File writes (${payload.fileWritePlan.fileCount}):`)}\n`);
        for (const group of payload.fileWritePlan.groups) {
          const groupId = String(group.id || "").trim();
          const category = String(group.category || "").trim();
          const reason = String(group.reason || "").trim();
          const files = ensureArray(group.files);
          const marker = groupId ? `id:${groupId}` : category ? `category:${category}` : "";
          const markerSuffix = marker ? ` (${marker})` : "";
          for (const file of files) {
            const targetPath = String(ensureObject(file).to || "").trim();
            if (!targetPath) {
              continue;
            }
            stdout.write(`- ${color.item(targetPath)}${color.installed(markerSuffix)}:\n`);
            if (reason) {
              stdout.write(`  ${reason}\n`);
            }
          }
        }
      }

      const serverProviders = ensureArray(ensureObject(payload.runtime.server).providers);
      const clientProviders = ensureArray(ensureObject(payload.runtime.client).providers);
      if (serverProviders.length > 0) {
        stdout.write(`${color.heading(`Runtime server providers (${serverProviders.length}):`)}\n`);
        for (const provider of serverProviders) {
          const record = ensureObject(provider);
          const entrypoint = String(record.entrypoint || "").trim();
          const exportName = String(record.export || "").trim();
          const label = exportName ? `${entrypoint}#${exportName}` : entrypoint;
          stdout.write(`- ${color.item(label)}\n`);
        }
      }
      if (clientProviders.length > 0) {
        stdout.write(`${color.heading(`Runtime client providers (${clientProviders.length}):`)}\n`);
        for (const provider of clientProviders) {
          const record = ensureObject(provider);
          const entrypoint = String(record.entrypoint || "").trim();
          const exportName = String(record.export || "").trim();
          const label = exportName ? `${entrypoint}#${exportName}` : entrypoint;
          stdout.write(`- ${color.item(label)}\n`);
        }
      }
      if (introspectionAvailable) {
        stdout.write(`${color.heading(`Container bindings server (${serverBindings.length}):`)}\n`);
        if (serverBindings.length < 1) {
          stdout.write(`- ${color.dim("none detected")}\n`);
        } else {
          for (const bindingRecord of serverBindings) {
            const binding = ensureObject(bindingRecord);
            const token = String(binding.token || "").trim();
            const tokenExpression = String(binding.tokenExpression || "").trim();
            const tokenLabel = binding.tokenResolved === true
              ? token
              : `${token || tokenExpression}${tokenExpression ? color.dim(` (expr: ${tokenExpression})`) : ""}`;
            const bindingMethod = String(binding.binding || "").trim();
            const providerLabel = String(binding.provider || "").trim();
            const lifecycle = String(binding.lifecycle || "").trim();
            const lifecycleSuffix = lifecycle && lifecycle !== "unknown" ? ` ${color.installed(`[${lifecycle}]`)}` : "";
            const location = String(binding.location || "").trim();
            const locationSuffix = location ? ` ${color.dim(`@ ${location}`)}` : "";
            stdout.write(`- ${color.item(tokenLabel)} ${color.installed(`[${bindingMethod}]`)} <= ${color.item(providerLabel)}${lifecycleSuffix}${locationSuffix}\n`);
          }
        }

        stdout.write(`${color.heading(`Container bindings client (${clientBindings.length}):`)}\n`);
        if (clientBindings.length < 1) {
          stdout.write(`- ${color.dim("none detected")}\n`);
        } else {
          for (const bindingRecord of clientBindings) {
            const binding = ensureObject(bindingRecord);
            const token = String(binding.token || "").trim();
            const tokenExpression = String(binding.tokenExpression || "").trim();
            const tokenLabel = binding.tokenResolved === true
              ? token
              : `${token || tokenExpression}${tokenExpression ? color.dim(` (expr: ${tokenExpression})`) : ""}`;
            const bindingMethod = String(binding.binding || "").trim();
            const providerLabel = String(binding.provider || "").trim();
            const lifecycle = String(binding.lifecycle || "").trim();
            const lifecycleSuffix = lifecycle && lifecycle !== "unknown" ? ` ${color.installed(`[${lifecycle}]`)}` : "";
            const location = String(binding.location || "").trim();
            const locationSuffix = location ? ` ${color.dim(`@ ${location}`)}` : "";
            stdout.write(`- ${color.item(tokenLabel)} ${color.installed(`[${bindingMethod}]`)} <= ${color.item(providerLabel)}${lifecycleSuffix}${locationSuffix}\n`);
          }
        }
      }
      if (introspectionNotes.length > 0) {
        stdout.write(`${color.heading(`Introspection notes (${introspectionNotes.length}):`)}\n`);
        for (const note of introspectionNotes) {
          stdout.write(`- ${color.dim(note)}\n`);
        }
      }
    }
    return 0;
  }

  if (bundleRegistry.has(id)) {
    const bundle = bundleRegistry.get(id);
    const payload = {
      kind: "bundle",
      bundleId: bundle.bundleId,
      version: bundle.version,
      description: String(bundle.description || ""),
      provider: Number(bundle.provider) === 1,
      curated: Number(bundle.curated) === 1,
      packages: ensureArray(bundle.packages).map((value) => String(value))
    };
    if (options.json) {
      stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      stdout.write(`${color.heading("Information")}\n`);
      writeField("Bundle", payload.bundleId, color.item);
      writeField("Version", payload.version, color.installed);
      if (payload.description) {
        writeField("Description", payload.description);
      }
      stdout.write(`${color.heading(`Packages (${payload.packages.length}):`)}\n`);
      for (const packageId of payload.packages) {
        stdout.write(`- ${color.item(packageId)}\n`);
      }
    }
    return 0;
  }

  throw createCliError(`Unknown package or bundle: ${id}`);
}

async function commandCreate({ positional, options, cwd, io }) {
  const targetType = String(positional[0] || "").trim();
  const rawName = String(positional[1] || "").trim();
  if (targetType !== "package" || !rawName) {
    throw createCliError("create requires: create package <name>", { showUsage: true });
  }

  const appRoot = await resolveAppRootFromCwd(cwd);
  const { packageJsonPath, packageJson } = await loadAppPackageJson(appRoot);
  const { lockPath, lock } = await loadLockFile(appRoot);
  const installedPackages = ensureObject(lock.installedPackages);
  const dependencies = ensureObject(packageJson.dependencies);
  const devDependencies = ensureObject(packageJson.devDependencies);

  const { packageId, packageDirName } = resolveLocalPackageId({
    rawName,
    appPackageName: packageJson.name,
    inlineOptions: options.inlineOptions
  });
  const localPackagesRoot = path.join(appRoot, "packages");
  const packageRoot = path.join(localPackagesRoot, packageDirName);
  const packageRelativePath = normalizeRelativePath(appRoot, packageRoot);
  const descriptorRelativePath = `${normalizeRelativePosixPath(packageRelativePath)}/package.descriptor.mjs`;
  const localDependencySpecifier = toFileDependencySpecifier(packageRelativePath);
  const packageDescription = String(options.inlineOptions.description || "").trim() || `App-local package ${packageId}.`;

  if (await fileExists(packageRoot)) {
    throw createCliError(`Package directory already exists: ${normalizeRelativePath(appRoot, packageRoot)}`);
  }
  if (Object.prototype.hasOwnProperty.call(installedPackages, packageId)) {
    throw createCliError(`Package is already present in lock file: ${packageId}`);
  }
  if (Object.prototype.hasOwnProperty.call(dependencies, packageId)) {
    throw createCliError(`package.json dependencies already contains ${packageId}.`);
  }
  if (Object.prototype.hasOwnProperty.call(devDependencies, packageId)) {
    throw createCliError(`package.json devDependencies already contains ${packageId}.`);
  }

  const scaffoldFiles = createLocalPackageScaffoldFiles({
    packageId,
    packageDescription
  });
  const touchedFiles = new Set(["package.json", normalizeRelativePath(appRoot, lockPath)]);
  for (const scaffoldFile of scaffoldFiles) {
    touchedFiles.add(`${normalizeRelativePosixPath(packageRelativePath)}/${normalizeRelativePosixPath(scaffoldFile.relativePath)}`);
  }

  if (!options.dryRun) {
    for (const scaffoldFile of scaffoldFiles) {
      const absoluteFilePath = path.join(packageRoot, scaffoldFile.relativePath);
      await mkdir(path.dirname(absoluteFilePath), { recursive: true });
      await writeFile(absoluteFilePath, String(scaffoldFile.content || ""), "utf8");
    }
  }

  const dependencyApplied = applyPackageJsonField(packageJson, "dependencies", packageId, localDependencySpecifier);
  const managedRecord = {
    packageId,
    version: "0.1.0",
    source: {
      type: "local-package",
      packagePath: normalizeRelativePosixPath(packageRelativePath),
      descriptorPath: descriptorRelativePath
    },
    managed: {
      packageJson: {
        dependencies: {},
        devDependencies: {},
        scripts: {}
      },
      text: {},
      files: []
    },
    options: {},
    installedAt: new Date().toISOString()
  };
  if (dependencyApplied.changed) {
    managedRecord.managed.packageJson.dependencies[packageId] = dependencyApplied.managed;
  }
  lock.installedPackages[packageId] = managedRecord;

  const touchedFileList = sortStrings([...touchedFiles]);
  if (!options.dryRun) {
    await writeJsonFile(packageJsonPath, packageJson);
    await writeJsonFile(lockPath, lock);
    if (!options.noInstall) {
      await runNpmInstall(appRoot, io.stderr);
    }
  }

  if (options.json) {
    io.stdout.write(
      `${JSON.stringify(
        {
          targetType: "package",
          packageId,
          packageDirectory: normalizeRelativePosixPath(packageRelativePath),
          descriptorPath: descriptorRelativePath,
          dependency: localDependencySpecifier,
          touchedFiles: touchedFileList,
          lockPath: normalizeRelativePath(appRoot, lockPath),
          dryRun: options.dryRun
        },
        null,
        2
      )}\n`
    );
  } else {
    io.stdout.write(`Created local package ${packageId}.\n`);
    io.stdout.write(`Directory: ${normalizeRelativePosixPath(packageRelativePath)}\n`);
    io.stdout.write(`Dependency: ${packageId} -> ${localDependencySpecifier}\n`);
    io.stdout.write(`Descriptor: ${descriptorRelativePath}\n`);
    io.stdout.write(`Touched files (${touchedFileList.length}):\n`);
    for (const touchedFile of touchedFileList) {
      io.stdout.write(`- ${touchedFile}\n`);
    }
    io.stdout.write(`Lock file: ${normalizeRelativePath(appRoot, lockPath)}\n`);
    if (options.dryRun) {
      io.stdout.write("Dry run enabled: no files were written.\n");
    }
  }

  return 0;
}

async function commandAdd({ positional, options, cwd, io }) {
  const targetType = String(positional[0] || "").trim();
  const targetId = String(positional[1] || "").trim();

  if (!targetType || !targetId) {
    throw createCliError("add requires target type and id (add bundle <id> | add package <id>).", {
      showUsage: true
    });
  }
  if (targetType !== "bundle" && targetType !== "package") {
    throw createCliError(`Unsupported add target type: ${targetType}`, { showUsage: true });
  }

  const appRoot = await resolveAppRootFromCwd(cwd);
  const packageRegistry = await loadPackageRegistry();
  const appLocalRegistry = await loadAppLocalPackageRegistry(appRoot);
  const bundleRegistry = await loadBundleRegistry();
  const combinedPackageRegistry = mergePackageRegistries(packageRegistry, appLocalRegistry);
  const { packageJsonPath, packageJson } = await loadAppPackageJson(appRoot);
  const { lockPath, lock } = await loadLockFile(appRoot);
  let resolvedTargetPackageId = targetType === "package" ? resolvePackageIdInput(targetId, combinedPackageRegistry) : "";
  if (targetType === "package" && !resolvedTargetPackageId) {
    const installedNodeModuleEntry = await resolveInstalledNodeModulePackageEntry({
      appRoot,
      packageId: targetId
    });
    if (installedNodeModuleEntry) {
      combinedPackageRegistry.set(installedNodeModuleEntry.packageId, installedNodeModuleEntry);
      resolvedTargetPackageId = installedNodeModuleEntry.packageId;
    }
  }

  const targetPackageIds = targetType === "bundle"
    ? ensureArray(bundleRegistry.get(targetId)?.packages).map((value) => String(value))
    : [resolvedTargetPackageId];
  if (targetType === "bundle" && targetPackageIds.length === 0) {
    throw createCliError(`Unknown bundle: ${targetId}`);
  }
  if (targetType === "package" && !resolvedTargetPackageId) {
    throw createCliError(
      `Unknown package: ${targetId}. Install an external module first (npm install ${targetId}) if you want to adopt it into lock.`
    );
  }

  await hydratePackageRegistryFromInstalledNodeModules({
    appRoot,
    packageRegistry: combinedPackageRegistry,
    seedPackageIds: targetPackageIds
  });

  const { ordered: resolvedPackageIds, externalDependencies } = resolveLocalDependencyOrder(
    targetPackageIds,
    combinedPackageRegistry
  );
  const plannedInstalledPackageIds = sortStrings([
    ...new Set([
      ...Object.keys(ensureObject(lock.installedPackages)).map((value) => String(value || "").trim()).filter(Boolean),
      ...resolvedPackageIds
    ])
  ]);
  validatePlannedCapabilityClosure(
    plannedInstalledPackageIds,
    combinedPackageRegistry,
    `add ${targetType} ${targetId}`
  );

  const resolvedOptionsByPackage = {};
  for (const packageId of resolvedPackageIds) {
    const packageEntry = combinedPackageRegistry.get(packageId);
    const lockEntryOptions = ensureObject(ensureObject(lock.installedPackages[packageId]).options);
    resolvedOptionsByPackage[packageId] = await resolvePackageOptions(
      packageEntry,
      {
        ...lockEntryOptions,
        ...options.inlineOptions
      },
      io
    );
  }

  const touchedFiles = new Set();
  const installedPackageRecords = [];

  for (const packageId of resolvedPackageIds) {
    const packageEntry = combinedPackageRegistry.get(packageId);
    const managedRecord = await applyPackageInstall({
      packageEntry,
      packageOptions: resolvedOptionsByPackage[packageId],
      appRoot,
      appPackageJson: packageJson,
      lock,
      packageRegistry: combinedPackageRegistry,
      touchedFiles
    });
    installedPackageRecords.push(managedRecord);
  }

  const touchedFileList = sortStrings([...touchedFiles]);
  const successLabel = targetType === "bundle" ? "Added bundle" : "Added package";

  if (!options.dryRun) {
    await writeJsonFile(packageJsonPath, packageJson);
    await writeJsonFile(lockPath, lock);
    if (!options.noInstall) {
      await runNpmInstall(appRoot, io.stderr);
    }
  }

  if (options.json) {
    io.stdout.write(`${JSON.stringify({
      targetType,
      targetId,
      resolvedPackages: resolvedPackageIds,
      touchedFiles: touchedFileList,
      lockPath: normalizeRelativePath(appRoot, lockPath),
      externalDependencies,
      dryRun: options.dryRun,
      installed: installedPackageRecords
    }, null, 2)}\n`);
  } else {
    io.stdout.write(
      `${renderResolvedSummary(
        `${successLabel}`,
        targetId,
        resolvedPackageIds,
        touchedFileList,
        appRoot,
        lockPath,
        externalDependencies
      )}\n`
    );
    if (options.dryRun) {
      io.stdout.write("Dry run enabled: no files were written.\n");
    }
  }

  return 0;
}

async function commandUpdate({ positional, options, cwd, io }) {
  const targetType = String(positional[0] || "").trim();
  const targetId = String(positional[1] || "").trim();
  if (targetType !== "package" || !targetId) {
    throw createCliError("update requires: update package <packageId>", { showUsage: true });
  }

  const appRoot = await resolveAppRootFromCwd(cwd);
  const { lock } = await loadLockFile(appRoot);
  const installedPackages = ensureObject(lock.installedPackages);
  const resolvedTargetId = resolveInstalledPackageIdInput(targetId, installedPackages);
  if (!resolvedTargetId) {
    throw createCliError(`Package is not installed: ${targetId}`);
  }

  return commandAdd({
    positional: ["package", resolvedTargetId],
    options,
    cwd,
    io
  });
}

async function commandRemove({ positional, options, cwd, io }) {
  const targetType = String(positional[0] || "").trim();
  const targetId = String(positional[1] || "").trim();
  if (targetType !== "package" || !targetId) {
    throw createCliError("remove requires: remove package <packageId>", { showUsage: true });
  }

  const appRoot = await resolveAppRootFromCwd(cwd);
  const packageRegistry = await loadPackageRegistry();
  const appLocalRegistry = await loadAppLocalPackageRegistry(appRoot);
  const combinedPackageRegistry = mergePackageRegistries(packageRegistry, appLocalRegistry);
  const { packageJsonPath, packageJson } = await loadAppPackageJson(appRoot);
  const { lockPath, lock } = await loadLockFile(appRoot);
  const installed = ensureObject(lock.installedPackages);
  await hydratePackageRegistryFromInstalledNodeModules({
    appRoot,
    packageRegistry: combinedPackageRegistry,
    seedPackageIds: Object.keys(installed)
  });
  const resolvedTargetId = resolveInstalledPackageIdInput(targetId, installed);

  if (!resolvedTargetId) {
    throw createCliError(`Package is not installed: ${targetId}`);
  }

  const dependents = getInstalledDependents(lock, resolvedTargetId, combinedPackageRegistry);
  if (dependents.length > 0) {
    throw createCliError(
      `Cannot remove ${resolvedTargetId}; installed packages depend on it: ${dependents.join(", ")}`
    );
  }

  const lockEntry = ensureObject(installed[resolvedTargetId]);
  const managed = ensureObject(lockEntry.managed);
  const touchedFiles = new Set();

  const managedPackageJson = ensureObject(managed.packageJson);
  for (const [dependencyId, managedChange] of Object.entries(ensureObject(managedPackageJson.dependencies))) {
    if (restorePackageJsonField(packageJson, "dependencies", dependencyId, managedChange)) {
      touchedFiles.add("package.json");
    }
  }
  for (const [dependencyId, managedChange] of Object.entries(ensureObject(managedPackageJson.devDependencies))) {
    if (restorePackageJsonField(packageJson, "devDependencies", dependencyId, managedChange)) {
      touchedFiles.add("package.json");
    }
  }
  for (const [scriptName, managedChange] of Object.entries(ensureObject(managedPackageJson.scripts))) {
    if (restorePackageJsonField(packageJson, "scripts", scriptName, managedChange)) {
      touchedFiles.add("package.json");
    }
  }

  const managedText = ensureObject(managed.text);
  for (const change of Object.values(managedText)) {
    const changeRecord = ensureObject(change);
    if (String(changeRecord.op || "") !== "upsert-env") {
      continue;
    }
    const relativeFile = String(changeRecord.file || "").trim();
    if (!relativeFile) {
      continue;
    }
    const absoluteFile = path.join(appRoot, relativeFile);
    const existing = await readFileBufferIfExists(absoluteFile);
    if (!existing.exists) {
      continue;
    }
    const updated = removeEnvValue(
      existing.buffer.toString("utf8"),
      String(changeRecord.key || ""),
      String(changeRecord.value || ""),
      {
        hadPrevious: Boolean(changeRecord.hadPrevious),
        previousValue: String(changeRecord.previousValue || "")
      }
    );
    if (updated.changed) {
      await writeFile(absoluteFile, updated.content, "utf8");
      touchedFiles.add(normalizeRelativePath(appRoot, absoluteFile));
    }
  }

  for (const fileChange of ensureArray(managed.files)) {
    const changeRecord = ensureObject(fileChange);
    const relativeFile = String(changeRecord.path || "").trim();
    if (!relativeFile) {
      continue;
    }
    const absoluteFile = path.join(appRoot, relativeFile);
    const existing = await readFileBufferIfExists(absoluteFile);
    if (!existing.exists) {
      continue;
    }
    if (hashBuffer(existing.buffer) !== String(changeRecord.hash || "")) {
      continue;
    }

    if (changeRecord.hadPrevious) {
      const previousBuffer = Buffer.from(String(changeRecord.previousContentBase64 || ""), "base64");
      await writeFile(absoluteFile, previousBuffer);
    } else {
      await rm(absoluteFile);
    }
    touchedFiles.add(relativeFile);
  }

  delete installed[resolvedTargetId];
  const touchedFileList = sortStrings([...touchedFiles]);

  if (!options.dryRun) {
    await writeJsonFile(packageJsonPath, packageJson);
    await writeJsonFile(lockPath, lock);
    if (!options.noInstall) {
      await runNpmInstall(appRoot, io.stderr);
    }
  }

  if (options.json) {
    io.stdout.write(`${JSON.stringify({
      removedPackage: resolvedTargetId,
      touchedFiles: touchedFileList,
      lockPath: normalizeRelativePath(appRoot, lockPath),
      dryRun: options.dryRun
    }, null, 2)}\n`);
  } else {
    io.stdout.write(`Removed package ${resolvedTargetId}.\n`);
    io.stdout.write(`Touched files (${touchedFileList.length}):\n`);
    for (const touchedFile of touchedFileList) {
      io.stdout.write(`- ${touchedFile}\n`);
    }
    io.stdout.write(`Lock file: ${normalizeRelativePath(appRoot, lockPath)}\n`);
    if (options.dryRun) {
      io.stdout.write("Dry run enabled: no files were written.\n");
    }
  }

  return 0;
}

async function commandDoctor({ cwd, options, stdout }) {
  const appRoot = await resolveAppRootFromCwd(cwd);
  const { lock } = await loadLockFile(appRoot);
  const packageRegistry = await loadPackageRegistry();
  const appLocalRegistry = await loadAppLocalPackageRegistry(appRoot);
  const combinedPackageRegistry = mergePackageRegistries(packageRegistry, appLocalRegistry);
  const issues = [];
  const installed = ensureObject(lock.installedPackages);
  await hydratePackageRegistryFromInstalledNodeModules({
    appRoot,
    packageRegistry: combinedPackageRegistry,
    seedPackageIds: Object.keys(installed)
  });

  for (const [packageId, lockEntryValue] of Object.entries(installed)) {
    const lockEntry = ensureObject(lockEntryValue);
    if (!combinedPackageRegistry.has(packageId)) {
      issues.push(`Installed package not found in package registry: ${packageId}`);
      continue;
    }

    const managed = ensureObject(lockEntry.managed);
    for (const fileChange of ensureArray(managed.files)) {
      const changeRecord = ensureObject(fileChange);
      const relativePath = String(changeRecord.path || "").trim();
      const absolutePath = path.join(appRoot, relativePath);
      if (!(await fileExists(absolutePath))) {
        issues.push(`${packageId}: managed file missing: ${relativePath}`);
        continue;
      }
      const content = await readFile(absolutePath);
      const actualHash = hashBuffer(content);
      if (actualHash !== String(changeRecord.hash || "")) {
        issues.push(`${packageId}: managed file changed outside jskit: ${relativePath}`);
      }
    }
  }

  const payload = {
    appRoot,
    lockVersion: lock.lockVersion,
    installedPackages: sortStrings(Object.keys(installed)),
    issues
  };

  if (options.json) {
    stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    stdout.write(`App root: ${appRoot}\n`);
    stdout.write(`Installed packages: ${payload.installedPackages.length}\n`);
    if (issues.length === 0) {
      stdout.write("Doctor status: healthy\n");
    } else {
      stdout.write(`Doctor status: unhealthy (${issues.length} issue(s))\n`);
      for (const issue of issues) {
        stdout.write(`- ${issue}\n`);
      }
    }
  }

  return issues.length === 0 ? 0 : 1;
}

async function commandLintDescriptors({ options, stdout }) {
  const packageRegistry = await loadPackageRegistry();
  const bundleRegistry = await loadBundleRegistry();
  const payload = {
    packageCount: packageRegistry.size,
    bundleCount: bundleRegistry.size,
    packages: sortStrings([...packageRegistry.keys()]),
    bundles: sortStrings([...bundleRegistry.keys()])
  };

  if (options.json) {
    stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    stdout.write(`Descriptor lint passed.\n`);
    stdout.write(`Packages: ${payload.packageCount}\n`);
    stdout.write(`Bundles: ${payload.bundleCount}\n`);
  }
  return 0;
}

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
      return await commandCreate({
        positional,
        options,
        cwd,
        io: { stdin, stdout, stderr }
      });
    }
    if (command === "list") {
      return await commandList({ positional, options, cwd, stdout });
    }
    if (command === "show") {
      return await commandShow({ positional, options, stdout });
    }
    if (command === "add") {
      return await commandAdd({
        positional,
        options,
        cwd,
        io: { stdin, stdout, stderr }
      });
    }
    if (command === "update") {
      return await commandUpdate({
        positional,
        options,
        cwd,
        io: { stdin, stdout, stderr }
      });
    }
    if (command === "remove") {
      return await commandRemove({
        positional,
        options,
        cwd,
        io: { stdin, stdout, stderr }
      });
    }
    if (command === "doctor") {
      return await commandDoctor({ cwd, options, stdout });
    }
    if (command === "lint-descriptors") {
      return await commandLintDescriptors({ options, stdout });
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
