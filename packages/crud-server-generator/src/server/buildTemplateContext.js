import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  normalizeText,
  resolveDatabaseClientFromEnvironment,
  resolveKnexConnectionFromEnvironment,
  toKnexClientId
} from "@jskit-ai/database-runtime/shared";
import { resolveCrudSurfacePolicyFromAppConfig } from "@jskit-ai/crud-core/server/crudModuleConfig";
import { checkCrudLookupFormControl } from "@jskit-ai/crud-core/shared/crudFieldMetaSupport";
import {
  importFreshModuleFromAbsolutePath,
  loadAppConfigFromModuleUrl,
  resolveRequiredAppRoot
} from "@jskit-ai/kernel/server/support";
import { normalizeCrudLookupNamespace } from "@jskit-ai/kernel/shared/support/crudLookup";
import { toCamelCase, toSnakeCase } from "@jskit-ai/kernel/shared/support/stringCase";
import descriptor from "../../package.descriptor.mjs";

const DEFAULT_ID_COLUMN = "id";
const DEFAULT_OWNERSHIP_FILTER_VALUES = Object.freeze(["auto", "public", "user", "workspace", "workspace_user"]);
const MYSQL_CLIENT_ID = "mysql2";
const CRUD_PERMISSION_OPERATIONS = Object.freeze(["list", "view", "create", "update", "delete"]);

function resolveAllowedValues(schema = {}, fallbackValues = []) {
  const resolvedValues = [];
  const seen = new Set();
  for (const rawValue of Array.isArray(schema?.allowedValues) ? schema.allowedValues : []) {
    const value = normalizeText(typeof rawValue === "string" ? rawValue : rawValue?.value).toLowerCase();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    resolvedValues.push(value);
  }
  if (resolvedValues.length > 0) {
    return Object.freeze(resolvedValues);
  }
  return Object.freeze(
    (Array.isArray(fallbackValues) ? fallbackValues : [])
      .map((value) => normalizeText(value).toLowerCase())
      .filter(Boolean)
  );
}

const OWNERSHIP_FILTER_ALLOWED_VALUES = resolveAllowedValues(
  descriptor?.options?.["ownership-filter"],
  DEFAULT_OWNERSHIP_FILTER_VALUES
);
const OWNERSHIP_FILTER_AUTO = normalizeText(
  descriptor?.options?.["ownership-filter"]?.defaultValue
).toLowerCase() || "auto";
const OWNERSHIP_FILTER_VALUES = new Set(OWNERSHIP_FILTER_ALLOWED_VALUES);

function resolveGlobalScaffoldCache() {
  const globalObject = globalThis;
  const cacheKey = "__jskitCrudTemplateContextCache";
  const existing = globalObject?.[cacheKey];
  if (existing instanceof Map) {
    return existing;
  }

  const nextCache = new Map();
  if (globalObject && typeof globalObject === "object") {
    globalObject[cacheKey] = nextCache;
  }
  return nextCache;
}

const scaffoldCache = resolveGlobalScaffoldCache();

function asRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function normalizeRequestedOwnershipFilter(value, { strict = false } = {}) {
  const normalized = normalizeText(value).toLowerCase();
  if (OWNERSHIP_FILTER_VALUES.has(normalized)) {
    return normalized;
  }
  if (strict) {
    throw new Error(
      `Invalid ownership filter "${normalized || String(value || "")}". Use: ${OWNERSHIP_FILTER_ALLOWED_VALUES.join(", ")}.`
    );
  }
  return OWNERSHIP_FILTER_AUTO;
}

function inferOwnershipFilterFromSnapshot(snapshot) {
  const hasWorkspace = snapshot?.hasWorkspaceIdColumn === true;
  const hasUser = snapshot?.hasUserIdColumn === true;
  if (hasWorkspace && hasUser) {
    return "workspace_user";
  }
  if (hasWorkspace) {
    return "workspace";
  }
  if (hasUser) {
    return "user";
  }
  return "public";
}

function assertOwnershipColumnsForFilter(snapshot, filter) {
  const hasWorkspace = snapshot?.hasWorkspaceIdColumn === true;
  const hasUser = snapshot?.hasUserIdColumn === true;
  if (filter === "public") {
    return;
  }
  if (filter === "workspace" && !hasWorkspace) {
    throw new Error(
      'Ownership filter "workspace" requires column "workspace_id".'
    );
  }
  if (filter === "user" && !hasUser) {
    throw new Error(
      'Ownership filter "user" requires column "user_id".'
    );
  }
  if (filter === "workspace_user" && (!hasWorkspace || !hasUser)) {
    throw new Error(
      'Ownership filter "workspace_user" requires both columns "workspace_id" and "user_id".'
    );
  }
}

function resolveOwnershipFilterForGeneration(snapshot, requestedOwnershipFilter, { enforceTableColumns = false } = {}) {
  const requested = normalizeRequestedOwnershipFilter(requestedOwnershipFilter, {
    strict: enforceTableColumns
  });
  if (!enforceTableColumns) {
    return requested;
  }
  if (requested === OWNERSHIP_FILTER_AUTO) {
    return inferOwnershipFilterFromSnapshot(snapshot);
  }
  assertOwnershipColumnsForFilter(snapshot, requested);
  return requested;
}

function parseDotEnvLine(line = "") {
  const source = String(line || "").trim();
  if (!source || source.startsWith("#")) {
    return null;
  }
  const separatorIndex = source.indexOf("=");
  if (separatorIndex < 0) {
    return null;
  }

  const key = normalizeText(source.slice(0, separatorIndex));
  if (!key) {
    return null;
  }

  let value = String(source.slice(separatorIndex + 1) || "").trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  } else {
    const commentIndex = value.indexOf(" #");
    if (commentIndex >= 0) {
      value = value.slice(0, commentIndex).trim();
    }
  }

  return {
    key,
    value
  };
}

async function loadEnvFromApp(appRoot) {
  const envPath = path.join(path.resolve(String(appRoot || "")), ".env");
  let envContent = "";
  try {
    envContent = await readFile(envPath, "utf8");
  } catch {
    envContent = "";
  }

  const parsed = {};
  for (const line of String(envContent || "").split(/\r?\n/)) {
    const parsedLine = parseDotEnvLine(line);
    if (!parsedLine) {
      continue;
    }
    parsed[parsedLine.key] = parsedLine.value;
  }

  return {
    ...parsed,
    ...process.env
  };
}

function createAppRequire(appRoot) {
  const resolvedAppRoot = path.resolve(String(appRoot || ""));
  const packageJsonPath = path.join(resolvedAppRoot, "package.json");
  return createRequire(packageJsonPath);
}

async function importModuleFromApp(appRequire, moduleId, contextLabel) {
  let resolvedPath = "";
  try {
    resolvedPath = appRequire.resolve(moduleId);
  } catch {
    throw new Error(
      `${contextLabel} requires dependency "${moduleId}" installed in the app.`
    );
  }

  try {
    return await importFreshModuleFromAbsolutePath(resolvedPath);
  } catch (error) {
    throw new Error(
      `${contextLabel} failed loading "${moduleId}": ${String(error?.message || error || "unknown error")}`
    );
  }
}

async function resolveCrudSurfaceRequiresWorkspace({
  appRoot,
  options,
  surface = ""
} = {}) {
  const namespace = normalizeText(options?.namespace);
  const resolvedSurface = normalizeText(surface || options?.surface);
  if (!namespace) {
    throw new Error('crud template context requires option "namespace".');
  }
  if (!resolvedSurface) {
    throw new Error('crud template context requires option "surface".');
  }

  const appConfig = await loadCrudAppConfig(appRoot);
  const crudPolicy = resolveCrudSurfacePolicyFromAppConfig(
    {
      namespace,
      surface: resolvedSurface,
      ownershipFilter: options?.["ownership-filter"]
    },
    appConfig,
    {
      context: "crud template context"
    }
  );

  return crudPolicy?.surfaceDefinition?.requiresWorkspace === true;
}

async function loadCrudAppConfig(appRoot = "") {
  const resolvedAppRoot = resolveRequiredAppRoot(appRoot, {
    context: "crud template context"
  });
  return loadAppConfigFromModuleUrl({
    moduleUrl: pathToFileURL(path.join(resolvedAppRoot, "config", "public.js")).href
  });
}

function resolveSurfaceDefinitions(appConfig = {}) {
  const definitions = asRecord(appConfig?.surfaceDefinitions);
  const resolved = {};
  for (const [key, rawValue] of Object.entries(definitions)) {
    const definition = asRecord(rawValue);
    const id = normalizeText(definition.id || key).toLowerCase();
    if (!id) {
      continue;
    }
    resolved[id] = Object.freeze({
      id,
      enabled: definition.enabled !== false,
      requiresWorkspace: definition.requiresWorkspace === true
    });
  }
  return Object.freeze(resolved);
}

function resolveDefaultCrudSurfaceIdFromAppConfig(appConfig = {}) {
  const surfaceDefinitions = resolveSurfaceDefinitions(appConfig);
  const enabledSurfaceDefinitions = Object.values(surfaceDefinitions).filter((entry) => entry.enabled === true);
  const hasEnabledWorkspaceSurface = enabledSurfaceDefinitions.some((entry) => entry.requiresWorkspace === true);
  if (hasEnabledWorkspaceSurface) {
    return "";
  }

  const homeSurface = surfaceDefinitions.home;
  if (homeSurface?.enabled === true && homeSurface.requiresWorkspace !== true) {
    return "home";
  }

  return "";
}

async function resolveCrudGenerationSurfaceId({
  appRoot,
  options
} = {}) {
  const explicitSurface = normalizeText(options?.surface).toLowerCase();
  if (explicitSurface) {
    return explicitSurface;
  }

  const appConfig = await loadCrudAppConfig(appRoot);
  const defaultSurface = resolveDefaultCrudSurfaceIdFromAppConfig(appConfig);
  if (defaultSurface) {
    return defaultSurface;
  }

  throw new Error(
    'crud template context requires option "surface" when the app has any enabled workspace surface or no enabled non-workspace "home" surface.'
  );
}

function resolveKnexFactory(moduleNamespace) {
  if (typeof moduleNamespace === "function") {
    return moduleNamespace;
  }
  if (typeof moduleNamespace?.default === "function") {
    return moduleNamespace.default;
  }
  if (typeof moduleNamespace?.knex === "function") {
    return moduleNamespace.knex;
  }
  throw new Error("Resolved knex module did not expose a callable factory.");
}

async function resolveMysqlSnapshotFromDatabase({
  appRoot,
  tableName,
  idColumn
} = {}) {
  const env = await loadEnvFromApp(appRoot);
  const dbClient = resolveDatabaseClientFromEnvironment(env);
  if (dbClient !== MYSQL_CLIENT_ID) {
    throw new Error(
      `CRUD table introspection currently supports only DB_CLIENT=${MYSQL_CLIENT_ID}. Found "${dbClient}".`
    );
  }

  const connection = resolveKnexConnectionFromEnvironment(env, {
    client: dbClient,
    defaultPort: 3306,
    context: "crud table introspection"
  });
  const knexClientId = toKnexClientId(dbClient);
  const appRequire = createAppRequire(appRoot);

  const knexModule = await importModuleFromApp(appRequire, "knex", "CRUD table introspection");
  const mysqlSharedModule = await importModuleFromApp(
    appRequire,
    "@jskit-ai/database-runtime-mysql/shared",
    "CRUD table introspection"
  );

  const knexFactory = resolveKnexFactory(knexModule);
  const introspectCrudTableSnapshot = mysqlSharedModule?.introspectCrudTableSnapshot;
  if (typeof introspectCrudTableSnapshot !== "function") {
    throw new Error(
      "CRUD table introspection requires @jskit-ai/database-runtime-mysql/shared export introspectCrudTableSnapshot()."
    );
  }

  const knex = knexFactory({
    client: knexClientId,
    connection
  });
  try {
    return await introspectCrudTableSnapshot(knex, {
      tableName,
      idColumn
    });
  } finally {
    if (knex && typeof knex.destroy === "function") {
      await knex.destroy();
    }
  }
}

function resolveColumnKey(column, idColumn) {
  if (column.name === idColumn) {
    return "id";
  }
  return String(column.key || "");
}

const NUMERIC_CHECK_CONSTRAINT_PATTERN = /(?:`([^`]+)`|([A-Za-z_][A-Za-z0-9_]*))\s*(>=|>|<=|<)\s*(-?\d+(?:\.\d+)?)/g;
const NUMERIC_CHECK_CONSTRAINT_BETWEEN_PATTERN = /(?:`([^`]+)`|([A-Za-z_][A-Za-z0-9_]*))\s+between\s+(-?\d+(?:\.\d+)?)\s+and\s+(-?\d+(?:\.\d+)?)/gi;

function normalizeNumericBoundValue(value, scale = null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  if (!Number.isInteger(scale) || scale < 0) {
    return parsed;
  }
  return Number(parsed.toFixed(scale));
}

function resolveNumericExclusiveStep(column) {
  if (column?.typeKind === "integer") {
    return 1;
  }
  if (column?.typeKind === "number" && Number.isInteger(column?.numericScale) && column.numericScale > 0) {
    return 1 / (10 ** column.numericScale);
  }
  return null;
}

function applyLowerBound(current = null, candidate = null) {
  if (!candidate) {
    return current;
  }
  if (!current) {
    return candidate;
  }
  if (candidate.value > current.value) {
    return candidate;
  }
  if (candidate.value < current.value) {
    return current;
  }
  if (candidate.exclusive === true && current.exclusive !== true) {
    return candidate;
  }
  return current;
}

function applyUpperBound(current = null, candidate = null) {
  if (!candidate) {
    return current;
  }
  if (!current) {
    return candidate;
  }
  if (candidate.value < current.value) {
    return candidate;
  }
  if (candidate.value > current.value) {
    return current;
  }
  if (candidate.exclusive === true && current.exclusive !== true) {
    return candidate;
  }
  return current;
}

function applyNumericConstraintBound(target = {}, column = null, operator = "", rawValue = null) {
  if (!column || !Number.isFinite(rawValue)) {
    return;
  }

  if (operator === ">=" || operator === ">") {
    let candidate = null;
    if (operator === ">=") {
      candidate = {
        value: normalizeNumericBoundValue(rawValue, column.numericScale),
        exclusive: false
      };
    } else {
      const exclusiveStep = resolveNumericExclusiveStep(column);
      if (exclusiveStep != null) {
        candidate = {
          value: normalizeNumericBoundValue(rawValue + exclusiveStep, column.numericScale),
          exclusive: false
        };
      } else {
        candidate = {
          value: normalizeNumericBoundValue(rawValue, column.numericScale),
          exclusive: true
        };
      }
    }

    const nextBound = applyLowerBound(
      target.minimum != null || target.exclusiveMinimum != null
        ? {
            value: target.minimum ?? target.exclusiveMinimum,
            exclusive: target.exclusiveMinimum != null
          }
        : null,
      candidate
    );
    target.minimum = nextBound?.exclusive === true ? null : nextBound?.value ?? null;
    target.exclusiveMinimum = nextBound?.exclusive === true ? nextBound?.value ?? null : null;
    return;
  }

  if (operator === "<=" || operator === "<") {
    let candidate = null;
    if (operator === "<=") {
      candidate = {
        value: normalizeNumericBoundValue(rawValue, column.numericScale),
        exclusive: false
      };
    } else {
      const exclusiveStep = resolveNumericExclusiveStep(column);
      if (exclusiveStep != null) {
        candidate = {
          value: normalizeNumericBoundValue(rawValue - exclusiveStep, column.numericScale),
          exclusive: false
        };
      } else {
        candidate = {
          value: normalizeNumericBoundValue(rawValue, column.numericScale),
          exclusive: true
        };
      }
    }

    const nextBound = applyUpperBound(
      target.maximum != null || target.exclusiveMaximum != null
        ? {
            value: target.maximum ?? target.exclusiveMaximum,
            exclusive: target.exclusiveMaximum != null
          }
        : null,
      candidate
    );
    target.maximum = nextBound?.exclusive === true ? null : nextBound?.value ?? null;
    target.exclusiveMaximum = nextBound?.exclusive === true ? nextBound?.value ?? null : null;
  }
}

function resolveColumnNumericBounds(snapshot = {}) {
  const byColumnName = new Map();
  const columns = Array.isArray(snapshot.columns) ? snapshot.columns : [];
  const checkConstraints = Array.isArray(snapshot.checkConstraints) ? snapshot.checkConstraints : [];
  const numericColumnsByName = new Map(
    columns
      .filter((column) => column?.typeKind === "integer" || column?.typeKind === "number")
      .map((column) => [String(column.name || ""), column])
  );

  function getColumnBounds(columnName) {
    if (!byColumnName.has(columnName)) {
      byColumnName.set(columnName, {
        minimum: null,
        exclusiveMinimum: null,
        maximum: null,
        exclusiveMaximum: null
      });
    }
    return byColumnName.get(columnName);
  }

  for (const column of numericColumnsByName.values()) {
    if (column.unsigned === true) {
      const target = getColumnBounds(column.name);
      target.minimum = 0;
    }
  }

  for (const constraint of checkConstraints) {
    const clause = String(constraint?.clause || "");
    if (!clause) {
      continue;
    }

    let betweenMatch = null;
    while ((betweenMatch = NUMERIC_CHECK_CONSTRAINT_BETWEEN_PATTERN.exec(clause)) != null) {
      const columnName = String(betweenMatch[1] || betweenMatch[2] || "");
      const lowerValue = Number(betweenMatch[3]);
      const upperValue = Number(betweenMatch[4]);
      const column = numericColumnsByName.get(columnName) || null;
      if (!column || !Number.isFinite(lowerValue) || !Number.isFinite(upperValue)) {
        continue;
      }

      const target = getColumnBounds(columnName);
      applyNumericConstraintBound(target, column, ">=", lowerValue);
      applyNumericConstraintBound(target, column, "<=", upperValue);
    }
    NUMERIC_CHECK_CONSTRAINT_BETWEEN_PATTERN.lastIndex = 0;

    let match = null;
    while ((match = NUMERIC_CHECK_CONSTRAINT_PATTERN.exec(clause)) != null) {
      const columnName = String(match[1] || match[2] || "");
      const operator = String(match[3] || "");
      const rawValue = Number(match[4]);
      const column = numericColumnsByName.get(columnName) || null;
      if (!column || !Number.isFinite(rawValue)) {
        continue;
      }

      const target = getColumnBounds(columnName);
      applyNumericConstraintBound(target, column, operator, rawValue);
    }
    NUMERIC_CHECK_CONSTRAINT_PATTERN.lastIndex = 0;
  }

  return byColumnName;
}

function resolveScaffoldColumns(snapshot) {
  const idColumn = String(snapshot.idColumn || DEFAULT_ID_COLUMN);
  const sourceColumns = Array.isArray(snapshot.columns) ? snapshot.columns : [];
  const numericBoundsByColumnName = resolveColumnNumericBounds(snapshot);
  const foreignKeyColumnNames = new Set(
    (Array.isArray(snapshot.foreignKeys) ? snapshot.foreignKeys : [])
      .flatMap((foreignKey) => Array.isArray(foreignKey?.columns) ? foreignKey.columns : [])
      .map((entry) => String(entry?.name || "").trim())
      .filter(Boolean)
  );
  const seenKeys = new Set();

  const columns = sourceColumns.map((column) => {
    const isWorkspaceIdColumn = column.name === "workspace_id";
    const isUserIdColumn = column.name === "user_id";
    const isOwnerColumn = isWorkspaceIdColumn || isUserIdColumn;
    const isIdColumn = column.name === idColumn;
    const isForeignIdColumn = foreignKeyColumnNames.has(column.name) || /_id$/i.test(String(column.name || ""));
    const isCreatedAtColumn = column.name === "created_at";
    const isUpdatedAtColumn = column.name === "updated_at";
    const key = resolveColumnKey(column, idColumn);
    const isRecordIdColumn = isIdColumn || isOwnerColumn || isForeignIdColumn || /Id$/.test(String(key || ""));
    if (!key) {
      throw new Error(`Could not derive API field key for column "${column.name}".`);
    }

    if (!isOwnerColumn) {
      if (seenKeys.has(key)) {
        throw new Error(
          `Generated API field key "${key}" is duplicated. Rename columns or choose a different id column.`
        );
      }
      seenKeys.add(key);
    }

    return Object.freeze({
      ...column,
      ...(numericBoundsByColumnName.get(column.name) || {}),
      key,
      isOwnerColumn,
      isIdColumn,
      isForeignIdColumn,
      isRecordIdColumn,
      isCreatedAtColumn,
      isUpdatedAtColumn,
      writable: !isOwnerColumn && !isIdColumn && !isCreatedAtColumn && !isUpdatedAtColumn
    });
  });

  return Object.freeze(columns);
}

const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function isIdentifier(value) {
  return IDENTIFIER_PATTERN.test(String(value || ""));
}

function renderObjectPropertyKey(value) {
  const key = String(value || "");
  return isIdentifier(key) ? key : JSON.stringify(key);
}

function renderPropertyAccess(sourceName, key) {
  const normalizedKey = String(key || "");
  if (isIdentifier(normalizedKey)) {
    return `${sourceName}.${normalizedKey}`;
  }
  return `${sourceName}[${JSON.stringify(normalizedKey)}]`;
}

function renderIntegerSchema(column) {
  const options = [];
  if (Number.isFinite(column?.minimum)) {
    options.push(`minimum: ${column.minimum}`);
  } else if (Number.isFinite(column?.exclusiveMinimum)) {
    options.push(`exclusiveMinimum: ${column.exclusiveMinimum}`);
  } else if (column.unsigned === true) {
    options.push("minimum: 0");
  }
  if (Number.isFinite(column?.maximum)) {
    options.push(`maximum: ${column.maximum}`);
  }
  if (Number.isFinite(column?.exclusiveMaximum)) {
    options.push(`exclusiveMaximum: ${column.exclusiveMaximum}`);
  }
  if (options.length > 0) {
    return `Type.Integer({ ${options.join(", ")} })`;
  }
  return "Type.Integer()";
}

function renderStringSchema(column, { forOutput = false } = {}) {
  const options = [];
  if (!forOutput && Number.isInteger(column.maxLength) && column.maxLength > 0) {
    options.push(`maxLength: ${column.maxLength}`);
  }
  const enumValues = Array.isArray(column.enumValues) ? column.enumValues.filter((entry) => entry != null) : [];
  if (!forOutput && enumValues.length > 0) {
    options.push(`enum: ${JSON.stringify(enumValues)}`);
  }
  if (options.length > 0) {
    return `Type.String({ ${options.join(", ")} })`;
  }
  return "Type.String()";
}

function renderResourceFieldSchema(column, { forOutput = false } = {}) {
  let schemaExpression = "Type.Any()";
  const typeKind = String(column.typeKind || "");
  if (typeKind === "string") {
    schemaExpression = renderStringSchema(column, { forOutput });
  } else if (typeKind === "integer") {
    if (column?.isRecordIdColumn === true) {
      return forOutput
        ? (column.nullable === true ? "nullableRecordIdSchema" : "recordIdSchema")
        : (column.nullable === true ? "nullableRecordIdInputSchema" : "recordIdInputSchema");
    }
    schemaExpression = renderIntegerSchema(column);
  } else if (typeKind === "number") {
    const options = [];
    if (Number.isFinite(column?.minimum)) {
      options.push(`minimum: ${column.minimum}`);
    }
    if (Number.isFinite(column?.exclusiveMinimum)) {
      options.push(`exclusiveMinimum: ${column.exclusiveMinimum}`);
    }
    if (Number.isFinite(column?.maximum)) {
      options.push(`maximum: ${column.maximum}`);
    }
    if (Number.isFinite(column?.exclusiveMaximum)) {
      options.push(`exclusiveMaximum: ${column.exclusiveMaximum}`);
    }
    schemaExpression = options.length > 0
      ? `Type.Number({ ${options.join(", ")} })`
      : "Type.Number()";
  } else if (typeKind === "boolean") {
    schemaExpression = "Type.Boolean()";
  } else if (typeKind === "datetime") {
    schemaExpression = 'Type.String({ format: "date-time", minLength: 1 })';
  } else if (typeKind === "date") {
    schemaExpression = 'Type.String({ format: "date", minLength: 1 })';
  } else if (typeKind === "time") {
    return column.nullable === true
      ? "NULLABLE_HTML_TIME_STRING_SCHEMA"
      : "HTML_TIME_STRING_SCHEMA";
  } else if (typeKind === "json") {
    schemaExpression = "Type.Any()";
  }

  if (column.nullable === true) {
    return `Type.Union([${schemaExpression}, Type.Null()])`;
  }
  return schemaExpression;
}

function renderResourceValidatorsImport({ htmlTimeSchemaImports = [], recordIdValidatorImports = [] } = {}) {
  const imports = [
    "normalizeObjectInput",
    "createCursorListValidator"
  ];
  for (const importName of Array.isArray(recordIdValidatorImports) ? recordIdValidatorImports : []) {
    if (!imports.includes(importName)) {
      imports.push(importName);
    }
  }
  for (const importName of Array.isArray(htmlTimeSchemaImports) ? htmlTimeSchemaImports : []) {
    if (!imports.includes(importName)) {
      imports.push(importName);
    }
  }
  return `import {\n  ${imports.join(",\n  ")}\n} from "@jskit-ai/kernel/shared/validators";`;
}

function resolveHtmlTimeSchemaImports(columns = []) {
  const imports = [];
  for (const column of Array.isArray(columns) ? columns : []) {
    if (column?.typeKind !== "time") {
      continue;
    }
    const importName = column.nullable === true
      ? "NULLABLE_HTML_TIME_STRING_SCHEMA"
      : "HTML_TIME_STRING_SCHEMA";
    if (!imports.includes(importName)) {
      imports.push(importName);
    }
  }
  return imports;
}

function resolveRecordIdValidatorImports(...sources) {
  const imports = ["recordIdSchema"];
  const joinedSource = sources
    .map((source) => String(source || ""))
    .join("\n");
  for (const importName of ["recordIdInputSchema", "nullableRecordIdSchema", "nullableRecordIdInputSchema"]) {
    if (joinedSource.includes(importName)) {
      imports.push(importName);
    }
  }
  return imports;
}

function renderInputNormalizer(column) {
  const typeKind = String(column.typeKind || "");
  const nullable = column?.nullable === true;
  if (typeKind === "string") {
    return "normalizeText";
  }
  if (typeKind === "time") {
    if (nullable) {
      return "(value) => { const normalized = normalizeText(value); return normalized || null; }";
    }
    return "normalizeText";
  }
  if (typeKind === "integer") {
    if (column?.isRecordIdColumn === true) {
      if (nullable) {
        return "(value) => normalizeRecordId(value, { fallback: null })";
      }
      return "normalizeRecordId";
    }
    return "normalizeFiniteInteger";
  }
  if (typeKind === "number") {
    return "normalizeFiniteNumber";
  }
  if (typeKind === "boolean") {
    return "normalizeBoolean";
  }
  if (typeKind === "datetime") {
    if (nullable) {
      return "(value) => { const normalized = normalizeText(value); return normalized ? toIsoString(normalized) : null; }";
    }
    return "toIsoString";
  }
  if (typeKind === "date") {
    if (nullable) {
      return "(value) => { const normalized = normalizeText(value); return normalized ? toIsoString(normalized).slice(0, 10) : null; }";
    }
    return "(value) => toIsoString(value).slice(0, 10)";
  }
  if (typeKind === "json") {
    return "(value) => parseJsonValue(value, null, { fallback: null, allowNull: true })";
  }
  return "(value) => value";
}

function renderOutputNormalizerExpression(column) {
  const typeKind = String(column.typeKind || "");
  const nullable = column?.nullable === true;
  if (typeKind === "string" || typeKind === "time") {
    return "normalizeText";
  }
  if (typeKind === "integer") {
    if (column?.isRecordIdColumn === true) {
      if (nullable) {
        return "(value) => normalizeRecordId(value, { fallback: null })";
      }
      return "normalizeRecordId";
    }
    return "normalizeFiniteInteger";
  }
  if (typeKind === "number") {
    return "normalizeFiniteNumber";
  }
  if (typeKind === "boolean") {
    return "normalizeBoolean";
  }
  if (typeKind === "datetime") {
    return "toIsoString";
  }
  if (typeKind === "date") {
    return "(value) => toIsoString(value).slice(0, 10)";
  }
  if (typeKind === "json") {
    return "(value) => parseJsonValue(value, null, { fallback: null, allowNull: true })";
  }
  return "";
}

function renderResourceSchemaPropertyLines(columns, { forOutput = false } = {}) {
  const sourceColumns = Array.isArray(columns) ? columns : [];
  return sourceColumns
    .map((column) => {
      const key = renderObjectPropertyKey(column.key);
      const schemaExpression = renderResourceFieldSchema(column, { forOutput });
      return `    ${key}: ${schemaExpression},`;
    })
    .join("\n");
}

function renderResourceInputNormalizationLines(columns) {
  const sourceColumns = Array.isArray(columns) ? columns : [];
  return sourceColumns
    .map((column) => {
      const keyLiteral = JSON.stringify(String(column.key || ""));
      const normalizer = renderInputNormalizer(column);
      return `  normalizeIfInSource(source, normalized, ${keyLiteral}, ${normalizer});`;
    })
    .join("\n");
}

function renderResourceOutputNormalizationLines(columns) {
  const sourceColumns = Array.isArray(columns) ? columns : [];
  return sourceColumns
    .map((column) => {
      const key = renderObjectPropertyKey(column.key);
      const sourceAccess = renderPropertyAccess("source", column.key);
      const normalizer = renderOutputNormalizerExpression(column);
      if (!normalizer) {
        return `    ${key}: ${sourceAccess},`;
      }
      const nullishNormalizer = column.nullable === true ? "normalizeOrNull" : "normalizeIfPresent";
      return `    ${key}: ${nullishNormalizer}(${sourceAccess}, ${normalizer}),`;
    })
    .join("\n");
}

function renderResourceDatabaseRuntimeImport({ needsToIsoString = false, needsToDatabaseDateTimeUtc = false } = {}) {
  const imports = [];
  if (needsToIsoString) {
    imports.push("toIsoString");
  }
  if (needsToDatabaseDateTimeUtc) {
    imports.push("toDatabaseDateTimeUtc");
  }
  if (imports.length < 1) {
    return "";
  }
  return `import {\n  ${imports.join(",\n  ")}\n} from "@jskit-ai/database-runtime/shared";`;
}

function renderResourceJsonImport({ needsJson = false } = {}) {
  if (!needsJson) {
    return "";
  }
  return 'import { parseJsonValue } from "@jskit-ai/database-runtime/shared/repositoryOptions";';
}

function renderResourceNormalizeSupportImport({
  needsNormalizeText = false,
  needsNormalizeBoolean = false,
  needsNormalizeFiniteNumber = false,
  needsNormalizeFiniteInteger = false,
  needsNormalizeRecordId = false,
  needsNormalizeIfInSource = false,
  needsNormalizeIfPresent = false,
  needsNormalizeOrNull = false
} = {}) {
  const imports = [];
  if (needsNormalizeText) {
    imports.push("normalizeText");
  }
  if (needsNormalizeBoolean) {
    imports.push("normalizeBoolean");
  }
  if (needsNormalizeFiniteNumber) {
    imports.push("normalizeFiniteNumber");
  }
  if (needsNormalizeFiniteInteger) {
    imports.push("normalizeFiniteInteger");
  }
  if (needsNormalizeRecordId) {
    imports.push("normalizeRecordId");
  }
  if (needsNormalizeIfInSource) {
    imports.push("normalizeIfInSource");
  }
  if (needsNormalizeIfPresent) {
    imports.push("normalizeIfPresent");
  }
  if (needsNormalizeOrNull) {
    imports.push("normalizeOrNull");
  }
  if (imports.length < 1) {
    return "";
  }
  return `import {\n  ${imports.join(",\n  ")}\n} from "@jskit-ai/kernel/shared/support/normalize";`;
}

function renderMigrationDefaultClause(column) {
  if (column.hasDefault !== true) {
    return "";
  }

  const rawDefault = column.defaultValue;
  if (rawDefault == null) {
    return "";
  }
  const normalized = String(rawDefault).trim();
  if (!normalized) {
    return '.defaultTo("")';
  }

  const normalizedLower = normalized.toLowerCase();
  if (normalizedLower === "null") {
    return "";
  }
  const extraLower = String(column.extra || "").toLowerCase();
  if (normalizedLower === "current_timestamp" || normalizedLower === "current_timestamp()") {
    if (extraLower.includes("on update current_timestamp")) {
      return '.defaultTo(knex.raw("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"))';
    }
    return ".defaultTo(knex.fn.now())";
  }

  if (column.typeKind === "boolean") {
    if (normalizedLower === "1" || normalizedLower === "true") {
      return ".defaultTo(true)";
    }
    if (normalizedLower === "0" || normalizedLower === "false") {
      return ".defaultTo(false)";
    }
  }

  if (column.typeKind === "integer" || column.typeKind === "number") {
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) {
      return `.defaultTo(${parsed})`;
    }
  }

  if (column.typeKind === "string" && normalized.startsWith("'") && normalized.endsWith("'")) {
    const unquoted = normalized
      .slice(1, -1)
      .replace(/\\'/g, "'")
      .replace(/''/g, "'");
    return `.defaultTo(${JSON.stringify(unquoted)})`;
  }

  return `.defaultTo(${JSON.stringify(rawDefault)})`;
}

function renderMigrationSpecificStringType(column, { tableCollation = "" } = {}) {
  const baseType = normalizeText(column?.columnType);
  if (!baseType) {
    return "";
  }

  const characterSetName = normalizeText(column?.characterSetName);
  const collationName = normalizeText(column?.collationName);
  const normalizedTableCollation = normalizeText(tableCollation);
  if (!collationName || collationName === normalizedTableCollation) {
    return "";
  }

  const parts = [baseType];
  if (characterSetName) {
    parts.push(`CHARACTER SET ${characterSetName}`);
  }
  parts.push(`COLLATE ${collationName}`);
  return parts.join(" ");
}

function renderTemporalColumnBuilder(column, methodName) {
  if (Number.isFinite(column?.datetimePrecision) && column.datetimePrecision > 0) {
    return `table.${methodName}(${JSON.stringify(column.name)}, { precision: ${column.datetimePrecision} })`;
  }
  return `table.${methodName}(${JSON.stringify(column.name)})`;
}

function renderMigrationColumnLine(column, {
  idColumn = DEFAULT_ID_COLUMN,
  primaryKeyColumns = [],
  foreignKeyColumnNames = new Set(),
  tableCollation = ""
} = {}) {
  const isPrimary = Array.isArray(primaryKeyColumns) && primaryKeyColumns.includes(column.name);
  const isIdColumn = column.name === idColumn;
  const isRecordIdColumn = isIdColumn || column.name === "workspace_id" || column.name === "user_id" || foreignKeyColumnNames.has(column.name) || /_id$/i.test(String(column.name || ""));

  if (isIdColumn && column.autoIncrement) {
    let line = `table.bigIncrements(${JSON.stringify(column.name)})`;
    if (column.unsigned) {
      line += ".unsigned()";
    }
    line += ".primary();";
    return line;
  }

  let line = "";
  const nameLiteral = JSON.stringify(column.name);
  const dataType = String(column.dataType || "").toLowerCase();
  const specificStringType = renderMigrationSpecificStringType(column, {
    tableCollation
  });

  if (dataType === "varchar") {
    if (specificStringType) {
      line = `table.specificType(${nameLiteral}, ${JSON.stringify(specificStringType)})`;
    } else {
      const maxLength = Number.isFinite(column.maxLength) ? column.maxLength : 255;
      line = `table.string(${nameLiteral}, ${maxLength})`;
    }
  } else if (dataType === "char") {
    line = `table.specificType(${nameLiteral}, ${JSON.stringify(specificStringType || column.columnType || "char(255)")})`;
  } else if (dataType === "text") {
    if (specificStringType) {
      line = `table.specificType(${nameLiteral}, ${JSON.stringify(specificStringType)})`;
    } else {
      line = `table.text(${nameLiteral})`;
    }
  } else if (dataType === "tinytext" || dataType === "mediumtext" || dataType === "longtext") {
    if (specificStringType) {
      line = `table.specificType(${nameLiteral}, ${JSON.stringify(specificStringType)})`;
    } else {
      line = `table.text(${nameLiteral}, ${JSON.stringify(dataType)})`;
    }
  } else if (dataType === "enum") {
    const enumValues = Array.isArray(column.enumValues) ? column.enumValues : [];
    line = `table.enu(${nameLiteral}, ${JSON.stringify(enumValues)})`;
  } else if (dataType === "set") {
    line = `table.specificType(${nameLiteral}, ${JSON.stringify(specificStringType || column.columnType || "set")})`;
  } else if (column.typeKind === "boolean") {
    line = `table.boolean(${nameLiteral})`;
  } else if (dataType === "int" || dataType === "integer") {
    line = isRecordIdColumn ? `table.bigInteger(${nameLiteral})` : `table.integer(${nameLiteral})`;
  } else if (dataType === "smallint") {
    line = `table.smallint(${nameLiteral})`;
  } else if (dataType === "bigint") {
    line = `table.bigInteger(${nameLiteral})`;
  } else if (dataType === "mediumint" || dataType === "tinyint") {
    line = `table.specificType(${nameLiteral}, ${JSON.stringify(column.columnType || dataType)})`;
  } else if (dataType === "decimal" || dataType === "numeric") {
    if (Number.isFinite(column.numericPrecision) && Number.isFinite(column.numericScale)) {
      line = `table.decimal(${nameLiteral}, ${column.numericPrecision}, ${column.numericScale})`;
    } else if (Number.isFinite(column.numericPrecision)) {
      line = `table.decimal(${nameLiteral}, ${column.numericPrecision})`;
    } else {
      line = `table.decimal(${nameLiteral})`;
    }
  } else if (dataType === "float") {
    line = `table.float(${nameLiteral})`;
  } else if (dataType === "double" || dataType === "real") {
    line = `table.double(${nameLiteral})`;
  } else if (dataType === "json") {
    line = `table.json(${nameLiteral})`;
  } else if (dataType === "date") {
    line = `table.date(${nameLiteral})`;
  } else if (dataType === "time") {
    line = renderTemporalColumnBuilder(column, "time");
  } else if (dataType === "datetime") {
    line = renderTemporalColumnBuilder(column, "dateTime");
  } else if (dataType === "timestamp") {
    line = renderTemporalColumnBuilder(column, "timestamp");
  } else {
    throw new Error(
      `Unsupported MySQL type "${dataType}" in migration renderer for column "${column.name}".`
    );
  }

  if (column.unsigned && (line.includes(".integer(") || line.includes(".smallint(") || line.includes(".bigInteger("))) {
    line += ".unsigned()";
  }
  line += column.nullable ? ".nullable()" : ".notNullable()";
  line += renderMigrationDefaultClause(column);
  if (isPrimary) {
    line += ".primary()";
  }
  line += ";";
  return line;
}

function renderMigrationColumnLines(snapshot) {
  const columns = Array.isArray(snapshot.columns) ? snapshot.columns : [];
  const foreignKeyColumnNames = new Set(
    (Array.isArray(snapshot.foreignKeys) ? snapshot.foreignKeys : [])
      .flatMap((foreignKey) => Array.isArray(foreignKey?.columns) ? foreignKey.columns : [])
      .map((entry) => String(entry?.name || "").trim())
      .filter(Boolean)
  );
  const lines = columns.map((column) =>
    `    ${renderMigrationColumnLine(column, {
      idColumn: snapshot.idColumn,
      primaryKeyColumns: snapshot.primaryKeyColumns,
      foreignKeyColumnNames,
      tableCollation: snapshot.tableCollation
    })}`
  );
  return lines.join("\n");
}

function renderMigrationIndexLine(index) {
  const columns = Array.isArray(index?.columns) ? index.columns.filter(Boolean) : [];
  if (columns.length < 1) {
    return "";
  }

  const columnsLiteral = JSON.stringify(columns);
  const indexName = normalizeText(index?.name);
  const normalizedIndexType = normalizeText(index?.indexType).toUpperCase();
  const storageEngineIndexType = normalizedIndexType && normalizedIndexType !== "BTREE"
    ? normalizedIndexType.toLowerCase()
    : "";
  if (index?.unique === true) {
    if (indexName && storageEngineIndexType) {
      return `    table.unique(${columnsLiteral}, { indexName: ${JSON.stringify(indexName)}, storageEngineIndexType: ${JSON.stringify(storageEngineIndexType)} });`;
    }
    if (indexName) {
      return `    table.unique(${columnsLiteral}, ${JSON.stringify(indexName)});`;
    }
    return `    table.unique(${columnsLiteral});`;
  }

  if (indexName && normalizedIndexType && normalizedIndexType !== "BTREE") {
    return `    table.index(${columnsLiteral}, ${JSON.stringify(indexName)}, ${JSON.stringify(normalizedIndexType)});`;
  }
  if (indexName) {
    return `    table.index(${columnsLiteral}, ${JSON.stringify(indexName)});`;
  }
  return `    table.index(${columnsLiteral});`;
}

function renderMigrationIndexLines(snapshot) {
  const indexes = Array.isArray(snapshot.indexes) ? snapshot.indexes : [];
  const lines = indexes
    .map((index) => renderMigrationIndexLine(index))
    .filter(Boolean);
  return lines.join("\n");
}

function renderMigrationForeignKeyLine(foreignKey = {}) {
  const columns = Array.isArray(foreignKey.columns)
    ? foreignKey.columns
        .map((column) => normalizeText(column?.name))
        .filter(Boolean)
    : [];
  const referencedColumns = Array.isArray(foreignKey.columns)
    ? foreignKey.columns
        .map((column) => normalizeText(column?.referencedName))
        .filter(Boolean)
    : [];
  const referencedTableName = normalizeText(foreignKey.referencedTableName);
  const foreignKeyName = normalizeText(foreignKey.name);
  if (columns.length < 1 || referencedColumns.length < 1 || !referencedTableName) {
    return "";
  }

  let line = `    table.foreign(${JSON.stringify(columns)}`;
  if (foreignKeyName) {
    line += `, ${JSON.stringify(foreignKeyName)}`;
  }
  line += `).references(${JSON.stringify(referencedColumns)}).inTable(${JSON.stringify(referencedTableName)})`;

  const updateRule = normalizeText(foreignKey.updateRule).toUpperCase();
  if (updateRule) {
    line += `.onUpdate(${JSON.stringify(updateRule)})`;
  }
  const deleteRule = normalizeText(foreignKey.deleteRule).toUpperCase();
  if (deleteRule) {
    line += `.onDelete(${JSON.stringify(deleteRule)})`;
  }
  line += ";";

  return line;
}

function renderMigrationForeignKeyLines(snapshot) {
  const foreignKeys = Array.isArray(snapshot.foreignKeys) ? snapshot.foreignKeys : [];
  const lines = foreignKeys
    .map((foreignKey) => renderMigrationForeignKeyLine(foreignKey))
    .filter(Boolean);
  return lines.join("\n");
}

function renderMigrationCheckConstraintLines(snapshot) {
  const tableName = normalizeText(snapshot?.tableName);
  const checkConstraints = Array.isArray(snapshot?.checkConstraints) ? snapshot.checkConstraints : [];
  if (!tableName || checkConstraints.length < 1) {
    return "";
  }

  return checkConstraints
    .map((constraint) => {
      const name = normalizeText(constraint?.name);
      const clause = normalizeText(constraint?.clause);
      if (!name || !clause) {
        return "";
      }

      const sql = `ALTER TABLE \`${tableName}\` ADD CONSTRAINT \`${name}\` CHECK (${clause})`;
      return `  await knex.raw(${JSON.stringify(sql)});`;
    })
    .filter(Boolean)
    .join("\n");
}

function mergeFieldMetaEntries(...entryGroups) {
  const mergedByKey = new Map();
  for (const sourceEntries of entryGroups) {
    for (const sourceEntry of Array.isArray(sourceEntries) ? sourceEntries : []) {
      const key = normalizeText(sourceEntry?.key);
      if (!key) {
        continue;
      }
      const existing = mergedByKey.get(key) || {};
      const next = {
        ...existing,
        ...sourceEntry,
        key
      };
      if (existing.relation || sourceEntry.relation) {
        next.relation = {
          ...(existing.relation && typeof existing.relation === "object" ? existing.relation : {}),
          ...(sourceEntry.relation && typeof sourceEntry.relation === "object" ? sourceEntry.relation : {})
        };
      }
      if (existing.ui || sourceEntry.ui) {
        next.ui = {
          ...(existing.ui && typeof existing.ui === "object" ? existing.ui : {}),
          ...(sourceEntry.ui && typeof sourceEntry.ui === "object" ? sourceEntry.ui : {})
        };
      }
      mergedByKey.set(key, next);
    }
  }

  return [...mergedByKey.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function resolveLookupNamespaceFromTableName(tableName = "") {
  const normalizedTableName = toSnakeCase(normalizeText(tableName));
  if (!normalizedTableName) {
    return "";
  }

  return normalizedTableName.replace(/_/g, "-");
}

function toFieldLabel(key = "") {
  const normalizedKey = normalizeText(key);
  if (!normalizedKey) {
    return "";
  }

  const words = normalizedKey
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .split(/\s+/)
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
  if (words.length < 1) {
    return "";
  }

  return words
    .map((entry) => `${entry.slice(0, 1).toUpperCase()}${entry.slice(1)}`)
    .join(" ");
}

function isSupportedSelectOptionValue(value) {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function toSelectOptionIdentity(value) {
  return `${typeof value}:${String(value)}`;
}

function toSelectOptionLabel(value) {
  if (typeof value === "string") {
    return toFieldLabel(value) || value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function normalizeFieldMetaUiOptions(rawOptions = []) {
  if (!Array.isArray(rawOptions)) {
    return [];
  }

  const options = [];
  const seenValues = new Set();
  for (const rawEntry of rawOptions) {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
      continue;
    }
    const value = rawEntry.value;
    if (!isSupportedSelectOptionValue(value)) {
      continue;
    }

    const identity = toSelectOptionIdentity(value);
    if (seenValues.has(identity)) {
      continue;
    }
    seenValues.add(identity);

    const explicitLabel = normalizeText(rawEntry.label);
    options.push({
      value,
      label: explicitLabel || toSelectOptionLabel(value) || String(value)
    });
  }

  return options;
}

function resolveEnumFieldMetaUiOptions(enumValues = []) {
  const options = Array.isArray(enumValues)
    ? enumValues.map((value) => ({
        value,
        label: toSelectOptionLabel(value)
      }))
    : [];
  return normalizeFieldMetaUiOptions(options);
}

function buildFieldMetaEntries({ outputColumns = [], writableColumns = [], snapshot = {} } = {}) {
  const fieldColumns = [...outputColumns, ...writableColumns];
  const fieldColumnsByName = new Map();
  const fieldColumnsByKey = new Map();
  for (const column of fieldColumns) {
    const columnName = normalizeText(column?.name);
    const key = normalizeText(column?.key);
    if (columnName && !fieldColumnsByName.has(columnName)) {
      fieldColumnsByName.set(columnName, column);
    }
    if (key && !fieldColumnsByKey.has(key)) {
      fieldColumnsByKey.set(key, column);
    }
  }

  const repositoryEntries = [];
  for (const column of fieldColumnsByKey.values()) {
    const key = normalizeText(column?.key);
    const name = normalizeText(column?.name);
    if (!key || !name) {
      continue;
    }
    if (toSnakeCase(key) === name) {
      continue;
    }
    repositoryEntries.push({
      key,
      repository: {
        column: name
      }
    });
  }

  const relationEntries = [];
  const foreignKeys = Array.isArray(snapshot.foreignKeys) ? snapshot.foreignKeys : [];
  for (const foreignKey of foreignKeys) {
    const columns = Array.isArray(foreignKey?.columns) ? foreignKey.columns : [];
    if (columns.length !== 1) {
      const name = normalizeText(foreignKey?.name) || "unnamed_foreign_key";
      throw new Error(
        `CRUD generation supports only single-column foreign keys. Constraint "${name}" has ${columns.length} columns.`
      );
    }

    const localColumnName = normalizeText(columns[0]?.name);
    const referencedColumnName = normalizeText(columns[0]?.referencedName);
    const referencedTableName = normalizeText(foreignKey?.referencedTableName);
    if (!localColumnName || !referencedColumnName || !referencedTableName) {
      continue;
    }

    const localColumn = fieldColumnsByName.get(localColumnName);
    if (!localColumn || localColumn.isOwnerColumn === true) {
      continue;
    }

    relationEntries.push({
      key: localColumn.key,
      relation: {
        kind: "lookup",
        namespace: resolveLookupNamespaceFromTableName(referencedTableName),
        valueKey: toCamelCase(referencedColumnName)
      },
      ui: {
        formControl: "autocomplete"
      }
    });
  }

  const relationFieldKeys = new Set(
    relationEntries
      .map((entry) => normalizeText(entry?.key))
      .filter(Boolean)
  );
  const enumEntries = [];
  for (const column of fieldColumnsByKey.values()) {
    const key = normalizeText(column?.key);
    if (!key || relationFieldKeys.has(key)) {
      continue;
    }

    const options = resolveEnumFieldMetaUiOptions(column?.enumValues);
    if (options.length < 1) {
      continue;
    }

    enumEntries.push({
      key,
      ui: {
        formControl: "select",
        options
      }
    });
  }

  return mergeFieldMetaEntries(repositoryEntries, relationEntries, enumEntries);
}

function renderFieldMetaEntryLines(entry = {}) {
  const lines = ["RESOURCE_FIELD_META.push({"];
  const topLevelProperties = [`key: ${JSON.stringify(entry.key)}`];
  const repositoryColumn = normalizeText(entry?.repository?.column);
  const repositoryWriteSerializer = normalizeText(entry?.repository?.writeSerializer);
  if (repositoryColumn || repositoryWriteSerializer) {
    const repositoryLines = [
      "repository: {",
      ...(repositoryColumn ? [`  column: ${JSON.stringify(repositoryColumn)}`] : []),
      ...(repositoryWriteSerializer ? [`  writeSerializer: ${JSON.stringify(repositoryWriteSerializer)}`] : [])
    ];
    if (repositoryLines.length > 2) {
      repositoryLines[repositoryLines.length - 1] = repositoryLines[repositoryLines.length - 1].replace(/,$/, "");
    }
    repositoryLines.push("}");
    for (let index = 1; index < repositoryLines.length - 1; index += 1) {
      if (index < repositoryLines.length - 2) {
        repositoryLines[index] = `${repositoryLines[index]},`;
      }
    }
    topLevelProperties.push(repositoryLines.join("\n"));
  }

  const relation = entry.relation && typeof entry.relation === "object" ? entry.relation : null;
  if (relation) {
    const targetResourceNamespace = normalizeCrudLookupNamespace(relation.targetResource);
    const relationNamespace =
      normalizeCrudLookupNamespace(relation.namespace) ||
      normalizeCrudLookupNamespace(relation.apiPath) ||
      normalizeCrudLookupNamespace(relation?.source?.path) ||
      targetResourceNamespace;
    if (!relationNamespace) {
      throw new Error(`crud template context fieldMeta["${normalizeText(entry.key)}"] lookup relation requires namespace.`);
    }
    const relationLines = [
      "relation: {",
      `  kind: ${JSON.stringify(normalizeText(relation.kind) || "lookup")},`,
      `  namespace: ${JSON.stringify(relationNamespace)},`,
      `  valueKey: ${JSON.stringify(normalizeText(relation.valueKey) || "id")},`
    ];
    const labelKey = normalizeText(relation.labelKey);
    if (labelKey) {
      relationLines.push(`  labelKey: ${JSON.stringify(labelKey)}`);
    } else {
      relationLines[relationLines.length - 1] = relationLines[relationLines.length - 1].replace(/,$/, "");
    }
    relationLines.push("}");
    topLevelProperties.push(relationLines.join("\n"));
  }

  const fieldUiOptions = normalizeFieldMetaUiOptions(entry?.ui?.options);
  const formControl = checkCrudLookupFormControl(entry?.ui?.formControl, {
    context: `resource.fieldMeta["${normalizeText(entry.key)}"].ui.formControl`,
    defaultValue: relation ? "autocomplete" : (fieldUiOptions.length > 0 ? "select" : "")
  });
  if (formControl || fieldUiOptions.length > 0) {
    const uiPropertyBlocks = [];
    if (formControl) {
      uiPropertyBlocks.push([
        `formControl: ${JSON.stringify(formControl)}${relation ? " // or \"select\"" : ""}`
      ]);
    }
    if (fieldUiOptions.length > 0) {
      const optionsJsonLines = JSON.stringify(fieldUiOptions, null, 2).split("\n");
      const optionPropertyLines = [`options: ${optionsJsonLines[0]}`];
      for (const jsonLine of optionsJsonLines.slice(1)) {
        optionPropertyLines.push(jsonLine);
      }
      uiPropertyBlocks.push(optionPropertyLines);
    }

    const uiLines = ["ui: {"];
    for (const [propertyIndex, propertyLines] of uiPropertyBlocks.entries()) {
      const isLastProperty = propertyIndex >= uiPropertyBlocks.length - 1;
      const propertySuffix = isLastProperty ? "" : ",";
      for (const [lineIndex, line] of propertyLines.entries()) {
        const isLastLine = lineIndex >= propertyLines.length - 1;
        uiLines.push(`  ${line}${isLastLine ? propertySuffix : ""}`);
      }
    }
    uiLines.push("}");
    topLevelProperties.push(
      uiLines.join("\n")
    );
  }

  for (const [index, propertyBlock] of topLevelProperties.entries()) {
    const blockLines = String(propertyBlock || "").split("\n");
    const isLastProperty = index >= topLevelProperties.length - 1;
    const propertySuffix = isLastProperty ? "" : ",";
    for (const [lineIndex, line] of blockLines.entries()) {
      const isLastLine = lineIndex >= blockLines.length - 1;
      lines.push(`  ${line}${isLastLine ? propertySuffix : ""}`);
    }
  }

  lines.push("});");
  return lines.join("\n");
}

function renderResourceFieldMetaPushLines(entries = []) {
  const sourceEntries = Array.isArray(entries) ? entries : [];
  if (sourceEntries.length < 1) {
    return "";
  }

  return sourceEntries.map((entry) => renderFieldMetaEntryLines(entry)).join("\n\n");
}

function renderRepositoryListConfigLines(snapshot = {}) {
  const commentLines = [
    "  // defaultLimit: 20,",
    "  // maxLimit: 100,",
    "  // searchColumns: [\"name\"],"
  ];
  const sourceColumns = Array.isArray(snapshot?.columns) ? snapshot.columns : [];
  const hasCreatedAtColumn = sourceColumns.some((column = {}) => normalizeText(column?.name) === "created_at");
  if (!hasCreatedAtColumn) {
    return commentLines.join("\n");
  }

  return [
    ...commentLines,
    "  orderBy: [",
    "    {",
    "      column: \"created_at\",",
    "      direction: \"desc\"",
    "    }",
    "  ]"
  ].join("\n");
}

function buildCrudPermissionIds(namespace = "") {
  const permissionNamespace = toSnakeCase(namespace);
  if (!permissionNamespace) {
    return null;
  }

  return Object.freeze(
    Object.fromEntries(
      CRUD_PERMISSION_OPERATIONS.map((operation) => [operation, `crud.${permissionNamespace}.${operation}`])
    )
  );
}

function normalizeCrudOperation(operation = "", context = "CRUD operation") {
  const normalizedOperation = normalizeText(operation).toLowerCase();
  if (!CRUD_PERMISSION_OPERATIONS.includes(normalizedOperation)) {
    throw new Error(`Unknown ${context} "${normalizedOperation || String(operation || "")}".`);
  }
  return normalizedOperation;
}

function renderRoleCatalogPermissionGrants(namespace = "", { requiresNamedPermissions = true } = {}) {
  const permissionIds = buildCrudPermissionIds(namespace);
  if (!requiresNamedPermissions || !permissionIds) {
    return "";
  }

  return [
    "roleCatalog.roles.member.permissions.push(",
    `  ${JSON.stringify(permissionIds.list)},`,
    `  ${JSON.stringify(permissionIds.view)},`,
    `  ${JSON.stringify(permissionIds.create)},`,
    `  ${JSON.stringify(permissionIds.update)},`,
    `  ${JSON.stringify(permissionIds.delete)}`,
    ");"
  ].join("\n");
}

function renderActionPermissionSupport(namespace = "", { requiresNamedPermissions = true } = {}) {
  if (!requiresNamedPermissions) {
    return [
      "const authenticatedPermission = Object.freeze({",
      '  require: "authenticated"',
      "});"
    ].join("\n");
  }

  const permissionIds = buildCrudPermissionIds(namespace);
  if (!permissionIds) {
    return "";
  }

  return [
    "const actionPermissions = Object.freeze({",
    `  list: ${JSON.stringify(permissionIds.list)},`,
    `  view: ${JSON.stringify(permissionIds.view)},`,
    `  create: ${JSON.stringify(permissionIds.create)},`,
    `  update: ${JSON.stringify(permissionIds.update)},`,
    `  delete: ${JSON.stringify(permissionIds.delete)}`,
    "});"
  ].join("\n");
}

function renderActionPermissionExpression(operation = "", { requiresNamedPermissions = true } = {}) {
  const normalizedOperation = normalizeCrudOperation(operation, "CRUD permission operation");

  if (!requiresNamedPermissions) {
    return "authenticatedPermission";
  }

  return `{ require: "all", permissions: [actionPermissions.${normalizedOperation}] }`;
}

function renderRouteWorkspaceSupportImports({ surfaceRequiresWorkspace = true } = {}) {
  if (!surfaceRequiresWorkspace) {
    return "";
  }

  return [
    'import { routeParamsValidator } from "@jskit-ai/workspaces-core/server/validators/routeParamsValidator";',
    'import { buildWorkspaceInputFromRouteParams } from "@jskit-ai/workspaces-core/server/support/workspaceRouteInput";'
  ].join("\n");
}

function renderActionWorkspaceValidatorImport({ surfaceRequiresWorkspace = true } = {}) {
  if (!surfaceRequiresWorkspace) {
    return "";
  }

  return 'import { workspaceSlugParamsValidator } from "@jskit-ai/workspaces-core/server/validators/routeParamsValidator";';
}

function renderRouteParamsValidatorLine(operation = "", { surfaceRequiresWorkspace = true } = {}) {
  const normalizedOperation = normalizeCrudOperation(operation, "CRUD route params validator operation");
  if (normalizedOperation === "list" || normalizedOperation === "create") {
    if (!surfaceRequiresWorkspace) {
      return "";
    }
    return "      paramsValidator: routeParamsValidator,";
  }

  if (!surfaceRequiresWorkspace) {
    return "      paramsValidator: recordIdParamsValidator,";
  }

  return "      paramsValidator: [routeParamsValidator, recordIdParamsValidator],";
}

function renderRouteInputLines(operation = "", { surfaceRequiresWorkspace = true } = {}) {
  const normalizedOperation = normalizeCrudOperation(operation, "CRUD route input operation");
  const lines = [];

  if (surfaceRequiresWorkspace) {
    lines.push("          ...buildWorkspaceInputFromRouteParams(request.input.params),");
  }

  if (normalizedOperation === "list") {
    lines.push("          ...(request.input.query || {})");
    return lines.join("\n");
  }

  if (normalizedOperation === "view") {
    lines.push("          recordId: request.input.params.recordId,");
    lines.push("          ...(request.input.query || {})");
    return lines.join("\n");
  }

  if (normalizedOperation === "create") {
    lines.push("          payload: request.input.body");
    return lines.join("\n");
  }

  if (normalizedOperation === "update") {
    lines.push("          recordId: request.input.params.recordId,");
    lines.push("          patch: request.input.body");
    return lines.join("\n");
  }

  lines.push("          recordId: request.input.params.recordId");
  return lines.join("\n");
}

function renderActionInputValidatorExpression(operation = "", { surfaceRequiresWorkspace = true } = {}) {
  const normalizedOperation = normalizeCrudOperation(operation, "CRUD action input validator operation");
  const validators = [];

  if (surfaceRequiresWorkspace) {
    validators.push("workspaceSlugParamsValidator");
  }

  if (normalizedOperation === "list") {
    validators.push(
      "listCursorPaginationQueryValidator",
      "listSearchQueryValidator",
      "listParentFilterQueryValidator",
      "lookupIncludeQueryValidator"
    );
  } else if (normalizedOperation === "view") {
    validators.push("recordIdParamsValidator", "lookupIncludeQueryValidator");
  } else if (normalizedOperation === "create") {
    validators.push("{ payload: resource.operations.create.bodyValidator }");
  } else if (normalizedOperation === "update") {
    validators.push("recordIdParamsValidator", "{ patch: resource.operations.patch.bodyValidator }");
  } else {
    validators.push("recordIdParamsValidator");
  }

  return validators.length === 1 ? validators[0] : `[${validators.join(", ")}]`;
}

function buildReplacementsFromSnapshot({
  namespace = "",
  snapshot,
  resolvedOwnershipFilter,
  surfaceRequiresWorkspace = true,
  surfaceId = ""
}) {
  const requiresNamedPermissions = surfaceRequiresWorkspace === true;
  const scaffoldColumns = resolveScaffoldColumns(snapshot);
  const outputColumns = scaffoldColumns.filter((column) => !column.isOwnerColumn);
  const writableColumns = scaffoldColumns.filter((column) => column.writable);
  const createRequiredFieldKeys = writableColumns
    .filter((column) => !column.nullable && column.hasDefault !== true)
    .map((column) => column.key);
  const resourceColumns = [...outputColumns, ...writableColumns];
  const fieldMetaEntries = buildFieldMetaEntries({
    outputColumns,
    writableColumns,
    snapshot
  });
  const needsFiniteInteger = resourceColumns.some((column) => column.typeKind === "integer" && column.isRecordIdColumn !== true);
  const needsRecordIdSchemas = resourceColumns.some((column) => column.typeKind === "integer" && column.isRecordIdColumn === true);
  const needsFiniteNumber = resourceColumns.some((column) => column.typeKind === "number");
  const needsDateTimeOutput = outputColumns.some((column) => column.typeKind === "datetime");
  const needsNullableDateTimeInput = writableColumns.some(
    (column) => column.typeKind === "datetime" && column.nullable === true
  );
  const needsNullableDateInput = writableColumns.some(
    (column) => column.typeKind === "date" && column.nullable === true
  );
  const htmlTimeSchemaImports = resolveHtmlTimeSchemaImports(resourceColumns);
  const needsDate = resourceColumns.some((column) => column.typeKind === "date");
  const needsJson = resourceColumns.some((column) => column.typeKind === "json");
  const needsNormalizeText = resourceColumns.some((column) =>
    column.typeKind === "string" || column.typeKind === "time"
  ) || needsNullableDateTimeInput || needsNullableDateInput;
  const needsNormalizeBoolean = resourceColumns.some((column) => column.typeKind === "boolean");
  const needsNormalizeIfInSource = writableColumns.length > 0;
  const outputColumnsWithNormalizer = outputColumns.filter(
    (column) => Boolean(renderOutputNormalizerExpression(column))
  );
  const needsNormalizeIfPresent = outputColumnsWithNormalizer.some((column) => column.nullable !== true);
  const needsNormalizeOrNull = outputColumnsWithNormalizer.some((column) => column.nullable === true);

  const replacements = Object.freeze({
    __JSKIT_CRUD_TABLE_NAME__: JSON.stringify(snapshot.tableName),
    __JSKIT_CRUD_ID_COLUMN__: JSON.stringify(snapshot.idColumn || DEFAULT_ID_COLUMN),
    __JSKIT_CRUD_SURFACE_ID__: JSON.stringify(normalizeText(surfaceId).toLowerCase()),
    __JSKIT_CRUD_RESOLVED_OWNERSHIP_FILTER__: resolvedOwnershipFilter,
    __JSKIT_CRUD_ACTION_PERMISSION_SUPPORT__: renderActionPermissionSupport(namespace, {
      requiresNamedPermissions
    }),
    __JSKIT_CRUD_ACTION_WORKSPACE_VALIDATOR_IMPORT__: renderActionWorkspaceValidatorImport({
      surfaceRequiresWorkspace
    }),
    __JSKIT_CRUD_LIST_ACTION_PERMISSION__: renderActionPermissionExpression("list", {
      requiresNamedPermissions
    }),
    __JSKIT_CRUD_LIST_ACTION_INPUT_VALIDATOR__: renderActionInputValidatorExpression("list", {
      surfaceRequiresWorkspace
    }),
    __JSKIT_CRUD_VIEW_ACTION_PERMISSION__: renderActionPermissionExpression("view", {
      requiresNamedPermissions
    }),
    __JSKIT_CRUD_VIEW_ACTION_INPUT_VALIDATOR__: renderActionInputValidatorExpression("view", {
      surfaceRequiresWorkspace
    }),
    __JSKIT_CRUD_CREATE_ACTION_PERMISSION__: renderActionPermissionExpression("create", {
      requiresNamedPermissions
    }),
    __JSKIT_CRUD_CREATE_ACTION_INPUT_VALIDATOR__: renderActionInputValidatorExpression("create", {
      surfaceRequiresWorkspace
    }),
    __JSKIT_CRUD_UPDATE_ACTION_PERMISSION__: renderActionPermissionExpression("update", {
      requiresNamedPermissions
    }),
    __JSKIT_CRUD_UPDATE_ACTION_INPUT_VALIDATOR__: renderActionInputValidatorExpression("update", {
      surfaceRequiresWorkspace
    }),
    __JSKIT_CRUD_DELETE_ACTION_PERMISSION__: renderActionPermissionExpression("delete", {
      requiresNamedPermissions
    }),
    __JSKIT_CRUD_DELETE_ACTION_INPUT_VALIDATOR__: renderActionInputValidatorExpression("delete", {
      surfaceRequiresWorkspace
    }),
    __JSKIT_CRUD_ROLE_CATALOG_PERMISSION_GRANTS__: renderRoleCatalogPermissionGrants(namespace, {
      requiresNamedPermissions
    }),
    __JSKIT_CRUD_ROUTE_SURFACE_REQUIRES_WORKSPACE__: String(surfaceRequiresWorkspace === true),
    __JSKIT_CRUD_ROUTE_BASE__: JSON.stringify(surfaceRequiresWorkspace === true ? "/w/:workspaceSlug" : "/"),
    __JSKIT_CRUD_ROUTE_WORKSPACE_SUPPORT_IMPORTS__: renderRouteWorkspaceSupportImports({
      surfaceRequiresWorkspace
    }),
    __JSKIT_CRUD_LIST_ROUTE_PARAMS_VALIDATOR_LINE__: renderRouteParamsValidatorLine("list", {
      surfaceRequiresWorkspace
    }),
    __JSKIT_CRUD_VIEW_ROUTE_PARAMS_VALIDATOR_LINE__: renderRouteParamsValidatorLine("view", {
      surfaceRequiresWorkspace
    }),
    __JSKIT_CRUD_CREATE_ROUTE_PARAMS_VALIDATOR_LINE__: renderRouteParamsValidatorLine("create", {
      surfaceRequiresWorkspace
    }),
    __JSKIT_CRUD_UPDATE_ROUTE_PARAMS_VALIDATOR_LINE__: renderRouteParamsValidatorLine("update", {
      surfaceRequiresWorkspace
    }),
    __JSKIT_CRUD_DELETE_ROUTE_PARAMS_VALIDATOR_LINE__: renderRouteParamsValidatorLine("delete", {
      surfaceRequiresWorkspace
    }),
    __JSKIT_CRUD_LIST_ROUTE_INPUT_LINES__: renderRouteInputLines("list", {
      surfaceRequiresWorkspace
    }),
    __JSKIT_CRUD_VIEW_ROUTE_INPUT_LINES__: renderRouteInputLines("view", {
      surfaceRequiresWorkspace
    }),
    __JSKIT_CRUD_CREATE_ROUTE_INPUT_LINES__: renderRouteInputLines("create", {
      surfaceRequiresWorkspace
    }),
    __JSKIT_CRUD_UPDATE_ROUTE_INPUT_LINES__: renderRouteInputLines("update", {
      surfaceRequiresWorkspace
    }),
    __JSKIT_CRUD_DELETE_ROUTE_INPUT_LINES__: renderRouteInputLines("delete", {
      surfaceRequiresWorkspace
    }),
    __JSKIT_CRUD_RESOURCE_VALIDATORS_IMPORT__: renderResourceValidatorsImport({
      htmlTimeSchemaImports,
      recordIdValidatorImports: resolveRecordIdValidatorImports(
        renderResourceSchemaPropertyLines(outputColumns, {
          forOutput: true
        }),
        renderResourceSchemaPropertyLines(writableColumns, {
          forOutput: false
        })
      )
    }),
    __JSKIT_CRUD_RESOURCE_DATABASE_RUNTIME_IMPORT__: renderResourceDatabaseRuntimeImport({
      needsToIsoString: needsDateTimeOutput || needsDate || writableColumns.some((column) => column.typeKind === "datetime"),
      needsToDatabaseDateTimeUtc: false
    }),
    __JSKIT_CRUD_RESOURCE_NORMALIZE_SUPPORT_IMPORT__: renderResourceNormalizeSupportImport({
      needsNormalizeText,
      needsNormalizeBoolean,
      needsNormalizeFiniteNumber: needsFiniteNumber,
      needsNormalizeFiniteInteger: needsFiniteInteger,
      needsNormalizeRecordId: needsRecordIdSchemas,
      needsNormalizeIfInSource,
      needsNormalizeIfPresent,
      needsNormalizeOrNull
    }),
    __JSKIT_CRUD_RESOURCE_JSON_IMPORT__: renderResourceJsonImport({
      needsJson
    }),
    __JSKIT_CRUD_RESOURCE_OUTPUT_SCHEMA_PROPERTIES__: renderResourceSchemaPropertyLines(outputColumns, {
      forOutput: true
    }),
    __JSKIT_CRUD_RESOURCE_CREATE_SCHEMA_PROPERTIES__: renderResourceSchemaPropertyLines(writableColumns, {
      forOutput: false
    }),
    __JSKIT_CRUD_RESOURCE_INPUT_NORMALIZATION_LINES__: renderResourceInputNormalizationLines(writableColumns),
    __JSKIT_CRUD_RESOURCE_OUTPUT_NORMALIZATION_LINES__: renderResourceOutputNormalizationLines(outputColumns),
    __JSKIT_CRUD_RESOURCE_CREATE_REQUIRED_FIELDS__: JSON.stringify(createRequiredFieldKeys),
    __JSKIT_CRUD_RESOURCE_FIELD_META_PUSH_LINES__: renderResourceFieldMetaPushLines(fieldMetaEntries),
    __JSKIT_CRUD_LIST_CONFIG_LINES__: renderRepositoryListConfigLines(snapshot),
    __JSKIT_CRUD_MIGRATION_COLUMN_LINES__: renderMigrationColumnLines(snapshot),
    __JSKIT_CRUD_MIGRATION_INDEX_LINES__: renderMigrationIndexLines(snapshot),
    __JSKIT_CRUD_MIGRATION_FOREIGN_KEY_LINES__: renderMigrationForeignKeyLines(snapshot),
    __JSKIT_CRUD_MIGRATION_CHECK_CONSTRAINT_LINES__: renderMigrationCheckConstraintLines(snapshot)
  });

  return replacements;
}

async function resolveGenerationSnapshot({
  appRoot,
  tableName,
  idColumnOption
} = {}) {
  const resolvedTableName = normalizeText(tableName);
  if (!resolvedTableName) {
    throw new Error('crud template context requires option "table-name".');
  }
  const idColumn = normalizeText(idColumnOption) || DEFAULT_ID_COLUMN;
  return resolveMysqlSnapshotFromDatabase({
    appRoot,
    tableName: resolvedTableName,
    idColumn
  });
}

function resolveCrudGenerationTableName(options = {}) {
  return normalizeText(options?.["table-name"] || options?.namespace);
}

function createCacheKey({ appRoot, options }) {
  const payload = {
    appRoot: path.resolve(String(appRoot || "")),
    options: {
      namespace: normalizeText(options?.namespace),
      surface: normalizeText(options?.surface),
      ownershipFilter: normalizeText(options?.["ownership-filter"]),
      tableName: normalizeText(options?.["table-name"]),
      idColumn: normalizeText(options?.["id-column"])
    }
  };

  return JSON.stringify(payload);
}

async function buildCrudTemplateContext(input = {}) {
  const source = asRecord(input);
  const appRoot = path.resolve(String(source.appRoot || ""));
  const options = asRecord(source.options);
  const namespace = normalizeText(options.namespace);
  if (!namespace) {
    throw new Error('crud template context requires option "namespace".');
  }
  const tableName = resolveCrudGenerationTableName(options);
  if (!tableName) {
    throw new Error('crud template context requires option "table-name".');
  }
  const resolvedSurface = await resolveCrudGenerationSurfaceId({
    appRoot,
    options
  });
  const snapshot = await resolveGenerationSnapshot({
    appRoot,
    tableName,
    idColumnOption: options["id-column"]
  });

  const resolvedOwnershipFilter = resolveOwnershipFilterForGeneration(
    snapshot,
    options["ownership-filter"],
    {
      enforceTableColumns: true
    }
  );
  const surfaceRequiresWorkspace = await resolveCrudSurfaceRequiresWorkspace({
    appRoot,
    options,
    surface: resolvedSurface
  });

  return buildReplacementsFromSnapshot({
    namespace,
    snapshot,
    resolvedOwnershipFilter,
    surfaceRequiresWorkspace,
    surfaceId: resolvedSurface
  });
}

async function buildTemplateContext(input = {}) {
  const cacheKey = createCacheKey({
    appRoot: input?.appRoot,
    options: input?.options
  });
  if (scaffoldCache.has(cacheKey)) {
    return scaffoldCache.get(cacheKey);
  }

  const replacements = await buildCrudTemplateContext(input);
  scaffoldCache.set(cacheKey, replacements);
  return replacements;
}

const __testables = Object.freeze({
  normalizeRequestedOwnershipFilter,
  inferOwnershipFilterFromSnapshot,
  resolveOwnershipFilterForGeneration,
  buildReplacementsFromSnapshot,
  parseDotEnvLine,
  renderMigrationColumnLine,
  renderMigrationCheckConstraintLines,
  renderMigrationForeignKeyLine,
  resolveScaffoldColumns,
  renderPropertyAccess,
  renderResourceFieldSchema,
  renderInputNormalizer,
  renderOutputNormalizerExpression,
  resolveCrudGenerationTableName,
  resolveGenerationSnapshot,
  buildFieldMetaEntries,
  resolveDefaultCrudSurfaceIdFromAppConfig,
  resolveCrudGenerationSurfaceId,
  resolveCrudSurfaceRequiresWorkspace,
  buildCrudPermissionIds,
  renderRoleCatalogPermissionGrants,
  renderActionPermissionSupport,
  renderActionPermissionExpression,
  renderActionInputValidatorExpression,
  renderRouteParamsValidatorLine,
  renderRouteInputLines
});

export {
  buildTemplateContext,
  resolveScaffoldColumns,
  renderPropertyAccess,
  resolveGenerationSnapshot,
  renderResourceFieldSchema,
  renderInputNormalizer,
  renderOutputNormalizerExpression,
  buildFieldMetaEntries,
  resolveCrudGenerationSurfaceId,
  __testables
};
