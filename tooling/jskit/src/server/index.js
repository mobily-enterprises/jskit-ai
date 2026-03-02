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

const CLI_PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REPO_ROOT = path.resolve(CLI_PACKAGE_ROOT, "../..");
const MODULES_ROOT = path.join(REPO_ROOT, "packages");
const BUNDLES_ROOT = path.join(CLI_PACKAGE_ROOT, "bundles");
const LOCK_RELATIVE_PATH = ".jskit/lock.json";
const LOCK_VERSION = 1;
const OPTION_INTERPOLATION_PATTERN = /\$\{(?:option:)?([a-z][a-z0-9-]*)\}/gi;
const KNOWN_COMMANDS = new Set([
  "help",
  "list",
  "show",
  "view",
  "add",
  "update",
  "remove",
  "doctor",
  "lint-descriptors"
]);

function createCliError(message, { showUsage = false } = {}) {
  const error = new Error(String(message || "Unknown CLI error"));
  error.name = "CliError";
  error.showUsage = Boolean(showUsage);
  return error;
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
  stream.write("  list [bundles [all]|packages] List available bundles/packages and installed status\n");
  stream.write("  lint-descriptors             Validate bundle/package descriptor files\n");
  stream.write("  add bundle <bundleId>        Add one bundle (bundle is a package shortcut)\n");
  stream.write("  add package <packageId>      Add one package to current app\n");
  stream.write("  show <id>                    Show details for bundle id or package id\n");
  stream.write("  view <id>                    Alias of show <id>\n");
  stream.write("  update package <packageId>   Re-apply one installed package\n");
  stream.write("  remove package <packageId>   Remove one installed package\n");
  stream.write("  doctor                       Validate lockfile + managed files\n");
  stream.write("\n");
  stream.write("Options:\n");
  stream.write("  --dry-run                    Print planned changes only\n");
  stream.write("  --no-install                 Skip npm install during add/update/remove\n");
  stream.write("  --full                       Show bundle package ids (declared packages)\n");
  stream.write("  --expanded                   Show expanded/transitive package ids\n");
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

function readOptionAllowedValues(optionSchema) {
  return ensureArray(optionSchema?.values)
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function validateResolvedOptionValue({
  ownerType,
  ownerId,
  optionName,
  optionSchema,
  value
}) {
  const required = Boolean(optionSchema?.required);
  const resolvedValue = String(value || "").trim();

  if (required && !resolvedValue) {
    throw createCliError(`${ownerType} ${ownerId} requires option ${optionName}.`);
  }

  const allowedValues = readOptionAllowedValues(optionSchema);
  if (allowedValues.length > 0 && resolvedValue && !allowedValues.includes(resolvedValue)) {
    throw createCliError(
      `Invalid value for option ${optionName} in ${ownerType} ${ownerId}. Expected one of: ${allowedValues.join(", ")}`
    );
  }

  const patternSource = String(optionSchema?.pattern || "").trim();
  if (!patternSource || !resolvedValue) {
    return resolvedValue;
  }

  let pattern;
  try {
    pattern = new RegExp(patternSource);
  } catch {
    throw createCliError(`Invalid option pattern for ${ownerType} ${ownerId} option ${optionName}: ${patternSource}`);
  }

  if (!pattern.test(resolvedValue)) {
    const hint = String(optionSchema?.patternHint || "").trim();
    const hintSuffix = hint ? ` ${hint}` : "";
    throw createCliError(
      `Invalid value for option ${optionName} in ${ownerType} ${ownerId}.${hintSuffix}`.trim()
    );
  }

  return resolvedValue;
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

  const optionSchemas = ensureObject(normalized.options);
  for (const [optionName, rawSchema] of Object.entries(optionSchemas)) {
    const schema = ensureObject(rawSchema);

    if (schema.values != null && !Array.isArray(schema.values)) {
      throw createCliError(
        `Invalid package descriptor at ${descriptorPath}: option ${optionName} "values" must be an array when provided.`
      );
    }

    const patternSource = String(schema.pattern || "").trim();
    if (patternSource) {
      try {
        new RegExp(patternSource);
      } catch {
        throw createCliError(
          `Invalid package descriptor at ${descriptorPath}: option ${optionName} has invalid pattern ${patternSource}.`
        );
      }
    }
  }

  return normalized;
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

async function loadPackageRegistry() {
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

    registry.set(descriptor.packageId, {
      packageId: descriptor.packageId,
      version: descriptor.version,
      descriptor,
      rootDir: packageRoot,
      relativeDir: normalizeRelativePath(REPO_ROOT, packageRoot),
      descriptorRelativePath: normalizeRelativePath(REPO_ROOT, descriptorPath),
      packageJson
    });
  }

  return registry;
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

function createLocalPackageSpecifier(packageEntry) {
  return `file:node_modules/@jskit-ai/jskit/${packageEntry.relativeDir}`;
}

function resolvePackageIdInput(rawPackageId, { packageRegistry, installedPackageIds = [] } = {}) {
  const packageIdInput = String(rawPackageId || "").trim();
  if (!packageIdInput) {
    return "";
  }

  const availablePackageIds = new Set([
    ...sortStrings([...packageRegistry.keys()]),
    ...sortStrings(ensureArray(installedPackageIds).map((value) => String(value)))
  ]);

  if (availablePackageIds.has(packageIdInput)) {
    return packageIdInput;
  }

  const candidateIds = new Set();
  if (!packageIdInput.startsWith("@")) {
    const scopedCandidate = `@jskit-ai/${packageIdInput}`;
    if (availablePackageIds.has(scopedCandidate)) {
      candidateIds.add(scopedCandidate);
    }
  }

  for (const packageId of availablePackageIds) {
    if (packageId.endsWith(`/${packageIdInput}`)) {
      candidateIds.add(packageId);
    }
  }

  const matches = sortStrings([...candidateIds]);
  if (matches.length === 1) {
    return matches[0];
  }
  if (matches.length > 1) {
    throw createCliError(`Ambiguous package id "${packageIdInput}". Matches: ${matches.join(", ")}`);
  }

  return "";
}

function getDeclaredCapabilities(descriptor, fieldName) {
  return ensureArray(ensureObject(descriptor.capabilities)[fieldName])
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function validateCapabilityRequirementsForPackageSet({
  packageIds,
  packageRegistry,
  operationLabel = "install"
} = {}) {
  const plannedPackageIds = sortStrings([...new Set(ensureArray(packageIds).map((value) => String(value || "").trim()).filter(Boolean))]);
  const plannedEntries = plannedPackageIds
    .filter((packageId) => packageRegistry.has(packageId))
    .map((packageId) => packageRegistry.get(packageId));

  const providersByCapability = new Map();
  for (const packageEntry of plannedEntries) {
    for (const capabilityId of getDeclaredCapabilities(packageEntry.descriptor, "provides")) {
      if (!providersByCapability.has(capabilityId)) {
        providersByCapability.set(capabilityId, new Set());
      }
      providersByCapability.get(capabilityId).add(packageEntry.packageId);
    }
  }

  const missingByCapability = new Map();
  for (const packageEntry of plannedEntries) {
    for (const capabilityId of getDeclaredCapabilities(packageEntry.descriptor, "requires")) {
      const providers = providersByCapability.get(capabilityId);
      if (providers && providers.size > 0) {
        continue;
      }

      if (!missingByCapability.has(capabilityId)) {
        missingByCapability.set(capabilityId, new Set());
      }
      missingByCapability.get(capabilityId).add(packageEntry.packageId);
    }
  }

  if (missingByCapability.size < 1) {
    return;
  }

  const knownProviderPackagesByCapability = new Map();
  for (const packageEntry of packageRegistry.values()) {
    for (const capabilityId of getDeclaredCapabilities(packageEntry.descriptor, "provides")) {
      if (!knownProviderPackagesByCapability.has(capabilityId)) {
        knownProviderPackagesByCapability.set(capabilityId, new Set());
      }
      knownProviderPackagesByCapability.get(capabilityId).add(packageEntry.packageId);
    }
  }

  const lines = [`Cannot ${operationLabel}; capability requirements would be unmet:`];
  for (const capabilityId of sortStrings([...missingByCapability.keys()])) {
    const requiredBy = sortStrings([...missingByCapability.get(capabilityId)]);
    lines.push(`- ${capabilityId} (required by: ${requiredBy.join(", ")})`);

    const knownProviders = sortStrings([...(knownProviderPackagesByCapability.get(capabilityId) || new Set())]);
    if (knownProviders.length > 0) {
      lines.push(`  available providers: ${knownProviders.join(", ")}`);
    } else {
      lines.push("  available providers: none in current packages/");
    }
  }

  throw createCliError(lines.join("\n"));
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

async function resolvePackageOptions(packageEntry, inlineOptions, io) {
  const optionSchemas = ensureObject(packageEntry.descriptor.options);
  const optionNames = sortStrings(Object.keys(optionSchemas));
  const resolved = {};

  for (const optionName of optionNames) {
    const schema = ensureObject(optionSchemas[optionName]);
    const inlineValue = inlineOptions[optionName];
    if (typeof inlineValue === "string" && inlineValue.trim()) {
      resolved[optionName] = validateResolvedOptionValue({
        ownerType: "package",
        ownerId: packageEntry.packageId,
        optionName,
        optionSchema: schema,
        value: inlineValue
      });
      continue;
    }

    if (typeof schema.defaultValue === "string" && schema.defaultValue.trim()) {
      resolved[optionName] = validateResolvedOptionValue({
        ownerType: "package",
        ownerId: packageEntry.packageId,
        optionName,
        optionSchema: schema,
        value: schema.defaultValue
      });
      continue;
    }

    if (schema.required) {
      const promptedValue = await promptForRequiredOption({
        ownerType: "package",
        ownerId: packageEntry.packageId,
        optionName,
        optionSchema: schema,
        stdin: io.stdin,
        stdout: io.stdout
      });
      resolved[optionName] = validateResolvedOptionValue({
        ownerType: "package",
        ownerId: packageEntry.packageId,
        optionName,
        optionSchema: schema,
        value: promptedValue
      });
      continue;
    }

    resolved[optionName] = validateResolvedOptionValue({
      ownerType: "package",
      ownerId: packageEntry.packageId,
      optionName,
      optionSchema: schema,
      value: ""
    });
  }

  return resolved;
}

function createManagedRecordBase(packageEntry, options) {
  return {
    packageId: packageEntry.packageId,
    version: packageEntry.version,
    source: {
      type: "packages-directory",
      descriptorPath: packageEntry.descriptorRelativePath
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
    options,
    installedAt: new Date().toISOString()
  };
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
  const mutationDependencies = ensureObject(mutations.dependencies);
  const runtimeDependencies = ensureObject(mutationDependencies.runtime);
  const devDependencies = ensureObject(mutationDependencies.dev);
  const mutationScripts = ensureObject(ensureObject(mutations.packageJson).scripts);

  for (const [dependencyId, dependencyVersion] of Object.entries(runtimeDependencies)) {
    const localPackage = packageRegistry.get(dependencyId);
    const resolvedValue = localPackage ? createLocalPackageSpecifier(localPackage) : String(dependencyVersion);
    const applied = applyPackageJsonField(appPackageJson, "dependencies", dependencyId, resolvedValue);
    if (applied.changed) {
      managedRecord.managed.packageJson.dependencies[dependencyId] = applied.managed;
      touchedFiles.add("package.json");
    }
  }

  for (const [dependencyId, dependencyVersion] of Object.entries(devDependencies)) {
    const localPackage = packageRegistry.get(dependencyId);
    const resolvedValue = localPackage ? createLocalPackageSpecifier(localPackage) : String(dependencyVersion);
    const applied = applyPackageJsonField(appPackageJson, "devDependencies", dependencyId, resolvedValue);
    if (applied.changed) {
      managedRecord.managed.packageJson.devDependencies[dependencyId] = applied.managed;
      touchedFiles.add("package.json");
    }
  }

  const selfDependencyValue = createLocalPackageSpecifier(packageEntry);
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
    packageEntry,
    appRoot,
    ensureArray(mutations.files),
    managedRecord.managed.files,
    touchedFiles
  );

  await applyTextMutations(
    packageEntry,
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
  const { lock } = await loadLockFile(appRoot);
  const installedPackages = new Set(Object.keys(ensureObject(lock.installedPackages)));

  const mode = String(positional[0] || "").trim();
  const shouldListBundles = !mode || mode === "bundles";
  const shouldListPackages = !mode || mode === "packages";

  if (!shouldListBundles && !shouldListPackages) {
    throw createCliError(`Unknown list mode: ${mode}`, { showUsage: true });
  }

  const lines = [];
  if (shouldListBundles) {
    lines.push("Available bundles:");
    const bundleIds = sortStrings([...bundleRegistry.keys()]);
    for (const bundleId of bundleIds) {
      const bundle = bundleRegistry.get(bundleId);
      const packageIds = ensureArray(bundle.packages).map((value) => String(value));
      const isInstalled = packageIds.length > 0 && packageIds.every((packageId) => installedPackages.has(packageId));
      const providerLabel = Number(bundle.provider) === 1 ? " [provider]" : "";
      const installedLabel = isInstalled ? " (installed)" : "";
      lines.push(
        `- ${bundle.bundleId} (${bundle.version})${installedLabel}${providerLabel}: ${String(bundle.description || "")}`
      );
      if (options.full || options.expanded) {
        for (const packageId of packageIds) {
          lines.push(`  - ${packageId}`);
        }
      }
    }
  }

  if (shouldListPackages) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push("Available packages:");
    const packageIds = sortStrings([...packageRegistry.keys()]);
    for (const packageId of packageIds) {
      const packageEntry = packageRegistry.get(packageId);
      const installedLabel = installedPackages.has(packageId) ? " (installed)" : "";
      lines.push(`- ${packageId} (${packageEntry.version})${installedLabel}`);
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

  function writePackagePayload(packageEntry) {
    const descriptor = packageEntry.descriptor;
    const payload = {
      kind: "package",
      packageId: descriptor.packageId,
      version: descriptor.version,
      description: String(descriptor.description || ""),
      dependsOn: ensureArray(descriptor.dependsOn).map((value) => String(value)),
      capabilities: ensureObject(descriptor.capabilities),
      options: ensureObject(descriptor.options),
      runtime: ensureObject(descriptor.runtime),
      metadata: ensureObject(descriptor.metadata),
      descriptorPath: packageEntry.descriptorRelativePath
    };
    if (options.json) {
      stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      stdout.write(`Package: ${payload.packageId}\n`);
      stdout.write(`Version: ${payload.version}\n`);
      if (payload.description) {
        stdout.write(`Description: ${payload.description}\n`);
      }
      stdout.write(`Descriptor: ${payload.descriptorPath}\n`);
      stdout.write(`Depends on (${payload.dependsOn.length}):\n`);
      for (const dependencyId of payload.dependsOn) {
        stdout.write(`- ${dependencyId}\n`);
      }
      const optionNames = Object.keys(payload.options);
      stdout.write(`Options (${optionNames.length}):\n`);
      for (const optionName of optionNames) {
        const schema = ensureObject(payload.options[optionName]);
        const required = schema.required ? "required" : "optional";
        const defaultSuffix = schema.defaultValue ? ` (default: ${schema.defaultValue})` : "";
        stdout.write(`- ${optionName} [${required}]${defaultSuffix}\n`);
      }
    }
  }

  if (packageRegistry.has(id)) {
    writePackagePayload(packageRegistry.get(id));
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
      stdout.write(`Bundle: ${payload.bundleId}\n`);
      stdout.write(`Version: ${payload.version}\n`);
      if (payload.description) {
        stdout.write(`Description: ${payload.description}\n`);
      }
      stdout.write(`Packages (${payload.packages.length}):\n`);
      for (const packageId of payload.packages) {
        stdout.write(`- ${packageId}\n`);
      }
    }
    return 0;
  }

  const resolvedPackageId = resolvePackageIdInput(id, { packageRegistry });
  if (resolvedPackageId && packageRegistry.has(resolvedPackageId)) {
    writePackagePayload(packageRegistry.get(resolvedPackageId));
    return 0;
  }

  throw createCliError(`Unknown package or bundle: ${id}`);
}

async function commandAdd({ positional, options, cwd, io }) {
  const targetType = String(positional[0] || "").trim();
  const rawTargetId = String(positional[1] || "").trim();

  if (!targetType || !rawTargetId) {
    throw createCliError("add requires target type and id (add bundle <id> | add package <id>).", {
      showUsage: true
    });
  }
  if (targetType !== "bundle" && targetType !== "package") {
    throw createCliError(`Unsupported add target type: ${targetType}`, { showUsage: true });
  }

  const packageRegistry = await loadPackageRegistry();
  const bundleRegistry = await loadBundleRegistry();
  const appRoot = await resolveAppRootFromCwd(cwd);
  const { packageJsonPath, packageJson } = await loadAppPackageJson(appRoot);
  const { lockPath, lock } = await loadLockFile(appRoot);
  const targetId = targetType === "package"
    ? resolvePackageIdInput(rawTargetId, {
      packageRegistry,
      installedPackageIds: Object.keys(ensureObject(lock.installedPackages))
    })
    : rawTargetId;

  const targetPackageIds = targetType === "bundle"
    ? ensureArray(bundleRegistry.get(targetId)?.packages).map((value) => String(value))
    : [targetId];
  if (targetType === "bundle" && targetPackageIds.length === 0) {
    throw createCliError(`Unknown bundle: ${targetId}`);
  }
  if (targetType === "package" && !packageRegistry.has(targetId)) {
    throw createCliError(`Unknown package: ${targetId}`);
  }

  const { ordered: resolvedPackageIds, externalDependencies } = resolveLocalDependencyOrder(
    targetPackageIds,
    packageRegistry
  );
  validateCapabilityRequirementsForPackageSet({
    packageIds: [...Object.keys(ensureObject(lock.installedPackages)), ...resolvedPackageIds],
    packageRegistry,
    operationLabel: `${targetType} ${targetId}`
  });

  const resolvedOptionsByPackage = {};
  for (const packageId of resolvedPackageIds) {
    const packageEntry = packageRegistry.get(packageId);
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
    const packageEntry = packageRegistry.get(packageId);
    const managedRecord = await applyPackageInstall({
      packageEntry,
      packageOptions: resolvedOptionsByPackage[packageId],
      appRoot,
      appPackageJson: packageJson,
      lock,
      packageRegistry,
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
  const targetIdInput = String(positional[1] || "").trim();
  if (targetType !== "package" || !targetIdInput) {
    throw createCliError("update requires: update package <packageId>", { showUsage: true });
  }

  const packageRegistry = await loadPackageRegistry();
  const appRoot = await resolveAppRootFromCwd(cwd);
  const { lock } = await loadLockFile(appRoot);
  const installedPackageIds = Object.keys(ensureObject(lock.installedPackages));
  const targetId = resolvePackageIdInput(targetIdInput, {
    packageRegistry,
    installedPackageIds
  });
  if (!Object.prototype.hasOwnProperty.call(ensureObject(lock.installedPackages), targetId)) {
    throw createCliError(`Package is not installed: ${targetIdInput}`);
  }

  return commandAdd({
    positional: ["package", targetId],
    options,
    cwd,
    io
  });
}

async function commandRemove({ positional, options, cwd, io }) {
  const targetType = String(positional[0] || "").trim();
  const targetIdInput = String(positional[1] || "").trim();
  if (targetType !== "package" || !targetIdInput) {
    throw createCliError("remove requires: remove package <packageId>", { showUsage: true });
  }

  const packageRegistry = await loadPackageRegistry();
  const appRoot = await resolveAppRootFromCwd(cwd);
  const { packageJsonPath, packageJson } = await loadAppPackageJson(appRoot);
  const { lockPath, lock } = await loadLockFile(appRoot);
  const installed = ensureObject(lock.installedPackages);
  const targetId = resolvePackageIdInput(targetIdInput, {
    packageRegistry,
    installedPackageIds: Object.keys(installed)
  });

  if (!Object.prototype.hasOwnProperty.call(installed, targetId)) {
    throw createCliError(`Package is not installed: ${targetIdInput}`);
  }

  const dependents = getInstalledDependents(lock, targetId, packageRegistry);
  if (dependents.length > 0) {
    throw createCliError(
      `Cannot remove ${targetId}; installed packages depend on it: ${dependents.join(", ")}`
    );
  }

  const lockEntry = ensureObject(installed[targetId]);
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

  delete installed[targetId];
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
      removedPackage: targetId,
      touchedFiles: touchedFileList,
      lockPath: normalizeRelativePath(appRoot, lockPath),
      dryRun: options.dryRun
    }, null, 2)}\n`);
  } else {
    io.stdout.write(`Removed package ${targetId}.\n`);
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
  const issues = [];
  const installed = ensureObject(lock.installedPackages);

  for (const [packageId, lockEntryValue] of Object.entries(installed)) {
    const lockEntry = ensureObject(lockEntryValue);
    if (!packageRegistry.has(packageId)) {
      issues.push(`Installed package not found in packages/: ${packageId}`);
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

    if (command === "list") {
      return commandList({ positional, options, cwd, stdout });
    }
    if (command === "show") {
      return commandShow({ positional, options, stdout });
    }
    if (command === "add") {
      return commandAdd({
        positional,
        options,
        cwd,
        io: { stdin, stdout, stderr }
      });
    }
    if (command === "update") {
      return commandUpdate({
        positional,
        options,
        cwd,
        io: { stdin, stdout, stderr }
      });
    }
    if (command === "remove") {
      return commandRemove({
        positional,
        options,
        cwd,
        io: { stdin, stdout, stderr }
      });
    }
    if (command === "doctor") {
      return commandDoctor({ cwd, options, stdout });
    }
    if (command === "lint-descriptors") {
      return commandLintDescriptors({ options, stdout });
    }

    throw createCliError(`Unhandled command: ${command}`, { showUsage: true });
  } catch (error) {
    stderr.write(`jskit: ${error?.message || String(error)}\n`);
    if (error?.showUsage) {
      printUsage(stderr);
    }
    return 1;
  }
}

export { runCli };
