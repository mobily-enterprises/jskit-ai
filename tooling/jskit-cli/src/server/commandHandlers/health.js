import {
  readdir,
  readFile
} from "node:fs/promises";
import { createRequire } from "node:module";
import { importFreshModuleFromAbsolutePath } from "@jskit-ai/kernel/server/support";
import {
  ensureArray,
  ensureObject,
  sortStrings
} from "../shared/collectionUtils.js";
import {
  UI_VERIFICATION_RECEIPT_RELATIVE_PATH,
  isValidUiVerificationReceipt,
  normalizeUiVerificationReceipt,
  resolveChangedUiFilesFromGit
} from "../shared/uiVerification.js";

function createHealthCommands(ctx = {}) {
  const {
    directoryLooksLikeJskitAppRoot,
    resolveAppRootFromCwd,
    loadLockFile,
    loadPackageRegistry,
    loadBundleRegistry,
    loadAppLocalPackageRegistry,
    mergePackageRegistries,
    hydratePackageRegistryFromInstalledNodeModules,
    inspectPackageOfferings,
    fileExists,
    normalizeRelativePath,
    path
  } = ctx;

  const APP_SOURCE_SCAN_ROOTS = Object.freeze([
    "src",
    "packages"
  ]);
  const APP_SOURCE_IGNORED_DIRECTORY_NAMES = new Set([
    ".git",
    ".jskit",
    ".build",
    "coverage",
    "dist",
    "docs",
    "LEGACY",
    "node_modules",
    "test",
    "tests",
    "__tests__"
  ]);
  const APP_SOURCE_IGNORED_FILE_PATTERNS = Object.freeze([
    /\.spec\./i,
    /\.test\./i,
    /\.vitest\./i
  ]);
  const APP_SOURCE_CODE_EXTENSIONS = new Set([
    ".cjs",
    ".js",
    ".jsx",
    ".mjs",
    ".ts",
    ".tsx",
    ".vue"
  ]);
  const VUE_SOURCE_EXTENSIONS = new Set([".vue"]);
  const MDI_SVG_MAIN_ENTRY_CANDIDATES = Object.freeze([
    "src/main.js",
    "src/main.mjs",
    "src/main.ts"
  ]);
  const DIRECT_MDI_LITERAL_ICON_PATTERN =
    /<(v-[a-z0-9-]+)[^>]*?\b(icon|prepend-icon|append-icon)\s*=\s*(['"])(mdi-[^'"]+)\3/gi;
  const DIRECT_MDI_BOUND_LITERAL_ICON_PATTERN =
    /<(v-[a-z0-9-]+)[^>]*?(?::|v-bind:)(icon|prepend-icon|append-icon)\s*=\s*(['"])(['"])(mdi-[^'"]+)\4\3/gi;
  const FILTER_RUNTIME_CALLEES = Object.freeze([
    "createCrudListFilters",
    "useCrudListFilters"
  ]);
  const CRUD_TRANSPORT_RUNTIME_CALLEES = Object.freeze([
    "useCrudList",
    "useCrudView",
    "useCrudAddEdit"
  ]);
  const FEATURE_SERVER_SCAFFOLD_SHAPE = "feature-server-v1";
  const CRUD_SERVER_SCAFFOLD_SHAPE = "crud-server-v1";
  const USERS_CORE_BASELINE_CRUD_SCAFFOLD_SHAPE = "users-core-crud-v1";
  const FEATURE_SERVER_DEFAULT_LANE = "default";
  const FEATURE_SERVER_JSON_REST_MODE = "json-rest";
  const FEATURE_SERVER_PERSISTENT_MODES = new Set([
    "json-rest",
    "custom-knex"
  ]);
  const TABLE_OWNERSHIP_RELATIVE_PATH = ".jskit/table-ownership.json";
  const TABLE_OWNERSHIP_VERSION = 1;
  const TABLE_OWNERSHIP_EXCEPTION_CATEGORIES = new Set([
    "audit-log",
    "join-table",
    "outbox",
    "projection-cache",
    "workflow-state"
  ]);
  const TABLE_OWNERSHIP_AUXILIARY_INHERITED_OWNER_EXCEPTION_CATEGORIES = new Set([
    "audit-log",
    "join-table",
    "outbox",
    "projection-cache"
  ]);
  const KNEX_SYSTEM_TABLE_NAMES = new Set([
    "knex_migrations",
    "knex_migrations_lock"
  ]);
  const DIRECT_OWNER_COLUMNS = Object.freeze({
    user: "user_id",
    workspace: "workspace_id"
  });
  const DIRECT_OWNER_KINDS = Object.freeze(Object.keys(DIRECT_OWNER_COLUMNS));
  const CRUD_OWNERSHIP_FILTER_LITERAL_PATTERN = /\bownershipFilter\s*:\s*"([A-Za-z_]+)"/u;
  const FEATURE_SERVER_COMPLEX_MARKER_RELATIVE_PATHS = Object.freeze([
    "src/server/inputSchemas.js",
    "src/server/actions.js",
    "src/server/service.js",
    "src/server/repository.js",
    "src/server/registerRoutes.js"
  ]);
  const FEATURE_SERVER_PERSISTENCE_IMPORT_SOURCE_PATTERNS = Object.freeze([
    /^@jskit-ai\/json-rest-api-core(?:\/|$)/u,
    /^@jskit-ai\/database-runtime(?:\/|$)/u,
    /^@jskit-ai\/database-runtime-mysql(?:\/|$)/u,
    /^knex(?:\/|$)/u,
    /^\.{1,2}\/.*repository(?:\.[A-Za-z0-9]+)?$/u
  ]);
  const MAIN_SERVER_BASELINE_RELATIVE_PATHS = new Set([
    "src/server/index.js",
    "src/server/MainServiceProvider.js",
    "src/server/loadAppConfig.js"
  ]);
  const MAIN_SERVER_DOMAIN_FILE_PATTERN =
    /^src\/server\/(?!(?:index|MainServiceProvider|loadAppConfig)\.[A-Za-z0-9]+$).+/u;
  const APP_LOCAL_DIRECT_KNEX_PATTERN_ENTRIES = Object.freeze([
    { pattern: /\bjskit\.database\.knex\b/u, label: "jskit.database.knex" },
    { pattern: /\bcreateWithTransaction\s*\(/u, label: "createWithTransaction(...)" },
    { pattern: /\bknex\s*\(/u, label: "knex(...)" },
    { pattern: /\bknex\./u, label: "knex." },
    { pattern: /from\s+["']knex["']/u, label: 'import "knex"' }
  ]);

  function collectDescriptorContainerTokens({ packageId, side, values, issues }) {
    const declaredTokens = new Set();
    const duplicateTokens = new Set();
    let invalidCount = 0;

    for (const rawValue of ensureArray(values)) {
      if (typeof rawValue !== "string") {
        invalidCount += 1;
        continue;
      }
      const token = rawValue.trim();
      if (!token) {
        invalidCount += 1;
        continue;
      }
      if (declaredTokens.has(token)) {
        duplicateTokens.add(token);
        continue;
      }
      declaredTokens.add(token);
    }

    if (invalidCount > 0) {
      issues.push({
        packageId,
        side,
        code: "descriptor-token-invalid",
        message: `${packageId} (${side}): metadata.apiSummary.containerTokens includes ${invalidCount} non-string or empty token value(s).`
      });
    }
    for (const token of sortStrings([...duplicateTokens])) {
      issues.push({
        packageId,
        side,
        code: "descriptor-token-duplicate",
        token,
        message: `${packageId} (${side}): descriptor token is declared more than once: ${token}.`
      });
    }

    return declaredTokens;
  }

  function collectUsedContainerTokens({ packageId, side, bindings, issues }) {
    const usedTokens = new Set();
    for (const rawBinding of ensureArray(bindings)) {
      const binding = ensureObject(rawBinding);
      const tokenExpression = String(binding.tokenExpression || "").trim();
      const token = String(binding.token || "").trim();
      const location = String(binding.location || "").trim();
      if (binding.tokenResolved !== true || !token) {
        const expressionLabel = tokenExpression || "<empty>";
        const locationSuffix = location ? ` at ${location}` : "";
        issues.push({
          packageId,
          side,
          code: "binding-token-unresolved",
          tokenExpression: expressionLabel,
          location,
          message: `${packageId} (${side}): unresolved DI token expression "${expressionLabel}"${locationSuffix}.`
        });
        continue;
      }
      usedTokens.add(token);
    }
    return usedTokens;
  }

  function collectProviderIntrospectionIssues({ packageId, packageInsights, issues }) {
    const introspection = ensureObject(packageInsights);
    if (!introspection.available) {
      issues.push({
        packageId,
        side: "",
        code: "provider-introspection-unavailable",
        message: `${packageId}: provider source introspection is unavailable, so DI token parity cannot be verified.`
      });
      return;
    }

    const notes = ensureArray(introspection.notes).map((value) => String(value || "").trim()).filter(Boolean);
    for (const note of notes) {
      if (
        note.startsWith("Skipped wildcard provider entrypoint during introspection:") ||
        note.startsWith("Provider file missing during introspection:") ||
        note.startsWith("Failed reading provider ")
      ) {
        issues.push({
          packageId,
          side: "",
          code: "provider-introspection-incomplete",
          message: `${packageId}: ${note}`
        });
      }
    }
  }

  function shouldSkipAppSourceDirectory(directoryName = "") {
    return APP_SOURCE_IGNORED_DIRECTORY_NAMES.has(String(directoryName || "").trim());
  }

  function shouldSkipAppSourceFile(
    fileName = "",
    {
      extensions = APP_SOURCE_CODE_EXTENSIONS,
      ignoredFilePatterns = APP_SOURCE_IGNORED_FILE_PATTERNS
    } = {}
  ) {
    const normalizedFileName = String(fileName || "").trim();
    const extension = path.extname(normalizedFileName).toLowerCase();
    if (!extensions.has(extension)) {
      return true;
    }
    return ignoredFilePatterns.some((pattern) => pattern.test(normalizedFileName));
  }

  async function collectAppSourceFiles(
    rootDirectory,
    {
      extensions = APP_SOURCE_CODE_EXTENSIONS,
      ignoredFilePatterns = APP_SOURCE_IGNORED_FILE_PATTERNS
    } = {},
    collected = []
  ) {
    if (!(await fileExists(rootDirectory))) {
      return collected;
    }

    const entries = await readdir(rootDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const entryPath = path.join(rootDirectory, entry.name);
      if (entry.isDirectory()) {
        if (shouldSkipAppSourceDirectory(entry.name)) {
          continue;
        }
        await collectAppSourceFiles(
          entryPath,
          {
            extensions,
            ignoredFilePatterns
          },
          collected
        );
        continue;
      }
      if (
        entry.isFile() &&
        !shouldSkipAppSourceFile(entry.name, {
          extensions,
          ignoredFilePatterns
        })
      ) {
        collected.push(entryPath);
      }
    }

    return collected;
  }

  async function appUsesVuetifyMdiSvg(appRoot) {
    for (const relativePath of MDI_SVG_MAIN_ENTRY_CANDIDATES) {
      const absolutePath = path.join(appRoot, relativePath);
      if (!(await fileExists(absolutePath))) {
        continue;
      }
      const fileContent = await readFile(absolutePath, "utf8");
      if (fileContent.includes("vuetify/iconsets/mdi-svg")) {
        return true;
      }
    }

    return false;
  }

  function resolveLineNumberFromIndex(sourceText = "", index = 0) {
    return String(sourceText || "").slice(0, Math.max(0, index)).split("\n").length;
  }

  function collectDirectMdiSvgTemplateIconIssues({ sourceText, relativePath, issues }) {
    DIRECT_MDI_LITERAL_ICON_PATTERN.lastIndex = 0;
    for (const match of sourceText.matchAll(DIRECT_MDI_LITERAL_ICON_PATTERN)) {
      const [, tagName = "v-component", propName = "icon", , rawIcon = ""] = match;
      const lineNumber = resolveLineNumberFromIndex(sourceText, match.index || 0);
      issues.push(
        `${relativePath}:${lineNumber}: raw "${rawIcon}" passed to <${tagName}> ${propName} while the app uses vuetify/iconsets/mdi-svg. Use an @mdi/js path or a Vuetify alias.`
      );
    }

    DIRECT_MDI_BOUND_LITERAL_ICON_PATTERN.lastIndex = 0;
    for (const match of sourceText.matchAll(DIRECT_MDI_BOUND_LITERAL_ICON_PATTERN)) {
      const [, tagName = "v-component", propName = "icon", , , rawIcon = ""] = match;
      const lineNumber = resolveLineNumberFromIndex(sourceText, match.index || 0);
      issues.push(
        `${relativePath}:${lineNumber}: raw "${rawIcon}" passed to <${tagName}> ${propName} while the app uses vuetify/iconsets/mdi-svg. Use an @mdi/js path or a Vuetify alias.`
      );
    }
  }

  function isEscapedCharacter(sourceText = "", index = 0) {
    let backslashCount = 0;
    for (let position = index - 1; position >= 0 && sourceText[position] === "\\"; position -= 1) {
      backslashCount += 1;
    }
    return backslashCount % 2 === 1;
  }

  function findClosingParenIndex(sourceText = "", openParenIndex = -1) {
    if (openParenIndex < 0 || sourceText[openParenIndex] !== "(") {
      return -1;
    }

    let parenDepth = 0;
    let quote = "";
    let inLineComment = false;
    let inBlockComment = false;

    for (let index = openParenIndex; index < sourceText.length; index += 1) {
      const character = sourceText[index];
      const nextCharacter = sourceText[index + 1] || "";

      if (inLineComment) {
        if (character === "\n") {
          inLineComment = false;
        }
        continue;
      }

      if (inBlockComment) {
        if (character === "*" && nextCharacter === "/") {
          inBlockComment = false;
          index += 1;
        }
        continue;
      }

      if (quote) {
        if (character === quote && !isEscapedCharacter(sourceText, index)) {
          quote = "";
        }
        continue;
      }

      if (character === "/" && nextCharacter === "/") {
        inLineComment = true;
        index += 1;
        continue;
      }

      if (character === "/" && nextCharacter === "*") {
        inBlockComment = true;
        index += 1;
        continue;
      }

      if (character === "'" || character === "\"" || character === "`") {
        quote = character;
        continue;
      }

      if (character === "(") {
        parenDepth += 1;
        continue;
      }

      if (character === ")") {
        parenDepth -= 1;
        if (parenDepth === 0) {
          return index;
        }
      }
    }

    return -1;
  }

  function extractFirstArgumentText(argsText = "") {
    let parenDepth = 0;
    let braceDepth = 0;
    let bracketDepth = 0;
    let quote = "";
    let inLineComment = false;
    let inBlockComment = false;

    for (let index = 0; index < argsText.length; index += 1) {
      const character = argsText[index];
      const nextCharacter = argsText[index + 1] || "";

      if (inLineComment) {
        if (character === "\n") {
          inLineComment = false;
        }
        continue;
      }

      if (inBlockComment) {
        if (character === "*" && nextCharacter === "/") {
          inBlockComment = false;
          index += 1;
        }
        continue;
      }

      if (quote) {
        if (character === quote && !isEscapedCharacter(argsText, index)) {
          quote = "";
        }
        continue;
      }

      if (character === "/" && nextCharacter === "/") {
        inLineComment = true;
        index += 1;
        continue;
      }

      if (character === "/" && nextCharacter === "*") {
        inBlockComment = true;
        index += 1;
        continue;
      }

      if (character === "'" || character === "\"" || character === "`") {
        quote = character;
        continue;
      }

      if (character === "(") {
        parenDepth += 1;
        continue;
      }
      if (character === ")") {
        parenDepth -= 1;
        continue;
      }
      if (character === "{") {
        braceDepth += 1;
        continue;
      }
      if (character === "}") {
        braceDepth -= 1;
        continue;
      }
      if (character === "[") {
        bracketDepth += 1;
        continue;
      }
      if (character === "]") {
        bracketDepth -= 1;
        continue;
      }

      if (character === "," && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
        return argsText.slice(0, index);
      }
    }

    return argsText;
  }

  function collectStaticImportBindings(sourceText = "") {
    const bindings = new Map();
    const importPattern = /^\s*import\s+([\s\S]*?)\s+from\s+["']([^"']+)["'];?/gmu;

    for (const match of sourceText.matchAll(importPattern)) {
      const specifierText = String(match[1] || "").trim();
      const sourcePath = String(match[2] || "").trim();
      if (!specifierText || !sourcePath) {
        continue;
      }

      const namedMatch = specifierText.match(/\{([\s\S]*)\}/u);
      if (namedMatch) {
        const namedContent = String(namedMatch[1] || "");
        for (const rawSpecifier of namedContent.split(",")) {
          const specifier = String(rawSpecifier || "").trim();
          if (!specifier) {
            continue;
          }
          const aliasMatch = specifier.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/u);
          const localName = aliasMatch ? aliasMatch[2] : specifier;
          if (/^[A-Za-z_$][\w$]*$/u.test(localName)) {
            bindings.set(localName, sourcePath);
          }
        }
      }

      const leadingSpecifier = namedMatch
        ? specifierText.slice(0, namedMatch.index).replace(/,$/u, "").trim()
        : specifierText;
      if (!leadingSpecifier) {
        continue;
      }

      const namespaceMatch = leadingSpecifier.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/u);
      if (namespaceMatch) {
        bindings.set(namespaceMatch[1], sourcePath);
        continue;
      }

      if (/^[A-Za-z_$][\w$]*$/u.test(leadingSpecifier)) {
        bindings.set(leadingSpecifier, sourcePath);
      }
    }

    return bindings;
  }

  function collectStaticImportSummaries(sourceText = "") {
    const imports = [];
    const importPattern = /^\s*import\s+[\s\S]*?\s+from\s+["']([^"']+)["'];?/gmu;

    for (const match of sourceText.matchAll(importPattern)) {
      const sourcePath = String(match[1] || "").trim();
      if (!sourcePath) {
        continue;
      }
      imports.push({
        sourcePath,
        lineNumber: resolveLineNumberFromIndex(sourceText, match.index || 0)
      });
    }

    return imports;
  }

  function normalizeFeatureLaneMetadata(descriptor = {}) {
    const metadata = ensureObject(ensureObject(ensureObject(descriptor).metadata).jskit);
    return {
      scaffoldShape: String(metadata.scaffoldShape || "").trim(),
      scaffoldMode: String(metadata.scaffoldMode || "").trim(),
      lane: String(metadata.lane || "").trim()
    };
  }

  function normalizeJskitMetadata(descriptor = {}) {
    return ensureObject(ensureObject(ensureObject(descriptor).metadata).jskit);
  }

  function normalizeOwnedTableEntries(packageEntry) {
    const packageId = String(packageEntry?.packageId || "").trim();
    const packagePath = resolvePackageDisplayPath(packageEntry);
    const metadata = normalizeJskitMetadata(packageEntry?.descriptor);
    const tableOwnership = ensureObject(metadata.tableOwnership);
    const normalized = [];

    for (const rawEntry of ensureArray(tableOwnership.tables)) {
      const entry = ensureObject(rawEntry);
      const tableName = String(entry.tableName || "").trim().toLowerCase();
      if (!tableName) {
        continue;
      }
      normalized.push({
        packageId,
        packagePath,
        tableName,
        provenance: String(entry.provenance || "").trim().toLowerCase(),
        ownerKind: String(entry.ownerKind || "").trim().toLowerCase(),
        providerEntrypoint: String(entry.providerEntrypoint || "").trim(),
        ownershipFilter: normalizeDbIdentifier(entry.ownershipFilter)
      });
    }

    return normalized;
  }

  function packageAllowsDirectKnexUsage(packageEntry) {
    const featureMetadata = normalizeFeatureLaneMetadata(packageEntry?.descriptor);
    if (
      featureMetadata.scaffoldShape === FEATURE_SERVER_SCAFFOLD_SHAPE &&
      featureMetadata.scaffoldMode === "custom-knex" &&
      featureMetadata.lane === "weird-custom"
    ) {
      return true;
    }

    const jskitMetadata = normalizeJskitMetadata(packageEntry?.descriptor);
    const scaffoldShape = String(jskitMetadata.scaffoldShape || "").trim();
    if (
      scaffoldShape === CRUD_SERVER_SCAFFOLD_SHAPE ||
      scaffoldShape === USERS_CORE_BASELINE_CRUD_SCAFFOLD_SHAPE
    ) {
      return true;
    }

    return normalizeOwnedTableEntries(packageEntry).some((entry) =>
      entry.provenance === "crud-server-generator" || entry.provenance === "users-core-template"
    );
  }

  function packageRequiresCrudOwnershipProvenance(packageEntry) {
    const descriptor = ensureObject(packageEntry?.descriptor);
    const providedCapabilities = ensureArray(ensureObject(descriptor.capabilities).provides)
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    return providedCapabilities.some((value) => value.startsWith("crud."));
  }

  function normalizeTableOwnershipExceptionEntries(rawValue = {}) {
    const source = ensureObject(rawValue);
    const exceptions = [];
    for (const rawEntry of ensureArray(source.exceptions)) {
      const entry = ensureObject(rawEntry);
      const tableName = String(entry.tableName || "").trim().toLowerCase();
      const category = String(entry.category || "").trim().toLowerCase();
      const owner = String(entry.owner || "").trim();
      const reason = String(entry.reason || "").trim();
      exceptions.push({
        tableName,
        category,
        owner,
        reason
      });
    }
    return {
      version: Number(source.version || 0),
      exceptions
    };
  }

  async function loadTableOwnershipExceptionConfig({ appRoot, issues }) {
    const absolutePath = path.join(appRoot, TABLE_OWNERSHIP_RELATIVE_PATH);
    if (!(await fileExists(absolutePath))) {
      return {
        exists: false,
        exceptions: []
      };
    }

    let parsed = null;
    try {
      parsed = JSON.parse(await readFile(absolutePath, "utf8"));
    } catch (error) {
      issues.push(
        `[table-ownership:invalid-exception-file] ${TABLE_OWNERSHIP_RELATIVE_PATH} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
      );
      return {
        exists: true,
        exceptions: []
      };
    }

    const config = normalizeTableOwnershipExceptionEntries(parsed);
    if (config.version !== TABLE_OWNERSHIP_VERSION) {
      issues.push(
        `[table-ownership:invalid-exception-file] ${TABLE_OWNERSHIP_RELATIVE_PATH} must declare version ${TABLE_OWNERSHIP_VERSION}.`
      );
    }

    const seenTables = new Set();
    for (const entry of config.exceptions) {
      if (!entry.tableName) {
        issues.push(
          `[table-ownership:invalid-exception-file] ${TABLE_OWNERSHIP_RELATIVE_PATH} contains an exception without tableName.`
        );
        continue;
      }
      if (!TABLE_OWNERSHIP_EXCEPTION_CATEGORIES.has(entry.category)) {
        issues.push(
          `[table-ownership:invalid-exception-file] ${TABLE_OWNERSHIP_RELATIVE_PATH} table "${entry.tableName}" must use one of: ${sortStrings([...TABLE_OWNERSHIP_EXCEPTION_CATEGORIES]).join(", ")}.`
        );
      }
      if (!entry.owner) {
        issues.push(
          `[table-ownership:invalid-exception-file] ${TABLE_OWNERSHIP_RELATIVE_PATH} table "${entry.tableName}" must include owner.`
        );
      }
      if (!entry.reason) {
        issues.push(
          `[table-ownership:invalid-exception-file] ${TABLE_OWNERSHIP_RELATIVE_PATH} table "${entry.tableName}" must include reason.`
        );
      }
      if (seenTables.has(entry.tableName)) {
        issues.push(
          `[table-ownership:invalid-exception-file] ${TABLE_OWNERSHIP_RELATIVE_PATH} declares table "${entry.tableName}" more than once.`
        );
        continue;
      }
      seenTables.add(entry.tableName);
    }

    return {
      exists: true,
      exceptions: config.exceptions
    };
  }

  function normalizeKnexRawRows(rawResult = null) {
    if (Array.isArray(rawResult)) {
      if (rawResult.length > 0 && Array.isArray(rawResult[0])) {
        return rawResult[0];
      }
      return rawResult;
    }

    if (Array.isArray(rawResult?.rows)) {
      return rawResult.rows;
    }

    return [];
  }

  function normalizeDbIdentifier(value = "") {
    return String(value || "").trim().toLowerCase();
  }

  function setMapValue(map, key, defaultValueFactory) {
    if (!map.has(key)) {
      map.set(key, defaultValueFactory());
    }
    return map.get(key);
  }

  async function loadAppKnexConfig(appRoot) {
    const knexfilePath = path.join(appRoot, "knexfile.js");
    if (!(await fileExists(knexfilePath))) {
      return null;
    }

    const moduleNamespace = await importFreshModuleFromAbsolutePath(knexfilePath);
    const exported =
      moduleNamespace?.default ??
      moduleNamespace?.config ??
      moduleNamespace;
    const config =
      typeof exported === "function"
        ? await exported()
        : ensureObject(exported);

    return {
      config: ensureObject(config),
      path: knexfilePath
    };
  }

  function loadAppKnexFactory(appRoot) {
    const requireFromApp = createRequire(path.join(appRoot, "package.json"));
    const moduleValue = requireFromApp("knex");
    const knexFactory =
      typeof moduleValue === "function"
        ? moduleValue
        : typeof moduleValue?.default === "function"
          ? moduleValue.default
          : null;
    if (!knexFactory) {
      throw new Error("App-local knex package resolved but did not expose a callable factory.");
    }
    return knexFactory;
  }

  async function resolveLiveDatabaseSchema(appRoot) {
    const loadedKnexConfig = await loadAppKnexConfig(appRoot);
    if (!loadedKnexConfig) {
      return {
        applicable: false,
        tableNames: [],
        columnsByTable: new Map(),
        foreignKeysByTable: new Map()
      };
    }

    const knexFactory = loadAppKnexFactory(appRoot);
    const knex = knexFactory(loadedKnexConfig.config);

    try {
      const clientId = String(loadedKnexConfig.config.client || "").trim().toLowerCase();
      let tableRows = [];
      let columnRows = [];
      let foreignKeyRows = [];
      if (clientId.startsWith("mysql")) {
        tableRows = normalizeKnexRawRows(await knex.raw(
          "SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME"
        ));
        columnRows = normalizeKnexRawRows(await knex.raw(
          "SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION"
        ));
        foreignKeyRows = normalizeKnexRawRows(await knex.raw(
          "SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, REFERENCED_TABLE_NAME AS referencedTableName, REFERENCED_COLUMN_NAME AS referencedColumnName FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION"
        ));
      } else if (clientId === "pg" || clientId.startsWith("postgres")) {
        tableRows = normalizeKnexRawRows(await knex.raw(
          'SELECT tablename AS "tableName" FROM pg_tables WHERE schemaname = current_schema() ORDER BY tablename'
        ));
        columnRows = normalizeKnexRawRows(await knex.raw(
          'SELECT table_name AS "tableName", column_name AS "columnName" FROM information_schema.columns WHERE table_schema = current_schema() ORDER BY table_name, ordinal_position'
        ));
        foreignKeyRows = normalizeKnexRawRows(await knex.raw(
          'SELECT kcu.table_name AS "tableName", kcu.column_name AS "columnName", ccu.table_name AS "referencedTableName", ccu.column_name AS "referencedColumnName" FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema WHERE tc.constraint_type = \'FOREIGN KEY\' AND tc.table_schema = current_schema() ORDER BY kcu.table_name, kcu.constraint_name, kcu.ordinal_position'
        ));
      } else {
        throw new Error(`Unsupported knex client for doctor table ownership audit: ${clientId || "<empty>"}.`);
      }

      const tableNames = sortStrings(
        tableRows
          .map((row) => normalizeDbIdentifier(
            ensureObject(row).tableName || ensureObject(row).TABLE_NAME || ensureObject(row).tablename
          ))
          .filter(Boolean)
          .filter((tableName) => !KNEX_SYSTEM_TABLE_NAMES.has(tableName))
      );
      const liveTableNameSet = new Set(tableNames);
      const columnsByTable = new Map();
      const foreignKeysByTable = new Map();

      for (const tableName of tableNames) {
        columnsByTable.set(tableName, new Set());
        foreignKeysByTable.set(tableName, []);
      }

      for (const rawRow of columnRows) {
        const row = ensureObject(rawRow);
        const tableName = normalizeDbIdentifier(row.tableName || row.TABLE_NAME || row.tablename);
        const columnName = normalizeDbIdentifier(row.columnName || row.COLUMN_NAME || row.columnname);
        if (!tableName || !columnName || !liveTableNameSet.has(tableName)) {
          continue;
        }
        setMapValue(columnsByTable, tableName, () => new Set()).add(columnName);
      }

      for (const rawRow of foreignKeyRows) {
        const row = ensureObject(rawRow);
        const tableName = normalizeDbIdentifier(row.tableName || row.TABLE_NAME || row.tablename);
        const columnName = normalizeDbIdentifier(row.columnName || row.COLUMN_NAME || row.columnname);
        const referencedTableName = normalizeDbIdentifier(
          row.referencedTableName || row.REFERENCED_TABLE_NAME || row.referencedtablename
        );
        const referencedColumnName = normalizeDbIdentifier(
          row.referencedColumnName || row.REFERENCED_COLUMN_NAME || row.referencedcolumnname
        );
        if (!tableName || !referencedTableName || !liveTableNameSet.has(tableName)) {
          continue;
        }
        setMapValue(foreignKeysByTable, tableName, () => []).push({
          columnName,
          referencedTableName,
          referencedColumnName
        });
      }

      return {
        applicable: true,
        tableNames,
        columnsByTable,
        foreignKeysByTable
      };
    } finally {
      if (knex && typeof knex.destroy === "function") {
        await knex.destroy();
      }
    }
  }

  function collectInstalledOwnedTables({ installedPackageIds = [], packageRegistry, issues }) {
    const ownersByTable = new Map();

    for (const packageId of ensureArray(installedPackageIds)) {
      const packageEntry = packageRegistry.get(packageId) || null;
      if (!packageEntry) {
        continue;
      }

      for (const ownershipEntry of normalizeOwnedTableEntries(packageEntry)) {
        const existing = ownersByTable.get(ownershipEntry.tableName);
        if (existing) {
          issues.push(
            `[table-ownership:duplicate-owner] table "${ownershipEntry.tableName}" is claimed by both ${existing.packagePath} and ${ownershipEntry.packagePath}.`
          );
          continue;
        }
        ownersByTable.set(ownershipEntry.tableName, ownershipEntry);
      }
    }

    return ownersByTable;
  }

  function normalizeDirectOwnerKinds(columnNames = new Set()) {
    const normalizedColumns = columnNames instanceof Set ? columnNames : new Set();
    const ownerKinds = new Set();
    for (const ownerKind of DIRECT_OWNER_KINDS) {
      if (normalizedColumns.has(DIRECT_OWNER_COLUMNS[ownerKind])) {
        ownerKinds.add(ownerKind);
      }
    }
    return ownerKinds;
  }

  function resolveRequiredOwnerKindsFromOwnershipFilter(ownershipFilter = "") {
    const normalizedFilter = normalizeDbIdentifier(ownershipFilter);
    if (normalizedFilter === "user") {
      return new Set(["user"]);
    }
    if (normalizedFilter === "workspace") {
      return new Set(["workspace"]);
    }
    if (normalizedFilter === "workspace_user") {
      return new Set(["workspace", "user"]);
    }
    return new Set();
  }

  function subtractStringSet(source = new Set(), valuesToSubtract = new Set()) {
    const result = new Set();
    const sourceSet = source instanceof Set ? source : new Set();
    const subtractSet = valuesToSubtract instanceof Set ? valuesToSubtract : new Set();
    for (const value of sourceSet) {
      if (!subtractSet.has(value)) {
        result.add(value);
      }
    }
    return result;
  }

  function formatOwnerColumns(ownerKinds = new Set()) {
    const normalizedKinds = ownerKinds instanceof Set ? ownerKinds : new Set();
    return sortStrings(
      [...normalizedKinds]
        .map((ownerKind) => DIRECT_OWNER_COLUMNS[ownerKind] || "")
        .filter(Boolean)
    )
      .map((columnName) => `"${columnName}"`)
      .join(", ");
  }

  async function resolveAppLocalCrudOwnershipFilters({ appRoot, appLocalRegistry, issues }) {
    const ownershipByTable = new Map();
    const packageEntries = sortStrings([...appLocalRegistry.keys()])
      .map((packageId) => appLocalRegistry.get(packageId))
      .filter(Boolean);

    for (const packageEntry of packageEntries) {
      if (!packageRequiresCrudOwnershipProvenance(packageEntry)) {
        continue;
      }

      const serverProviderEntries = resolveServerProviderEntries(packageEntry);
      const providerInfoByEntrypoint = new Map();
      for (const providerEntry of serverProviderEntries) {
        if (!(await fileExists(providerEntry.absolutePath))) {
          continue;
        }

        const sourceText = await readFile(providerEntry.absolutePath, "utf8");
        const match = CRUD_OWNERSHIP_FILTER_LITERAL_PATTERN.exec(sourceText);
        if (!match) {
          continue;
        }

        const ownershipFilter = normalizeDbIdentifier(match[1]);
        providerInfoByEntrypoint.set(providerEntry.entrypoint, {
          providerPath: normalizeRelativePath(appRoot, providerEntry.absolutePath),
          ownershipFilter,
          requiredOwnerKinds: resolveRequiredOwnerKindsFromOwnershipFilter(ownershipFilter)
        });
      }

      for (const ownershipEntry of normalizeOwnedTableEntries(packageEntry)) {
        const descriptorPath = `${resolvePackageDisplayPath(packageEntry)}/package.descriptor.mjs`;
        let providerInfo = null;
        if (ownershipEntry.providerEntrypoint) {
          providerInfo = providerInfoByEntrypoint.get(ownershipEntry.providerEntrypoint) || null;
          if (!providerInfo) {
            issues.push(
              `${descriptorPath}: [crud-ownership:provider-unresolved] table "${ownershipEntry.tableName}" points at providerEntrypoint "${ownershipEntry.providerEntrypoint}" but doctor could not resolve an ownershipFilter from that provider. Make sure the file exists and declares a literal CRUD_MODULE_CONFIG.ownershipFilter.`
            );
          }
        } else if (serverProviderEntries.length === 1) {
          providerInfo = providerInfoByEntrypoint.get(serverProviderEntries[0].entrypoint) || null;
          if (!providerInfo) {
            issues.push(
              `${descriptorPath}: [crud-ownership:provider-unresolved] table "${ownershipEntry.tableName}" relies on the package's only server provider, but doctor could not resolve a literal CRUD_MODULE_CONFIG.ownershipFilter from "${serverProviderEntries[0].entrypoint}".`
            );
          }
        } else if (serverProviderEntries.length > 1) {
          issues.push(
            `${descriptorPath}: [crud-ownership:missing-provider-entrypoint] table "${ownershipEntry.tableName}" is claimed by a multi-provider CRUD package but does not declare metadata.jskit.tableOwnership.tables[].providerEntrypoint. Point it at the owning provider so doctor can verify the real ownershipFilter.`
          );
        }

        if (
          ownershipEntry.ownershipFilter &&
          providerInfo?.ownershipFilter &&
          ownershipEntry.ownershipFilter !== providerInfo.ownershipFilter
        ) {
          issues.push(
            `${providerInfo.providerPath}: [crud-ownership:ownership-filter-mismatch] metadata declares ownershipFilter "${ownershipEntry.ownershipFilter}" for live table "${ownershipEntry.tableName}" but provider code uses "${providerInfo.ownershipFilter}". Update the provider or metadata so doctor verifies the real contract.`
          );
        }

        const ownershipFilter = providerInfo?.ownershipFilter || "";
        if (!ownershipFilter) {
          continue;
        }

        ownershipByTable.set(ownershipEntry.tableName, {
          tableName: ownershipEntry.tableName,
          ownershipFilter,
          requiredOwnerKinds: providerInfo?.requiredOwnerKinds || new Set(),
          packagePath: resolvePackageDisplayPath(packageEntry),
          providerPath:
            providerInfo?.providerPath ||
            normalizeRelativePath(appRoot, resolvePrimaryServerProviderPath(packageEntry))
        });
      }
    }

    return ownershipByTable;
  }

  function resolveReachableOwnerKinds(tableName, {
    directOwnerKindsByTable,
    foreignKeysByTable,
    memo = new Map(),
    visiting = new Set()
  } = {}) {
    const normalizedTableName = normalizeDbIdentifier(tableName);
    if (!normalizedTableName) {
      return new Set();
    }
    if (memo.has(normalizedTableName)) {
      return memo.get(normalizedTableName);
    }
    if (visiting.has(normalizedTableName)) {
      return new Set();
    }

    visiting.add(normalizedTableName);
    const resolved = new Set(directOwnerKindsByTable.get(normalizedTableName) || []);
    for (const foreignKey of ensureArray(foreignKeysByTable.get(normalizedTableName))) {
      const parentTableName = normalizeDbIdentifier(foreignKey?.referencedTableName);
      if (!parentTableName) {
        continue;
      }
      for (const ownerKind of resolveReachableOwnerKinds(parentTableName, {
        directOwnerKindsByTable,
        foreignKeysByTable,
        memo,
        visiting
      })) {
        resolved.add(ownerKind);
      }
    }
    visiting.delete(normalizedTableName);
    memo.set(normalizedTableName, resolved);
    return resolved;
  }

  function findInheritedOwnerChain(tableName, ownerKind, {
    directOwnerKindsByTable,
    foreignKeysByTable
  } = {}) {
    const normalizedTableName = normalizeDbIdentifier(tableName);
    const normalizedOwnerKind = normalizeDbIdentifier(ownerKind);
    if (!normalizedTableName || !normalizedOwnerKind) {
      return [];
    }

    const visited = new Set([normalizedTableName]);
    const queue = [{
      tableName: normalizedTableName,
      path: [normalizedTableName]
    }];

    while (queue.length > 0) {
      const current = queue.shift();
      const currentTableName = normalizeDbIdentifier(current?.tableName);
      if (!currentTableName) {
        continue;
      }

      for (const foreignKey of ensureArray(foreignKeysByTable.get(currentTableName))) {
        const parentTableName = normalizeDbIdentifier(foreignKey?.referencedTableName);
        if (!parentTableName || visited.has(parentTableName)) {
          continue;
        }
        const nextPath = [
          ...ensureArray(current?.path),
          parentTableName
        ];
        if ((directOwnerKindsByTable.get(parentTableName) || new Set()).has(normalizedOwnerKind)) {
          return nextPath;
        }
        visited.add(parentTableName);
        queue.push({
          tableName: parentTableName,
          path: nextPath
        });
      }
    }

    return [];
  }

  function isFeatureLanePersistenceImportSource(sourcePath = "") {
    const normalizedSourcePath = String(sourcePath || "").trim();
    if (!normalizedSourcePath) {
      return false;
    }
    return FEATURE_SERVER_PERSISTENCE_IMPORT_SOURCE_PATTERNS.some((pattern) => pattern.test(normalizedSourcePath));
  }

  function findFirstPatternMatch(sourceText = "", patternEntries = []) {
    let firstMatch = null;

    for (const rawEntry of ensureArray(patternEntries)) {
      const entry = ensureObject(rawEntry);
      const pattern = entry.pattern instanceof RegExp ? entry.pattern : null;
      if (!pattern) {
        continue;
      }
      const match = pattern.exec(sourceText);
      if (!match) {
        continue;
      }
      if (!firstMatch || (match.index || 0) < firstMatch.index) {
        firstMatch = {
          index: match.index || 0,
          label: String(entry.label || pattern.source).trim() || pattern.source
        };
      }
    }

    if (!firstMatch) {
      return null;
    }

    return {
      ...firstMatch,
      lineNumber: resolveLineNumberFromIndex(sourceText, firstMatch.index)
    };
  }

  function resolvePrimaryServerProviderPath(packageEntry) {
    const rootDir = String(packageEntry?.rootDir || "").trim();
    if (!rootDir) {
      return "";
    }

    const providers = ensureArray(ensureObject(ensureObject(packageEntry?.descriptor).runtime).server?.providers);
    for (const rawProvider of providers) {
      const provider = ensureObject(rawProvider);
      const entrypoint = String(provider.entrypoint || "").trim();
      if (!entrypoint || entrypoint.includes("*")) {
        continue;
      }
      return path.resolve(rootDir, entrypoint);
    }

    return "";
  }

  function resolveServerProviderEntries(packageEntry) {
    const rootDir = String(packageEntry?.rootDir || "").trim();
    if (!rootDir) {
      return [];
    }

    const providers = ensureArray(ensureObject(ensureObject(packageEntry?.descriptor).runtime).server?.providers);
    const resolved = [];
    for (const rawProvider of providers) {
      const provider = ensureObject(rawProvider);
      const entrypoint = String(provider.entrypoint || "").trim();
      if (!entrypoint || entrypoint.includes("*")) {
        continue;
      }
      resolved.push({
        entrypoint,
        absolutePath: path.resolve(rootDir, entrypoint)
      });
    }

    return resolved;
  }

  function resolvePackageDisplayPath(packageEntry) {
    const relativeDir = String(packageEntry?.relativeDir || "").trim();
    if (relativeDir) {
      return relativeDir;
    }
    return String(packageEntry?.packageId || "").trim() || "package";
  }

  async function collectFeatureLaneRuleIssuesForPackage({ appRoot, packageEntry, issues }) {
    const metadata = normalizeFeatureLaneMetadata(packageEntry?.descriptor);
    if (metadata.scaffoldShape !== FEATURE_SERVER_SCAFFOLD_SHAPE) {
      return;
    }

    const rootDir = String(packageEntry?.rootDir || "").trim();
    if (!rootDir) {
      return;
    }

    const packageDisplayPath = resolvePackageDisplayPath(packageEntry);
    const isDefaultLane = metadata.lane === FEATURE_SERVER_DEFAULT_LANE;
    const isPersistentMode = FEATURE_SERVER_PERSISTENT_MODES.has(metadata.scaffoldMode);

    const servicePath = path.join(rootDir, "src", "server", "service.js");
    if (isDefaultLane && (await fileExists(servicePath))) {
      const serviceSource = await readFile(servicePath, "utf8");
      const serviceRelativePath = normalizeRelativePath(appRoot, servicePath);
      const knexMatch = findFirstPatternMatch(serviceSource, [
        { pattern: /\bjskit\.database\.knex\b/u, label: "jskit.database.knex" },
        { pattern: /\bcreateWithTransaction\s*\(/u, label: "createWithTransaction(...)" },
        { pattern: /\bknex\b/u, label: "knex" }
      ]);
      if (knexMatch) {
        issues.push(
          `${serviceRelativePath}:${knexMatch.lineNumber}: [feature-lane:service-knex] default-lane service code must not use knex directly (${knexMatch.label}). Move persistence into src/server/repository.js or switch the package to an explicit weird-custom lane.`
        );
      }

      const offendingServiceImports = collectStaticImportSummaries(serviceSource)
        .filter((entry) => isFeatureLanePersistenceImportSource(entry.sourcePath));
      if (offendingServiceImports.length > 0) {
        const firstImport = offendingServiceImports[0];
        const importSources = sortStrings(
          [...new Set(offendingServiceImports.map((entry) => String(entry.sourcePath || "").trim()).filter(Boolean))]
        );
        issues.push(
          `${serviceRelativePath}:${firstImport.lineNumber}: [feature-lane:service-persistence-import] default-lane service code must not import persistence helpers directly (${importSources.join(", ")}). Use the injected repository seam instead.`
        );
      }
    }

    const providerPath = resolvePrimaryServerProviderPath(packageEntry);
    if (isDefaultLane && providerPath && (await fileExists(providerPath))) {
      const providerSource = await readFile(providerPath, "utf8");
      const providerRelativePath = normalizeRelativePath(appRoot, providerPath);
      const providerPersistenceMatch = findFirstPatternMatch(providerSource, [
        { pattern: /\bcreateJsonRestContext\s*\(/u, label: "createJsonRestContext(...)" },
        { pattern: /\.resources\b/u, label: ".resources" },
        { pattern: /\bjskit\.database\.knex\b/u, label: "jskit.database.knex" },
        { pattern: /\bcreateWithTransaction\s*\(/u, label: "createWithTransaction(...)" },
        { pattern: /\bknex\s*\./u, label: "knex." }
      ]);
      if (providerPersistenceMatch) {
        issues.push(
          `${providerRelativePath}:${providerPersistenceMatch.lineNumber}: [feature-lane:provider-persistence-direct] default-lane providers may wire repositories but must not perform persistence work directly (${providerPersistenceMatch.label}). Move json-rest/database calls into src/server/repository.js.`
        );
      }
    }

    const repositoryPath = path.join(rootDir, "src", "server", "repository.js");
    if (isPersistentMode && !(await fileExists(repositoryPath))) {
      issues.push(
        `${packageDisplayPath}/src/server/repository.js: [feature-lane:repository-required] generated persistent feature packages require src/server/repository.js for scaffoldMode "${metadata.scaffoldMode}".`
      );
      return;
    }

    if (
      isDefaultLane &&
      metadata.scaffoldMode === FEATURE_SERVER_JSON_REST_MODE &&
      (await fileExists(repositoryPath))
    ) {
      const repositorySource = await readFile(repositoryPath, "utf8");
      const repositoryRelativePath = normalizeRelativePath(appRoot, repositoryPath);
      const directDatabaseMatch = findFirstPatternMatch(repositorySource, [
        { pattern: /\bjskit\.database\.knex\b/u, label: "jskit.database.knex" },
        { pattern: /\bcreateWithTransaction\s*\(/u, label: "createWithTransaction(...)" },
        { pattern: /\bknex\b/u, label: "knex" }
      ]);
      const usesJsonRest = /@jskit-ai\/json-rest-api-core|createJsonRestContext\s*\(|\.resources\b|json-rest-api/iu.test(repositorySource);
      if (directDatabaseMatch || !usesJsonRest) {
        const locationSuffix = directDatabaseMatch ? `:${directDatabaseMatch.lineNumber}` : "";
        issues.push(
          `${repositoryRelativePath}${locationSuffix}: [feature-lane:repository-default-path] default-lane persistent repositories must stay on internal json-rest-api. Use the injected json-rest-api seam or mark the package as an explicit weird-custom lane.`
        );
      }
    }
  }

  async function collectMainPackageFeatureLaneWarnings({ appRoot, appLocalRegistry, warnings }) {
    const mainPackageEntry = [...appLocalRegistry.values()].find((packageEntry) => {
      const packageId = String(packageEntry?.packageId || "").trim();
      const relativeDir = String(packageEntry?.relativeDir || "").trim();
      return packageId === "@local/main" || relativeDir === "packages/main";
    });
    if (!mainPackageEntry) {
      return;
    }

    const rootDir = String(mainPackageEntry.rootDir || "").trim();
    if (!rootDir) {
      return;
    }

    const reasons = [];
    const serverFilePaths = [];
    await collectAppSourceFiles(path.join(rootDir, "src", "server"), undefined, serverFilePaths);
    const relativeServerFiles = sortStrings(serverFilePaths.map((absolutePath) => normalizeRelativePath(rootDir, absolutePath)));
    const extraDomainFiles = relativeServerFiles.filter(
      (relativePath) =>
        !MAIN_SERVER_BASELINE_RELATIVE_PATHS.has(relativePath) &&
        MAIN_SERVER_DOMAIN_FILE_PATTERN.test(relativePath)
    );
    if (extraDomainFiles.length > 0) {
      reasons.push(`extra server domain files: ${extraDomainFiles.join(", ")}`);
    }

    const providerPath = path.join(rootDir, "src", "server", "MainServiceProvider.js");
    if (await fileExists(providerPath)) {
      const providerSource = await readFile(providerPath, "utf8");
      const actionBindingCount = (providerSource.match(/\bapp\.actions\s*\(/gu) || []).length;
      const serviceBindingCount = (providerSource.match(/\bapp\.(?:service|singleton)\s*\(/gu) || []).length;
      const routeRegistrationCount = (providerSource.match(/\brouter\.register\s*\(/gu) || []).length;

      if (actionBindingCount > 0) {
        reasons.push("MainServiceProvider registers actions directly");
      }
      if (serviceBindingCount > 1) {
        reasons.push(`MainServiceProvider registers ${serviceBindingCount} service/singleton bindings directly`);
      }
      if (routeRegistrationCount > 0) {
        reasons.push("MainServiceProvider registers HTTP routes directly");
      }
    }

    if (reasons.length > 0) {
      warnings.push(
        `packages/main: [feature-lane:main-glue-only] packages/main should stay composition/glue. Found ${reasons.join("; ")}. Move substantial server feature logic into a dedicated package generated with feature-server-generator scaffold.`
      );
    }
  }

  async function collectHandmadeFeatureLaneWarnings({ appLocalRegistry, warnings }) {
    const packageEntries = sortStrings([...appLocalRegistry.keys()])
      .map((packageId) => appLocalRegistry.get(packageId))
      .filter(Boolean);

    for (const packageEntry of packageEntries) {
      const relativeDir = String(packageEntry?.relativeDir || "").trim();
      if (relativeDir === "packages/main") {
        continue;
      }

      const rootDir = String(packageEntry?.rootDir || "").trim();
      if (!rootDir) {
        continue;
      }

      const metadata = normalizeFeatureLaneMetadata(packageEntry?.descriptor);
      if (metadata.scaffoldShape === FEATURE_SERVER_SCAFFOLD_SHAPE) {
        continue;
      }

      const descriptor = ensureObject(packageEntry?.descriptor);
      const capabilities = ensureObject(descriptor.capabilities);
      const providedCapabilities = ensureArray(capabilities.provides)
        .map((value) => String(value || "").trim())
        .filter(Boolean);
      const dependsOn = ensureArray(descriptor.dependsOn)
        .map((value) => String(value || "").trim())
        .filter(Boolean);
      if (
        providedCapabilities.some((value) => value.startsWith("crud.")) ||
        dependsOn.includes("@jskit-ai/crud-core")
      ) {
        continue;
      }

      const serverProviders = ensureArray(ensureObject(ensureObject(descriptor.runtime).server).providers);
      const hasDirectServerProvider = serverProviders.some((rawProvider) => {
        const provider = ensureObject(rawProvider);
        const entrypoint = String(provider.entrypoint || "").trim();
        return entrypoint.startsWith("src/server/") && /Provider\.[A-Za-z0-9]+$/u.test(entrypoint);
      });
      if (!hasDirectServerProvider) {
        continue;
      }

      const markerPaths = [];
      for (const relativePath of FEATURE_SERVER_COMPLEX_MARKER_RELATIVE_PATHS) {
        if (await fileExists(path.join(rootDir, relativePath))) {
          markerPaths.push(relativePath);
        }
      }

      const looksLikeFeatureCapability = providedCapabilities.some((value) => value.startsWith("feature."));
      if (!(markerPaths.length >= 3 || (looksLikeFeatureCapability && markerPaths.length >= 2))) {
        continue;
      }

      warnings.push(
        `${relativeDir || String(packageEntry?.packageId || "").trim()}: [feature-lane:handmade-feature] package looks like a substantial non-CRUD server feature (${markerPaths.join(", ")}) but is missing metadata.jskit.scaffoldShape="${FEATURE_SERVER_SCAFFOLD_SHAPE}". Start from jskit generate feature-server-generator scaffold <feature-name> for this lane instead of hand-making the topology.`
      );
    }
  }

  async function collectFeatureLaneDoctorIssues({ appRoot, appLocalRegistry, issues, warnings }) {
    const packageEntries = sortStrings([...appLocalRegistry.keys()])
      .map((packageId) => appLocalRegistry.get(packageId))
      .filter(Boolean);

    for (const packageEntry of packageEntries) {
      await collectFeatureLaneRuleIssuesForPackage({
        appRoot,
        packageEntry,
        issues
      });
    }

    await collectMainPackageFeatureLaneWarnings({
      appRoot,
      appLocalRegistry,
      warnings
    });
    await collectHandmadeFeatureLaneWarnings({
      appLocalRegistry,
      warnings
    });
  }

  async function collectCrudOwnershipMetadataIssues({ appLocalRegistry, issues }) {
    const packageEntries = sortStrings([...appLocalRegistry.keys()])
      .map((packageId) => appLocalRegistry.get(packageId))
      .filter(Boolean);

    for (const packageEntry of packageEntries) {
      if (!packageRequiresCrudOwnershipProvenance(packageEntry)) {
        continue;
      }

      const packagePath = resolvePackageDisplayPath(packageEntry);
      const metadata = normalizeJskitMetadata(packageEntry?.descriptor);
      const scaffoldShape = String(metadata.scaffoldShape || "").trim();
      const ownedTables = normalizeOwnedTableEntries(packageEntry);
      if (ownedTables.length < 1) {
        issues.push(
          `${packagePath}: [crud-ownership:missing-metadata] CRUD package is missing metadata.jskit.tableOwnership.tables. App-owned CRUD tables must be claimed by generator/baseline ownership metadata so doctor can audit live DB tables.`
        );
        continue;
      }

      const allowedProvenances = String(packageEntry?.packageId || "").trim() === "@local/users"
        ? new Set(["crud-server-generator", "users-core-template"])
        : new Set(["crud-server-generator"]);
      if (
        scaffoldShape &&
        scaffoldShape !== CRUD_SERVER_SCAFFOLD_SHAPE &&
        scaffoldShape !== USERS_CORE_BASELINE_CRUD_SCAFFOLD_SHAPE
      ) {
        issues.push(
          `${packagePath}: [crud-ownership:unsupported-shape] CRUD package declares unsupported metadata.jskit.scaffoldShape="${scaffoldShape}". Use crud-server-generator for app-owned CRUDs, or the JSKIT baseline users scaffold where applicable.`
        );
      }

      for (const ownedTable of ownedTables) {
        if (!allowedProvenances.has(ownedTable.provenance)) {
          issues.push(
            `${packagePath}: [crud-ownership:unsupported-provenance] table "${ownedTable.tableName}" is claimed with provenance "${ownedTable.provenance || "<empty>"}". App-owned CRUD tables must come from crud-server-generator (or users-core-template for @local/users).`
          );
        }
      }
    }
  }

  async function collectAppLocalDirectKnexIssues({ appRoot, appLocalRegistry, issues }) {
    const packageEntries = sortStrings([...appLocalRegistry.keys()])
      .map((packageId) => appLocalRegistry.get(packageId))
      .filter(Boolean);

    for (const packageEntry of packageEntries) {
      const featureMetadata = normalizeFeatureLaneMetadata(packageEntry?.descriptor);
      if (featureMetadata.scaffoldShape === FEATURE_SERVER_SCAFFOLD_SHAPE) {
        continue;
      }
      if (packageAllowsDirectKnexUsage(packageEntry)) {
        continue;
      }

      const rootDir = String(packageEntry?.rootDir || "").trim();
      if (!rootDir) {
        continue;
      }

      const serverFilePaths = [];
      await collectAppSourceFiles(path.join(rootDir, "src", "server"), undefined, serverFilePaths);
      serverFilePaths.sort((left, right) => left.localeCompare(right));

      for (const absolutePath of serverFilePaths) {
        const sourceText = await readFile(absolutePath, "utf8");
        const match = findFirstPatternMatch(sourceText, APP_LOCAL_DIRECT_KNEX_PATTERN_ENTRIES);
        if (!match) {
          continue;
        }

        const relativePath = normalizeRelativePath(appRoot, absolutePath);
        issues.push(
          `${relativePath}:${match.lineNumber}: [persistence-lane:direct-knex] app-owned runtime code must stay on generated CRUD or internal json-rest-api by default. Direct knex is only allowed in explicit weird-custom feature-server lanes and approved baseline CRUD packages.`
        );
      }
    }
  }

  async function collectTableOwnershipDoctorIssues({
    appRoot,
    installedPackageIds,
    packageRegistry,
    appLocalRegistry,
    issues
  }) {
    await collectCrudOwnershipMetadataIssues({
      appLocalRegistry,
      issues
    });
    await collectAppLocalDirectKnexIssues({
      appRoot,
      appLocalRegistry,
      issues
    });

    const exceptionConfig = await loadTableOwnershipExceptionConfig({
      appRoot,
      issues
    });

    let liveSchema = null;
    try {
      const resolved = await resolveLiveDatabaseSchema(appRoot);
      if (!resolved.applicable) {
        return;
      }
      liveSchema = resolved;
    } catch (error) {
      issues.push(
        `[table-ownership:db-introspection-unavailable] doctor could not inspect live database tables via knexfile.js: ${error instanceof Error ? error.message : String(error)}`
      );
      return;
    }

    const liveTables = ensureArray(liveSchema?.tableNames);
    const columnsByTable = liveSchema?.columnsByTable instanceof Map ? liveSchema.columnsByTable : new Map();
    const foreignKeysByTable = liveSchema?.foreignKeysByTable instanceof Map ? liveSchema.foreignKeysByTable : new Map();
    const ownedTablesByName = collectInstalledOwnedTables({
      installedPackageIds,
      packageRegistry,
      issues
    });
    const crudOwnershipByTable = await resolveAppLocalCrudOwnershipFilters({
      appRoot,
      appLocalRegistry,
      issues
    });
    const exceptionEntriesByName = new Map();
    for (const entry of exceptionConfig.exceptions) {
      if (entry.tableName) {
        exceptionEntriesByName.set(entry.tableName, entry);
      }
    }
    const directOwnerKindsByTable = new Map(
      liveTables.map((tableName) => [
        tableName,
        normalizeDirectOwnerKinds(columnsByTable.get(tableName) || new Set())
      ])
    );
    const reachableOwnerKindsMemo = new Map();

    for (const tableName of liveTables) {
      if (ownedTablesByName.has(tableName)) {
        if (exceptionEntriesByName.has(tableName)) {
          issues.push(
            `[table-ownership:duplicate-exception] table "${tableName}" is both package-owned and listed in ${TABLE_OWNERSHIP_RELATIVE_PATH}. Remove the exception entry.`
          );
        }
        continue;
      }
      if (exceptionEntriesByName.has(tableName)) {
        continue;
      }

      issues.push(
        `[table-ownership:missing-owner] live database table "${tableName}" has no declared owner. Create a server CRUD with jskit generate crud-server-generator scaffold ..., or add a narrow explicit exception in ${TABLE_OWNERSHIP_RELATIVE_PATH}.`
      );
    }

    for (const tableName of liveTables) {
      if (!ownedTablesByName.has(tableName) && !exceptionEntriesByName.has(tableName)) {
        continue;
      }

      const directOwnerKinds = directOwnerKindsByTable.get(tableName) || new Set();
      const reachableOwnerKinds = resolveReachableOwnerKinds(tableName, {
        directOwnerKindsByTable,
        foreignKeysByTable,
        memo: reachableOwnerKindsMemo
      });
      const inheritedOwnerKinds = subtractStringSet(reachableOwnerKinds, directOwnerKinds);
      const exceptionEntry = exceptionEntriesByName.get(tableName) || null;
      const allowsAuxiliaryInheritedOwnership =
        exceptionEntry &&
        TABLE_OWNERSHIP_AUXILIARY_INHERITED_OWNER_EXCEPTION_CATEGORIES.has(exceptionEntry.category);

      const crudOwnership = crudOwnershipByTable.get(tableName) || null;
      if (crudOwnership) {
        const missingRequiredOwnerKinds = subtractStringSet(crudOwnership.requiredOwnerKinds, directOwnerKinds);
        if (missingRequiredOwnerKinds.size > 0) {
          issues.push(
            `${crudOwnership.providerPath}: [crud-ownership:missing-owner-columns] ownershipFilter "${crudOwnership.ownershipFilter}" requires live table "${tableName}" to carry direct owner column(s) ${formatOwnerColumns(missingRequiredOwnerKinds)}. JSKIT CRUD ownership must be materialized on the row, not recovered through joins.`
          );
        }
      }

      if (inheritedOwnerKinds.size < 1 || allowsAuxiliaryInheritedOwnership) {
        continue;
      }

      for (const ownerKind of sortStrings([...inheritedOwnerKinds])) {
        const inheritedPath = findInheritedOwnerChain(tableName, ownerKind, {
          directOwnerKindsByTable,
          foreignKeysByTable
        });
        const formattedPath = inheritedPath.length > 1
          ? inheritedPath.join(" -> ")
          : tableName;
        const ownerColumnName = DIRECT_OWNER_COLUMNS[ownerKind];
        const exceptionSuffix = exceptionEntry
          ? ` ${TABLE_OWNERSHIP_RELATIVE_PATH} category "${exceptionEntry.category}" does not exempt inherited ownership.`
          : "";
        issues.push(
          `[table-ownership:inherited-owner] live database table "${tableName}" reaches ${ownerKind} ownership only via foreign-key chain ${formattedPath} but lacks direct owner column "${ownerColumnName}". Materialize the owner on the row instead of filtering through parent relationships.${exceptionSuffix}`
        );
      }
    }

    for (const exceptionEntry of exceptionConfig.exceptions) {
      if (!exceptionEntry.tableName) {
        continue;
      }
      if (!liveTables.includes(exceptionEntry.tableName)) {
        issues.push(
          `[table-ownership:stale-exception] ${TABLE_OWNERSHIP_RELATIVE_PATH} declares table "${exceptionEntry.tableName}" but that table does not exist in the live database.`
        );
      }
    }
  }

  function hasTopLevelObjectProperty(sourceText = "", propertyName = "") {
    const normalizedPropertyName = String(propertyName || "").trim();
    const normalizedSourceText = String(sourceText || "").trim();
    if (!normalizedPropertyName || !normalizedSourceText.startsWith("{")) {
      return false;
    }

    let parenDepth = 0;
    let braceDepth = 0;
    let bracketDepth = 0;
    let inLineComment = false;
    let inBlockComment = false;

    for (let index = 0; index < normalizedSourceText.length; index += 1) {
      const character = normalizedSourceText[index];
      const nextCharacter = normalizedSourceText[index + 1] || "";

      if (inLineComment) {
        if (character === "\n") {
          inLineComment = false;
        }
        continue;
      }

      if (inBlockComment) {
        if (character === "*" && nextCharacter === "/") {
          inBlockComment = false;
          index += 1;
        }
        continue;
      }

      if (character === "/" && nextCharacter === "/") {
        inLineComment = true;
        index += 1;
        continue;
      }

      if (character === "/" && nextCharacter === "*") {
        inBlockComment = true;
        index += 1;
        continue;
      }

      if (character === "'" || character === "\"") {
        const quote = character;
        const stringStart = index + 1;
        let stringEnd = stringStart;
        for (; stringEnd < normalizedSourceText.length; stringEnd += 1) {
          if (
            normalizedSourceText[stringEnd] === quote &&
            !isEscapedCharacter(normalizedSourceText, stringEnd)
          ) {
            break;
          }
        }

        const stringValue = normalizedSourceText.slice(stringStart, stringEnd);
        index = stringEnd;
        if (braceDepth === 1 && parenDepth === 0 && bracketDepth === 0 && stringValue === normalizedPropertyName) {
          let cursor = index + 1;
          while (/\s/u.test(normalizedSourceText[cursor] || "")) {
            cursor += 1;
          }
          if (normalizedSourceText[cursor] === ":") {
            return true;
          }
        }
        continue;
      }

      if (character === "`") {
        for (index += 1; index < normalizedSourceText.length; index += 1) {
          if (
            normalizedSourceText[index] === "`" &&
            !isEscapedCharacter(normalizedSourceText, index)
          ) {
            break;
          }
        }
        continue;
      }

      if (character === "(") {
        parenDepth += 1;
        continue;
      }
      if (character === ")") {
        parenDepth -= 1;
        continue;
      }
      if (character === "{") {
        braceDepth += 1;
        continue;
      }
      if (character === "}") {
        braceDepth -= 1;
        continue;
      }
      if (character === "[") {
        bracketDepth += 1;
        continue;
      }
      if (character === "]") {
        bracketDepth -= 1;
        continue;
      }

      if (
        braceDepth === 1 &&
        parenDepth === 0 &&
        bracketDepth === 0 &&
        /[A-Za-z_$]/u.test(character)
      ) {
        const identifierStart = index;
        for (index += 1; index < normalizedSourceText.length; index += 1) {
          if (!/[\w$]/u.test(normalizedSourceText[index] || "")) {
            break;
          }
        }

        const identifier = normalizedSourceText.slice(identifierStart, index);
        index -= 1;
        if (identifier !== normalizedPropertyName) {
          continue;
        }

        let cursor = index + 1;
        while (/\s/u.test(normalizedSourceText[cursor] || "")) {
          cursor += 1;
        }
        if (normalizedSourceText[cursor] === ":") {
          return true;
        }
      }
    }

    return false;
  }

  function isSharedListFiltersImportSource(sourcePath = "") {
    return /(^|\/)shared\/[^/'"]*ListFilters(?:\.[A-Za-z0-9]+)?$/u.test(String(sourcePath || "").trim());
  }

  function findCallSites(sourceText = "", calleeName = "") {
    const normalizedCalleeName = String(calleeName || "").trim();
    if (!normalizedCalleeName) {
      return [];
    }

    const callPattern = new RegExp(`\\b${normalizedCalleeName}\\s*\\(`, "gu");
    const calls = [];

    for (const match of sourceText.matchAll(callPattern)) {
      const matchedText = String(match[0] || "");
      const openParenIndex = (match.index || 0) + matchedText.lastIndexOf("(");
      const closeParenIndex = findClosingParenIndex(sourceText, openParenIndex);
      if (closeParenIndex < 0) {
        continue;
      }

      calls.push({
        calleeName: normalizedCalleeName,
        index: match.index || 0,
        openParenIndex,
        closeParenIndex,
        argsText: sourceText.slice(openParenIndex + 1, closeParenIndex)
      });
    }

    return calls;
  }

  function collectFilterDefinitionOwnershipIssues({
    sourceText = "",
    relativePath = "",
    issues = []
  }) {
    const importBindings = collectStaticImportBindings(sourceText);

    for (const calleeName of FILTER_RUNTIME_CALLEES) {
      for (const callSite of findCallSites(sourceText, calleeName)) {
        const lineNumber = resolveLineNumberFromIndex(sourceText, callSite.index);
        const firstArgument = extractFirstArgumentText(callSite.argsText).trim();

        if (!firstArgument || firstArgument.startsWith("{")) {
          issues.push(
            `${relativePath}:${lineNumber}: [filters:shared-definition] do not inline structured filter definitions in ${calleeName}(...). Put them in packages/<crud>/src/shared/<crud>ListFilters.js and import that shared module.`
          );
          continue;
        }

        if (!/^[A-Za-z_$][\w$]*$/u.test(firstArgument)) {
          issues.push(
            `${relativePath}:${lineNumber}: [filters:shared-definition] ${calleeName}(...) must receive a definitions symbol imported from a CRUD shared *ListFilters module, not an ad-hoc expression.`
          );
          continue;
        }

        const importSource = importBindings.get(firstArgument) || "";
        if (!isSharedListFiltersImportSource(importSource)) {
          issues.push(
            `${relativePath}:${lineNumber}: [filters:shared-definition] ${calleeName}(${firstArgument}, ...) must use definitions imported from a CRUD shared *ListFilters module. Found ${importSource ? `import source "${importSource}"` : "a local symbol"} instead.`
          );
        }
      }
    }
  }

  function collectFilterValidatorModeIssues({
    sourceText = "",
    relativePath = "",
    issues = []
  }) {
    for (const callSite of findCallSites(sourceText, "createQueryValidator")) {
      const lineNumber = resolveLineNumberFromIndex(sourceText, callSite.index);
      const argsText = String(callSite.argsText || "").trim();
      if (!argsText.startsWith("{") || !/\binvalidValues\s*:/u.test(argsText)) {
        issues.push(
          `${relativePath}:${lineNumber}: [filters:validator-mode] createQueryValidator(...) must be written explicitly as createQueryValidator({ invalidValues: "reject" | "discard" }). Do not rely on hidden defaults, aliases, or indirect option objects.`
        );
      }
    }
  }

  function collectCrudTransportOwnershipIssues({
    sourceText = "",
    relativePath = "",
    issues = []
  }) {
    for (const calleeName of CRUD_TRANSPORT_RUNTIME_CALLEES) {
      for (const callSite of findCallSites(sourceText, calleeName)) {
        const firstArgument = extractFirstArgumentText(callSite.argsText).trim();
        if (!hasTopLevelObjectProperty(firstArgument, "transport")) {
          continue;
        }

        const lineNumber = resolveLineNumberFromIndex(sourceText, callSite.index);
        issues.push(
          `${relativePath}:${lineNumber}: [crud:transport-derived] do not pass explicit transport to ${calleeName}(...). Let the shared CRUD resource derive JSON:API transport automatically, or drop to useList/useView/useAddEdit/usersWebHttpClient.request(...) for custom transport behavior.`
        );
      }
    }
  }

  async function collectMdiSvgDoctorIssues({ appRoot, issues }) {
    if (!(await appUsesVuetifyMdiSvg(appRoot))) {
      return;
    }

    const vueFilePaths = [];
    for (const relativeRoot of APP_SOURCE_SCAN_ROOTS) {
      await collectAppSourceFiles(
        path.join(appRoot, relativeRoot),
        { extensions: VUE_SOURCE_EXTENSIONS },
        vueFilePaths
      );
    }

    vueFilePaths.sort((left, right) => left.localeCompare(right));

    for (const absolutePath of vueFilePaths) {
      const sourceText = await readFile(absolutePath, "utf8");
      collectDirectMdiSvgTemplateIconIssues({
        sourceText,
        relativePath: normalizeRelativePath(appRoot, absolutePath),
        issues
      });
    }
  }

  async function collectCrudFilterDoctorIssues({ appRoot, issues }) {
    const sourceFilePaths = [];
    for (const relativeRoot of APP_SOURCE_SCAN_ROOTS) {
      await collectAppSourceFiles(path.join(appRoot, relativeRoot), undefined, sourceFilePaths);
    }

    sourceFilePaths.sort((left, right) => left.localeCompare(right));

    for (const absolutePath of sourceFilePaths) {
      const sourceText = await readFile(absolutePath, "utf8");
      if (
        !sourceText.includes("useCrudListFilters") &&
        !sourceText.includes("createCrudListFilters") &&
        !sourceText.includes("createQueryValidator") &&
        !sourceText.includes("useCrudList") &&
        !sourceText.includes("useCrudView") &&
        !sourceText.includes("useCrudAddEdit")
      ) {
        continue;
      }

      const relativePath = normalizeRelativePath(appRoot, absolutePath);
      collectFilterDefinitionOwnershipIssues({
        sourceText,
        relativePath,
        issues
      });
      collectFilterValidatorModeIssues({
        sourceText,
        relativePath,
        issues
      });
      collectCrudTransportOwnershipIssues({
        sourceText,
        relativePath,
        issues
      });
    }
  }

  async function collectUiVerificationDoctorIssues({ appRoot, issues, against = "" }) {
    if (!(await directoryLooksLikeJskitAppRoot(appRoot))) {
      return;
    }

    const normalizedAgainst = String(against || "").trim();
    const changedUiState = resolveChangedUiFilesFromGit(appRoot, {
      against: normalizedAgainst
    });
    if (!changedUiState.available) {
      if (normalizedAgainst) {
        issues.push(
          `[ui:verification] could not resolve changed UI files against ${JSON.stringify(normalizedAgainst)}: ${changedUiState.error || "unknown git error"}`
        );
      }
      return;
    }
    if (changedUiState.paths.length < 1) {
      return;
    }

    const receiptPath = path.join(appRoot, UI_VERIFICATION_RECEIPT_RELATIVE_PATH);
    if (!(await fileExists(receiptPath))) {
      const againstSegment = normalizedAgainst ? ` --against ${JSON.stringify(normalizedAgainst)}` : "";
      issues.push(
        `[ui:verification] changed UI files require a matching ${UI_VERIFICATION_RECEIPT_RELATIVE_PATH} receipt. Run jskit app verify-ui${againstSegment} --command "<playwright command>" --feature "<label>" --auth-mode <mode>. Current files: ${changedUiState.paths.join(", ")}`
      );
      return;
    }

    let parsedReceipt = null;
    try {
      parsedReceipt = JSON.parse(await readFile(receiptPath, "utf8"));
    } catch (error) {
      issues.push(
        `[ui:verification] ${UI_VERIFICATION_RECEIPT_RELATIVE_PATH} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
      );
      return;
    }

    const receipt = normalizeUiVerificationReceipt(parsedReceipt);
    if (!isValidUiVerificationReceipt(receipt)) {
      issues.push(
        `[ui:verification] ${UI_VERIFICATION_RECEIPT_RELATIVE_PATH} is incomplete. It must include version, runner, recordedAt, feature, command, authMode, and changedUiFiles from jskit app verify-ui.`
      );
      return;
    }

    if (normalizedAgainst && receipt.against !== normalizedAgainst) {
      issues.push(
        `[ui:verification] ${UI_VERIFICATION_RECEIPT_RELATIVE_PATH} was recorded against ${JSON.stringify(receipt.against || "<dirty-worktree>")} but doctor is checking against ${JSON.stringify(normalizedAgainst)}. Re-run jskit app verify-ui with the same --against value.`
      );
      return;
    }

    if (JSON.stringify(receipt.changedUiFiles) !== JSON.stringify(changedUiState.paths)) {
      issues.push(
        `[ui:verification] ${UI_VERIFICATION_RECEIPT_RELATIVE_PATH} does not match the current changed UI file set. Re-run jskit app verify-ui after the latest UI edits. Current files: ${changedUiState.paths.join(", ")}`
      );
    }
  }

  function collectDiLabelParityIssuesForPackage({ packageEntry, packageInsights }) {
    const packageId = String(packageEntry?.packageId || "").trim();
    const descriptor = ensureObject(packageEntry?.descriptor);
    const metadataApiSummary = ensureObject(ensureObject(descriptor.metadata).apiSummary);
    const descriptorTokenSummary = ensureObject(metadataApiSummary.containerTokens);
    const bindingSections = ensureObject(ensureObject(packageInsights).containerBindings);
    const issues = [];
    const sides = ["server", "client"];

    collectProviderIntrospectionIssues({ packageId, packageInsights, issues });

    for (const side of sides) {
      const declaredTokens = collectDescriptorContainerTokens({
        packageId,
        side,
        values: descriptorTokenSummary[side],
        issues
      });
      const usedTokens = collectUsedContainerTokens({
        packageId,
        side,
        bindings: bindingSections[side],
        issues
      });

      for (const token of sortStrings([...usedTokens])) {
        if (!declaredTokens.has(token)) {
          issues.push({
            packageId,
            side,
            code: "binding-token-undeclared",
            token,
            message: `${packageId} (${side}): token is used by providers but missing from metadata.apiSummary.containerTokens.${side}: ${token}.`
          });
        }
      }
      for (const token of sortStrings([...declaredTokens])) {
        if (!usedTokens.has(token)) {
          issues.push({
            packageId,
            side,
            code: "descriptor-token-unused",
            token,
            message: `${packageId} (${side}): token is declared in metadata.apiSummary.containerTokens.${side} but never bound by providers: ${token}.`
          });
        }
      }
    }

    return issues;
  }

  async function commandDoctor({ cwd, options, stdout }) {
    const appRoot = await resolveAppRootFromCwd(cwd);
    const against = String(options?.inlineOptions?.against || "").trim();
    const { lock } = await loadLockFile(appRoot);
    const packageRegistry = await loadPackageRegistry();
    const appLocalRegistry = await loadAppLocalPackageRegistry(appRoot);
    const combinedPackageRegistry = mergePackageRegistries(packageRegistry, appLocalRegistry);
    const issues = [];
    const warnings = [];
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
        }
      }
    }

    await collectMdiSvgDoctorIssues({
      appRoot,
      issues
    });
    await collectCrudFilterDoctorIssues({
      appRoot,
      issues
    });
    await collectUiVerificationDoctorIssues({
      appRoot,
      issues,
      against
    });
    await collectFeatureLaneDoctorIssues({
      appRoot,
      appLocalRegistry,
      issues,
      warnings
    });
    await collectTableOwnershipDoctorIssues({
      appRoot,
      installedPackageIds: Object.keys(installed),
      packageRegistry: combinedPackageRegistry,
      appLocalRegistry,
      issues
    });

    const payload = {
      appRoot,
      lockVersion: lock.lockVersion,
      installedPackages: sortStrings(Object.keys(installed)),
      issues,
      warnings: sortStrings(warnings)
    };

    if (options.json) {
      stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      stdout.write(`App root: ${appRoot}\n`);
      stdout.write(`Installed packages: ${payload.installedPackages.length}\n`);
      if (issues.length === 0 && payload.warnings.length === 0) {
        stdout.write("Doctor status: healthy\n");
      } else if (issues.length === 0) {
        stdout.write(`Doctor status: warnings (${payload.warnings.length} warning(s))\n`);
        for (const warning of payload.warnings) {
          stdout.write(`! ${warning}\n`);
        }
      } else {
        stdout.write(`Doctor status: unhealthy (${issues.length} issue(s))\n`);
        for (const issue of issues) {
          stdout.write(`- ${issue}\n`);
        }
        for (const warning of payload.warnings) {
          stdout.write(`! ${warning}\n`);
        }
      }
    }

    return issues.length === 0 ? 0 : 1;
  }

  async function commandLintDescriptors({ options, stdout }) {
    const packageRegistry = await loadPackageRegistry();
    const bundleRegistry = await loadBundleRegistry();
    const shouldCheckDiLabels = options.checkDiLabels === true;
    let diLabelIssues = [];
    if (shouldCheckDiLabels) {
      const issues = [];
      for (const packageId of sortStrings([...packageRegistry.keys()])) {
        const packageEntry = packageRegistry.get(packageId);
        if (!packageEntry) {
          continue;
        }
        const packageInsights = await inspectPackageOfferings({ packageEntry });
        issues.push(...collectDiLabelParityIssuesForPackage({ packageEntry, packageInsights }));
      }
      diLabelIssues = issues;
    }
    const payload = {
      packageCount: packageRegistry.size,
      bundleCount: bundleRegistry.size,
      packages: sortStrings([...packageRegistry.keys()]),
      bundles: sortStrings([...bundleRegistry.keys()]),
      diLabelCheck: shouldCheckDiLabels
        ? {
            enabled: true,
            issueCount: diLabelIssues.length,
            issues: diLabelIssues
          }
        : {
            enabled: false
          }
    };

    if (options.json) {
      stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      const descriptorStatus = shouldCheckDiLabels && diLabelIssues.length > 0 ? "failed" : "passed";
      stdout.write(`Descriptor lint ${descriptorStatus}.\n`);
      stdout.write(`Packages: ${payload.packageCount}\n`);
      stdout.write(`Bundles: ${payload.bundleCount}\n`);
      if (shouldCheckDiLabels) {
        if (diLabelIssues.length === 0) {
          stdout.write("DI label parity check passed.\n");
        } else {
          stdout.write(`DI label parity check failed (${diLabelIssues.length} issue(s)).\n`);
          for (const issue of diLabelIssues) {
            const code = String(issue?.code || "").trim();
            const codeLabel = code ? `[${code}] ` : "";
            stdout.write(`- ${codeLabel}${String(issue?.message || "").trim()}\n`);
          }
        }
      }
    }
    if (shouldCheckDiLabels && diLabelIssues.length > 0) {
      return 1;
    }
    return 0;
  }

  return {
    commandDoctor,
    commandLintDescriptors
  };
}

export { createHealthCommands };
