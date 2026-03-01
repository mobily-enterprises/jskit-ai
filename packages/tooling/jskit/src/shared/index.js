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
import { escapeRegExp } from "@jskit-ai/surface-routing";
import { createCliError, normalizeRelativePath } from "./schemas/validationHelpers.mjs";
import { ensureUniqueDescriptor } from "./schemas/descriptorRegistry.mjs";
import { normalizeBundleDescriptor } from "./schemas/bundleDescriptor.mjs";
import { normalizePackageDescriptor } from "./schemas/packageDescriptor.mjs";
import { validateCapabilityContracts } from "./capabilityContracts.mjs";
import { getCapabilityContract } from "../../contracts/capabilities/index.mjs";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BUNDLES_ROOT = path.join(PACKAGE_ROOT, "bundles");
const PACKAGE_DESCRIPTORS_ROOT = path.join(PACKAGE_ROOT, "packages");
const MONOREPO_PACKAGES_ROOT = path.resolve(PACKAGE_ROOT, "..", "..", "..", "packages");
const MONOREPO_ROOT = path.resolve(PACKAGE_ROOT, "..", "..", "..");
const JSKIT_LOCAL_PACKAGE_PREFIX = "file:node_modules/@jskit-ai/jskit/";
const EXTERNAL_JSKIT_DEPENDENCY_IDS = new Set([
  "@jskit-ai/app-scripts",
  "@jskit-ai/config-eslint",
  "@jskit-ai/create-app",
  "@jskit-ai/jskit"
]);
const LOCK_RELATIVE_PATH = ".jskit/lock.json";
const LOCK_VERSION = 3;
const OPTION_INTERPOLATION_PATTERN = /\$\{(?:option:)?([a-z][a-z0-9-]*)\}/gi;

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
  const allowedValues = Array.isArray(optionSchema?.values) ? optionSchema.values : [];
  const defaultValue = String(optionSchema?.defaultValue || "").trim();
  const promptLabel = String(optionSchema?.promptLabel || "").trim();
  const promptHint = String(optionSchema?.promptHint || "").trim();
  const required = Boolean(optionSchema?.required);

  if (!stdin?.isTTY || !stdout?.isTTY) {
    if (defaultValue) {
      return defaultValue;
    }
    if (required) {
      const valuesSuffix = allowedValues.length > 0 ? ` (${allowedValues.join(" | ")})` : "";
      throw createCliError(
        `${ownerType} ${ownerId} requires option ${optionName}. Non-interactive mode requires --${optionName} <value>${valuesSuffix}.`
      );
    }
    return "";
  }

  const label = promptLabel || `Select ${optionName} for ${ownerType} ${ownerId}`;
  const valuesHint = allowedValues.length > 0 ? ` (${allowedValues.join(" / ")})` : "";
  const defaultHint = defaultValue ? ` [default: ${defaultValue}]` : "";
  const hintSuffix = promptHint ? ` ${promptHint}` : "";
  const rl = createInterface({
    input: stdin,
    output: stdout
  });

  try {
    const answer = String(await rl.question(`${label}${valuesHint}${defaultHint}${hintSuffix}: `)).trim();
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
  const rawCommand = String(args.shift() || "help").trim() || "help";
  const command = rawCommand === "view" ? "show" : rawCommand === "ls" ? "list" : rawCommand;

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
  stream.write("  list [bundles [all]|packages] List available bundles/packages and installed status\n");
  stream.write("  lint-descriptors          Validate bundle/package descriptor files\n");
  stream.write("  add bundle <bundleId>     Add one bundle (bundle is a package shortcut)\n");
  stream.write("  add package <packageId>   Add one package to current app\n");
  stream.write("  show <id>                 Show details for bundle id or package id\n");
  stream.write("  view <id>                 Alias of show <id>\n");
  stream.write("  update package <packageId> Re-apply one installed package\n");
  stream.write("  remove package <packageId> Remove one installed package\n");
  stream.write("  doctor                    Validate lockfile + managed files\n");
  stream.write("\n");
  stream.write("Options:\n");
  stream.write("  --dry-run                 Print planned changes only\n");
  stream.write("  --no-install              Skip npm install during add/update\n");
  stream.write("  --full                    Show bundle package ids (declared packages)\n");
  stream.write("  --expanded                Show expanded/transitive package ids\n");
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

function parseTextLines(source) {
  return String(source || "")
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
}

function ensureTextWithTrailingNewline(lines) {
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

function findLineByKey(source, key) {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) {
    return null;
  }
  const pattern = new RegExp(`^\\s*${escapeRegExp(normalizedKey)}\\s*:\\s*(.*)$`);
  for (const line of parseTextLines(source)) {
    const match = line.match(pattern);
    if (match) {
      return `${normalizedKey}: ${String(match[1] || "").trim()}`;
    }
  }
  return null;
}

function upsertLineByKey(source, key, line) {
  const normalizedKey = String(key || "").trim();
  const normalizedLine = String(line || "").trim();
  if (!normalizedKey || !normalizedLine) {
    return String(source || "");
  }
  const lines = parseTextLines(source);
  const pattern = new RegExp(`^\\s*${escapeRegExp(normalizedKey)}\\s*:\\s*(.*)$`);
  let found = false;
  const updated = lines.map((line) => {
    if (pattern.test(line)) {
      found = true;
      return normalizedLine;
    }
    return line;
  });

  if (!found) {
    updated.push(normalizedLine);
  }

  return ensureTextWithTrailingNewline(updated);
}

function removeLineByKey(source, key) {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) {
    return String(source || "");
  }
  const pattern = new RegExp(`^\\s*${escapeRegExp(normalizedKey)}\\s*:\\s*(.*)$`);
  const lines = parseTextLines(source).filter((line) => !pattern.test(line));
  return ensureTextWithTrailingNewline(lines);
}

function hasExactLine(source, line) {
  const normalizedLine = String(line || "").trim();
  if (!normalizedLine) {
    return false;
  }
  return parseTextLines(source).includes(normalizedLine);
}

function appendLineOnce(source, line) {
  const normalizedLine = String(line || "").trim();
  if (!normalizedLine) {
    return String(source || "");
  }
  const lines = parseTextLines(source);
  if (lines.includes(normalizedLine)) {
    return ensureTextWithTrailingNewline(lines);
  }
  lines.push(normalizedLine);
  return ensureTextWithTrailingNewline(lines);
}

function removeExactLine(source, line) {
  const normalizedLine = String(line || "").trim();
  if (!normalizedLine) {
    return String(source || "");
  }
  const lines = parseTextLines(source).filter((entry) => entry !== normalizedLine);
  return ensureTextWithTrailingNewline(lines);
}

function parseEnvEntry(line) {
  const match = String(line || "").match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
  if (!match) {
    return null;
  }
  return {
    key: match[1],
    value: String(match[2] || "")
  };
}

function findEnvValue(source, key) {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) {
    return null;
  }
  for (const line of parseTextLines(source)) {
    const entry = parseEnvEntry(line);
    if (entry && entry.key === normalizedKey) {
      return entry.value;
    }
  }
  return null;
}

function upsertEnvValue(source, key, value) {
  const normalizedKey = String(key || "").trim();
  const normalizedValue = String(value || "").trim();
  if (!normalizedKey) {
    return String(source || "");
  }
  const replacement = `${normalizedKey}=${normalizedValue}`;
  const pattern = new RegExp(`^\\s*${escapeRegExp(normalizedKey)}\\s*=\\s*(.*)$`);
  const lines = parseTextLines(source);
  let found = false;
  const updated = lines.map((line) => {
    if (pattern.test(line)) {
      found = true;
      return replacement;
    }
    return line;
  });
  if (!found) {
    updated.push(replacement);
  }
  return ensureTextWithTrailingNewline(updated);
}

function removeEnvKey(source, key) {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) {
    return String(source || "");
  }
  const pattern = new RegExp(`^\\s*${escapeRegExp(normalizedKey)}\\s*=\\s*(.*)$`);
  const lines = parseTextLines(source).filter((line) => !pattern.test(line));
  return ensureTextWithTrailingNewline(lines);
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

function resolvePackageIdFromLookup(rawLookupId, availablePackages) {
  const lookupId = String(rawLookupId || "").trim();
  if (!lookupId) {
    return null;
  }

  if (availablePackages.has(lookupId)) {
    return lookupId;
  }

  if (lookupId.includes("/")) {
    return null;
  }

  const matches = [];
  for (const packageId of availablePackages.keys()) {
    const normalized = String(packageId || "").trim();
    const separatorIndex = normalized.lastIndexOf("/");
    const baseId = separatorIndex >= 0 ? normalized.slice(separatorIndex + 1) : normalized;
    if (baseId === lookupId) {
      matches.push(normalized);
    }
  }

  if (matches.length < 1) {
    return null;
  }
  if (matches.length > 1) {
    throw createCliError(
      `Ambiguous package identifier ${lookupId}. Matches: ${toSortedUniqueStrings(matches).join(", ")}.`
    );
  }
  return matches[0];
}

async function lintDescriptors({ appRoot }) {
  const bundles = await discoverAvailableBundles();
  const packages = await discoverAvailablePackages(appRoot);
  const contractValidation = await validateCapabilityContracts(packages);
  if (!contractValidation.ok) {
    throw createConflictError(
      "capability-contract",
      "Descriptor lint failed central capability-contract checks.",
      contractValidation.issues.map((message) => createIssue(message))
    );
  }
  return {
    command: "lint-descriptors",
    bundleCount: bundles.size,
    packageCount: packages.size,
    capabilityContractCount: contractValidation.contractCount
  };
}

function ensurePlainObjectRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function getManagedTextEntries(installedPackageState) {
  const managedText = ensurePlainObjectRecord(installedPackageState?.managed?.text);
  if (Object.keys(managedText).length > 0) {
    return managedText;
  }

  const legacyProcfile = ensurePlainObjectRecord(installedPackageState?.managed?.procfile);
  const legacyText = {};
  for (const [processType, meta] of Object.entries(legacyProcfile)) {
    const normalizedProcessType = String(processType || "").trim();
    if (!normalizedProcessType) {
      continue;
    }
    const currentCommand = String(meta?.value || "").trim();
    const previousCommand = String(meta?.previousValue || "").trim();
    legacyText[`Procfile::upsert-line::${normalizedProcessType}`] = {
      file: "Procfile",
      op: "upsert-line",
      key: normalizedProcessType,
      line: `${normalizedProcessType}: ${currentCommand}`,
      value: `${normalizedProcessType}: ${currentCommand}`,
      hadPrevious: Boolean(meta?.hadPrevious),
      previousValue: previousCommand ? `${normalizedProcessType}: ${previousCommand}` : "",
      reason: "",
      category: "procfile",
      id: `procfile.${normalizedProcessType}`
    };
  }
  return legacyText;
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

function normalizeToPosixPath(value) {
  return String(value || "").replaceAll("\\", "/");
}

function resolveLocalJskitDependencyTarget({ dependencyName, availablePackages }) {
  const dependencyId = String(dependencyName || "").trim();
  if (!dependencyId.startsWith("@jskit-ai/")) {
    return null;
  }
  if (EXTERNAL_JSKIT_DEPENDENCY_IDS.has(dependencyId)) {
    return null;
  }

  const packageEntry = availablePackages.get(dependencyId);
  if (!packageEntry) {
    return null;
  }

  const packageRoot = path.dirname(packageEntry.descriptorPath);
  const relativeFromMonorepoRoot = normalizeToPosixPath(path.relative(MONOREPO_ROOT, packageRoot));
  if (!relativeFromMonorepoRoot || relativeFromMonorepoRoot.startsWith("..")) {
    return null;
  }

  return `${JSKIT_LOCAL_PACKAGE_PREFIX}${relativeFromMonorepoRoot}`;
}

function resolveLocalJskitDependencySpec({ dependencyName, desiredValue, availablePackages }) {
  const desiredString = String(desiredValue || "").trim();
  if (
    desiredString.startsWith("file:") ||
    desiredString.startsWith("git+") ||
    desiredString.startsWith("github:") ||
    desiredString.startsWith("http://") ||
    desiredString.startsWith("https://")
  ) {
    return desiredString;
  }

  const localTarget = resolveLocalJskitDependencyTarget({
    dependencyName,
    availablePackages
  });
  return localTarget || desiredString;
}

function interpolateOptionValue(template, { selectedOptions, packageId, label }) {
  const rawTemplate = String(template || "");
  if (!rawTemplate.includes("${")) {
    return rawTemplate;
  }

  return rawTemplate.replace(OPTION_INTERPOLATION_PATTERN, (_, optionName) => {
    const normalizedOptionName = String(optionName || "").trim();
    const resolvedValue = String(selectedOptions?.[normalizedOptionName] || "").trim();
    if (!resolvedValue) {
      throw createCliError(
        `Package ${packageId} ${label} references option ${normalizedOptionName}, but no value was provided. Pass --${normalizedOptionName} <value> or run interactively.`
      );
    }
    return resolvedValue;
  });
}

function applyDefaultOptionInterpolation(template, defaultOptions) {
  const rawTemplate = String(template || "");
  if (!rawTemplate.includes("${")) {
    return rawTemplate;
  }
  const resolvedDefaults = defaultOptions && typeof defaultOptions === "object" ? defaultOptions : {};
  return rawTemplate.replace(OPTION_INTERPOLATION_PATTERN, (match, optionName) => {
    const normalizedOptionName = String(optionName || "").trim();
    const fallback = resolvedDefaults[normalizedOptionName];
    return fallback ? String(fallback) : match;
  });
}

function resolveTextMutationEntries({ packageDescriptor, selectedOptions, packageId }) {
  const entries = Array.isArray(packageDescriptor.mutations?.text) ? packageDescriptor.mutations.text : [];
  return entries.map((entry, index) => {
    const mutationLabel = `mutations.text[${index}]`;
    return {
      file: interpolateOptionValue(entry.file, {
        selectedOptions,
        packageId,
        label: `${mutationLabel}.file`
      }),
      op: String(entry.op || "").trim(),
      key: interpolateOptionValue(entry.key, {
        selectedOptions,
        packageId,
        label: `${mutationLabel}.key`
      }).trim(),
      line: interpolateOptionValue(entry.line, {
        selectedOptions,
        packageId,
        label: `${mutationLabel}.line`
      }).trim(),
      value: interpolateOptionValue(entry.value, {
        selectedOptions,
        packageId,
        label: `${mutationLabel}.value`
      }).trim(),
      reason: interpolateOptionValue(entry.reason, {
        selectedOptions,
        packageId,
        label: `${mutationLabel}.reason`
      }).trim(),
      category: interpolateOptionValue(entry.category, {
        selectedOptions,
        packageId,
        label: `${mutationLabel}.category`
      }).trim(),
      id: String(entry.id || "").trim()
    };
  });
}

function resolveFileMutationEntries({ packageDescriptor, selectedOptions, packageId }) {
  const entries = Array.isArray(packageDescriptor.mutations?.files) ? packageDescriptor.mutations.files : [];
  return entries.map((entry, index) => {
    const mutationLabel = `mutations.files[${index}]`;
    return {
      from: interpolateOptionValue(entry.from, {
        selectedOptions,
        packageId,
        label: `${mutationLabel}.from`
      }),
      to: interpolateOptionValue(entry.to, {
        selectedOptions,
        packageId,
        label: `${mutationLabel}.to`
      }),
      reason: interpolateOptionValue(entry.reason, {
        selectedOptions,
        packageId,
        label: `${mutationLabel}.reason`
      }).trim(),
      category: interpolateOptionValue(entry.category, {
        selectedOptions,
        packageId,
        label: `${mutationLabel}.category`
      }).trim(),
      id: String(entry.id || "").trim()
    };
  });
}

function interpolateStructuredValue(value, interpolationContext) {
  if (typeof value === "string") {
    return interpolateOptionValue(value, interpolationContext);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => interpolateStructuredValue(entry, interpolationContext));
  }
  if (value && typeof value === "object") {
    const next = {};
    for (const [key, child] of Object.entries(value)) {
      next[key] = interpolateStructuredValue(child, interpolationContext);
    }
    return next;
  }
  return value;
}

function toShellEntryTargetPath({ surface, slot, id, to }) {
  const explicit = normalizeRelativePath(String(to || "").trim() || `src/surfaces/${surface}/${slot}.d/${id}.entry.js`);
  return explicit;
}

function buildShellEntryModuleSource(entry) {
  const serializable = {
    id: entry.id,
    title: entry.title,
    route: entry.route,
    order: Number.isFinite(Number(entry.order)) ? Number(entry.order) : 100
  };
  if (entry.icon) {
    serializable.icon = entry.icon;
  }
  if (entry.group) {
    serializable.group = entry.group;
  }
  if (entry.description) {
    serializable.description = entry.description;
  }
  if (entry.guard && typeof entry.guard === "object" && !Array.isArray(entry.guard)) {
    serializable.guard = entry.guard;
  }
  return `export default Object.freeze(${JSON.stringify(serializable, null, 2)});\n`;
}

function resolveUiElementContributions({ packageDescriptor, selectedOptions, packageId }) {
  const uiElements = Array.isArray(packageDescriptor?.metadata?.ui?.elements)
    ? packageDescriptor.metadata.ui.elements
    : [];
  const resolvedElements = [];
  const fileMutations = [];
  const textMutations = [];
  const clientRoutes = [];

  for (const uiElement of uiElements) {
    const elementId = String(uiElement.id || "").trim();
    const interpolationContext = {
      selectedOptions,
      packageId,
      label: `metadata.ui.elements[${elementId || "element"}]`
    };
    const availabilityImport = uiElement?.availability?.import && typeof uiElement.availability.import === "object"
      ? {
          module: String(uiElement.availability.import.module || "").trim(),
          symbols: toSortedUniqueStrings(Array.isArray(uiElement.availability.import.symbols) ? uiElement.availability.import.symbols : [])
        }
      : null;

    const resolvedClientRoutes = [];
    for (const routeEntry of uiElement?.contributions?.clientRoutes || []) {
      const resolvedRoute = {
        path: interpolateOptionValue(routeEntry.path, { ...interpolationContext, label: `${interpolationContext.label}.clientRoutes.path` }),
        surface: interpolateOptionValue(routeEntry.surface, {
          ...interpolationContext,
          label: `${interpolationContext.label}.clientRoutes.surface`
        }).trim(),
        name: interpolateOptionValue(routeEntry.name, {
          ...interpolationContext,
          label: `${interpolationContext.label}.clientRoutes.name`
        }).trim(),
        purpose: interpolateOptionValue(routeEntry.purpose, {
          ...interpolationContext,
          label: `${interpolationContext.label}.clientRoutes.purpose`
        }).trim()
      };
      resolvedClientRoutes.push(resolvedRoute);
      clientRoutes.push(resolvedRoute);
    }

    const resolvedShellEntries = [];
    for (const shellEntry of uiElement?.contributions?.shellEntries || []) {
      const resolvedShellEntry = {
        surface: interpolateOptionValue(shellEntry.surface, {
          ...interpolationContext,
          label: `${interpolationContext.label}.shellEntries.surface`
        })
          .trim()
          .toLowerCase(),
        slot: interpolateOptionValue(shellEntry.slot, {
          ...interpolationContext,
          label: `${interpolationContext.label}.shellEntries.slot`
        })
          .trim()
          .toLowerCase(),
        id: interpolateOptionValue(shellEntry.id, {
          ...interpolationContext,
          label: `${interpolationContext.label}.shellEntries.id`
        }).trim(),
        title: interpolateOptionValue(shellEntry.title, {
          ...interpolationContext,
          label: `${interpolationContext.label}.shellEntries.title`
        }).trim(),
        route: interpolateOptionValue(shellEntry.route, {
          ...interpolationContext,
          label: `${interpolationContext.label}.shellEntries.route`
        }).trim(),
        icon: interpolateOptionValue(shellEntry.icon, {
          ...interpolationContext,
          label: `${interpolationContext.label}.shellEntries.icon`
        }).trim(),
        group: interpolateOptionValue(shellEntry.group, {
          ...interpolationContext,
          label: `${interpolationContext.label}.shellEntries.group`
        }).trim(),
        description: interpolateOptionValue(shellEntry.description, {
          ...interpolationContext,
          label: `${interpolationContext.label}.shellEntries.description`
        }).trim(),
        order: Number.isFinite(Number(shellEntry.order)) ? Number(shellEntry.order) : 100,
        to: interpolateOptionValue(shellEntry.to || "", {
          ...interpolationContext,
          label: `${interpolationContext.label}.shellEntries.to`
        }).trim(),
        guard: interpolateStructuredValue(shellEntry.guard, interpolationContext)
      };
      resolvedShellEntries.push(resolvedShellEntry);

      fileMutations.push({
        from: "",
        to: toShellEntryTargetPath(resolvedShellEntry),
        reason: `Materialize shell entry ${resolvedShellEntry.id} from ${packageId} element ${elementId}.`,
        category: "ui-shell",
        id: `${elementId || "element"}.shell-entry.${resolvedShellEntry.id}`,
        content: buildShellEntryModuleSource(resolvedShellEntry)
      });
    }

    const resolvedFileMutations = [];
    for (const fileEntry of uiElement?.contributions?.files || []) {
      const resolvedFileEntry = {
        from: interpolateOptionValue(fileEntry.from, {
          ...interpolationContext,
          label: `${interpolationContext.label}.files.from`
        }),
        to: interpolateOptionValue(fileEntry.to, {
          ...interpolationContext,
          label: `${interpolationContext.label}.files.to`
        }),
        reason: interpolateOptionValue(fileEntry.reason, {
          ...interpolationContext,
          label: `${interpolationContext.label}.files.reason`
        }).trim(),
        category: interpolateOptionValue(fileEntry.category, {
          ...interpolationContext,
          label: `${interpolationContext.label}.files.category`
        }).trim(),
        id: interpolateOptionValue(fileEntry.id, {
          ...interpolationContext,
          label: `${interpolationContext.label}.files.id`
        }).trim()
      };
      resolvedFileMutations.push(resolvedFileEntry);
      fileMutations.push(resolvedFileEntry);
    }

    const resolvedTextMutations = [];
    for (const textEntry of uiElement?.contributions?.text || []) {
      const resolvedTextEntry = {
        file: interpolateOptionValue(textEntry.file, {
          ...interpolationContext,
          label: `${interpolationContext.label}.text.file`
        }),
        op: String(textEntry.op || "").trim(),
        key: interpolateOptionValue(textEntry.key, {
          ...interpolationContext,
          label: `${interpolationContext.label}.text.key`
        }).trim(),
        line: interpolateOptionValue(textEntry.line, {
          ...interpolationContext,
          label: `${interpolationContext.label}.text.line`
        }).trim(),
        value: interpolateOptionValue(textEntry.value, {
          ...interpolationContext,
          label: `${interpolationContext.label}.text.value`
        }).trim(),
        reason: interpolateOptionValue(textEntry.reason, {
          ...interpolationContext,
          label: `${interpolationContext.label}.text.reason`
        }).trim(),
        category: interpolateOptionValue(textEntry.category, {
          ...interpolationContext,
          label: `${interpolationContext.label}.text.category`
        }).trim(),
        id: interpolateOptionValue(textEntry.id, {
          ...interpolationContext,
          label: `${interpolationContext.label}.text.id`
        }).trim()
      };
      resolvedTextMutations.push(resolvedTextEntry);
      textMutations.push(resolvedTextEntry);
    }

    resolvedElements.push({
      packageId,
      elementId,
      name: String(uiElement.name || "").trim(),
      capability: String(uiElement.capability || "").trim(),
      purpose: String(uiElement.purpose || "").trim(),
      surface: String(uiElement.surface || "").trim(),
      availabilityImport,
      pathOptions: Array.isArray(uiElement.pathOptions) ? uiElement.pathOptions : [],
      clientRoutes: resolvedClientRoutes,
      shellEntries: resolvedShellEntries,
      files: resolvedFileMutations,
      text: resolvedTextMutations
    });
  }

  return {
    elements: resolvedElements,
    fileMutations,
    textMutations,
    clientRoutes
  };
}

function buildPackageJsonMutationPlan({ packageJson, packageDescriptor, lock, packageId, availablePackages }) {
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
      let desiredString = String(desiredValue);
      if (section.packageJsonKey === "dependencies" || section.packageJsonKey === "devDependencies") {
        desiredString = resolveLocalJskitDependencySpec({
          dependencyName: name,
          desiredValue: desiredString,
          availablePackages
        });
      }
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

function buildTextMutationHandle(entry, index) {
  const id = String(entry.id || "").trim();
  if (id) {
    return `${entry.file}::id::${id}`;
  }
  const op = String(entry.op || "").trim();
  const key = String(entry.key || "").trim();
  const line = String(entry.line || "").trim();
  if ((op === "upsert-line" || op === "upsert-env") && key) {
    return `${entry.file}::${op}::${key}`;
  }
  if (op === "append-once" && key) {
    return `${entry.file}::${op}::${key}`;
  }
  return `${entry.file}::${op}::${hashString(`${line}:${String(index)}`)}`;
}

function getTextMutationValueFromSource(source, entry) {
  const op = String(entry.op || "").trim();
  if (op === "upsert-line") {
    return findLineByKey(source, entry.key);
  }
  if (op === "append-once") {
    return hasExactLine(source, entry.line) ? String(entry.line || "").trim() : null;
  }
  if (op === "upsert-env") {
    return findEnvValue(source, entry.key);
  }
  return null;
}

function applyTextMutationToSource(source, entry) {
  const op = String(entry.op || "").trim();
  if (op === "upsert-line") {
    return upsertLineByKey(source, entry.key, entry.line);
  }
  if (op === "append-once") {
    return appendLineOnce(source, entry.line);
  }
  if (op === "upsert-env") {
    return upsertEnvValue(source, entry.key, entry.value);
  }
  throw createCliError(`Unsupported text mutation op: ${op}`);
}

function removeTextMutationFromSource(source, entry) {
  const op = String(entry.op || "").trim();
  if (op === "upsert-line") {
    return removeLineByKey(source, entry.key);
  }
  if (op === "append-once") {
    return removeExactLine(source, entry.line);
  }
  if (op === "upsert-env") {
    return removeEnvKey(source, entry.key);
  }
  throw createCliError(`Unsupported text mutation op: ${op}`);
}

function reapplyTextMutationPreviousValue(source, entry, previousValue) {
  const op = String(entry.op || "").trim();
  const normalizedPreviousValue = String(previousValue || "");
  if (op === "upsert-line") {
    return upsertLineByKey(source, entry.key, normalizedPreviousValue);
  }
  if (op === "append-once") {
    return appendLineOnce(source, normalizedPreviousValue);
  }
  if (op === "upsert-env") {
    return upsertEnvValue(source, entry.key, normalizedPreviousValue);
  }
  throw createCliError(`Unsupported text mutation op: ${op}`);
}

async function loadTextMutationSourceMap(appRoot, textMutations) {
  const sourceMap = new Map();
  for (const entry of textMutations) {
    const relativePath = normalizeRelativePath(entry.file);
    if (sourceMap.has(relativePath)) {
      continue;
    }
    const absolutePath = path.join(appRoot, relativePath);
    if (!(await fileExists(absolutePath))) {
      sourceMap.set(relativePath, "");
      continue;
    }
    sourceMap.set(relativePath, await readFile(absolutePath, "utf8"));
  }
  return sourceMap;
}

async function buildTextMutationPlan({
  appRoot,
  textMutations,
  lock,
  packageId
}) {
  const previousState = getInstalledPackageState(lock, packageId);
  const previousManagedText = ensurePlainObjectRecord(previousState?.managed?.text);
  const sourceMap = await loadTextMutationSourceMap(appRoot, textMutations);
  const baseSourceMap = new Map(sourceMap);
  const changedFiles = new Set();
  const managed = {};
  const conflicts = [];

  for (const [index, rawEntry] of textMutations.entries()) {
    const entry = {
      ...rawEntry,
      file: normalizeRelativePath(rawEntry.file)
    };
    const handle = buildTextMutationHandle(entry, index);
    const currentSource = String(sourceMap.get(entry.file) || "");
    const currentValue = getTextMutationValueFromSource(currentSource, entry);
    const desiredValue = entry.op === "upsert-env" ? String(entry.value || "").trim() : String(entry.line || "").trim();
    const previousManagedEntry = previousManagedText[handle] || null;

    if (previousManagedEntry && currentValue !== String(previousManagedEntry.value || "")) {
      conflicts.push(
        createIssue(
          `Cannot apply text mutation ${entry.file} (${entry.op}): value changed since install (expected ${previousManagedEntry.value}, found ${currentValue ?? "<missing>"}).`
        )
      );
      continue;
    }

    const otherPackageManager = isManagedByOtherPackage(lock, packageId, (state) => {
      const managedText = ensurePlainObjectRecord(state?.managed?.text);
      const otherEntry = managedText[handle];
      return Boolean(otherEntry && String(otherEntry.value || "") === desiredValue);
    });

    const hadPrevious = previousManagedEntry
      ? Boolean(previousManagedEntry.hadPrevious)
      : otherPackageManager
        ? false
        : currentValue !== null;
    const previousValue = previousManagedEntry
      ? String(previousManagedEntry.previousValue || "")
      : hadPrevious && currentValue !== null
        ? String(currentValue)
        : "";

    const nextSource = applyTextMutationToSource(currentSource, entry);
    const nextValue = getTextMutationValueFromSource(nextSource, entry);
    if (nextSource !== currentSource) {
      changedFiles.add(entry.file);
      sourceMap.set(entry.file, nextSource);
    }

    managed[handle] = {
      file: entry.file,
      op: entry.op,
      key: entry.key,
      line: entry.line,
      value: nextValue !== null ? String(nextValue) : desiredValue,
      hadPrevious,
      previousValue: hadPrevious ? previousValue : "",
      reason: String(entry.reason || ""),
      category: String(entry.category || ""),
      id: String(entry.id || "")
    };
  }

  return {
    sourceMap,
    baseSourceMap,
    changedFiles: toSortedUniqueStrings([...changedFiles]),
    changed: changedFiles.size > 0,
    managed,
    conflicts
  };
}

async function applyTextMutationPlan({ appRoot, plan, dryRun, transaction }) {
  for (const relativePath of plan.changedFiles || []) {
    const absolutePath = path.join(appRoot, normalizeRelativePath(relativePath));
    const source = String(plan.sourceMap.get(relativePath) || "");
    if (!dryRun) {
      await writeTextFileWithTransaction(transaction, absolutePath, source);
    }
  }
}

async function buildFileMutationPlan({ appRoot, fileMutations, packageRoot, lock, packageId, mode }) {
  const previousState = getInstalledPackageState(lock, packageId);
  const previousManagedFiles = new Map(
    (Array.isArray(previousState?.managed?.files) ? previousState.managed.files : []).map((entry) => [entry.path, entry])
  );

  const conflicts = [];
  const operations = [];

  for (const fileEntry of fileMutations) {
    const relativeTargetPath = normalizeRelativePath(fileEntry.to);
    const targetPath = path.join(appRoot, relativeTargetPath);
    const inlineContent = typeof fileEntry.content === "string" ? fileEntry.content : null;
    const sourcePath = inlineContent === null ? path.join(packageRoot, normalizeRelativePath(fileEntry.from)) : "";
    const sourceContent = inlineContent === null ? await readFile(sourcePath, "utf8") : inlineContent;
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
      inlineContent,
      shouldWrite,
      created: createdByPackage,
      reason: String(fileEntry.reason || "").trim(),
      category: String(fileEntry.category || "").trim(),
      id: String(fileEntry.id || "").trim()
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
      if (typeof operation.inlineContent === "string") {
        await writeTextFileWithTransaction(transaction, operation.targetPath, operation.inlineContent);
      } else {
        await copyFileWithTransaction(transaction, operation.sourcePath, operation.targetPath);
      }
    }

    managedFiles.push({
      path: operation.relativeTargetPath,
      hash: operation.sourceHash,
      created: operation.created,
      reason: String(operation.reason || ""),
      category: String(operation.category || ""),
      id: String(operation.id || "")
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

  const providerOptionsByFamily = (() => {
    const index = new Map();
    for (const packageEntry of availablePackages.values()) {
      for (const capabilityId of packageEntry.descriptor.capabilities.provides) {
        const family = getProviderFamilyFromOptionCapability(capabilityId);
        if (!family) {
          continue;
        }
        const option = capabilityId.slice(family.length + 1).trim();
        if (!option) {
          continue;
        }
        if (!index.has(family)) {
          index.set(family, new Set());
        }
        index.get(family).add(option);
      }
    }
    return index;
  })();
  const providerPackagesByCapability = (() => {
    const index = new Map();
    for (const packageEntry of availablePackages.values()) {
      const packageId = packageEntry.descriptor.packageId;
      for (const capabilityId of packageEntry.descriptor.capabilities.provides) {
        if (!index.has(capabilityId)) {
          index.set(capabilityId, new Set());
        }
        index.get(capabilityId).add(packageId);
      }
    }
    return index;
  })();

  function isProviderCapability(capabilityId) {
    const normalized = String(capabilityId || "").trim();
    if (!normalized) {
      return false;
    }
    if (normalized === "db-provider") {
      return true;
    }
    if (normalized.endsWith(".provider")) {
      return true;
    }
    if (normalized.includes(".provider.")) {
      return true;
    }
    return false;
  }

  function isProviderPackage(packageEntry) {
    if (!packageEntry) {
      return false;
    }
    return (packageEntry.descriptor.capabilities.provides || []).some((capabilityId) =>
      isProviderCapability(capabilityId)
    );
  }

  function resolveProviderRequirementHints(requiredCapabilities) {
    const hints = [];
    for (const capabilityId of requiredCapabilities) {
      const options = providerOptionsByFamily.get(capabilityId);
      if (options && options.size > 0) {
        const label = toSortedUniqueStrings([...options]).join("|");
        if (label) {
          hints.push(label);
        }
        continue;
      }

      const providers = providerPackagesByCapability.get(capabilityId);
      if (providers && providers.size > 1) {
        hints.push(capabilityId);
      }
    }
    return toSortedUniqueStrings(hints);
  }

  function buildPackageExplanation(packageId) {
    const packageEntry = availablePackages.get(packageId);
    if (!packageEntry) {
      return "No package description.";
    }

    const explicitDescription = String(packageEntry.descriptor.description || "").trim();
    if (explicitDescription.length > 0) {
      return explicitDescription;
    }

    const provided = toSortedUniqueStrings(packageEntry.descriptor.capabilities.provides || []);
    if (provided.length > 0) {
      const preview = provided.slice(0, 3).join(", ");
      return provided.length > 3 ? `Capabilities: ${preview}, ...` : `Capabilities: ${preview}.`;
    }

    const required = toSortedUniqueStrings(packageEntry.descriptor.capabilities.requires || []);
    if (required.length > 0) {
      const preview = required.slice(0, 3).join(", ");
      return required.length > 3 ? `Requires: ${preview}, ...` : `Requires: ${preview}.`;
    }

    return "No package description.";
  }

  function buildPackageEntry(packageId) {
    const packageEntry = availablePackages.get(packageId);
    const providerRequirementHints = resolveProviderRequirementHints(
      packageEntry?.descriptor?.capabilities?.requires || []
    );
    return {
      packageId,
      provider: isProviderPackage(packageEntry),
      providerRequirementHints,
      description: buildPackageExplanation(packageId)
    };
  }

  return {
    packageCount: uniqueRootPackageIds.length,
    packages: uniqueRootPackageIds,
    packageEntries: uniqueRootPackageIds.map((packageId) => buildPackageEntry(packageId)),
    expandedPackageCount: resolvedPackageIds.length,
    expandedPackages: resolvedPackageIds,
    expandedPackageEntries: resolvedPackageIds.map((packageId) => buildPackageEntry(packageId)),
    providerRequirementHints: resolveProviderRequirementHints(
      [...requiredCapabilities].filter((capabilityId) => !providedCapabilities.has(capabilityId))
    ),
    requiredCapabilities: [...requiredCapabilities].sort((left, right) => left.localeCompare(right)),
    providedCapabilities: [...providedCapabilities].sort((left, right) => left.localeCompare(right))
  };
}

function summarizeCapabilities(capabilityIds) {
  return toSortedUniqueStrings(Array.isArray(capabilityIds) ? capabilityIds : []);
}

function buildCapabilitySetsForPackages(packageIds, availablePackages) {
  const requiredCapabilities = new Set();
  const providedCapabilities = new Set();

  for (const packageId of toSortedUniqueStrings(Array.isArray(packageIds) ? packageIds : [])) {
    const packageEntry = availablePackages.get(packageId);
    if (!packageEntry) {
      continue;
    }
    for (const capabilityId of packageEntry.descriptor.capabilities.requires || []) {
      requiredCapabilities.add(capabilityId);
    }
    for (const capabilityId of packageEntry.descriptor.capabilities.provides || []) {
      providedCapabilities.add(capabilityId);
    }
  }

  return {
    requiredCapabilities: toSortedUniqueStrings([...requiredCapabilities]),
    providedCapabilities: toSortedUniqueStrings([...providedCapabilities])
  };
}

function buildFileContributionDetails(packageIds, availablePackages) {
  const contributions = [];
  for (const packageId of toSortedUniqueStrings(Array.isArray(packageIds) ? packageIds : [])) {
    const packageEntry = availablePackages.get(packageId);
    if (!packageEntry) {
      continue;
    }

    for (const fileEntry of packageEntry.descriptor.mutations.files || []) {
      contributions.push({
        packageId,
        from: fileEntry.from,
        to: fileEntry.to,
        reason: String(fileEntry.reason || "").trim(),
        category: String(fileEntry.category || "").trim(),
        id: String(fileEntry.id || "").trim()
      });
    }

    for (const uiElement of packageEntry.descriptor.metadata?.ui?.elements || []) {
      const defaultOptions = {};
      for (const pathOption of uiElement.pathOptions || []) {
        const optionName = String(pathOption.option || "").trim();
        const defaultValue = String(pathOption.defaultValue || "").trim();
        if (optionName && defaultValue) {
          defaultOptions[optionName] = defaultValue;
        }
      }
      for (const fileEntry of uiElement?.contributions?.files || []) {
        contributions.push({
          packageId,
          from: fileEntry.from,
          to: fileEntry.to,
          resolvedTo: applyDefaultOptionInterpolation(fileEntry.to, defaultOptions),
          reason: String(fileEntry.reason || "").trim(),
          category: String(fileEntry.category || "").trim() || "ui-element",
          id: String(fileEntry.id || "").trim(),
          elementId: String(uiElement.id || "").trim()
        });
      }
      for (const shellEntry of uiElement?.contributions?.shellEntries || []) {
        contributions.push({
          packageId,
          from: "<generated-shell-entry>",
          to: toShellEntryTargetPath({
            surface: String(shellEntry.surface || "").trim(),
            slot: String(shellEntry.slot || "").trim(),
            id: String(shellEntry.id || "").trim(),
            to: String(shellEntry.to || "").trim()
          }),
          reason: `Materialize shell entry ${String(shellEntry.id || "").trim()} for ${String(uiElement.id || "").trim()}.`,
          category: "ui-shell",
          id: `${String(uiElement.id || "").trim()}.shell-entry.${String(shellEntry.id || "").trim()}`,
          elementId: String(uiElement.id || "").trim()
        });
      }
    }
  }

  return contributions.sort((left, right) => {
    const toDiff = String(left.to || "").localeCompare(String(right.to || ""));
    if (toDiff !== 0) {
      return toDiff;
    }
    return String(left.packageId || "").localeCompare(String(right.packageId || ""));
  });
}

function buildTextMutationDetails(packageIds, availablePackages) {
  const mutations = [];
  for (const packageId of toSortedUniqueStrings(Array.isArray(packageIds) ? packageIds : [])) {
    const packageEntry = availablePackages.get(packageId);
    if (!packageEntry) {
      continue;
    }
    for (const mutation of packageEntry.descriptor.mutations.text || []) {
      mutations.push({
        packageId,
        file: String(mutation.file || "").trim(),
        op: String(mutation.op || "").trim(),
        key: String(mutation.key || "").trim(),
        line: String(mutation.line || "").trim(),
        value: String(mutation.value || "").trim(),
        reason: String(mutation.reason || "").trim(),
        category: String(mutation.category || "").trim(),
        id: String(mutation.id || "").trim()
      });
    }

    for (const uiElement of packageEntry.descriptor.metadata?.ui?.elements || []) {
      for (const mutation of uiElement?.contributions?.text || []) {
        mutations.push({
          packageId,
          file: String(mutation.file || "").trim(),
          op: String(mutation.op || "").trim(),
          key: String(mutation.key || "").trim(),
          line: String(mutation.line || "").trim(),
          value: String(mutation.value || "").trim(),
          reason: String(mutation.reason || "").trim(),
          category: String(mutation.category || "").trim() || "ui-element",
          id: String(mutation.id || "").trim(),
          elementId: String(uiElement.id || "").trim()
        });
      }
    }
  }

  return mutations.sort((left, right) => {
    const fileDiff = String(left.file || "").localeCompare(String(right.file || ""));
    if (fileDiff !== 0) {
      return fileDiff;
    }
    const opDiff = String(left.op || "").localeCompare(String(right.op || ""));
    if (opDiff !== 0) {
      return opDiff;
    }
    return String(left.packageId || "").localeCompare(String(right.packageId || ""));
  });
}

function buildPackageJsonMutationDetails(packageIds, availablePackages) {
  const details = [];
  for (const packageId of toSortedUniqueStrings(Array.isArray(packageIds) ? packageIds : [])) {
    const packageEntry = availablePackages.get(packageId);
    if (!packageEntry) {
      continue;
    }
    const runtimeDependencies = ensurePlainObjectRecord(packageEntry.descriptor.mutations?.dependencies?.runtime);
    const devDependencies = ensurePlainObjectRecord(packageEntry.descriptor.mutations?.dependencies?.dev);
    const scripts = ensurePlainObjectRecord(packageEntry.descriptor.mutations?.packageJson?.scripts);
    for (const [dependencyName, versionSpec] of Object.entries(runtimeDependencies)) {
      details.push({
        packageId,
        section: "dependencies",
        key: dependencyName,
        value: String(versionSpec || "").trim()
      });
    }
    for (const [dependencyName, versionSpec] of Object.entries(devDependencies)) {
      details.push({
        packageId,
        section: "devDependencies",
        key: dependencyName,
        value: String(versionSpec || "").trim()
      });
    }
    for (const [scriptName, command] of Object.entries(scripts)) {
      details.push({
        packageId,
        section: "scripts",
        key: scriptName,
        value: String(command || "").trim()
      });
    }
  }

  return details.sort((left, right) => {
    const sectionDiff = String(left.section || "").localeCompare(String(right.section || ""));
    if (sectionDiff !== 0) {
      return sectionDiff;
    }
    const keyDiff = String(left.key || "").localeCompare(String(right.key || ""));
    if (keyDiff !== 0) {
      return keyDiff;
    }
    return String(left.packageId || "").localeCompare(String(right.packageId || ""));
  });
}

function buildUiElementDetails(packageIds, availablePackages) {
  const elements = [];
  for (const packageId of toSortedUniqueStrings(Array.isArray(packageIds) ? packageIds : [])) {
    const packageEntry = availablePackages.get(packageId);
    if (!packageEntry) {
      continue;
    }
    for (const uiElement of packageEntry.descriptor.metadata?.ui?.elements || []) {
      elements.push({
        packageId,
        id: String(uiElement.id || "").trim(),
        capability: String(uiElement.capability || "").trim(),
        name: String(uiElement.name || "").trim(),
        purpose: String(uiElement.purpose || "").trim() || "UI element contribution.",
        surface: String(uiElement.surface || "").trim(),
        availabilityImport:
          uiElement?.availability?.import && typeof uiElement.availability.import === "object"
            ? {
                module: String(uiElement.availability.import.module || "").trim(),
                symbols: toSortedUniqueStrings(Array.isArray(uiElement.availability.import.symbols) ? uiElement.availability.import.symbols : [])
              }
            : null
      });
    }
  }

  return elements.sort((left, right) => {
    const nameDiff = String(left.name || "").localeCompare(String(right.name || ""));
    if (nameDiff !== 0) {
      return nameDiff;
    }
    return String(left.packageId || "").localeCompare(String(right.packageId || ""));
  });
}

function buildUiRouteDetails(packageIds, availablePackages) {
  const routes = [];
  for (const packageId of toSortedUniqueStrings(Array.isArray(packageIds) ? packageIds : [])) {
    const packageEntry = availablePackages.get(packageId);
    if (!packageEntry) {
      continue;
    }
    for (const route of packageEntry.descriptor.metadata?.ui?.routes || []) {
      routes.push({
        packageId,
        path: String(route.path || "").trim(),
        name: String(route.name || "").trim(),
        surface: String(route.surface || "").trim(),
        purpose: String(route.purpose || "").trim()
      });
    }
    for (const uiElement of packageEntry.descriptor.metadata?.ui?.elements || []) {
      const defaultOptions = {};
      for (const pathOption of uiElement.pathOptions || []) {
        const optionName = String(pathOption.option || "").trim();
        const defaultValue = String(pathOption.defaultValue || "").trim();
        if (optionName && defaultValue) {
          defaultOptions[optionName] = defaultValue;
        }
      }
      for (const route of uiElement?.contributions?.clientRoutes || []) {
        routes.push({
          packageId,
          path: String(route.path || "").trim(),
          resolvedPath: applyDefaultOptionInterpolation(String(route.path || "").trim(), defaultOptions),
          name: String(route.name || "").trim(),
          surface: String(route.surface || "").trim(),
          purpose: String(route.purpose || "").trim(),
          elementId: String(uiElement.id || "").trim()
        });
      }
    }
  }

  return routes.sort((left, right) => {
    const pathDiff = String(left.path || "").localeCompare(String(right.path || ""));
    if (pathDiff !== 0) {
      return pathDiff;
    }
    return String(left.packageId || "").localeCompare(String(right.packageId || ""));
  });
}

function buildShellEntryContributionDetails(packageIds, availablePackages) {
  const entries = [];
  for (const packageId of toSortedUniqueStrings(Array.isArray(packageIds) ? packageIds : [])) {
    const packageEntry = availablePackages.get(packageId);
    if (!packageEntry) {
      continue;
    }
    for (const uiElement of packageEntry.descriptor.metadata?.ui?.elements || []) {
      const defaultOptions = {};
      for (const pathOption of uiElement.pathOptions || []) {
        const optionName = String(pathOption.option || "").trim();
        const defaultValue = String(pathOption.defaultValue || "").trim();
        if (optionName && defaultValue) {
          defaultOptions[optionName] = defaultValue;
        }
      }
      for (const shellEntry of uiElement?.contributions?.shellEntries || []) {
        const route = String(shellEntry.route || "").trim();
        entries.push({
          packageId,
          elementId: String(uiElement.id || "").trim(),
          surface: String(shellEntry.surface || "").trim(),
          slot: String(shellEntry.slot || "").trim(),
          id: String(shellEntry.id || "").trim(),
          title: String(shellEntry.title || "").trim(),
          route,
          resolvedRoute: applyDefaultOptionInterpolation(route, defaultOptions),
          icon: String(shellEntry.icon || "").trim(),
          group: String(shellEntry.group || "").trim(),
          description: String(shellEntry.description || "").trim(),
          order: Number.isFinite(Number(shellEntry.order)) ? Number(shellEntry.order) : 100
        });
      }
    }
  }

  return entries.sort((left, right) => {
    const surfaceDiff = String(left.surface || "").localeCompare(String(right.surface || ""));
    if (surfaceDiff !== 0) {
      return surfaceDiff;
    }
    const slotDiff = String(left.slot || "").localeCompare(String(right.slot || ""));
    if (slotDiff !== 0) {
      return slotDiff;
    }
    const orderDiff = Number(left.order || 0) - Number(right.order || 0);
    if (orderDiff !== 0) {
      return orderDiff;
    }
    return String(left.id || "").localeCompare(String(right.id || ""));
  });
}

function buildElementContributionDetails(packageIds, availablePackages) {
  const elements = [];
  for (const packageId of toSortedUniqueStrings(Array.isArray(packageIds) ? packageIds : [])) {
    const packageEntry = availablePackages.get(packageId);
    if (!packageEntry) {
      continue;
    }
    for (const uiElement of packageEntry.descriptor.metadata?.ui?.elements || []) {
      const defaultOptions = {};
      for (const pathOption of uiElement.pathOptions || []) {
        const optionName = String(pathOption.option || "").trim();
        const defaultValue = String(pathOption.defaultValue || "").trim();
        if (optionName && defaultValue) {
          defaultOptions[optionName] = defaultValue;
        }
      }
      elements.push({
        packageId,
        id: String(uiElement.id || "").trim(),
        name: String(uiElement.name || "").trim(),
        capability: String(uiElement.capability || "").trim(),
        purpose: String(uiElement.purpose || "").trim(),
        surface: String(uiElement.surface || "").trim(),
        availabilityImport:
          uiElement?.availability?.import && typeof uiElement.availability.import === "object"
            ? {
                module: String(uiElement.availability.import.module || "").trim(),
                symbols: toSortedUniqueStrings(Array.isArray(uiElement.availability.import.symbols) ? uiElement.availability.import.symbols : [])
              }
            : null,
        pathOptions: (Array.isArray(uiElement.pathOptions) ? uiElement.pathOptions : []).map((pathOption) => ({
          option: String(pathOption.option || "").trim(),
          required: Boolean(pathOption.required),
          defaultValue: String(pathOption.defaultValue || "").trim(),
          promptLabel: String(pathOption.promptLabel || "").trim(),
          promptHint: String(pathOption.promptHint || "").trim(),
          values: toSortedUniqueStrings(Array.isArray(pathOption.values) ? pathOption.values : [])
        })),
        contributions: {
          clientRoutes: (uiElement?.contributions?.clientRoutes || []).map((entry) => ({
            path: String(entry.path || "").trim(),
            resolvedPath: applyDefaultOptionInterpolation(String(entry.path || "").trim(), defaultOptions),
            surface: String(entry.surface || "").trim(),
            name: String(entry.name || "").trim(),
            purpose: String(entry.purpose || "").trim()
          })),
          shellEntries: (uiElement?.contributions?.shellEntries || []).map((entry) => ({
            surface: String(entry.surface || "").trim(),
            slot: String(entry.slot || "").trim(),
            id: String(entry.id || "").trim(),
            title: String(entry.title || "").trim(),
            route: String(entry.route || "").trim(),
            resolvedRoute: applyDefaultOptionInterpolation(String(entry.route || "").trim(), defaultOptions),
            icon: String(entry.icon || "").trim(),
            group: String(entry.group || "").trim(),
            description: String(entry.description || "").trim(),
            order: Number.isFinite(Number(entry.order)) ? Number(entry.order) : 100
          })),
          files: (uiElement?.contributions?.files || []).map((entry) => ({
            from: String(entry.from || "").trim(),
            to: String(entry.to || "").trim(),
            resolvedTo: applyDefaultOptionInterpolation(String(entry.to || "").trim(), defaultOptions),
            reason: String(entry.reason || "").trim(),
            category: String(entry.category || "").trim(),
            id: String(entry.id || "").trim()
          })),
          text: (uiElement?.contributions?.text || []).map((entry) => ({
            file: String(entry.file || "").trim(),
            op: String(entry.op || "").trim(),
            key: String(entry.key || "").trim(),
            line: String(entry.line || "").trim(),
            value: String(entry.value || "").trim(),
            reason: String(entry.reason || "").trim(),
            category: String(entry.category || "").trim(),
            id: String(entry.id || "").trim()
          }))
        }
      });
    }
  }

  return elements.sort((left, right) => {
    const packageDiff = String(left.packageId || "").localeCompare(String(right.packageId || ""));
    if (packageDiff !== 0) {
      return packageDiff;
    }
    return String(left.id || "").localeCompare(String(right.id || ""));
  });
}

async function buildServerRouteDetailsForPackage(packageEntry) {
  if (!packageEntry) {
    return [];
  }

  const routes = (packageEntry.descriptor.metadata?.server?.routes || []).map((route) => ({
    method: String(route.method || "").trim().toUpperCase(),
    path: String(route.path || "").trim(),
    summary: String(route.summary || "").trim()
  }));

  return routes.sort((left, right) => {
    const pathDiff = left.path.localeCompare(right.path);
    if (pathDiff !== 0) {
      return pathDiff;
    }
    return left.method.localeCompare(right.method);
  });
}

async function buildServerRouteDetails(packageIds, availablePackages) {
  const routeGroups = [];
  for (const packageId of toSortedUniqueStrings(Array.isArray(packageIds) ? packageIds : [])) {
    const packageEntry = availablePackages.get(packageId);
    if (!packageEntry) {
      continue;
    }
    const routes = await buildServerRouteDetailsForPackage(packageEntry);
    if (routes.length < 1) {
      continue;
    }
    routeGroups.push({
      packageId,
      routes
    });
  }
  return routeGroups;
}

function buildCapabilityContractRoleDetails({ requiredCapabilities, providedCapabilities }) {
  const requiredSet = new Set(Array.isArray(requiredCapabilities) ? requiredCapabilities : []);
  const providedSet = new Set(Array.isArray(providedCapabilities) ? providedCapabilities : []);
  const allCapabilityIds = toSortedUniqueStrings([...requiredSet, ...providedSet]);

  return allCapabilityIds.map((capabilityId) => {
    const contract = getCapabilityContract(capabilityId);
    const roles = [];
    if (providedSet.has(capabilityId)) {
      roles.push("provides");
    }
    if (requiredSet.has(capabilityId)) {
      roles.push("requires");
    }
    return {
      capabilityId,
      roles,
      kind: String(contract?.kind || "").trim(),
      summary: String(contract?.summary || "").trim() || "No central contract registered."
    };
  });
}

async function buildShowPackageBundleResult({
  bundleEntry,
  availablePackages,
  installedPackageIds,
  expanded = false
}) {
  const metadata = buildBundleMetadata(bundleEntry.descriptor, availablePackages);
  const selectedPackageIds = expanded ? metadata.expandedPackages : metadata.packages;
  const capabilitySets = buildCapabilitySetsForPackages(selectedPackageIds, availablePackages);
  const serverRoutes = await buildServerRouteDetails(selectedPackageIds, availablePackages);
  const clientRoutes = buildUiRouteDetails(selectedPackageIds, availablePackages);
  const fileContributions = buildFileContributionDetails(selectedPackageIds, availablePackages);
  const textMutations = buildTextMutationDetails(selectedPackageIds, availablePackages);
  const packageJsonMutations = buildPackageJsonMutationDetails(selectedPackageIds, availablePackages);
  const uiElements = buildUiElementDetails(selectedPackageIds, availablePackages);
  const shellEntries = buildShellEntryContributionDetails(selectedPackageIds, availablePackages);
  const elementContributions = buildElementContributionDetails(selectedPackageIds, availablePackages);
  const packageSections = [];
  for (const packageId of selectedPackageIds) {
    const packageEntry = availablePackages.get(packageId);
    if (!packageEntry) {
      continue;
    }
    packageSections.push(
      await buildShowPackagePackageResult({
        packageEntry,
        availablePackages,
        installedPackageIds,
        expanded: false
      })
    );
  }

  return {
    command: "show-package",
    targetType: "bundle",
    expanded,
    packageId: bundleEntry.descriptor.bundleId,
    bundleId: bundleEntry.descriptor.bundleId,
    version: bundleEntry.descriptor.version,
    description: bundleEntry.descriptor.description,
    curated: bundleEntry.descriptor.curated,
    provider: bundleEntry.descriptor.provider,
    installed: metadata.expandedPackages.every((packageId) => installedPackageIds.has(packageId)),
    declaredPackageIds: metadata.packages,
    expandedPackageIds: metadata.expandedPackages,
    packageIds: selectedPackageIds,
    packageEntries: (expanded ? metadata.expandedPackageEntries : metadata.packageEntries) || [],
    requiredCapabilities: capabilitySets.requiredCapabilities,
    requiredCapabilitySummary: summarizeCapabilities(capabilitySets.requiredCapabilities),
    providedCapabilities: capabilitySets.providedCapabilities,
    providedCapabilitySummary: summarizeCapabilities(capabilitySets.providedCapabilities),
    capabilityContracts: buildCapabilityContractRoleDetails({
      requiredCapabilities: capabilitySets.requiredCapabilities,
      providedCapabilities: capabilitySets.providedCapabilities
    }),
    serverRoutes,
    clientRoutes,
    fileContributions,
    textMutations,
    packageJsonMutations,
    uiElements,
    shellEntries,
    elementContributions,
    packageSections
  };
}

async function buildShowPackagePackageResult({
  packageEntry,
  availablePackages,
  installedPackageIds,
  expanded = false
}) {
  const rootPackageId = packageEntry.descriptor.packageId;
  const expandedPackageIds = toSortedUniqueStrings(resolvePackageInstallOrder([rootPackageId], availablePackages));
  const selectedPackageIds = expanded ? expandedPackageIds : [rootPackageId];
  const capabilitySets = buildCapabilitySetsForPackages(selectedPackageIds, availablePackages);
  const serverRoutes = await buildServerRouteDetails(selectedPackageIds, availablePackages);
  const clientRoutes = buildUiRouteDetails(selectedPackageIds, availablePackages);
  const fileContributions = buildFileContributionDetails(selectedPackageIds, availablePackages);
  const textMutations = buildTextMutationDetails(selectedPackageIds, availablePackages);
  const packageJsonMutations = buildPackageJsonMutationDetails(selectedPackageIds, availablePackages);
  const uiElements = buildUiElementDetails(selectedPackageIds, availablePackages);
  const shellEntries = buildShellEntryContributionDetails(selectedPackageIds, availablePackages);
  const elementContributions = buildElementContributionDetails(selectedPackageIds, availablePackages);

  return {
    command: "show-package",
    targetType: "package",
    expanded,
    packageId: rootPackageId,
    version: packageEntry.descriptor.version,
    description: packageEntry.descriptor.description,
    installed: installedPackageIds.has(rootPackageId),
    options: buildPackageOptionSchema(packageEntry.descriptor),
    dependsOn: packageEntry.descriptor.dependsOn,
    declaredPackageIds: [rootPackageId],
    expandedPackageIds,
    packageIds: selectedPackageIds,
    packageEntries: selectedPackageIds.map((packageId) => ({
      packageId,
      provider: (availablePackages.get(packageId)?.descriptor?.capabilities?.provides || []).some((capabilityId) =>
        capabilityId === "db-provider" || capabilityId.endsWith(".provider") || capabilityId.includes(".provider.")
      ),
      providerRequirementHints: [],
      description: String(availablePackages.get(packageId)?.descriptor?.description || "").trim() || "No package description."
    })),
    requiredCapabilities: capabilitySets.requiredCapabilities,
    requiredCapabilitySummary: summarizeCapabilities(capabilitySets.requiredCapabilities),
    providedCapabilities: capabilitySets.providedCapabilities,
    providedCapabilitySummary: summarizeCapabilities(capabilitySets.providedCapabilities),
    capabilityContracts: buildCapabilityContractRoleDetails({
      requiredCapabilities: capabilitySets.requiredCapabilities,
      providedCapabilities: capabilitySets.providedCapabilities
    }),
    serverRoutes,
    clientRoutes,
    fileContributions,
    textMutations,
    packageJsonMutations,
    uiElements,
    shellEntries,
    elementContributions
  };
}

function getProviderFamilyFromOptionCapability(capabilityId) {
  const normalized = String(capabilityId || "").trim();
  if (!normalized) {
    return null;
  }

  const marker = ".provider.";
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex < 1) {
    return null;
  }

  return `${normalized.slice(0, markerIndex)}.provider`;
}

function buildProviderChoiceContext(availablePackages) {
  const dbProviderPackages = new Set();
  const optionProvidersByFamily = new Map();

  for (const packageEntry of availablePackages.values()) {
    const packageId = packageEntry.descriptor.packageId;
    for (const capabilityId of packageEntry.descriptor.capabilities.provides) {
      if (capabilityId === "db-provider") {
        dbProviderPackages.add(packageId);
      }

      const family = getProviderFamilyFromOptionCapability(capabilityId);
      if (!family) {
        continue;
      }
      if (!optionProvidersByFamily.has(family)) {
        optionProvidersByFamily.set(family, new Set());
      }
      optionProvidersByFamily.get(family).add(packageId);
    }
  }

  const choiceProviderFamilies = new Set();
  for (const [family, providerPackages] of optionProvidersByFamily.entries()) {
    if (providerPackages.size > 1) {
      choiceProviderFamilies.add(family);
    }
  }

  return {
    hasDbProviderChoice: dbProviderPackages.size > 1,
    choiceProviderFamilies
  };
}

function isProviderBundleEntry(bundleEntry, providerChoiceContext) {
  if (bundleEntry.provider === 1) {
    return true;
  }

  for (const capabilityId of bundleEntry.providedCapabilities || []) {
    if (capabilityId === "db-provider" && providerChoiceContext?.hasDbProviderChoice) {
      return true;
    }

    const family = getProviderFamilyFromOptionCapability(capabilityId);
    if (family && providerChoiceContext?.choiceProviderFamilies?.has(family)) {
      return true;
    }
  }

  return false;
}

function splitBundleEntriesByProviderRole(bundleEntries, providerChoiceContext) {
  const providerBundles = [];
  const standardBundles = [];

  for (const entry of bundleEntries) {
    if (isProviderBundleEntry(entry, providerChoiceContext)) {
      providerBundles.push(entry);
      continue;
    }
    standardBundles.push(entry);
  }

  return {
    providerBundles,
    standardBundles
  };
}

function normalizeOptionSchemaRecord(schema) {
  return {
    required: Boolean(schema?.required),
    values: toSortedUniqueStrings(Array.isArray(schema?.values) ? schema.values : []),
    defaultValue: String(schema?.defaultValue || "").trim(),
    promptLabel: String(schema?.promptLabel || "").trim(),
    promptHint: String(schema?.promptHint || "").trim(),
    prompt: Boolean(schema?.prompt)
  };
}

function optionSchemasEqual(left, right) {
  const normalizedLeft = normalizeOptionSchemaRecord(left);
  const normalizedRight = normalizeOptionSchemaRecord(right);
  return (
    normalizedLeft.required === normalizedRight.required &&
    normalizedLeft.defaultValue === normalizedRight.defaultValue &&
    normalizedLeft.promptLabel === normalizedRight.promptLabel &&
    normalizedLeft.promptHint === normalizedRight.promptHint &&
    normalizedLeft.prompt === normalizedRight.prompt &&
    normalizedLeft.values.length === normalizedRight.values.length &&
    normalizedLeft.values.every((value, index) => value === normalizedRight.values[index])
  );
}

function buildPackageOptionSchema(packageDescriptor) {
  const merged = {};
  const descriptorOptions = ensurePlainObjectRecord(packageDescriptor?.options);
  for (const [optionName, optionSchema] of Object.entries(descriptorOptions)) {
    merged[optionName] = normalizeOptionSchemaRecord(optionSchema);
  }

  const uiElements = Array.isArray(packageDescriptor?.metadata?.ui?.elements)
    ? packageDescriptor.metadata.ui.elements
    : [];

  for (const element of uiElements) {
    for (const pathOption of Array.isArray(element?.pathOptions) ? element.pathOptions : []) {
      const optionName = String(pathOption?.option || "").trim();
      if (!optionName) {
        continue;
      }
      const optionSchema = normalizeOptionSchemaRecord({
        ...pathOption,
        prompt: pathOption?.prompt === undefined ? true : Boolean(pathOption.prompt)
      });
      if (!Object.prototype.hasOwnProperty.call(merged, optionName)) {
        merged[optionName] = optionSchema;
        continue;
      }
      if (!optionSchemasEqual(merged[optionName], optionSchema)) {
        throw createCliError(
          `Package ${packageDescriptor.packageId} has conflicting schemas for option ${optionName} between options and ui.pathOptions.`
        );
      }
    }
  }

  return merged;
}

function buildOptionOwnerIndex(packageIds, availablePackages) {
  const owners = new Map();
  for (const packageId of packageIds) {
    const packageEntry = availablePackages.get(packageId);
    if (!packageEntry) {
      continue;
    }

    for (const optionName of Object.keys(buildPackageOptionSchema(packageEntry.descriptor))) {
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
  const optionsSchema = buildPackageOptionSchema(packageDescriptor);
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
    const fromInstalled = String(installedPackageState?.options?.[optionName] || "").trim();
    const fromProvided = String(ensurePlainObjectRecord(providedOptions)[optionName] || "").trim();
    let value = String(selectedOptions[optionName] || "").trim();
    const shouldPromptForUnset =
      !value &&
      Boolean(schema.prompt) &&
      !fromInstalled &&
      !fromProvided;

    if (shouldPromptForUnset) {
      value = await promptForRequiredOption({
        ownerType: "package",
        ownerId: packageDescriptor.packageId,
        optionName,
        optionSchema: schema,
        stdin,
        stdout
      });
    }
    if (!value && schema.defaultValue) {
      value = String(schema.defaultValue || "").trim();
    }
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
  availablePackages,
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
    packageId,
    availablePackages
  });

  const textMutations = resolveTextMutationEntries({
    packageDescriptor: packageEntry.descriptor,
    selectedOptions,
    packageId
  });
  const uiContributions = resolveUiElementContributions({
    packageDescriptor: packageEntry.descriptor,
    selectedOptions,
    packageId
  });
  const allTextMutations = [...textMutations, ...uiContributions.textMutations];
  const textPlan = await buildTextMutationPlan({
    appRoot,
    textMutations: allTextMutations,
    lock,
    packageId
  });
  const fileMutations = resolveFileMutationEntries({
    packageDescriptor: packageEntry.descriptor,
    selectedOptions,
    packageId
  });
  const allFileMutations = [...fileMutations, ...uiContributions.fileMutations];

  const filesPlan = await buildFileMutationPlan({
    appRoot,
    fileMutations: allFileMutations,
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

  if (textPlan.conflicts.length > 0) {
    throw createConflictError(
      "managed-text-drift",
      `Package ${packageId} has text mutation conflicts.`,
      textPlan.conflicts
    );
  }

  if (filesPlan.conflicts.length > 0) {
    throw createConflictError(
      "managed-file-drift",
      `Package ${packageId} has file mutation conflicts.`,
      filesPlan.conflicts
    );
  }

  await applyTextMutationPlan({
    appRoot,
    plan: textPlan,
    dryRun,
    transaction
  });

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
      text: textPlan.managed,
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
  }

  const touchedFiles = toSortedUniqueStrings([
    ...filesPlan.operations.map((operation) => operation.relativeTargetPath),
    ...textPlan.changedFiles
  ]);

  return {
    packageId,
    dryRun,
    packageJsonChanged: packagePlan.changed,
    textChanged: textPlan.changed,
    filesTouched: touchedFiles,
    dependenciesTouched: packagePlan.dependenciesTouched,
    journal: {
      packageId,
      mode: filePlanMode,
      options: selectedOptions,
      packageJsonChanged: packagePlan.changed,
      textChanged: textPlan.changed,
      filesTouched: touchedFiles,
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

  const textConflicts = [];
  const managedText = getManagedTextEntries(installedState);
  const textEntries = Object.entries(managedText).map(([handle, entry]) => ({
    handle,
    entry: {
      ...entry,
      file: normalizeRelativePath(entry.file)
    }
  }));
  const textSourceMap = await loadTextMutationSourceMap(
    appRoot,
    textEntries.map((item) => item.entry)
  );
  const changedTextFiles = new Set();

  for (const { handle, entry } of textEntries) {
    const currentSource = String(textSourceMap.get(entry.file) || "");
    const currentValue = getTextMutationValueFromSource(currentSource, entry);
    const expectedValue = String(entry.value || "");
    if (currentValue !== expectedValue) {
      textConflicts.push(
        createIssue(
          `Skipped text mutation ${entry.file} (${entry.op}): value changed from managed value ${expectedValue}.`
        )
      );
      continue;
    }

    const otherPackageManager = isManagedByOtherPackage(lock, packageId, (state) => {
      const otherEntries = getManagedTextEntries(state);
      const otherEntry = otherEntries[handle];
      return Boolean(otherEntry && String(otherEntry.value || "") === expectedValue);
    });
    if (otherPackageManager) {
      continue;
    }

    let nextSource = currentSource;
    if (entry.hadPrevious) {
      nextSource = reapplyTextMutationPreviousValue(nextSource, entry, String(entry.previousValue || ""));
    } else {
      nextSource = removeTextMutationFromSource(nextSource, entry);
    }

    if (nextSource !== currentSource) {
      textSourceMap.set(entry.file, nextSource);
      changedTextFiles.add(entry.file);
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

    for (const relativePath of toSortedUniqueStrings([...changedTextFiles])) {
      const source = String(textSourceMap.get(relativePath) || "");
      const absolutePath = path.join(appRoot, normalizeRelativePath(relativePath));
      if (source.trim().length > 0) {
        await writeTextFileWithTransaction(transaction, absolutePath, source);
        continue;
      }
      if (await fileExists(absolutePath)) {
        await rmFileWithTransaction(transaction, absolutePath);
      }
    }
  }

  return {
    packageId,
    dryRun,
    removedFiles: toSortedUniqueStrings(removedFiles),
    issues: [...packageConflicts, ...textConflicts, ...fileConflicts],
    journal: {
      packageId,
      removedFiles: toSortedUniqueStrings(removedFiles),
      issues: [...packageConflicts, ...textConflicts, ...fileConflicts]
    },
    nextLock,
    nextPackageJson
  };
}

async function validateDoctor({ appRoot, lock, availableBundles, availablePackages }) {
  const issues = [];
  const { packageJson } = await loadAppPackageJson(appRoot);
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

    const managedPackageJson = ensurePlainObjectRecord(state?.managed?.packageJson);
    for (const sectionName of ["dependencies", "devDependencies", "scripts"]) {
      const managedSection = ensurePlainObjectRecord(managedPackageJson[sectionName]);
      if (Object.keys(managedSection).length < 1) {
        continue;
      }

      const currentSection = ensurePlainObjectRecord(packageJson[sectionName]);
      for (const [name, meta] of Object.entries(managedSection)) {
        const expectedValue = String(meta?.value || "");
        const hasCurrentValue = Object.prototype.hasOwnProperty.call(currentSection, name);
        const currentValue = hasCurrentValue ? String(currentSection[name]) : "<missing>";

        if (!hasCurrentValue || currentValue !== expectedValue) {
          issues.push(
            createIssue(
              `Managed package.json drift detected: ${sectionName}.${name} (expected ${expectedValue}, found ${currentValue}).`
            )
          );
        }
      }
    }

    const managedTextEntries = Object.values(getManagedTextEntries(state)).map((entry) => ({
      ...entry,
      file: normalizeRelativePath(entry.file)
    }));
    if (managedTextEntries.length > 0) {
      const sourceMap = await loadTextMutationSourceMap(appRoot, managedTextEntries);
      for (const textEntry of managedTextEntries) {
        const source = String(sourceMap.get(textEntry.file) || "");
        const currentValue = getTextMutationValueFromSource(source, textEntry);
        const expectedValue = String(textEntry.value || "");
        if (currentValue !== expectedValue) {
          issues.push(
            createIssue(
              `Managed text drift detected: ${textEntry.file} (${textEntry.op}). Expected ${expectedValue || "<missing>"}, found ${currentValue ?? "<missing>"}.`
            )
          );
        }
      }
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

  for (const sectionName of ["dependencies", "devDependencies"]) {
    const section = ensurePlainObjectRecord(packageJson[sectionName]);
    for (const [dependencyName, spec] of Object.entries(section)) {
      const localTarget = resolveLocalJskitDependencyTarget({
        dependencyName,
        availablePackages
      });
      if (!localTarget) {
        continue;
      }

      const currentSpec = String(spec || "").trim();
      if (currentSpec === localTarget) {
        continue;
      }

      issues.push(
        createIssue(
          `[distribution-policy] ${sectionName}.${dependencyName} must be ${localTarget} (found ${currentSpec || "<empty>"}). Run: npx jskit update --all --no-install && npm install.`
        )
      );
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
  const supportsColor = Boolean(stdout?.isTTY) && !process.env.NO_COLOR;
  const color = (code, text) => (supportsColor ? `\x1b[${code}m${text}\x1b[0m` : text);
  const bold = (text) => color("1", text);
  const cyan = (text) => color("36", text);
  const blue = (text) => color("34", text);
  const green = (text) => color("32", text);
  const yellow = (text) => color("33", text);
  const magenta = (text) => color("35", text);
  const red = (text) => color("31", text);
  const brightWhite = (text) => color("97", text);
  const gray = (text) => (supportsColor ? `\x1b[90m${text}\x1b[0m` : text);
  const showExpanded = result.expanded === true;

  function formatBundleLine(entry) {
    const installedSuffix = entry.installed ? " (installed)" : "";
    const providerRequirementSuffix =
      Array.isArray(entry.providerRequirementHints) && entry.providerRequirementHints.length > 0
        ? ` [${entry.providerRequirementHints.join(", ")}]`
        : "";
    const description = String(entry.description || "").trim();
    return description.length > 0
      ? `- ${entry.bundleId} (${entry.version})${installedSuffix}${providerRequirementSuffix}: ${gray(description)}\n`
      : `- ${entry.bundleId} (${entry.version})${installedSuffix}${providerRequirementSuffix}\n`;
  }

  function writeCapabilitySection({ title, groupedCapabilities = [], colorize = (text) => text }) {
    if (!Array.isArray(groupedCapabilities) || groupedCapabilities.length < 1) {
      return;
    }
    const labels = groupedCapabilities.map((label) => colorize(label)).join(", ");
    stdout.write(`${bold(blue(title))}: ${labels}\n`);
  }

  function displayPackageId(packageId) {
    const normalized = String(packageId || "").trim();
    const prefix = "@jskit-ai/";
    if (normalized.startsWith(prefix)) {
      return normalized.slice(prefix.length);
    }
    return normalized;
  }

  function colorMethod(method) {
    const normalized = String(method || "").trim().toUpperCase();
    if (normalized === "GET") {
      return green(normalized);
    }
    if (normalized === "POST") {
      return cyan(normalized);
    }
    if (normalized === "PUT") {
      return yellow(normalized);
    }
    if (normalized === "PATCH") {
      return magenta(normalized);
    }
    if (normalized === "DELETE") {
      return red(normalized);
    }
    return brightWhite(normalized);
  }

  if (json) {
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (result.command === "list") {
    if (result.availableBundles) {
      stdout.write("\nBundles:\n");
      for (const entry of result.standardBundles || []) {
        stdout.write(formatBundleLine(entry));
        if (result.full) {
          const packageIds = showExpanded ? entry.expandedPackages || entry.packages : entry.packages;
          const packageEntries = showExpanded ? entry.expandedPackageEntries || entry.packageEntries : entry.packageEntries;
          stdout.write(`  packages (${packageIds.length}):\n`);
          for (const packageEntry of packageEntries || []) {
            const providerRequirementSuffix =
              Array.isArray(packageEntry.providerRequirementHints) && packageEntry.providerRequirementHints.length > 0
                ? ` [${packageEntry.providerRequirementHints.join(", ")}]`
                : "";
            const packageId = `${displayPackageId(packageEntry.packageId)}${packageEntry.provider ? "*" : ""}${providerRequirementSuffix}`;
            const description = String(packageEntry.description || "").trim();
            if (description.length > 0) {
              stdout.write(`  - ${packageId}: ${gray(description)}\n`);
              continue;
            }
            stdout.write(`  - ${packageId}\n`);
          }
        }
      }

      stdout.write("\nProvider bundles:\n");
      for (const entry of result.providerBundles || []) {
        stdout.write(formatBundleLine(entry));
        if (result.full) {
          const packageIds = showExpanded ? entry.expandedPackages || entry.packages : entry.packages;
          const packageEntries = showExpanded ? entry.expandedPackageEntries || entry.packageEntries : entry.packageEntries;
          stdout.write(`  packages (${packageIds.length}):\n`);
          for (const packageEntry of packageEntries || []) {
            const providerRequirementSuffix =
              Array.isArray(packageEntry.providerRequirementHints) && packageEntry.providerRequirementHints.length > 0
                ? ` [${packageEntry.providerRequirementHints.join(", ")}]`
                : "";
            const packageId = `${displayPackageId(packageEntry.packageId)}${packageEntry.provider ? "*" : ""}${providerRequirementSuffix}`;
            const description = String(packageEntry.description || "").trim();
            if (description.length > 0) {
              stdout.write(`  - ${packageId}: ${gray(description)}\n`);
              continue;
            }
            stdout.write(`  - ${packageId}\n`);
          }
        }
      }

      if (result.full) {
        stdout.write("\n* provider package\n");
      }
    }
    if (result.availablePackages) {
      stdout.write("Available packages:\n");
      for (const entry of result.availablePackages) {
        stdout.write(`- ${entry.packageId} (${entry.version})${entry.installed ? " (installed)" : ""}\n`);
      }
    }
    return;
  }

  if (result.command === "show-package") {
    const renderShowSection = ({ sectionResult, includeHeader = true, includePackageList = true, includeAggregates = true }) => {
      const installedSuffix = sectionResult.installed ? " (installed)" : "";
      const targetLabel = sectionResult.targetType === "bundle" ? "bundle shortcut" : "package";
      const headlineLabel = sectionResult.targetType === "bundle" ? "Bundle" : "Package";
      const displayedTargetId =
        sectionResult.targetType === "package" ? displayPackageId(sectionResult.packageId) : String(sectionResult.packageId || "");

      if (includeHeader) {
        stdout.write(`${bold(cyan(`${headlineLabel} ${displayedTargetId} (${sectionResult.version})${installedSuffix}`))}\n`);
        stdout.write(`${bold("Type")}: ${targetLabel}\n`);
        if (sectionResult.description) {
          stdout.write(`${bold("Description")}: ${gray(sectionResult.description)}\n`);
        }
        if (sectionResult.targetType === "bundle") {
          stdout.write(`${bold("Curated")}: ${sectionResult.curated === 1 ? green("yes") : gray("no")}\n`);
          stdout.write(`${bold("Provider bundle")}: ${sectionResult.provider === 1 ? yellow("yes") : gray("no")}\n`);
        }
        if (sectionResult.targetType === "package") {
          if (Array.isArray(sectionResult.dependsOn) && sectionResult.dependsOn.length > 0) {
            stdout.write(`${bold(blue("Depends on"))}:\n`);
            for (const dependencyId of sectionResult.dependsOn) {
              stdout.write(`- ${cyan(displayPackageId(dependencyId))}\n`);
            }
          }
          const optionNames = Object.keys(sectionResult.options || {});
          if (optionNames.length > 0) {
            stdout.write(`${bold(blue("Options"))}:\n`);
            for (const optionName of optionNames.sort((left, right) => left.localeCompare(right))) {
              const option = sectionResult.options[optionName] || {};
              const requiredSuffix = option.required ? ` ${red("(required)")}` : "";
              const values = Array.isArray(option.values) && option.values.length > 0 ? `: ${option.values.join(" | ")}` : "";
              const defaultSuffix = String(option.defaultValue || "").trim()
                ? ` ${gray(`default=${String(option.defaultValue || "").trim()}`)}`
                : "";
              const promptSuffix = option.prompt ? ` ${gray("(prompt)")}` : "";
              stdout.write(`- ${yellow(optionName)}${requiredSuffix}${gray(values)}${defaultSuffix}${promptSuffix}\n`);
            }
          }
        }
      }

      if (includePackageList && Array.isArray(sectionResult.packageEntries) && sectionResult.packageEntries.length > 0) {
        stdout.write(`${bold(blue(`Packages (${sectionResult.packageEntries.length})${showExpanded ? " [expanded]" : ""}`))}:\n`);
        for (const packageEntry of sectionResult.packageEntries) {
          const providerRequirementSuffix =
            Array.isArray(packageEntry.providerRequirementHints) && packageEntry.providerRequirementHints.length > 0
              ? ` ${magenta(`[${packageEntry.providerRequirementHints.join(", ")}]`)}`
              : "";
          const providerSuffix = packageEntry.provider ? magenta("*") : "";
          const description = String(packageEntry.description || "").trim();
          const packageIdLabel = cyan(displayPackageId(packageEntry.packageId));
          if (description) {
            stdout.write(`- ${packageIdLabel}${providerSuffix}${providerRequirementSuffix}: ${gray(description)}\n`);
            continue;
          }
          stdout.write(`- ${packageIdLabel}${providerSuffix}${providerRequirementSuffix}\n`);
        }
      }

      if (includeAggregates) {
        writeCapabilitySection({
          title: "Requires capabilities",
          groupedCapabilities: sectionResult.requiredCapabilitySummary,
          colorize: yellow
        });
        writeCapabilitySection({
          title: "Provides capabilities",
          groupedCapabilities: sectionResult.providedCapabilitySummary,
          colorize: green
        });

        if (Array.isArray(sectionResult.capabilityContracts) && sectionResult.capabilityContracts.length > 0) {
          stdout.write(`${bold(blue("Contracts"))}:\n`);
          const contractKindNotes = Object.freeze({
            "service-contract": "service runtime API",
            "schema-contract": "schema/type surface",
            "client-runtime": "client runtime surface",
            "client-element": "client UI element",
            "provider-family": "provider selection family",
            "runtime-primitive": "runtime infrastructure primitive",
            "database-contract": "database adapter contract"
          });
          const providesLines = [];
          const requiresLines = [];
          const formatContractDetail = (capabilityLabel, kindLabel, kindNote, summaryLabel) => {
            const parts = [];
            if (kindLabel) {
              parts.push(`kind=${kindLabel}`);
            }
            if (kindNote) {
              parts.push(kindNote);
            }
            if (summaryLabel) {
              parts.push(summaryLabel);
            }
            if (parts.length < 1) {
              return capabilityLabel;
            }
            return `${capabilityLabel} — ${parts.join(" — ")}`;
          };
          for (const contractEntry of sectionResult.capabilityContracts) {
            const kindLabel = String(contractEntry.kind || "").trim();
            const kindNote = kindLabel ? String(contractKindNotes[kindLabel] || "").trim() : "";
            const summaryLabel = String(contractEntry.summary || "").trim();
            const capabilityLabel = cyan(contractEntry.capabilityId);
            const roles = Array.isArray(contractEntry.roles) ? contractEntry.roles : [];
            if (roles.includes("provides")) {
              providesLines.push(`- ${green("Provides")}: ${capabilityLabel}`);
            }
            if (roles.includes("requires")) {
              const detail = formatContractDetail(
                capabilityLabel,
                kindLabel ? yellow(kindLabel) : "",
                kindNote ? gray(kindNote) : "",
                summaryLabel ? gray(summaryLabel) : ""
              );
              requiresLines.push(`- ${yellow("Requires")}: ${detail}`);
            }
          }
          for (const line of providesLines) {
            stdout.write(`${line}\n`);
          }
          for (const line of requiresLines) {
            stdout.write(`${line}\n`);
          }
        }

        if (Array.isArray(sectionResult.serverRoutes) && sectionResult.serverRoutes.length > 0) {
          const totalRouteCount = sectionResult.serverRoutes.reduce((sum, entry) => sum + ((entry.routes || []).length || 0), 0);
          stdout.write(`${bold(blue(`Server routes (${totalRouteCount})`))}:\n`);
          for (const routeGroup of sectionResult.serverRoutes) {
            stdout.write(`- ${cyan(displayPackageId(routeGroup.packageId))}:\n`);
            for (const route of routeGroup.routes || []) {
              const summary = String(route.summary || "").trim();
              const methodLabel = colorMethod(route.method);
              const pathLabel = brightWhite(route.path);
              if (summary) {
                stdout.write(`  ${methodLabel} ${pathLabel}: ${gray(summary)}\n`);
                continue;
              }
              stdout.write(`  ${methodLabel} ${pathLabel}\n`);
            }
          }
        }

        if (Array.isArray(sectionResult.clientRoutes) && sectionResult.clientRoutes.length > 0) {
          stdout.write(`${bold(blue(`Client routes (${sectionResult.clientRoutes.length})`))}:\n`);
          for (const route of sectionResult.clientRoutes) {
            const surfaceSuffix = String(route.surface || "").trim() ? ` ${yellow(`(${route.surface})`)}` : "";
            const purpose = String(route.purpose || "").trim();
            const pathLabel = String(route.resolvedPath || "").trim() || String(route.path || "").trim();
            if (purpose) {
              stdout.write(
                `- ${brightWhite(pathLabel)}${surfaceSuffix} ${gray(`(${displayPackageId(route.packageId)})`)}: ${gray(purpose)}\n`
              );
              continue;
            }
            stdout.write(`- ${brightWhite(pathLabel)}${surfaceSuffix} ${gray(`(${displayPackageId(route.packageId)})`)}\n`);
          }
        }

        if (Array.isArray(sectionResult.shellEntries) && sectionResult.shellEntries.length > 0) {
          stdout.write(`${bold(blue(`Shell entries (${sectionResult.shellEntries.length})`))}:\n`);
          for (const shellEntry of sectionResult.shellEntries) {
            const surfaceSlot = `${shellEntry.surface || "unknown"}/${shellEntry.slot || "unknown"}`;
            const iconSuffix = String(shellEntry.icon || "").trim() ? ` ${magenta(`[${shellEntry.icon}]`)}` : "";
            const groupSuffix = String(shellEntry.group || "").trim() ? ` ${yellow(`(${shellEntry.group})`)}` : "";
            const elementSuffix = String(shellEntry.elementId || "").trim() ? ` ${gray(`#${shellEntry.elementId}`)}` : "";
            const routeLabel = String(shellEntry.resolvedRoute || "").trim() || String(shellEntry.route || "").trim();
            const description = String(shellEntry.description || "").trim();
            if (description) {
              stdout.write(
                `- ${brightWhite(`${surfaceSlot}:${shellEntry.id}`)} ${gray("->")} ${brightWhite(routeLabel)}${iconSuffix}${groupSuffix}${elementSuffix} ${gray(`(${displayPackageId(shellEntry.packageId)})`)}: ${gray(description)}\n`
              );
              continue;
            }
            stdout.write(
              `- ${brightWhite(`${surfaceSlot}:${shellEntry.id}`)} ${gray("->")} ${brightWhite(routeLabel)}${iconSuffix}${groupSuffix}${elementSuffix} ${gray(`(${displayPackageId(shellEntry.packageId)})`)}\n`
            );
          }
        }

        if (Array.isArray(sectionResult.elementContributions) && sectionResult.elementContributions.length > 0) {
          stdout.write(`${bold(blue(`Element contributions (${sectionResult.elementContributions.length})`))}:\n`);
          for (const element of sectionResult.elementContributions) {
            const capabilitySuffix = String(element.capability || "").trim()
              ? ` ${magenta(`[cap=${element.capability}]`)}`
              : "";
            const surfaceSuffix = String(element.surface || "").trim()
              ? ` ${yellow(`(surface=${element.surface})`)}`
              : "";
            const purpose = String(element.purpose || "").trim();
            const packageLabel = cyan(displayPackageId(element.packageId));
            const elementLabel = brightWhite(element.name || element.id || "element");
            const header = `- ${packageLabel}: ${elementLabel}${capabilitySuffix} ${surfaceSuffix}`;
            stdout.write(purpose ? `${header}: ${gray(purpose)}\n` : `${header}\n`);

            if (element.availabilityImport && element.availabilityImport.module) {
              const symbols = Array.isArray(element.availabilityImport.symbols) ? element.availabilityImport.symbols : [];
              const symbolLabel = symbols.length > 0 ? symbols.join(", ") : "<module>";
              stdout.write(
                `  ${gray("availability")}: ${brightWhite(element.availabilityImport.module)} ${gray(`(${symbolLabel})`)}\n`
              );
            }

            if (Array.isArray(element.pathOptions) && element.pathOptions.length > 0) {
              stdout.write(`  ${gray("generation (cmd line) options")}:\n`);
              for (const option of element.pathOptions) {
                const requiredSuffix = option.required ? ` ${red("(required)")}` : "";
                const defaultSuffix = option.defaultValue ? ` ${gray(`default=${option.defaultValue}`)}` : "";
                const valuesSuffix =
                  Array.isArray(option.values) && option.values.length > 0 ? ` ${gray(`values=${option.values.join("|")}`)}` : "";
                stdout.write(`    - ${yellow(option.option)}${requiredSuffix}${defaultSuffix}${valuesSuffix}\n`);
              }
            }

            const contributions = element.contributions || {};
            if (Array.isArray(contributions.clientRoutes) && contributions.clientRoutes.length > 0) {
              stdout.write(`  ${gray("client routes")}:\n`);
              for (const route of contributions.clientRoutes) {
                const routeSurface = String(route.surface || "").trim() ? ` ${yellow(`(${route.surface})`)}` : "";
                const routePurpose = String(route.purpose || "").trim();
                const routeLabel = String(route.resolvedPath || "").trim() || String(route.path || "").trim();
                if (routePurpose) {
                  stdout.write(`    - ${brightWhite(routeLabel)}${routeSurface}: ${gray(routePurpose)}\n`);
                  continue;
                }
                stdout.write(`    - ${brightWhite(routeLabel)}${routeSurface}\n`);
              }
            }

            if (Array.isArray(contributions.shellEntries) && contributions.shellEntries.length > 0) {
              stdout.write(`  ${gray("shell entries")}:\n`);
              for (const shellEntry of contributions.shellEntries) {
                const label = `${shellEntry.surface || "unknown"}/${shellEntry.slot || "unknown"}:${shellEntry.id || "entry"}`;
                const detail = String(shellEntry.title || "").trim() ? ` ${gray(`(${shellEntry.title})`)}` : "";
                const routeLabel = String(shellEntry.resolvedRoute || "").trim() || String(shellEntry.route || "").trim() || "/";
                stdout.write(`    - ${brightWhite(label)} ${gray("->")} ${brightWhite(routeLabel)}${detail}\n`);
              }
            }

            if (Array.isArray(contributions.files) && contributions.files.length > 0) {
              stdout.write(`  ${gray("files")}:\n`);
              for (const fileEntry of contributions.files) {
                const reason = String(fileEntry.reason || "").trim();
                const toLabel = String(fileEntry.resolvedTo || "").trim() || String(fileEntry.to || "").trim();
                if (reason) {
                  stdout.write(`    - ${brightWhite(fileEntry.from)} ${gray("->")} ${brightWhite(toLabel)}: ${gray(reason)}\n`);
                  continue;
                }
                stdout.write(`    - ${brightWhite(fileEntry.from)} ${gray("->")} ${brightWhite(toLabel)}\n`);
              }
            }

            if (Array.isArray(contributions.text) && contributions.text.length > 0) {
              stdout.write(`  ${gray("text")}:\n`);
              for (const mutation of contributions.text) {
                const valueLabel =
                  mutation.op === "upsert-env"
                    ? `${mutation.key}=${mutation.value}`
                    : String(mutation.line || "").trim();
                const reason = String(mutation.reason || "").trim();
                if (reason) {
                  stdout.write(`    - ${brightWhite(mutation.file)} ${cyan(mutation.op)}: ${gray(`${valueLabel} | ${reason}`)}\n`);
                  continue;
                }
                stdout.write(`    - ${brightWhite(mutation.file)} ${cyan(mutation.op)}: ${gray(valueLabel)}\n`);
              }
            }
          }
        }

        if (Array.isArray(sectionResult.packageJsonMutations) && sectionResult.packageJsonMutations.length > 0) {
          stdout.write(`${bold(blue(`package.json mutations (${sectionResult.packageJsonMutations.length})`))}:\n`);
          for (const mutation of sectionResult.packageJsonMutations) {
            stdout.write(
              `- ${yellow(`${mutation.section}.${mutation.key}`)} = ${brightWhite(mutation.value)} ${gray(`(${displayPackageId(mutation.packageId)})`)}\n`
            );
          }
        }

        if (Array.isArray(sectionResult.textMutations) && sectionResult.textMutations.length > 0) {
          stdout.write(`${bold(blue(`Text mutations (${sectionResult.textMutations.length})`))}:\n`);
          for (const mutation of sectionResult.textMutations) {
            const keyLabel = String(mutation.key || "").trim() ? ` ${magenta(`[${mutation.key}]`)}` : "";
            const idLabel = String(mutation.id || "").trim() ? ` ${yellow(`#${mutation.id}`)}` : "";
            const categoryLabel = String(mutation.category || "").trim() ? ` ${gray(`(${mutation.category})`)}` : "";
            const valueLabel =
              mutation.op === "upsert-env"
                ? `${mutation.key}=${mutation.value}`
                : String(mutation.line || "").trim();
            const reason = String(mutation.reason || "").trim();
            if (reason) {
              stdout.write(
                `- ${brightWhite(mutation.file)} ${cyan(mutation.op)}${keyLabel}${idLabel}${categoryLabel} ${gray(`(${displayPackageId(mutation.packageId)})`)}: ${gray(`${valueLabel} | ${reason}`)}\n`
              );
              continue;
            }
            stdout.write(
              `- ${brightWhite(mutation.file)} ${cyan(mutation.op)}${keyLabel}${idLabel}${categoryLabel} ${gray(`(${displayPackageId(mutation.packageId)})`)}: ${gray(valueLabel)}\n`
            );
          }
        }

        if (Array.isArray(sectionResult.fileContributions) && sectionResult.fileContributions.length > 0) {
          stdout.write(`${bold(blue(`File contributions (${sectionResult.fileContributions.length})`))}:\n`);
          for (const fileEntry of sectionResult.fileContributions) {
            const idLabel = String(fileEntry.id || "").trim() ? ` ${yellow(`#${fileEntry.id}`)}` : "";
            const categoryLabel = String(fileEntry.category || "").trim() ? ` ${gray(`(${fileEntry.category})`)}` : "";
            const reasonLabel = String(fileEntry.reason || "").trim();
            const toLabel = String(fileEntry.resolvedTo || "").trim() || String(fileEntry.to || "").trim();
            if (reasonLabel) {
              stdout.write(
                `- ${brightWhite(fileEntry.from)} ${gray("->")} ${brightWhite(toLabel)}${idLabel}${categoryLabel} ${gray(`(${displayPackageId(fileEntry.packageId)})`)}: ${gray(reasonLabel)}\n`
              );
              continue;
            }
            stdout.write(
              `- ${brightWhite(fileEntry.from)} ${gray("->")} ${brightWhite(toLabel)}${idLabel}${categoryLabel} ${gray(`(${displayPackageId(fileEntry.packageId)})`)}\n`
            );
          }
        }

        if (Array.isArray(sectionResult.uiElements) && sectionResult.uiElements.length > 0) {
          stdout.write(`${bold(blue(`UI elements (${sectionResult.uiElements.length})`))}:\n`);
          for (const element of sectionResult.uiElements) {
            const capabilitySuffix = String(element.capability || "").trim()
              ? ` ${magenta(`[cap=${element.capability}]`)}`
              : "";
            const surfaceSuffix = String(element.surface || "").trim()
              ? ` ${yellow(`(surface=${element.surface})`)}`
              : "";
            const packageLabel = cyan(displayPackageId(element.packageId));
            const elementLabel = brightWhite(element.name || element.id || "element");
            stdout.write(
              `- ${packageLabel}: ${elementLabel}${capabilitySuffix} ${surfaceSuffix}: ${gray(element.purpose)}\n`
            );
          }
        }
      }
    };

    if (result.targetType === "bundle") {
      renderShowSection({
        sectionResult: result,
        includeHeader: true,
        includePackageList: true,
        includeAggregates: false
      });

      if (Array.isArray(result.packageSections) && result.packageSections.length > 0) {
        for (const section of result.packageSections) {
          stdout.write("\n");
          renderShowSection({
            sectionResult: section,
            includeHeader: true,
            includePackageList: false,
            includeAggregates: true
          });
        }
      }
      return;
    }

    renderShowSection({
      sectionResult: result,
      includeHeader: true,
      includePackageList: true,
      includeAggregates: true
    });
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
      stdout.write("OK: no lockfile, managed-file, managed-text, or dependency-policy issues detected.\n");
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
        availablePackages,
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
      textChanged: packageResults.some((entry) => entry.textChanged),
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
  const hasTextConflict = issues.some((issue) => String(issue?.message || "").includes("text mutation"));
  throw createConflictError(
    hasFileConflict ? "managed-file-drift" : hasTextConflict ? "managed-text-drift" : "managed-script-drift",
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
        availablePackages,
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
      textChanged: packageResults.some((entry) => entry.textChanged),
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
    const resolvedCwd = path.resolve(cwd);

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

      const result = await lintDescriptors({ appRoot: resolvedCwd });
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

    if (parsed.options.full && parsed.command !== "list") {
      throw createCliError("--full is supported only for jskit list commands.", {
        showUsage: true
      });
    }
    if (parsed.options.expanded && !(parsed.command === "list" || parsed.command === "show")) {
      throw createCliError("--expanded is supported only for jskit list/show commands.", {
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

    const appRoot = await resolveAppRootFromCwd(resolvedCwd);
    const { packageJson, packageJsonPath } = await loadAppPackageJson(appRoot);
    const { lock, lockPath } = await loadLockFile(appRoot);
    const availableBundles = await discoverAvailableBundles();
    const availablePackages = await discoverAvailablePackages(appRoot);

    let result = null;

    if (parsed.command === "list") {
      let selector = "all";

      if (parsed.positional.length > 0) {
        selector = String(parsed.positional[0] || "").trim();
      }

      if (selector === "all") {
        if (parsed.positional.length > 1) {
          throw createCliError("jskit list all does not accept extra selectors.", {
            showUsage: true
          });
        }
      } else if (selector === "bundles") {
        if (parsed.positional.length === 1) {
          // default bundles list is the full catalog
        } else if (parsed.positional.length === 2 && parsed.positional[1] === "all") {
          // legacy alias; no longer changes output
        } else {
          throw createCliError("jskit list bundles accepts optional trailing selector: all.", {
            showUsage: true
          });
        }
      } else if (selector === "packages") {
        if (!(parsed.positional.length === 1 || (parsed.positional.length === 2 && parsed.positional[1] === "all"))) {
          throw createCliError("jskit list packages accepts no additional selectors.", {
            showUsage: true
          });
        }
        if (parsed.options.full || parsed.options.expanded) {
          throw createCliError("--full/--expanded are supported only for bundle listings.", {
            showUsage: true
          });
        }
      } else {
        throw createCliError(`Unknown list selector: ${selector}. Expected bundles, packages, or all.`, {
          showUsage: true
        });
      }

      const installedPackageIds = new Set(Object.keys(ensurePlainObjectRecord(lock.installedPackages)));
      const allBundleEntries = [...availableBundles.values()].map((entry) => {
        const metadata = buildBundleMetadata(entry.descriptor, availablePackages);
        const installed = metadata.expandedPackages.every((packageId) => installedPackageIds.has(packageId));
        return {
          bundleId: entry.descriptor.bundleId,
          version: entry.descriptor.version,
          description: entry.descriptor.description,
          curated: entry.descriptor.curated,
          provider: entry.descriptor.provider,
          installed,
          ...metadata
        };
      });
      const availableBundleEntries = allBundleEntries;

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

      const providerChoiceContext = buildProviderChoiceContext(availablePackages);
      const bundleSplit = splitBundleEntriesByProviderRole(availableBundleEntries, providerChoiceContext);

      result = {
        command: "list",
        full: parsed.options.full,
        expanded: parsed.options.expanded,
        availableBundles: selector === "all" || selector === "bundles" ? availableBundleEntries : null,
        providerBundles: selector === "all" || selector === "bundles" ? bundleSplit.providerBundles : null,
        standardBundles: selector === "all" || selector === "bundles" ? bundleSplit.standardBundles : null,
        availablePackages: selector === "all" || selector === "packages" ? availablePackageEntries : null
      };
      formatResult(result, {
        json: parsed.options.json,
        stdout
      });
      return 0;
    }

    if (parsed.command === "show") {
      if (parsed.positional.length !== 1) {
        throw createCliError("jskit show usage: show <id>.", {
          showUsage: true
        });
      }

      const installedPackageIds = new Set(Object.keys(ensurePlainObjectRecord(lock.installedPackages)));
      const targetId = parsed.positional[0];
      const bundleEntry = availableBundles.get(targetId) || null;
      const exactPackageEntry = availablePackages.get(targetId) || null;
      let packageEntry = exactPackageEntry;
      if (!packageEntry && !bundleEntry) {
        const resolvedPackageId = resolvePackageIdFromLookup(targetId, availablePackages);
        packageEntry = resolvedPackageId ? availablePackages.get(resolvedPackageId) : null;
      }

      if (bundleEntry && packageEntry) {
        throw createCliError(
          `Identifier ${targetId} is ambiguous (both bundle and package). Rename one descriptor before using show.`
        );
      }

      if (bundleEntry) {
        result = await buildShowPackageBundleResult({
          bundleEntry,
          availablePackages,
          installedPackageIds,
          expanded: parsed.options.expanded
        });
      } else if (packageEntry) {
        result = await buildShowPackagePackageResult({
          packageEntry,
          availablePackages,
          installedPackageIds,
          expanded: parsed.options.expanded
        });
      } else {
        throw createCliError(`Unknown package or bundle: ${targetId}`);
      }

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
        const resolvedPackageId = resolvePackageIdFromLookup(targetId, availablePackages);
        if (!resolvedPackageId) {
          throw createCliError(`Unknown package: ${targetId}`);
        }
        result = await applySinglePackageOperation({
          mode: "add",
          appRoot,
          packageId: resolvedPackageId,
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

      const resolvedPackageId = resolvePackageIdFromLookup(parsed.positional[1], availablePackages);
      if (!resolvedPackageId) {
        throw createCliError(`Unknown package: ${parsed.positional[1]}`);
      }

      result = await applySinglePackageOperation({
        mode: "update",
        appRoot,
        packageId: resolvedPackageId,
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

      const resolvedPackageId = resolvePackageIdFromLookup(parsed.positional[1], availablePackages);
      if (!resolvedPackageId) {
        throw createCliError(`Unknown package: ${parsed.positional[1]}`);
      }

      result = await removeSinglePackageOperation({
        appRoot,
        packageId: resolvedPackageId,
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
