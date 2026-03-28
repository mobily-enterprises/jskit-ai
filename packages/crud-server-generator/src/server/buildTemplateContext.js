import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  normalizeText,
  resolveDatabaseClientFromEnvironment,
  resolveDatabaseConnectionFromEnvironment,
  toKnexClientId
} from "@jskit-ai/database-runtime/shared";
import { toSnakeCase } from "@jskit-ai/kernel/shared/support/stringCase";

const DEFAULT_ID_COLUMN = "id";
const OWNERSHIP_FILTER_AUTO = "auto";
const OWNERSHIP_FILTER_VALUES = new Set([
  OWNERSHIP_FILTER_AUTO,
  "public",
  "user",
  "workspace",
  "workspace_user"
]);
const MYSQL_CLIENT_ID = "mysql2";

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
      `Invalid ownership filter "${normalized || String(value || "")}". Use: auto, public, user, workspace, workspace_user.`
    );
  }
  return OWNERSHIP_FILTER_AUTO;
}

function inferOwnershipFilterFromSnapshot(snapshot) {
  const hasWorkspace = snapshot?.hasWorkspaceOwnerColumn === true;
  const hasUser = snapshot?.hasUserOwnerColumn === true;
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
  const hasWorkspace = snapshot?.hasWorkspaceOwnerColumn === true;
  const hasUser = snapshot?.hasUserOwnerColumn === true;
  if (filter === "public") {
    return;
  }
  if (filter === "workspace" && !hasWorkspace) {
    throw new Error(
      'Ownership filter "workspace" requires column "workspace_owner_id".'
    );
  }
  if (filter === "user" && !hasUser) {
    throw new Error(
      'Ownership filter "user" requires column "user_owner_id".'
    );
  }
  if (filter === "workspace_user" && (!hasWorkspace || !hasUser)) {
    throw new Error(
      'Ownership filter "workspace_user" requires both columns "workspace_owner_id" and "user_owner_id".'
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
    return await import(`${pathToFileURL(resolvedPath).href}?t=${Date.now()}_${Math.random()}`);
  } catch (error) {
    throw new Error(
      `${contextLabel} failed loading "${moduleId}": ${String(error?.message || error || "unknown error")}`
    );
  }
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

  const connection = resolveDatabaseConnectionFromEnvironment(env, {
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

function resolveScaffoldColumns(snapshot) {
  const idColumn = String(snapshot.idColumn || DEFAULT_ID_COLUMN);
  const sourceColumns = Array.isArray(snapshot.columns) ? snapshot.columns : [];
  const seenKeys = new Set();

  const columns = sourceColumns.map((column) => {
    const isWorkspaceOwnerColumn = column.name === "workspace_owner_id";
    const isUserOwnerColumn = column.name === "user_owner_id";
    const isOwnerColumn = isWorkspaceOwnerColumn || isUserOwnerColumn;
    const isIdColumn = column.name === idColumn;
    const isCreatedAtColumn = column.name === "created_at";
    const isUpdatedAtColumn = column.name === "updated_at";
    const key = resolveColumnKey(column, idColumn);
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
      key,
      isOwnerColumn,
      isIdColumn,
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
  if (column.isIdColumn === true) {
    options.push("minimum: 1");
  } else if (column.unsigned === true) {
    options.push("minimum: 0");
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
    schemaExpression = renderIntegerSchema(column);
  } else if (typeKind === "number") {
    schemaExpression = "Type.Number()";
  } else if (typeKind === "boolean") {
    schemaExpression = "Type.Boolean()";
  } else if (typeKind === "datetime") {
    schemaExpression = 'Type.String({ format: "date-time", minLength: 1 })';
  } else if (typeKind === "date") {
    schemaExpression = 'Type.String({ format: "date", minLength: 1 })';
  } else if (typeKind === "time") {
    schemaExpression = 'Type.String({ format: "time", minLength: 1 })';
  } else if (typeKind === "json") {
    schemaExpression = "Type.Any()";
  }

  if (column.nullable === true) {
    return `Type.Union([${schemaExpression}, Type.Null()])`;
  }
  return schemaExpression;
}

function renderInputNormalizer(column) {
  const typeKind = String(column.typeKind || "");
  const nullable = column?.nullable === true;
  if (typeKind === "string" || typeKind === "time") {
    if (typeKind === "time" && nullable) {
      return "normalizeNullableTimeInput";
    }
    return "normalizeText";
  }
  if (typeKind === "integer") {
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
      return "normalizeNullableDateTimeInput";
    }
    return "toDatabaseDateTimeUtc";
  }
  if (typeKind === "date") {
    if (nullable) {
      return "normalizeNullableDateInput";
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
  if (typeKind === "string" || typeKind === "time") {
    return "normalizeText";
  }
  if (typeKind === "integer") {
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

function renderResourceInputNormalizerSupport({
  needsNullableDateTimeInput = false,
  needsNullableDateInput = false,
  needsNullableTimeInput = false
} = {}) {
  const blocks = [];

  if (needsNullableDateTimeInput) {
    blocks.push(`function normalizeNullableDateTimeInput(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  return toDatabaseDateTimeUtc(normalized);
}`);
  }

  if (needsNullableDateInput) {
    blocks.push(`function normalizeNullableDateInput(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  return toIsoString(normalized).slice(0, 10);
}`);
  }

  if (needsNullableTimeInput) {
    blocks.push(`function normalizeNullableTimeInput(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}`);
  }

  if (blocks.length < 1) {
    return "";
  }

  return `${blocks.join("\n\n")}\n`;
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

  return `.defaultTo(${JSON.stringify(rawDefault)})`;
}

function renderMigrationColumnLine(column, { idColumn = DEFAULT_ID_COLUMN, primaryKeyColumns = [] } = {}) {
  const isPrimary = Array.isArray(primaryKeyColumns) && primaryKeyColumns.includes(column.name);
  const isIdColumn = column.name === idColumn;

  if (isIdColumn && column.autoIncrement) {
    let line = `table.increments(${JSON.stringify(column.name)})`;
    if (column.unsigned) {
      line += ".unsigned()";
    }
    line += ".primary();";
    return line;
  }

  let line = "";
  const nameLiteral = JSON.stringify(column.name);
  const dataType = String(column.dataType || "").toLowerCase();

  if (dataType === "varchar") {
    const maxLength = Number.isFinite(column.maxLength) ? column.maxLength : 255;
    line = `table.string(${nameLiteral}, ${maxLength})`;
  } else if (dataType === "char") {
    line = `table.specificType(${nameLiteral}, ${JSON.stringify(column.columnType || "char(255)")})`;
  } else if (dataType === "text") {
    line = `table.text(${nameLiteral})`;
  } else if (dataType === "tinytext" || dataType === "mediumtext" || dataType === "longtext") {
    line = `table.text(${nameLiteral}, ${JSON.stringify(dataType)})`;
  } else if (dataType === "enum") {
    const enumValues = Array.isArray(column.enumValues) ? column.enumValues : [];
    line = `table.enu(${nameLiteral}, ${JSON.stringify(enumValues)})`;
  } else if (dataType === "set") {
    line = `table.specificType(${nameLiteral}, ${JSON.stringify(column.columnType || "set")})`;
  } else if (column.typeKind === "boolean") {
    line = `table.boolean(${nameLiteral})`;
  } else if (dataType === "int" || dataType === "integer") {
    line = `table.integer(${nameLiteral})`;
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
    line = `table.time(${nameLiteral})`;
  } else if (dataType === "datetime") {
    line = `table.dateTime(${nameLiteral})`;
  } else if (dataType === "timestamp") {
    line = `table.timestamp(${nameLiteral})`;
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
  const lines = columns.map((column) =>
    `    ${renderMigrationColumnLine(column, {
      idColumn: snapshot.idColumn,
      primaryKeyColumns: snapshot.primaryKeyColumns
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
  if (index?.unique === true) {
    if (indexName) {
      return `    table.unique(${columnsLiteral}, ${JSON.stringify(indexName)});`;
    }
    return `    table.unique(${columnsLiteral});`;
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

function buildReplacementsFromSnapshot({
  namespace,
  snapshot,
  resolvedOwnershipFilter
}) {
  const scaffoldColumns = resolveScaffoldColumns(snapshot);
  const outputColumns = scaffoldColumns.filter((column) => !column.isOwnerColumn);
  const writableColumns = scaffoldColumns.filter((column) => column.writable);
  const createRequiredFieldKeys = writableColumns
    .filter((column) => !column.nullable && column.hasDefault !== true)
    .map((column) => column.key);
  const resourceColumns = [...outputColumns, ...writableColumns];

  const outputKeys = outputColumns.map((column) => column.key);
  const writeKeys = writableColumns.map((column) => column.key);
  const columnOverrides = {};
  const seenOverrideKeys = new Set();
  for (const column of [...outputColumns, ...writableColumns]) {
    const key = column.key;
    if (!key || seenOverrideKeys.has(key)) {
      continue;
    }
    seenOverrideKeys.add(key);
    const guessedColumn = toSnakeCase(key);
    const actualColumn = column.name;
    if (typeof actualColumn === "string" && actualColumn && actualColumn !== guessedColumn) {
      columnOverrides[key] = actualColumn;
    }
  }
  const createdAtColumn = scaffoldColumns.find((column) => column.isCreatedAtColumn)?.name || "";
  const updatedAtColumn = scaffoldColumns.find((column) => column.isUpdatedAtColumn)?.name || "";
  const needsFiniteInteger = resourceColumns.some((column) => column.typeKind === "integer");
  const needsFiniteNumber = resourceColumns.some((column) => column.typeKind === "number");
  const needsDateTimeOutput = outputColumns.some((column) => column.typeKind === "datetime");
  const needsDateTimeInput = writableColumns.some((column) => column.typeKind === "datetime");
  const needsNullableDateTimeInput = writableColumns.some(
    (column) => column.typeKind === "datetime" && column.nullable === true
  );
  const needsNullableDateInput = writableColumns.some(
    (column) => column.typeKind === "date" && column.nullable === true
  );
  const needsNullableTimeInput = writableColumns.some(
    (column) => column.typeKind === "time" && column.nullable === true
  );
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
    __JSKIT_CRUD_RESOLVED_OWNERSHIP_FILTER__: resolvedOwnershipFilter,
    __JSKIT_CRUD_RESOURCE_DATABASE_RUNTIME_IMPORT__: renderResourceDatabaseRuntimeImport({
      needsToIsoString: needsDateTimeOutput || needsDate,
      needsToDatabaseDateTimeUtc: needsDateTimeInput
    }),
    __JSKIT_CRUD_RESOURCE_NORMALIZE_SUPPORT_IMPORT__: renderResourceNormalizeSupportImport({
      needsNormalizeText,
      needsNormalizeBoolean,
      needsNormalizeFiniteNumber: needsFiniteNumber,
      needsNormalizeFiniteInteger: needsFiniteInteger,
      needsNormalizeIfInSource,
      needsNormalizeIfPresent,
      needsNormalizeOrNull
    }),
    __JSKIT_CRUD_RESOURCE_JSON_IMPORT__: renderResourceJsonImport({
      needsJson
    }),
    __JSKIT_CRUD_RESOURCE_INPUT_NORMALIZER_SUPPORT__: renderResourceInputNormalizerSupport({
      needsNullableDateTimeInput,
      needsNullableDateInput,
      needsNullableTimeInput
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
    __JSKIT_CRUD_REPOSITORY_OUTPUT_KEYS__: JSON.stringify(outputKeys),
    __JSKIT_CRUD_REPOSITORY_WRITE_KEYS__: JSON.stringify(writeKeys),
    __JSKIT_CRUD_REPOSITORY_COLUMN_OVERRIDES__: JSON.stringify(columnOverrides),
    __JSKIT_CRUD_REPOSITORY_CREATED_AT_COLUMN__: JSON.stringify(createdAtColumn),
    __JSKIT_CRUD_REPOSITORY_UPDATED_AT_COLUMN__: JSON.stringify(updatedAtColumn),
    __JSKIT_CRUD_MIGRATION_COLUMN_LINES__: renderMigrationColumnLines(snapshot),
    __JSKIT_CRUD_MIGRATION_INDEX_LINES__: renderMigrationIndexLines(snapshot)
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

function createCacheKey({ appRoot, options }) {
  const payload = {
    appRoot: path.resolve(String(appRoot || "")),
    options: {
      namespace: normalizeText(options?.namespace),
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
  const tableName = normalizeText(options["table-name"]);
  if (!tableName) {
    throw new Error('crud template context requires option "table-name".');
  }
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

  return buildReplacementsFromSnapshot({
    namespace,
    snapshot,
    resolvedOwnershipFilter
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
  renderMigrationColumnLine
});

export { buildTemplateContext, __testables };
