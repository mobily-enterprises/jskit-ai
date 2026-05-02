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
import { checkCrudLookupFormControl } from "@jskit-ai/crud-core/shared/crudFieldSupport";
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

function renderBoundedNumberEntries(column) {
  const entries = [];
  if (Number.isFinite(column?.minimum)) {
    entries.push(`min: ${column.minimum}`);
  } else if (column?.unsigned === true) {
    entries.push("min: 0");
  }
  if (Number.isFinite(column?.maximum)) {
    entries.push(`max: ${column.maximum}`);
  }
  return entries;
}

function resolveCanonicalResourceFieldRequired(column = {}) {
  return column?.nullable !== true && column?.hasDefault !== true;
}

function renderCanonicalResourceOperations(column = {}) {
  if (column?.isOwnerColumn === true) {
    return "{}";
  }

  const entries = [
    'output: { required: true }'
  ];

  if (column?.writable === true) {
    entries.push(`create: { required: ${resolveCanonicalResourceFieldRequired(column)} }`);
    entries.push("patch: { required: false }");
  }

  return [
    "{",
    ...entries.map((entry, index) => `  ${entry}${index < entries.length - 1 ? "," : ""}`),
    "}"
  ].join("\n");
}

function renderCanonicalResourceFieldSchema(column, { fieldContractEntry = null } = {}) {
  const entries = [];
  const typeKind = String(column?.typeKind || "");
  const isRequired = resolveCanonicalResourceFieldRequired(column);

  if (typeKind === "string") {
    entries.push('type: "string"');
    if (Number.isInteger(column?.maxLength) && column.maxLength > 0) {
      entries.push(`maxLength: ${column.maxLength}`);
    }
    const enumValues = Array.isArray(column?.enumValues) ? column.enumValues.filter((entry) => entry != null) : [];
    if (enumValues.length > 0) {
      entries.push(`enum: ${JSON.stringify(enumValues)}`);
    }
  } else if (typeKind === "integer") {
    if (column?.isRecordIdColumn === true) {
      entries.push('type: "id"');
    } else {
      entries.push('type: "integer"');
      entries.push(...renderBoundedNumberEntries(column));
    }
  } else if (typeKind === "number") {
    entries.push('type: "number"');
    entries.push(...renderBoundedNumberEntries(column));
  } else if (typeKind === "boolean") {
    entries.push('type: "boolean"');
  } else if (typeKind === "datetime") {
    entries.push('type: "dateTime"');
    const normalizedDefault = normalizeText(column?.defaultValue).toLowerCase();
    if (normalizedDefault === "current_timestamp" || normalizedDefault === "current_timestamp()") {
      entries.push('default: "now()"');
    }
  } else if (typeKind === "date") {
    entries.push('type: "date"');
  } else if (typeKind === "time") {
    entries.push('type: "time"');
  } else {
    entries.push('type: "none"');
  }

  if (isRequired) {
    entries.push("required: true");
  }
  if (column?.nullable === true) {
    entries.push("nullable: true");
  }
  if (shouldRenderJsonRestSearch(column)) {
    entries.push("search: true");
  }
  if (column?.isOwnerColumn === true) {
    entries.push("hidden: true");
  }

  const actualField = normalizeText(fieldContractEntry?.actualField);
  if (actualField) {
    entries.push(`actualField: ${JSON.stringify(actualField)}`);
  }

  const parentRouteParamKey = normalizeText(fieldContractEntry?.parentRouteParamKey);
  if (parentRouteParamKey) {
    entries.push(`parentRouteParamKey: ${JSON.stringify(parentRouteParamKey)}`);
  }

  const relation = fieldContractEntry?.relation && typeof fieldContractEntry.relation === "object"
    ? fieldContractEntry.relation
    : null;
  if (relation) {
    const relationNamespace =
      normalizeCrudLookupNamespace(relation.namespace) ||
      normalizeCrudLookupNamespace(relation.apiPath) ||
      normalizeCrudLookupNamespace(relation?.source?.path) ||
      normalizeCrudLookupNamespace(relation.targetResource);
    if (!relationNamespace) {
      throw new Error(`crud template context field "${normalizeText(column?.key)}" lookup relation requires namespace.`);
    }

    const relationEntries = [
      `kind: ${JSON.stringify(normalizeText(relation.kind) || "lookup")}`,
      `namespace: ${JSON.stringify(relationNamespace)}`,
      `valueKey: ${JSON.stringify(normalizeText(relation.valueKey) || "id")}`
    ];
    const labelKey = normalizeText(relation.labelKey);
    if (labelKey) {
      relationEntries.push(`labelKey: ${JSON.stringify(labelKey)}`);
    }
    entries.push(`relation: { ${relationEntries.join(", ")} }`);
  }

  const relationshipScopeName = resolveJsonRestRelationshipScopeName(fieldContractEntry);
  const relationshipAlias = resolveJsonRestRelationshipAlias(column);
  if (
    relationshipScopeName &&
    relationshipAlias &&
    column?.isOwnerColumn !== true &&
    column?.isForeignIdColumn === true
  ) {
    entries.push(`belongsTo: ${JSON.stringify(relationshipScopeName)}`);
    entries.push(`as: ${JSON.stringify(relationshipAlias)}`);
  }

  const fieldUiOptions = normalizeFieldMetaUiOptions(fieldContractEntry?.ui?.options);
  const formControl = checkCrudLookupFormControl(fieldContractEntry?.ui?.formControl, {
    context: `resource schema field "${normalizeText(column?.key)}" ui.formControl`,
    defaultValue: relation ? "autocomplete" : (fieldUiOptions.length > 0 ? "select" : "")
  });
  if (formControl || fieldUiOptions.length > 0) {
    const uiEntries = [];
    if (formControl) {
      uiEntries.push(`formControl: ${JSON.stringify(formControl)}`);
    }
    if (fieldUiOptions.length > 0) {
      uiEntries.push(`options: ${JSON.stringify(fieldUiOptions)}`);
    }
    entries.push(`ui: { ${uiEntries.join(", ")} }`);
  }

  const storageEntries = [];
  if (fieldContractEntry?.storage?.mode === "virtual") {
    storageEntries.push("virtual: true");
  }
  if (toSnakeCase(normalizeText(column?.key)) !== normalizeText(column?.name)) {
    storageEntries.push(`column: ${JSON.stringify(column.name)}`);
  }
  if (normalizeText(column?.typeKind).toLowerCase() === "datetime") {
    storageEntries.push('writeSerializer: "datetime-utc"');
  }
  if (storageEntries.length > 0) {
    entries.push(`storage: { ${storageEntries.join(", ")} }`);
  }

  const operationsLines = renderCanonicalResourceOperations(column).split("\n");
  const lines = [
    "{",
    ...entries.map((entry) => `  ${entry},`),
    `  operations: ${operationsLines[0]}`
  ];

  for (const line of operationsLines.slice(1)) {
    lines.push(`  ${line}`);
  }

  lines.push("}");
  return lines.join("\n");
}

function renderCanonicalResourceSchemaPropertyLines(columns = [], { fieldContractEntries = [] } = {}) {
  const fieldContractByKey = Object.fromEntries(
    (Array.isArray(fieldContractEntries) ? fieldContractEntries : [])
      .map((entry) => [normalizeText(entry?.key), entry])
      .filter(([key]) => key)
  );

  return (Array.isArray(columns) ? columns : [])
    .filter((column) => column?.isIdColumn !== true)
    .map((column) => {
      const key = renderObjectPropertyKey(column.key);
      const schemaLines = renderCanonicalResourceFieldSchema(column, {
        fieldContractEntry: fieldContractByKey[normalizeText(column?.key)] || null
      }).split("\n");
      const lines = [`  ${key}: ${schemaLines[0]}`];
      for (const line of schemaLines.slice(1)) {
        lines.push(`  ${line}`);
      }
      lines[lines.length - 1] = `${lines[lines.length - 1]},`;
      return lines.join("\n");
    })
    .join("\n");
}

function resolveJsonRestRelationshipScopeName(fieldContractEntry = null) {
  const namespace = normalizeText(fieldContractEntry?.relation?.namespace);
  if (!namespace) {
    return "";
  }

  return toCamelCase(namespace.replace(/\//g, "-"));
}

function resolveJsonRestRelationshipAlias(column = null) {
  const key = normalizeText(column?.key);
  if (!key) {
    return "";
  }
  if (key.endsWith("Id") && key.length > 2) {
    return `${key.slice(0, -2).slice(0, 1).toLowerCase()}${key.slice(0, -2).slice(1)}`;
  }
  return "";
}

function resolveJsonRestFieldType(column = {}) {
  if (column?.isRecordIdColumn === true) {
    return "id";
  }

  const typeKind = normalizeText(column?.typeKind).toLowerCase();
  if (typeKind === "string") {
    return "string";
  }
  if (typeKind === "integer") {
    return "integer";
  }
  if (typeKind === "number") {
    return "number";
  }
  if (typeKind === "boolean") {
    return "boolean";
  }
  if (typeKind === "datetime") {
    return "dateTime";
  }
  if (typeKind === "date") {
    return "date";
  }
  if (typeKind === "time") {
    return "time";
  }
  return "string";
}

function shouldRenderJsonRestSearch(column = {}) {
  return column?.isCreatedAtColumn !== true && column?.isUpdatedAtColumn !== true;
}

function shouldRenderJsonRestStorage(column = {}) {
  const key = normalizeText(column?.key);
  const columnName = normalizeText(column?.name);
  if (!key || !columnName) {
    return false;
  }

  if (toSnakeCase(key) !== columnName) {
    return true;
  }

  return normalizeText(column?.typeKind).toLowerCase() === "datetime";
}

function renderJsonRestFieldSchema(column, { fieldContractEntry = null } = {}) {
  const entries = [];
  const type = resolveJsonRestFieldType(column);
  entries.push(`type: ${JSON.stringify(type)}`);

  if (column?.isIdColumn === true) {
    entries.push("primary: true");
    entries.push("required: true");
    entries.push("search: true");
  } else {
    const required = column?.nullable !== true && column?.hasDefault !== true;
    entries.push(`required: ${required}`);
    if (shouldRenderJsonRestSearch(column)) {
      entries.push("search: true");
    }
  }

  if (column?.nullable === true) {
    entries.push("nullable: true");
  }

  if (type === "string" && Number.isInteger(column?.maxLength) && column.maxLength > 0) {
    entries.push(`max: ${column.maxLength}`);
  }

  if (column?.isOwnerColumn === true) {
    entries.push("hidden: true");
  }

  const relationshipScopeName = resolveJsonRestRelationshipScopeName(fieldContractEntry);
  const relationshipAlias = resolveJsonRestRelationshipAlias(column);
  if (
    relationshipScopeName &&
    relationshipAlias &&
    column?.isOwnerColumn !== true &&
    column?.isForeignIdColumn === true
  ) {
    entries.push(`belongsTo: ${JSON.stringify(relationshipScopeName)}`);
    entries.push(`as: ${JSON.stringify(relationshipAlias)}`);
  }

  if (shouldRenderJsonRestStorage(column)) {
    const storageEntries = [];
    if (toSnakeCase(normalizeText(column?.key)) !== normalizeText(column?.name)) {
      storageEntries.push(`column: ${JSON.stringify(column.name)}`);
    }
    if (normalizeText(column?.typeKind).toLowerCase() === "datetime") {
      storageEntries.push("serialize: serializeNullableDateTime");
    }
    entries.push(`storage: { ${storageEntries.join(", ")} }`);
  }

  return [
    "{",
    ...entries.map((entry, index) => `  ${entry}${index < entries.length - 1 ? "," : ""}`),
    "}"
  ].join("\n");
}

function renderJsonRestSchemaPropertyLines(columns = [], { fieldContractEntries = [] } = {}) {
  const fieldContractByKey = Object.fromEntries(
    (Array.isArray(fieldContractEntries) ? fieldContractEntries : [])
      .map((entry) => [normalizeText(entry?.key), entry])
      .filter(([key]) => key)
  );

  return (Array.isArray(columns) ? columns : [])
    .filter((column) => column?.isIdColumn !== true)
    .map((column) => {
      const key = renderObjectPropertyKey(column.key);
      const schemaLines = renderJsonRestFieldSchema(column, {
        fieldContractEntry: fieldContractByKey[normalizeText(column?.key)] || null
      }).split("\n");
      const lines = [`    ${key}: ${schemaLines[0]}`];
      for (const line of schemaLines.slice(1)) {
        lines.push(`    ${line}`);
      }
      lines[lines.length - 1] = `${lines[lines.length - 1]},`;
      return lines.join("\n");
    })
    .join("\n");
}

function renderJsonRestSearchSchemaLines(columns = []) {
  const searchableStringKeys = (Array.isArray(columns) ? columns : [])
    .filter((column) =>
      normalizeText(column?.typeKind).toLowerCase() === "string" &&
      column?.isOwnerColumn !== true &&
      column?.isIdColumn !== true &&
      column?.isCreatedAtColumn !== true &&
      column?.isUpdatedAtColumn !== true
    )
    .map((column) => normalizeText(column?.key))
    .filter(Boolean);

  const lines = [
    '    id: { type: "id", actualField: "id" },'
  ];

  if (searchableStringKeys.length > 0) {
    lines.push(
      `    q: { type: "string", oneOf: ${JSON.stringify(searchableStringKeys)}, filterOperator: "like", splitBy: " ", matchAll: true },`
    );
  }

  return lines.join("\n");
}

function renderJsonRestDefaultSortLine(columns = []) {
  const sourceColumns = Array.isArray(columns) ? columns : [];
  const createdAtColumn = sourceColumns.find((column) => column?.isCreatedAtColumn === true);
  if (createdAtColumn?.key) {
    return `  defaultSort: ${JSON.stringify([`-${createdAtColumn.key}`])},`;
  }

  const idColumn = sourceColumns.find((column) => column?.isIdColumn === true);
  if (idColumn?.key) {
    return `  defaultSort: ${JSON.stringify([`-${idColumn.key}`])},`;
  }

  return "";
}

function renderResourceDefaultSortLiteral(columns = []) {
  const sortLine = renderJsonRestDefaultSortLine(columns);
  const match = sortLine.match(/defaultSort:\s*(.+),$/);
  return match?.[1] || "[]";
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

function buildFieldContractEntries({ outputColumns = [], writableColumns = [], snapshot = {} } = {}) {
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
    return "      params: routeParamsValidator,";
  }

  return "      params: recordRouteParamsValidator,";
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
    lines.push("          ...(request.input.body || {})");
    return lines.join("\n");
  }

  if (normalizedOperation === "update") {
    lines.push("          recordId: request.input.params.recordId,");
    lines.push("          ...(request.input.body || {})");
    return lines.join("\n");
  }

  lines.push("          recordId: request.input.params.recordId");
  return lines.join("\n");
}

function renderObjectSchemaDefinition(lines = [], { mode = "patch" } = {}) {
  const entries = (Array.isArray(lines) ? lines : [])
    .map((line) => String(line || "").trim())
    .filter(Boolean)
    .map((line) => line.endsWith(",") ? line.slice(0, -1) : line);

  if (entries.length < 1) {
    throw new TypeError("renderObjectSchemaDefinition requires at least one schema definition.");
  }

  if (entries.length === 1) {
    return entries[0];
  }

  if (normalizeText(mode).toLowerCase() === "patch") {
    return [
      "composeSchemaDefinitions([",
      ...entries.map((line) => `  ${line},`),
      "])"
    ].join("\n");
  }

  return [
    "composeSchemaDefinitions([",
    ...entries.map((line) => `  ${line},`),
    "], {",
    `  mode: ${JSON.stringify(mode)}`,
    "})"
  ].join("\n");
}

function renderActionInputExpressions({ surfaceRequiresWorkspace = true } = {}) {
  const listLines = [];
  const viewLines = [];
  const createLines = [];
  const updateLines = [];
  const deleteLines = [];

  if (surfaceRequiresWorkspace) {
    listLines.push("workspaceSlugParamsValidator,");
    viewLines.push("workspaceSlugParamsValidator,");
    createLines.push("workspaceSlugParamsValidator,");
    updateLines.push("workspaceSlugParamsValidator,");
    deleteLines.push("workspaceSlugParamsValidator,");
  }

  listLines.push(
    "listCursorPaginationQueryValidator,",
    "listSearchQueryValidator,",
    "listParentFilterQueryValidator,",
    "lookupIncludeQueryValidator,"
  );
  viewLines.push(
    "recordIdParamsValidator,",
    "lookupIncludeQueryValidator,"
  );
  createLines.push("resource.operations.create.body,");
  updateLines.push(
    "recordIdParamsValidator,",
    "resource.operations.patch.body,"
  );
  deleteLines.push("recordIdParamsValidator,");

  return Object.freeze({
    list: renderObjectSchemaDefinition(listLines),
    view: renderObjectSchemaDefinition(viewLines),
    create: renderObjectSchemaDefinition(createLines, { mode: "create" }),
    update: renderObjectSchemaDefinition(updateLines),
    delete: renderObjectSchemaDefinition(deleteLines)
  });
}

function renderRouteValidatorConstants({ surfaceRequiresWorkspace = true } = {}) {
  if (!surfaceRequiresWorkspace) {
    return "";
  }

  return [
    "const recordRouteParamsValidator = composeSchemaDefinitions([",
    "  routeParamsValidator,",
    "  recordIdParamsValidator",
    "]);"
  ].join("\n");
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
  const fieldContractEntries = buildFieldContractEntries({
    outputColumns,
    writableColumns,
    snapshot
  });
  const actionInputExpressions = renderActionInputExpressions({
    surfaceRequiresWorkspace
  });
  const resourceSchemaColumns = scaffoldColumns;
  const resourceSchemaPropertyLines = renderCanonicalResourceSchemaPropertyLines(resourceSchemaColumns, {
    fieldContractEntries
  });
  const resourceSearchSchemaLines = renderJsonRestSearchSchemaLines(resourceSchemaColumns);
  const resourceDefaultSortLiteral = renderResourceDefaultSortLiteral(resourceSchemaColumns);
  const jsonRestSchemaPropertyLines = renderJsonRestSchemaPropertyLines(resourceSchemaColumns, {
    fieldContractEntries
  });
  const jsonRestSearchSchemaLines = renderJsonRestSearchSchemaLines(resourceSchemaColumns);
  const jsonRestDefaultSortLine = renderJsonRestDefaultSortLine(resourceSchemaColumns);

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
    __JSKIT_CRUD_LIST_ACTION_INPUT__: actionInputExpressions.list,
    __JSKIT_CRUD_VIEW_ACTION_INPUT__: actionInputExpressions.view,
    __JSKIT_CRUD_CREATE_ACTION_INPUT__: actionInputExpressions.create,
    __JSKIT_CRUD_UPDATE_ACTION_INPUT__: actionInputExpressions.update,
    __JSKIT_CRUD_DELETE_ACTION_INPUT__: actionInputExpressions.delete,
    __JSKIT_CRUD_LIST_ACTION_PERMISSION__: renderActionPermissionExpression("list", {
      requiresNamedPermissions
    }),
    __JSKIT_CRUD_VIEW_ACTION_PERMISSION__: renderActionPermissionExpression("view", {
      requiresNamedPermissions
    }),
    __JSKIT_CRUD_CREATE_ACTION_PERMISSION__: renderActionPermissionExpression("create", {
      requiresNamedPermissions
    }),
    __JSKIT_CRUD_UPDATE_ACTION_PERMISSION__: renderActionPermissionExpression("update", {
      requiresNamedPermissions
    }),
    __JSKIT_CRUD_DELETE_ACTION_PERMISSION__: renderActionPermissionExpression("delete", {
      requiresNamedPermissions
    }),
    __JSKIT_CRUD_ROLE_CATALOG_PERMISSION_GRANTS__: renderRoleCatalogPermissionGrants(namespace, {
      requiresNamedPermissions
    }),
    __JSKIT_CRUD_ROUTE_SURFACE_REQUIRES_WORKSPACE__: String(surfaceRequiresWorkspace === true),
    __JSKIT_CRUD_ROUTE_BASE__: JSON.stringify(surfaceRequiresWorkspace === true ? "/w/:workspaceSlug" : "/"),
    __JSKIT_CRUD_ROUTE_WORKSPACE_SUPPORT_IMPORTS__: renderRouteWorkspaceSupportImports({
      surfaceRequiresWorkspace
    }),
    __JSKIT_CRUD_ROUTE_CONTRACTS_RESOURCE_ARGS__: surfaceRequiresWorkspace ? ",\n  routeParamsValidator" : "",
    __JSKIT_CRUD_ROUTE_VALIDATOR_CONSTANTS__: renderRouteValidatorConstants({
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
    __JSKIT_CRUD_RESOURCE_SCHEMA_PROPERTIES__: resourceSchemaPropertyLines,
    __JSKIT_CRUD_RESOURCE_SEARCH_SCHEMA_LINES__: resourceSearchSchemaLines,
    __JSKIT_CRUD_RESOURCE_DEFAULT_SORT__: resourceDefaultSortLiteral,
    __JSKIT_CRUD_RESOURCE_AUTOFILTER__: JSON.stringify(resolvedOwnershipFilter),
    __JSKIT_CRUD_JSONREST_SCOPE_NAME__: JSON.stringify(toCamelCase(namespace)),
    __JSKIT_CRUD_JSONREST_AUTOFILTER__: JSON.stringify(resolvedOwnershipFilter),
    __JSKIT_CRUD_JSONREST_SEARCH_SCHEMA_LINES__: jsonRestSearchSchemaLines,
    __JSKIT_CRUD_JSONREST_SCHEMA_PROPERTIES__: jsonRestSchemaPropertyLines,
    __JSKIT_CRUD_JSONREST_DEFAULT_SORT_LINE__: jsonRestDefaultSortLine,
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
  resolveCrudGenerationTableName,
  resolveGenerationSnapshot,
  buildFieldContractEntries,
  renderCanonicalResourceFieldSchema,
  resolveDefaultCrudSurfaceIdFromAppConfig,
  resolveCrudGenerationSurfaceId,
  resolveCrudSurfaceRequiresWorkspace,
  buildCrudPermissionIds,
  renderRoleCatalogPermissionGrants,
  renderActionPermissionSupport,
  renderActionPermissionExpression,
  renderActionInputExpressions,
  renderRouteValidatorConstants,
  renderRouteParamsValidatorLine,
  renderRouteInputLines
});

export {
  buildTemplateContext,
  resolveScaffoldColumns,
  resolveGenerationSnapshot,
  renderCanonicalResourceFieldSchema,
  buildFieldContractEntries,
  resolveCrudGenerationSurfaceId,
  __testables
};
