import path from "node:path";
import { pathToFileURL } from "node:url";
import { access, readdir, readFile } from "node:fs/promises";
import { buildCrudFieldContractMap } from "@jskit-ai/kernel/shared/support/crudFieldContract";
import {
  buildAppCommandOptionMeta,
  listAppCommandDefinitions
} from "../commandHandlers/appCommandCatalog.js";
import {
  COMMAND_IDS,
  isKnownCommandName,
  resolveCommandAlias,
  resolveCommandDescriptor
} from "../core/commandCatalog.js";

const WRAPPER_COMMANDS = new Set(["npx", "jsx"]);
const KNOWN_GENERATE_FLAG_OPTIONS = Object.freeze(["dry-run", "run-npm-install", "devlinks", "json", "verbose"]);
const BOOLEAN_OPTION_NAMES = new Set([
  "dry-run",
  "run-npm-install",
  "devlinks",
  "full",
  "expanded",
  "details",
  "debug-exports",
  "check-di-labels",
  "verbose",
  "json",
  "all",
  "help",
  "force"
]);
const LIST_MODES = Object.freeze(["bundles", "packages", "generators"]);
const ADD_TARGET_TYPES = Object.freeze(["package", "bundle"]);
const POSITION_TARGET_TYPES = Object.freeze(["element"]);
const UPDATE_TARGET_TYPES = Object.freeze(["package"]);
const REMOVE_TARGET_TYPES = Object.freeze(["package"]);
const MIGRATION_SCOPES = Object.freeze(["all", "changed", "package"]);

function normalizeText(value = "") {
  return String(value || "").trim();
}

function toPosix(value = "") {
  return String(value || "").replaceAll(path.sep, "/");
}

function uniqueSorted(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))].sort((left, right) =>
    String(left).localeCompare(String(right))
  );
}

function filterByPrefix(values = [], prefix = "") {
  const normalizedPrefix = String(prefix || "");
  if (!normalizedPrefix) {
    return uniqueSorted(values);
  }
  return uniqueSorted(values).filter((value) => String(value || "").startsWith(normalizedPrefix));
}

function resolveAllowedValues(schema = {}) {
  const values = [];
  const seen = new Set();
  for (const rawValue of Array.isArray(schema?.allowedValues) ? schema.allowedValues : []) {
    const value = normalizeText(typeof rawValue === "string" ? rawValue : rawValue?.value);
    if (!value) {
      continue;
    }
    const normalizedKey = value.toLowerCase();
    if (seen.has(normalizedKey)) {
      continue;
    }
    seen.add(normalizedKey);
    values.push(value);
  }
  return Object.freeze(values);
}

function ensureTrailingSlash(value = "") {
  const normalized = toPosix(value).replace(/\/+$/g, "");
  if (!normalized) {
    return "";
  }
  return `${normalized}/`;
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(filePath) {
  const source = await readFile(filePath, "utf8");
  return JSON.parse(source);
}

async function safeReaddir(directoryPath) {
  try {
    return await readdir(directoryPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function walkDirectory(rootPath, { includeDirectories = false, includeFiles = true, fileFilter = null } = {}) {
  const entries = [];

  async function visit(directoryPath) {
    const children = await safeReaddir(directoryPath);
    for (const child of children) {
      if (child.name.startsWith(".")) {
        continue;
      }
      const absolutePath = path.join(directoryPath, child.name);
      if (child.isDirectory()) {
        if (includeDirectories) {
          entries.push(absolutePath);
        }
        await visit(absolutePath);
        continue;
      }
      if (!includeFiles) {
        continue;
      }
      if (typeof fileFilter === "function" && fileFilter(absolutePath) !== true) {
        continue;
      }
      entries.push(absolutePath);
    }
  }

  if (await pathExists(rootPath)) {
    await visit(rootPath);
  }

  return entries;
}

async function importDefaultModule(modulePath) {
  const moduleUrl = `${pathToFileURL(modulePath).href}?mtime=${Date.now()}`;
  const imported = await import(moduleUrl);
  return imported?.default;
}

async function loadCommandCatalog() {
  return {
    COMMAND_IDS,
    isKnownCommandName,
    resolveCommandAlias,
    resolveCommandDescriptor
  };
}

function isDirectoryLike(entry) {
  return Boolean(entry && (entry.isDirectory() || entry.isSymbolicLink()));
}

async function discoverDescriptorPackages(appRoot) {
  const packageDirs = [];

  for (const entry of await safeReaddir(path.join(appRoot, "packages"))) {
    if (isDirectoryLike(entry)) {
      packageDirs.push(path.join(appRoot, "packages", entry.name));
    }
  }

  for (const entry of await safeReaddir(path.join(appRoot, "node_modules", "@jskit-ai"))) {
    if (isDirectoryLike(entry)) {
      packageDirs.push(path.join(appRoot, "node_modules", "@jskit-ai", entry.name));
    }
  }

  const discovered = [];
  for (const packageDir of packageDirs) {
    const descriptorPath = path.join(packageDir, "package.descriptor.mjs");
    if (!(await pathExists(descriptorPath))) {
      continue;
    }
    try {
      const descriptor = await importDefaultModule(descriptorPath);
      const packageJsonPath = path.join(packageDir, "package.json");
      const packageJson = (await pathExists(packageJsonPath)) ? await readJsonFile(packageJsonPath) : {};
      const packageId = normalizeText(descriptor?.packageId || packageJson?.name || path.basename(packageDir));
      if (!packageId) {
        continue;
      }
      discovered.push(
        Object.freeze({
          packageDir,
          packageId,
          descriptor: descriptor && typeof descriptor === "object" ? descriptor : {}
        })
      );
    } catch {
      // Ignore malformed descriptors during completion discovery.
    }
  }

  return uniqueSorted(discovered.map((entry) => entry.packageId)).map((packageId) =>
    discovered.find((entry) => entry.packageId === packageId)
  );
}

async function discoverBundleIds(appRoot) {
  const bundleDescriptorPaths = [];

  for (const packageDir of [
    ...((await safeReaddir(path.join(appRoot, "packages"))).filter((entry) => isDirectoryLike(entry)).map((entry) =>
      path.join(appRoot, "packages", entry.name)
    )),
    ...((await safeReaddir(path.join(appRoot, "node_modules", "@jskit-ai"))).filter((entry) => isDirectoryLike(entry)).map((entry) =>
      path.join(appRoot, "node_modules", "@jskit-ai", entry.name)
    ))
  ]) {
    const bundlesDir = path.join(packageDir, "bundles");
    for (const entry of await safeReaddir(bundlesDir)) {
      if (!entry.isDirectory()) {
        continue;
      }
      const descriptorPath = path.join(bundlesDir, entry.name, "bundle.descriptor.mjs");
      if (await pathExists(descriptorPath)) {
        bundleDescriptorPaths.push(descriptorPath);
      }
    }
  }

  const bundleIds = [];
  for (const descriptorPath of bundleDescriptorPaths) {
    try {
      const descriptor = await importDefaultModule(descriptorPath);
      const bundleId = normalizeText(descriptor?.bundleId);
      if (bundleId) {
        bundleIds.push(bundleId);
      }
    } catch {
      // Ignore malformed bundle descriptors.
    }
  }

  return uniqueSorted(bundleIds);
}

function toShortPackageId(packageId = "") {
  const normalized = normalizeText(packageId);
  if (!normalized.startsWith("@jskit-ai/")) {
    return normalized;
  }
  return normalized.slice("@jskit-ai/".length);
}

async function discoverGenerators(appRoot) {
  const packages = await discoverDescriptorPackages(appRoot);
  const generators = [];
  for (const entry of packages) {
    if (normalizeText(entry?.descriptor?.kind) !== "generator") {
      continue;
    }
    const shortId = toShortPackageId(entry.packageId);
    generators.push(
      Object.freeze({
        packageId: entry.packageId,
        shortId,
        descriptor: entry.descriptor
      })
    );
  }
  return generators.sort((left, right) => left.shortId.localeCompare(right.shortId));
}

async function discoverRuntimePackages(appRoot) {
  const packages = await discoverDescriptorPackages(appRoot);
  const runtimeIds = [];
  for (const entry of packages) {
    if (normalizeText(entry?.descriptor?.kind) === "generator") {
      continue;
    }
    runtimeIds.push(entry.packageId);
    if (entry.packageId.startsWith("@jskit-ai/")) {
      runtimeIds.push(toShortPackageId(entry.packageId));
    }
  }
  return uniqueSorted(runtimeIds);
}

async function discoverResourceFiles(appRoot) {
  const sharedFiles = [];
  for (const packageDir of await safeReaddir(path.join(appRoot, "packages"))) {
    if (!packageDir.isDirectory()) {
      continue;
    }
    const sharedDir = path.join(appRoot, "packages", packageDir.name, "src", "shared");
    for (const fileEntry of await safeReaddir(sharedDir)) {
      if (!fileEntry.isFile()) {
        continue;
      }
      if (!/Resource\.js$/u.test(fileEntry.name)) {
        continue;
      }
      sharedFiles.push(toPosix(path.relative(appRoot, path.join(sharedDir, fileEntry.name))));
    }
  }
  return uniqueSorted(sharedFiles);
}

async function discoverSurfaces(appRoot) {
  const pagesRoot = path.join(appRoot, "src", "pages");
  const surfaces = [];
  for (const entry of await safeReaddir(pagesRoot)) {
    if (entry.isDirectory()) {
      surfaces.push(entry.name);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".vue")) {
      surfaces.push(entry.name.slice(0, -".vue".length));
    }
  }
  return uniqueSorted(surfaces);
}

function extractMatches(source = "", patterns = []) {
  const values = [];
  for (const pattern of patterns) {
    for (const match of String(source || "").matchAll(pattern)) {
      const value = normalizeText(match?.[1]);
      if (value) {
        values.push(value);
      }
    }
  }
  return values;
}

async function discoverPlacementTargets(appRoot) {
  const placementValues = [];
  const placementSourcePath = path.join(appRoot, "src", "placement.js");
  if (await pathExists(placementSourcePath)) {
    const source = await readFile(placementSourcePath, "utf8");
    placementValues.push(...extractMatches(source, [/\btarget\s*:\s*["']([^"']+)["']/g]));
    for (const match of source.matchAll(/\bhost\s*:\s*["']([^"']+)["']\s*,\s*\n?\s*position\s*:\s*["']([^"']+)["']/g)) {
      const host = normalizeText(match?.[1]);
      const position = normalizeText(match?.[2]);
      if (host && position) {
        placementValues.push(`${host}:${position}`);
      }
    }
  }

  const sourceFiles = await walkDirectory(path.join(appRoot, "src"), {
    includeFiles: true,
    includeDirectories: false,
    fileFilter: (filePath) => /\.(vue|js|mjs)$/u.test(filePath)
  });
  for (const filePath of sourceFiles) {
    const source = await readFile(filePath, "utf8");
    placementValues.push(...extractMatches(source, [/\btarget\s*=\s*["']([^"']+)["']/g]));
    for (const match of source.matchAll(/\bhost\s*=\s*["']([^"']+)["']\s+position\s*=\s*["']([^"']+)["']/g)) {
      const host = normalizeText(match?.[1]);
      const position = normalizeText(match?.[2]);
      if (host && position) {
        placementValues.push(`${host}:${position}`);
      }
    }
  }

  return uniqueSorted(placementValues);
}

async function discoverComponentTokens(appRoot) {
  const tokens = [];
  for (const filePath of [
    path.join(appRoot, "src", "placement.js"),
    ...((await walkDirectory(path.join(appRoot, "src"), {
      includeFiles: true,
      includeDirectories: false,
      fileFilter: (candidate) => /\.(vue|js|mjs)$/u.test(candidate)
    })) || []),
    ...((await walkDirectory(path.join(appRoot, "packages"), {
      includeFiles: true,
      includeDirectories: false,
      fileFilter: (candidate) => /\.(vue|js|mjs)$/u.test(candidate)
    })) || [])
  ]) {
    if (!(await pathExists(filePath))) {
      continue;
    }
    const source = await readFile(filePath, "utf8");
    tokens.push(...extractMatches(source, [
      /\bcomponentToken\s*:\s*["']([^"']+)["']/g,
      /\bdefault-link-component-token\s*=\s*["']([^"']+)["']/g,
      /registerMainClientComponent\(\s*["']([^"']+)["']/g
    ]));
  }
  return uniqueSorted(tokens);
}

function isRouteLikeRelativePath(relativePath = "") {
  return !toPosix(relativePath)
    .split("/")
    .filter(Boolean)
    .some((segment) => segment.startsWith("_"));
}

async function discoverPagesRelativeDirectories(appRoot) {
  const pagesRoot = path.join(appRoot, "src", "pages");
  const directories = await walkDirectory(pagesRoot, {
    includeDirectories: true,
    includeFiles: false
  });
  return uniqueSorted(
    directories
      .map((directoryPath) => path.relative(pagesRoot, directoryPath))
      .filter(Boolean)
      .filter((relativePath) => isRouteLikeRelativePath(relativePath))
      .map((relativePath) => ensureTrailingSlash(relativePath))
  );
}

async function discoverPagesRelativeFiles(appRoot) {
  const pagesRoot = path.join(appRoot, "src", "pages");
  const files = await walkDirectory(pagesRoot, {
    includeDirectories: false,
    includeFiles: true,
    fileFilter: (filePath) => filePath.endsWith(".vue")
  });
  return uniqueSorted(
    files
      .map((filePath) => path.relative(pagesRoot, filePath))
      .filter((relativePath) => isRouteLikeRelativePath(relativePath))
      .map((relativePath) => toPosix(relativePath))
  );
}

async function discoverAppVueFiles(appRoot) {
  const srcRoot = path.join(appRoot, "src");
  const files = await walkDirectory(srcRoot, {
    includeDirectories: false,
    includeFiles: true,
    fileFilter: (filePath) => filePath.endsWith(".vue")
  });
  return uniqueSorted(files.map((filePath) => toPosix(path.relative(appRoot, filePath))));
}

function buildOptionSuggestions(optionNames = [], { current = "", seenOptionNames = new Set() } = {}) {
  const suggestions = [];
  for (const optionName of optionNames) {
    if (!optionName) {
      continue;
    }
    if (seenOptionNames.has(optionName) && !BOOLEAN_OPTION_NAMES.has(optionName)) {
      continue;
    }
    suggestions.push(`--${optionName}`);
  }
  return filterByPrefix(suggestions, current);
}

function parseOptionToken(token = "") {
  const normalized = String(token || "");
  if (!normalized.startsWith("--")) {
    return null;
  }
  const withoutPrefix = normalized.slice(2);
  if (!withoutPrefix) {
    return null;
  }
  const equalsIndex = withoutPrefix.indexOf("=");
  if (equalsIndex < 0) {
    return {
      name: withoutPrefix,
      value: "",
      hasInlineValue: false
    };
  }
  return {
    name: withoutPrefix.slice(0, equalsIndex),
    value: withoutPrefix.slice(equalsIndex + 1),
    hasInlineValue: true
  };
}

function parseContextTokens(tokens = [], optionMeta = {}) {
  const positionals = [];
  const seenOptionNames = new Set();
  const optionValues = new Map();
  let expectValueFor = "";

  for (const token of Array.isArray(tokens) ? tokens : []) {
    if (expectValueFor) {
      optionValues.set(expectValueFor, token);
      seenOptionNames.add(expectValueFor);
      expectValueFor = "";
      continue;
    }

    const parsedOption = parseOptionToken(token);
    if (parsedOption) {
      const optionName = normalizeText(parsedOption.name);
      if (!optionName) {
        continue;
      }
      const meta = optionMeta[optionName] || {};
      seenOptionNames.add(optionName);
      if (parsedOption.hasInlineValue) {
        optionValues.set(optionName, parsedOption.value);
        continue;
      }
      if (normalizeText(meta.inputType) === "flag" || BOOLEAN_OPTION_NAMES.has(optionName)) {
        optionValues.set(optionName, "true");
        continue;
      }
      expectValueFor = optionName;
      continue;
    }

    positionals.push(token);
  }

  return Object.freeze({
    positionals: Object.freeze(positionals),
    optionValues,
    seenOptionNames,
    expectValueFor
  });
}

function resolveCurrentOptionValueRequest({ currentToken = "", previousToken = "", optionMeta = {} } = {}) {
  const previousOption = parseOptionToken(previousToken);
  if (previousOption && !previousOption.hasInlineValue) {
    const meta = optionMeta[previousOption.name] || {};
    if (normalizeText(meta.inputType) !== "flag" && !BOOLEAN_OPTION_NAMES.has(previousOption.name)) {
      return {
        optionName: previousOption.name,
        valuePrefix: currentToken,
        includeOptionPrefix: false
      };
    }
  }

  const currentOption = parseOptionToken(currentToken);
  if (currentOption && currentOption.hasInlineValue) {
    const meta = optionMeta[currentOption.name] || {};
    if (normalizeText(meta.inputType) !== "flag" && !BOOLEAN_OPTION_NAMES.has(currentOption.name)) {
      return {
        optionName: currentOption.name,
        valuePrefix: currentOption.value,
        includeOptionPrefix: true
      };
    }
  }

  return null;
}

function completeCommaSeparatedValues({ currentValue = "", allowedValues = [] } = {}) {
  const source = String(currentValue || "");
  const segments = source.split(",");
  segments.pop();
  const used = new Set(segments.map((entry) => normalizeText(entry)).filter(Boolean));
  const prefix = segments.length > 0 ? `${segments.join(",")},` : "";

  return filterByPrefix(
    allowedValues.filter((value) => !used.has(value)).map((value) => `${prefix}${value}`),
    source
  );
}

function extractBracketParams(value = "") {
  return [...String(value || "").matchAll(/\[([^\]/]+)\]/g)].map((match) => normalizeText(match?.[1])).filter(Boolean);
}

async function completeOptionValue({
  appRoot,
  optionName = "",
  valuePrefix = "",
  includeOptionPrefix = false,
  parseState,
  currentGenerator = "",
  optionMeta = {}
} = {}) {
  const normalizedOptionName = normalizeText(optionName);
  const descriptorOption = optionMeta?.descriptorOption || {};
  const validationType = normalizeText(descriptorOption?.validationType).toLowerCase();
  const allowedValues = resolveAllowedValues(descriptorOption);
  let suggestions = [];

  if (normalizedOptionName === "resource-file") {
    suggestions = await discoverResourceFiles(appRoot);
  } else if (["link-placement", "placement", "target"].includes(normalizedOptionName)) {
    suggestions = await discoverPlacementTargets(appRoot);
  } else if (normalizedOptionName === "link-component-token") {
    suggestions = await discoverComponentTokens(appRoot);
  } else if (normalizedOptionName === "surface") {
    suggestions = await discoverSurfaces(appRoot);
  } else if (validationType === "csv-enum" && allowedValues.length > 0) {
    suggestions = completeCommaSeparatedValues({
      currentValue: valuePrefix,
      allowedValues
    });
  } else if (validationType === "enum" && allowedValues.length > 0) {
    suggestions = allowedValues;
  } else if (normalizedOptionName === "display-fields") {
    const resourceFile = normalizeText(parseState?.optionValues?.get("resource-file"));
    const fields = await discoverResourceDisplayFields(appRoot, resourceFile);
    suggestions = completeCommaSeparatedValues({
      currentValue: valuePrefix,
      allowedValues: fields
    });
  } else if (normalizedOptionName === "prefix") {
    const tokens = await discoverComponentTokens(appRoot);
    const prefixes = new Set();
    for (const token of tokens) {
      const segments = String(token || "").split(".").filter(Boolean);
      let currentPrefix = "";
      for (const segment of segments.slice(0, -1)) {
        currentPrefix = currentPrefix ? `${currentPrefix}.${segment}` : segment;
        prefixes.add(`${currentPrefix}.`);
      }
    }
    suggestions = [...prefixes];
  } else if (normalizedOptionName === "id-param") {
    const dynamicParams = new Set(["recordId"]);
    for (const positional of parseState?.positionals || []) {
      for (const param of extractBracketParams(positional)) {
        dynamicParams.add(param);
      }
    }
    suggestions = [...dynamicParams];
  } else if (normalizedOptionName === "table-name" && currentGenerator === "crud-server-generator") {
    suggestions = [];
  }

  suggestions = filterByPrefix(suggestions, valuePrefix);
  if (!includeOptionPrefix) {
    return suggestions;
  }
  return suggestions.map((value) => `--${normalizedOptionName}=${value}`);
}

async function discoverResourceDisplayFields(appRoot, resourceFile = "") {
  const normalizedPath = normalizeText(resourceFile);
  if (!normalizedPath) {
    return [];
  }

  const absolutePath = path.resolve(appRoot, normalizedPath);
  if (!absolutePath.startsWith(`${appRoot}${path.sep}`) && absolutePath !== appRoot) {
    return [];
  }
  if (!(await pathExists(absolutePath))) {
    return [];
  }

  try {
    const imported = await import(`${pathToFileURL(absolutePath).href}?mtime=${Date.now()}`);
    const resource = imported?.resource;
    if (!resource || typeof resource !== "object") {
      return [];
    }
    return uniqueSorted(Object.keys(buildCrudFieldContractMap(resource)));
  } catch {
    return [];
  }
}

async function completeRelativeDirectoryRoot(appRoot, current = "") {
  return filterByPrefix(await discoverPagesRelativeDirectories(appRoot), current);
}

async function completeRelativePageTargetFile(appRoot, current = "") {
  return filterByPrefix(
    [...(await discoverPagesRelativeDirectories(appRoot)), ...(await discoverPagesRelativeFiles(appRoot))],
    current
  );
}

async function completeAppVueFile(appRoot, current = "") {
  return filterByPrefix(await discoverAppVueFiles(appRoot), current);
}

function normalizeCompletionInvocation(words = [], cword = 0) {
  const rawWords = (Array.isArray(words) ? words : []).map((value) => String(value ?? ""));
  let currentIndex = Number(cword);
  if (!Number.isInteger(currentIndex)) {
    currentIndex = Math.max(rawWords.length - 1, 0);
  }

  if (rawWords.length < 1) {
    return {
      words: ["jskit"],
      cword: 0,
      wrapperOnly: false
    };
  }

  if (WRAPPER_COMMANDS.has(rawWords[0])) {
    const jskitIndex = rawWords.findIndex((token, index) => index > 0 && ["jskit", "@jskit-ai/jskit-cli"].includes(token));
    if (jskitIndex < 0) {
      return {
        words: rawWords,
        cword: currentIndex,
        wrapperOnly: true
      };
    }
    const normalizedWords = rawWords.slice(jskitIndex);
    return {
      words: normalizedWords,
      cword: Math.max(0, currentIndex - jskitIndex),
      wrapperOnly: false
    };
  }

  return {
    words: rawWords[0] === "@jskit-ai/jskit-cli" ? ["jskit", ...rawWords.slice(1)] : rawWords,
    cword: currentIndex,
    wrapperOnly: false
  };
}

function buildTopLevelCommandMetadata(catalogModule) {
  const commands = new Set();
  for (const commandId of catalogModule.COMMAND_IDS || []) {
    const descriptor = catalogModule.resolveCommandDescriptor(commandId);
    if (!descriptor) {
      continue;
    }
    commands.add(descriptor.command);
    for (const alias of Array.isArray(descriptor.aliases) ? descriptor.aliases : []) {
      commands.add(alias);
    }
  }
  commands.add("help");
  return uniqueSorted([...commands]);
}

function buildCommandOptionMeta(command = "", catalogModule) {
  const descriptor = catalogModule.resolveCommandDescriptor(command);
  if (!descriptor) {
    return {};
  }

  const optionMeta = {};
  for (const flagKey of Array.isArray(descriptor.allowedFlagKeys) ? descriptor.allowedFlagKeys : []) {
    const labels = {
      dryRun: "dry-run",
      runNpmInstall: "run-npm-install",
      devlinks: "devlinks",
      full: "full",
      expanded: "expanded",
      details: "details",
      debugExports: "debug-exports",
      checkDiLabels: "check-di-labels",
      verbose: "verbose",
      json: "json",
      all: "all"
    };
    const optionName = labels[flagKey];
    if (optionName) {
      optionMeta[optionName] = { inputType: "flag" };
    }
  }
  for (const optionName of Array.isArray(descriptor.allowedValueOptionNames) ? descriptor.allowedValueOptionNames : []) {
    optionMeta[optionName] = { inputType: "text" };
  }
  optionMeta.help = { inputType: "flag" };
  return optionMeta;
}

function buildGeneratorLookup(generators = []) {
  const lookup = new Map();
  for (const generator of generators) {
    lookup.set(generator.shortId, generator);
    lookup.set(generator.packageId, generator);
  }
  return lookup;
}

function buildGeneratorOptionMeta(generator = null, subcommandName = "") {
  const optionMeta = {};
  for (const optionName of KNOWN_GENERATE_FLAG_OPTIONS) {
    optionMeta[optionName] = { inputType: "flag" };
  }
  optionMeta.help = { inputType: "flag" };

  const descriptorOptions = generator?.descriptor?.options && typeof generator.descriptor.options === "object"
    ? generator.descriptor.options
    : {};
  const subcommand = generator?.descriptor?.metadata?.generatorSubcommands?.[subcommandName] || {};
  for (const optionName of Array.isArray(subcommand.optionNames) ? subcommand.optionNames : []) {
    const descriptorOption = descriptorOptions?.[optionName] || {};
    optionMeta[optionName] = {
      inputType: normalizeText(descriptorOption.inputType) || (BOOLEAN_OPTION_NAMES.has(optionName) ? "flag" : "text"),
      descriptorOption
    };
  }
  return optionMeta;
}

function resolveImplicitGeneratorSubcommand(generator = null, tokensAfterGenerator = [], currentToken = "") {
  const metadata = generator?.descriptor?.metadata || {};
  const subcommands = metadata.generatorSubcommands && typeof metadata.generatorSubcommands === "object"
    ? metadata.generatorSubcommands
    : {};
  const tokenList = Array.isArray(tokensAfterGenerator) ? tokensAfterGenerator : [];
  const firstToken = normalizeText(tokenList[0]);

  if (firstToken && !firstToken.startsWith("-") && firstToken !== "help" && Object.hasOwn(subcommands, firstToken)) {
    return {
      subcommandName: firstToken,
      explicit: true,
      offset: 1
    };
  }

  const primarySubcommand = normalizeText(metadata.generatorPrimarySubcommand);
  if (!primarySubcommand || !Object.hasOwn(subcommands, primarySubcommand)) {
    return {
      subcommandName: "",
      explicit: false,
      offset: 0
    };
  }

  const hasOptionUsage = tokenList.some((token) => String(token || "").startsWith("--")) || String(currentToken || "").startsWith("--");
  if (!hasOptionUsage) {
    return {
      subcommandName: "",
      explicit: false,
      offset: 0
    };
  }

  return {
    subcommandName: primarySubcommand,
    explicit: false,
    offset: 0
  };
}

async function completeGenericContext({
  appRoot,
  currentToken = "",
  previousToken = "",
  optionMeta = {},
  positionalArgs = [],
  tokensBeforeCurrent = [],
  optionNames = [],
  positionalCompleter = null,
  generatorName = "",
  subcommandName = ""
} = {}) {
  const parseState = parseContextTokens(tokensBeforeCurrent, optionMeta);
  const optionValueRequest = resolveCurrentOptionValueRequest({
    currentToken,
    previousToken,
    optionMeta
  });
  if (optionValueRequest) {
    return completeOptionValue({
      appRoot,
      optionName: optionValueRequest.optionName,
      valuePrefix: optionValueRequest.valuePrefix,
      includeOptionPrefix: optionValueRequest.includeOptionPrefix,
      parseState,
      currentSubcommand: subcommandName,
      currentGenerator: generatorName,
      optionMeta: optionMeta[optionValueRequest.optionName] || {}
    });
  }

  if (String(currentToken || "").startsWith("--")) {
    return buildOptionSuggestions(optionNames, {
      current: currentToken,
      seenOptionNames: parseState.seenOptionNames
    });
  }

  const positionalIndex = parseState.positionals.length;
  const suggestions = [];
  if (typeof positionalCompleter === "function") {
    suggestions.push(
      ...(await positionalCompleter({
        positionalIndex,
        currentToken,
        parseState,
        positionalArgs,
        appRoot,
        generatorName,
        subcommandName
      }))
    );
  }

  if (!currentToken) {
    suggestions.push(
      ...buildOptionSuggestions(optionNames, {
        current: currentToken,
        seenOptionNames: parseState.seenOptionNames
      })
    );
  }

  return uniqueSorted(suggestions);
}

async function completeTopLevel({ currentToken = "", catalogModule }) {
  const commandSuggestions = buildTopLevelCommandMetadata(catalogModule);
  if (String(currentToken || "").startsWith("-")) {
    return filterByPrefix(["--help"], currentToken);
  }
  return filterByPrefix([...commandSuggestions, "--help"], currentToken);
}

async function completeGenerateCommand({ appRoot, words, cword, catalogModule }) {
  const currentToken = words[cword] ?? "";
  const previousToken = words[cword - 1] ?? "";
  const generators = await discoverGenerators(appRoot);
  const generatorLookup = buildGeneratorLookup(generators);

  if (cword <= 2) {
    const generatorIds = uniqueSorted(
      generators.flatMap((generator) => [generator.shortId, generator.packageId])
    );
    if (String(currentToken || "").startsWith("-")) {
      return buildOptionSuggestions(KNOWN_GENERATE_FLAG_OPTIONS, {
        current: currentToken,
        seenOptionNames: parseContextTokens(words.slice(2, cword), buildCommandOptionMeta("generate", catalogModule)).seenOptionNames
      });
    }
    return filterByPrefix([...generatorIds, ...KNOWN_GENERATE_FLAG_OPTIONS.map((name) => `--${name}`)], currentToken);
  }

  const generatorToken = normalizeText(words[2]);
  const generator = generatorLookup.get(generatorToken);
  if (!generator) {
    return [];
  }

  const generatorContext = resolveImplicitGeneratorSubcommand(generator, words.slice(3, cword), currentToken);
  const metadata = generator?.descriptor?.metadata || {};
  const subcommands = metadata.generatorSubcommands && typeof metadata.generatorSubcommands === "object"
    ? metadata.generatorSubcommands
    : {};

  if (!generatorContext.subcommandName && cword <= 3) {
    const subcommandNames = uniqueSorted([...Object.keys(subcommands), "help"]);
    if (String(currentToken || "").startsWith("-")) {
      return buildOptionSuggestions(KNOWN_GENERATE_FLAG_OPTIONS, {
        current: currentToken,
        seenOptionNames: parseContextTokens(words.slice(3, cword), buildCommandOptionMeta("generate", catalogModule)).seenOptionNames
      });
    }
    return filterByPrefix([...subcommandNames, ...KNOWN_GENERATE_FLAG_OPTIONS.map((name) => `--${name}`)], currentToken);
  }

  if (!generatorContext.subcommandName) {
    return filterByPrefix(uniqueSorted([...Object.keys(subcommands), "help"]), currentToken);
  }

  const subcommandName = generatorContext.subcommandName;
  const subcommand = subcommands[subcommandName] || {};
  const optionMeta = buildGeneratorOptionMeta(generator, subcommandName);
  const optionNames = uniqueSorted(Object.keys(optionMeta));
  const tokensBeforeCurrent = words.slice(3 + generatorContext.offset, cword);

  return completeGenericContext({
    appRoot,
    currentToken,
    previousToken,
    optionMeta,
    positionalArgs: Array.isArray(subcommand.positionalArgs) ? subcommand.positionalArgs : [],
    tokensBeforeCurrent,
    optionNames,
    generatorName: generator.shortId,
    subcommandName,
    positionalCompleter: async ({ positionalIndex, currentToken: currentPositional }) => {
      if (currentToken === "help" || previousToken === "help") {
        return [];
      }
      if (generator.shortId === "crud-ui-generator" && subcommandName === "crud" && positionalIndex === 0) {
        return completeRelativeDirectoryRoot(appRoot, currentPositional);
      }
      if (generator.shortId === "crud-ui-generator" && subcommandName === "field") {
        if (positionalIndex === 1) {
          return filterByPrefix(await discoverResourceFiles(appRoot), currentPositional);
        }
      }
      if (generator.shortId === "crud-server-generator" && subcommandName === "scaffold-field" && positionalIndex === 1) {
        return filterByPrefix(await discoverResourceFiles(appRoot), currentPositional);
      }
      if (generator.shortId === "ui-generator" && ["page", "add-subpages"].includes(subcommandName) && positionalIndex === 0) {
        return completeRelativePageTargetFile(appRoot, currentPositional);
      }
      if (generator.shortId === "ui-generator" && subcommandName === "outlet" && positionalIndex === 0) {
        return completeAppVueFile(appRoot, currentPositional);
      }
      return [];
    }
  });
}

async function completeCommand({ appRoot, words, cword, catalogModule }) {
  const currentToken = words[cword] ?? "";
  const commandToken = normalizeText(words[1]);
  const command = catalogModule.resolveCommandAlias(commandToken);
  const previousToken = words[cword - 1] ?? "";

  if (!command || !catalogModule.isKnownCommandName(command)) {
    return completeTopLevel({ appRoot, currentToken, catalogModule });
  }

  if (command === "generate") {
    return completeGenerateCommand({ appRoot, words, cword, catalogModule });
  }
  if (command === "app") {
    const appCommandNames = listAppCommandDefinitions().map((entry) => entry.name);
    const currentTokenForApp = words[cword] ?? "";
    const subcommandName = normalizeText(words[2]);
    if (cword <= 2) {
      return filterByPrefix(appCommandNames, currentTokenForApp);
    }

    if (!subcommandName || !appCommandNames.includes(subcommandName)) {
      return filterByPrefix(appCommandNames, currentTokenForApp);
    }

    const previousTokenForApp = words[cword - 1] ?? "";
    const optionMetaForApp = buildAppCommandOptionMeta(subcommandName);
    return completeGenericContext({
      appRoot,
      currentToken: currentTokenForApp,
      previousToken: previousTokenForApp,
      optionMeta: optionMetaForApp,
      tokensBeforeCurrent: words.slice(3, cword),
      optionNames: uniqueSorted(Object.keys(optionMetaForApp)),
      positionalCompleter: async ({ positionalIndex, currentToken: positionalCurrent }) => {
        if (positionalIndex === 0) {
          return filterByPrefix(["help"], positionalCurrent);
        }
        return [];
      }
    });
  }

  const optionMeta = buildCommandOptionMeta(command, catalogModule);
  const optionNames = uniqueSorted(Object.keys(optionMeta));
  const tokensBeforeCurrent = words.slice(2, cword);

  return completeGenericContext({
    appRoot,
    currentToken,
    previousToken,
    optionMeta,
    tokensBeforeCurrent,
    optionNames,
    positionalCompleter: async ({ positionalIndex, currentToken: positionalCurrent, parseState }) => {
      if (command === "help" && positionalIndex === 0) {
        return filterByPrefix(buildTopLevelCommandMetadata(catalogModule), positionalCurrent);
      }
      if (command === "create" && positionalIndex === 0) {
        return filterByPrefix(["package"], positionalCurrent);
      }
      if (command === "add") {
        if (positionalIndex === 0) {
          return filterByPrefix(ADD_TARGET_TYPES, positionalCurrent);
        }
        if (positionalIndex === 1) {
          if (parseState.positionals[0] === "package") {
            return filterByPrefix(await discoverRuntimePackages(appRoot), positionalCurrent);
          }
          if (parseState.positionals[0] === "bundle") {
            return filterByPrefix(await discoverBundleIds(appRoot), positionalCurrent);
          }
        }
      }
      if (command === "list" && positionalIndex === 0) {
        return filterByPrefix(LIST_MODES, positionalCurrent);
      }
      if (command === "show" && positionalIndex === 0) {
        return filterByPrefix(
          [...(await discoverRuntimePackages(appRoot)), ...(await discoverBundleIds(appRoot))],
          positionalCurrent
        );
      }
      if (command === "migrations") {
        if (positionalIndex === 0) {
          return filterByPrefix(MIGRATION_SCOPES, positionalCurrent);
        }
        if (positionalIndex === 1 && parseState.positionals[0] === "package") {
          return filterByPrefix(await discoverRuntimePackages(appRoot), positionalCurrent);
        }
      }
      if (command === "position") {
        if (positionalIndex === 0) {
          return filterByPrefix(POSITION_TARGET_TYPES, positionalCurrent);
        }
        if (positionalIndex === 1 && parseState.positionals[0] === "element") {
          return filterByPrefix(await discoverRuntimePackages(appRoot), positionalCurrent);
        }
      }
      if (command === "update") {
        if (positionalIndex === 0) {
          return filterByPrefix(UPDATE_TARGET_TYPES, positionalCurrent);
        }
        if (positionalIndex === 1 && parseState.positionals[0] === "package") {
          return filterByPrefix(await discoverRuntimePackages(appRoot), positionalCurrent);
        }
      }
      if (command === "remove") {
        if (positionalIndex === 0) {
          return filterByPrefix(REMOVE_TARGET_TYPES, positionalCurrent);
        }
        if (positionalIndex === 1 && parseState.positionals[0] === "package") {
          return filterByPrefix(await discoverRuntimePackages(appRoot), positionalCurrent);
        }
      }
      return [];
    }
  });
}

async function getCompletions({ appRoot = process.cwd(), words = [], cword = 0 } = {}) {
  const normalized = normalizeCompletionInvocation(words, cword);
  const currentToken = normalized.words[normalized.cword] ?? "";

  if (normalized.wrapperOnly) {
    return filterByPrefix(["jskit"], currentToken);
  }

  if (normalized.words[0] !== "jskit") {
    return filterByPrefix(["jskit"], currentToken);
  }

  const catalogModule = await loadCommandCatalog(appRoot);
  if (normalized.cword <= 1) {
    return completeTopLevel({ appRoot, currentToken, catalogModule });
  }

  return completeCommand({
    appRoot,
    words: normalized.words,
    cword: normalized.cword,
    catalogModule
  });
}

function renderBashCompletionScript() {
  return `# shellcheck shell=bash

_jskit_completion() {
  local first_word="\${COMP_WORDS[0]}"
  local second_word="\${COMP_WORDS[1]}"

  if [[ "$first_word" == "npx" || "$first_word" == "jsx" ]]; then
    if (( COMP_CWORD == 1 )); then
      COMPREPLY=( $(compgen -W "jskit" -- "\${COMP_WORDS[COMP_CWORD]}") )
      return 0
    fi
    if [[ "$second_word" != "jskit" && "$second_word" != "@jskit-ai/jskit-cli" ]]; then
      return 1
    fi
  elif [[ "$first_word" != "jskit" ]]; then
    return 1
  fi

  mapfile -t COMPREPLY < <(
    npx jskit completion bash __complete__ "$COMP_CWORD" -- "\${COMP_WORDS[@]}"
  ) || return 1

  if ((\${#COMPREPLY[@]} == 0)); then
    return 1
  fi

  return 0
}
complete -o bashdefault -o default -F _jskit_completion npx
complete -o bashdefault -o default -F _jskit_completion jsx
complete -o bashdefault -o default -F _jskit_completion jskit
`;
}

export {
  discoverPlacementTargets,
  discoverResourceDisplayFields,
  discoverResourceFiles,
  discoverSurfaces,
  getCompletions,
  normalizeCompletionInvocation,
  renderBashCompletionScript
};
