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

function normalizeNamespace(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function resolveDefaultTableName(namespace) {
  const normalizedNamespace = normalizeNamespace(namespace);
  if (!normalizedNamespace) {
    throw new Error('crud template context requires option "namespace".');
  }
  return `crud_${normalizedNamespace.replace(/-/g, "_")}`;
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

function normalizeDefaultSnapshotColumn(source) {
  return Object.freeze({
    ...source,
    key: String(source.key || ""),
    dataType: String(source.dataType || "").toLowerCase(),
    columnType: String(source.columnType || "").toLowerCase(),
    typeKind: String(source.typeKind || ""),
    nullable: source.nullable === true,
    hasDefault: source.hasDefault === true,
    autoIncrement: source.autoIncrement === true,
    unsigned: source.unsigned === true,
    maxLength: Number.isFinite(source.maxLength) ? source.maxLength : null,
    numericPrecision: Number.isFinite(source.numericPrecision) ? source.numericPrecision : null,
    numericScale: Number.isFinite(source.numericScale) ? source.numericScale : null,
    datetimePrecision: Number.isFinite(source.datetimePrecision) ? source.datetimePrecision : null,
    enumValues: Object.freeze(Array.isArray(source.enumValues) ? [...source.enumValues] : []),
    extra: String(source.extra || "")
  });
}

function buildDefaultSnapshot({ namespace, tableName = "", idColumn = DEFAULT_ID_COLUMN } = {}) {
  const resolvedTableName = normalizeText(tableName) || resolveDefaultTableName(namespace);
  const resolvedIdColumn = normalizeText(idColumn) || DEFAULT_ID_COLUMN;

  const columns = Object.freeze([
    normalizeDefaultSnapshotColumn({
      name: "id",
      key: "id",
      dataType: "int",
      columnType: "int unsigned",
      typeKind: "integer",
      nullable: false,
      hasDefault: false,
      defaultValue: null,
      autoIncrement: true,
      unsigned: true,
      numericPrecision: 10,
      numericScale: 0,
      ordinalPosition: 1
    }),
    normalizeDefaultSnapshotColumn({
      name: "workspace_owner_id",
      key: "workspaceOwnerId",
      dataType: "int",
      columnType: "int unsigned",
      typeKind: "integer",
      nullable: true,
      hasDefault: false,
      defaultValue: null,
      autoIncrement: false,
      unsigned: true,
      numericPrecision: 10,
      numericScale: 0,
      ordinalPosition: 2
    }),
    normalizeDefaultSnapshotColumn({
      name: "user_owner_id",
      key: "userOwnerId",
      dataType: "int",
      columnType: "int unsigned",
      typeKind: "integer",
      nullable: true,
      hasDefault: false,
      defaultValue: null,
      autoIncrement: false,
      unsigned: true,
      numericPrecision: 10,
      numericScale: 0,
      ordinalPosition: 3
    }),
    normalizeDefaultSnapshotColumn({
      name: "text_field",
      key: "textField",
      dataType: "varchar",
      columnType: "varchar(160)",
      typeKind: "string",
      nullable: false,
      hasDefault: false,
      defaultValue: null,
      autoIncrement: false,
      unsigned: false,
      maxLength: 160,
      ordinalPosition: 4
    }),
    normalizeDefaultSnapshotColumn({
      name: "date_field",
      key: "dateField",
      dataType: "timestamp",
      columnType: "timestamp",
      typeKind: "datetime",
      nullable: false,
      hasDefault: false,
      defaultValue: null,
      autoIncrement: false,
      unsigned: false,
      ordinalPosition: 5
    }),
    normalizeDefaultSnapshotColumn({
      name: "number_field",
      key: "numberField",
      dataType: "double",
      columnType: "double",
      typeKind: "number",
      nullable: false,
      hasDefault: false,
      defaultValue: null,
      autoIncrement: false,
      unsigned: false,
      ordinalPosition: 6
    }),
    normalizeDefaultSnapshotColumn({
      name: "created_at",
      key: "createdAt",
      dataType: "timestamp",
      columnType: "timestamp",
      typeKind: "datetime",
      nullable: false,
      hasDefault: true,
      defaultValue: "CURRENT_TIMESTAMP",
      autoIncrement: false,
      unsigned: false,
      extra: "",
      ordinalPosition: 7
    }),
    normalizeDefaultSnapshotColumn({
      name: "updated_at",
      key: "updatedAt",
      dataType: "timestamp",
      columnType: "timestamp",
      typeKind: "datetime",
      nullable: false,
      hasDefault: true,
      defaultValue: "CURRENT_TIMESTAMP",
      autoIncrement: false,
      unsigned: false,
      extra: "on update current_timestamp",
      ordinalPosition: 8
    })
  ]);

  return Object.freeze({
    dialect: MYSQL_CLIENT_ID,
    schemaName: "",
    tableName: resolvedTableName,
    idColumn: resolvedIdColumn,
    primaryKeyColumns: Object.freeze([resolvedIdColumn]),
    hasWorkspaceOwnerColumn: true,
    hasUserOwnerColumn: true,
    columns,
    indexes: Object.freeze([
      Object.freeze({
        name: "",
        unique: false,
        columns: Object.freeze(["workspace_owner_id"])
      }),
      Object.freeze({
        name: "",
        unique: false,
        columns: Object.freeze(["user_owner_id"])
      })
    ])
  });
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

function toResourceFieldDefinition(column) {
  return Object.freeze({
    key: String(column.key),
    typeKind: String(column.typeKind),
    nullable: column.nullable === true,
    unsigned: column.unsigned === true,
    maxLength: Number.isFinite(column.maxLength) ? column.maxLength : null,
    numericPrecision: Number.isFinite(column.numericPrecision) ? column.numericPrecision : null,
    numericScale: Number.isFinite(column.numericScale) ? column.numericScale : null,
    enumValues: Array.isArray(column.enumValues) ? [...column.enumValues] : [],
    format:
      column.typeKind === "datetime"
        ? "date-time"
        : column.typeKind === "date"
          ? "date"
          : column.typeKind === "time"
            ? "time"
            : ""
  });
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

  const outputFieldDefinitions = outputColumns.map((column) => toResourceFieldDefinition(column));
  const writeFieldDefinitions = writableColumns.map((column) => toResourceFieldDefinition(column));

  const outputMappings = outputColumns.map((column) => ({
    key: column.key,
    column: column.name
  }));
  const writeMappings = writableColumns.map((column) => ({
    key: column.key,
    column: column.name
  }));
  const createdAtColumn = scaffoldColumns.find((column) => column.isCreatedAtColumn)?.name || "";
  const updatedAtColumn = scaffoldColumns.find((column) => column.isUpdatedAtColumn)?.name || "";

  const replacements = Object.freeze({
    __JSKIT_CRUD_TABLE_NAME__: JSON.stringify(snapshot.tableName),
    __JSKIT_CRUD_ID_COLUMN__: JSON.stringify(snapshot.idColumn || DEFAULT_ID_COLUMN),
    __JSKIT_CRUD_RESOLVED_OWNERSHIP_FILTER__: resolvedOwnershipFilter,
    __JSKIT_CRUD_RESOURCE_OUTPUT_FIELDS__: JSON.stringify(outputFieldDefinitions),
    __JSKIT_CRUD_RESOURCE_WRITE_FIELDS__: JSON.stringify(writeFieldDefinitions),
    __JSKIT_CRUD_RESOURCE_CREATE_REQUIRED_FIELDS__: JSON.stringify(createRequiredFieldKeys),
    __JSKIT_CRUD_REPOSITORY_SELECT_COLUMNS__: JSON.stringify(outputMappings.map((mapping) => mapping.column)),
    __JSKIT_CRUD_REPOSITORY_OUTPUT_MAPPINGS__: JSON.stringify(outputMappings),
    __JSKIT_CRUD_REPOSITORY_WRITE_MAPPINGS__: JSON.stringify(writeMappings),
    __JSKIT_CRUD_REPOSITORY_CREATED_AT_COLUMN__: JSON.stringify(createdAtColumn),
    __JSKIT_CRUD_REPOSITORY_UPDATED_AT_COLUMN__: JSON.stringify(updatedAtColumn),
    __JSKIT_CRUD_MIGRATION_COLUMN_LINES__: renderMigrationColumnLines(snapshot),
    __JSKIT_CRUD_MIGRATION_INDEX_LINES__: renderMigrationIndexLines(snapshot)
  });

  return replacements;
}

async function resolveGenerationSnapshot({
  appRoot,
  namespace,
  tableNameOption,
  idColumnOption
} = {}) {
  const tableName = normalizeText(tableNameOption);
  const idColumn = normalizeText(idColumnOption) || DEFAULT_ID_COLUMN;
  if (!tableName) {
    return buildDefaultSnapshot({
      namespace,
      idColumn
    });
  }

  return resolveMysqlSnapshotFromDatabase({
    appRoot,
    tableName,
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

  const hasTableMode = Boolean(normalizeText(options["table-name"]));
  const snapshot = await resolveGenerationSnapshot({
    appRoot,
    namespace,
    tableNameOption: options["table-name"],
    idColumnOption: options["id-column"]
  });

  const resolvedOwnershipFilter = resolveOwnershipFilterForGeneration(
    snapshot,
    options["ownership-filter"],
    {
      enforceTableColumns: hasTableMode
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
  buildDefaultSnapshot,
  normalizeRequestedOwnershipFilter,
  inferOwnershipFilterFromSnapshot,
  resolveOwnershipFilterForGeneration,
  buildReplacementsFromSnapshot,
  parseDotEnvLine,
  renderMigrationColumnLine
});

export { buildTemplateContext, __testables };
