import { normalizeText } from "@jskit-ai/database-runtime/shared";
import { toCamelCase } from "@jskit-ai/kernel/shared/support/stringCase";

const BOOLEAN_TINYINT_PATTERN = /^tinyint\(1\)/;
const TABLE_NAME_PATTERN = /^[A-Za-z0-9_]+$/;

function requireKnexRaw(knex) {
  if (!knex || typeof knex.raw !== "function") {
    throw new TypeError("introspectCrudTableSnapshot requires knex with raw().");
  }
}

function requireTableName(value) {
  const tableName = normalizeText(value);
  if (!tableName) {
    throw new TypeError("introspectCrudTableSnapshot requires tableName.");
  }
  if (!TABLE_NAME_PATTERN.test(tableName)) {
    throw new Error(`Invalid table name "${tableName}". Use letters, numbers, and underscore only.`);
  }

  return tableName;
}

function normalizeRows(rawResult) {
  if (Array.isArray(rawResult)) {
    if (rawResult.length > 0 && Array.isArray(rawResult[0])) {
      return rawResult[0];
    }
    return rawResult;
  }
  if (rawResult && typeof rawResult === "object" && Array.isArray(rawResult.rows)) {
    return rawResult.rows;
  }
  return [];
}

function normalizeDbSchemaName(rows = []) {
  const firstRow = Array.isArray(rows) ? rows[0] : null;
  const schemaName = normalizeText(firstRow?.schemaName || firstRow?.schema_name || "");
  if (!schemaName) {
    throw new Error("Could not resolve current database schema name.");
  }

  return schemaName;
}

function toBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  const text = normalizeText(value).toLowerCase();
  return text === "1" || text === "true" || text === "yes" || text === "y";
}

function toNullableNumber(value) {
  if (value == null) {
    return null;
  }
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeColumnDefault(value) {
  if (value == null) {
    return null;
  }

  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "null") {
    return null;
  }

  return value;
}

function parseEnumValues(columnType = "") {
  const source = normalizeText(columnType);
  if (!source.toLowerCase().startsWith("enum(") || !source.endsWith(")")) {
    return Object.freeze([]);
  }

  const body = source.slice(5, -1);
  const values = [];
  const pattern = /'((?:\\'|[^'])*)'/g;
  let match = null;
  while ((match = pattern.exec(body)) != null) {
    values.push(match[1].replace(/\\'/g, "'"));
  }
  return Object.freeze(values);
}

function resolveTypeKind(column) {
  const dataType = normalizeText(column?.dataType).toLowerCase();
  const columnType = normalizeText(column?.columnType).toLowerCase();

  if (
    dataType === "varchar" ||
    dataType === "char" ||
    dataType === "text" ||
    dataType === "tinytext" ||
    dataType === "mediumtext" ||
    dataType === "longtext" ||
    dataType === "enum" ||
    dataType === "set"
  ) {
    return "string";
  }

  if (
    dataType === "int" ||
    dataType === "integer" ||
    dataType === "smallint" ||
    dataType === "mediumint" ||
    dataType === "bigint"
  ) {
    return "integer";
  }

  if (dataType === "tinyint") {
    if (BOOLEAN_TINYINT_PATTERN.test(columnType)) {
      return "boolean";
    }
    return "integer";
  }

  if (
    dataType === "decimal" ||
    dataType === "numeric" ||
    dataType === "float" ||
    dataType === "double" ||
    dataType === "real"
  ) {
    return "number";
  }

  if (dataType === "boolean" || dataType === "bool") {
    return "boolean";
  }

  if (dataType === "datetime" || dataType === "timestamp") {
    return "datetime";
  }
  if (dataType === "date") {
    return "date";
  }
  if (dataType === "time") {
    return "time";
  }
  if (dataType === "json") {
    return "json";
  }

  throw new Error(
    `Unsupported MySQL column type "${dataType}" for column "${String(column?.name || "")}".`
  );
}

function normalizeColumn(row = {}) {
  const name = normalizeText(row.columnName || row.column_name);
  if (!name) {
    throw new Error("MySQL introspection returned a column without column name.");
  }

  const dataType = normalizeText(row.dataType || row.data_type).toLowerCase();
  const columnType = normalizeText(row.columnType || row.column_type);
  const columnTypeLower = columnType.toLowerCase();
  const nullable = normalizeText(row.isNullable || row.is_nullable).toUpperCase() === "YES";
  const rawDefaultValue = Object.prototype.hasOwnProperty.call(row, "columnDefault")
    ? row.columnDefault
    : Object.prototype.hasOwnProperty.call(row, "column_default")
      ? row.column_default
      : null;
  const defaultValue = normalizeColumnDefault(rawDefaultValue);
  const hasDefault = defaultValue != null;
  const extra = normalizeText(row.extra).toLowerCase();
  const autoIncrement = extra.includes("auto_increment");
  const unsigned = columnTypeLower.includes("unsigned");
  const enumValues = parseEnumValues(columnType);

  const normalized = Object.freeze({
    name,
    key: toCamelCase(name),
    dataType,
    columnType,
    extra,
    typeKind: resolveTypeKind({
      name,
      dataType,
      columnType
    }),
    nullable,
    defaultValue,
    hasDefault,
    autoIncrement,
    unsigned,
    maxLength: toNullableNumber(row.characterMaximumLength ?? row.character_maximum_length),
    numericPrecision: toNullableNumber(row.numericPrecision ?? row.numeric_precision),
    numericScale: toNullableNumber(row.numericScale ?? row.numeric_scale),
    datetimePrecision: toNullableNumber(row.datetimePrecision ?? row.datetime_precision),
    ordinalPosition: toNullableNumber(row.ordinalPosition ?? row.ordinal_position),
    enumValues
  });

  return normalized;
}

function normalizePrimaryKeyColumns(rows = []) {
  return Object.freeze(
    rows
      .map((row) => normalizeText(row.columnName || row.column_name))
      .filter(Boolean)
  );
}

function normalizeIndexes(rows = []) {
  const byName = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const indexName = normalizeText(row.indexName || row.index_name);
    const columnName = normalizeText(row.columnName || row.column_name);
    if (!indexName || !columnName) {
      continue;
    }

    const seqInIndex = toNullableNumber(row.seqInIndex ?? row.seq_in_index) || 0;
    const nonUnique = toBoolean(row.nonUnique ?? row.non_unique);
    const existing = byName.get(indexName) || {
      name: indexName,
      unique: !nonUnique,
      columns: []
    };
    existing.columns.push({
      name: columnName,
      order: seqInIndex
    });
    byName.set(indexName, existing);
  }

  return Object.freeze(
    [...byName.values()]
      .map((index) =>
        Object.freeze({
          name: index.name,
          unique: index.unique,
          columns: Object.freeze(
            index.columns
              .sort((left, right) => left.order - right.order)
              .map((column) => column.name)
          )
        })
      )
      .sort((left, right) => left.name.localeCompare(right.name))
  );
}

function requireIdColumn(columns, idColumn) {
  const normalizedIdColumn = normalizeText(idColumn) || "id";
  const idSpec = columns.find((column) => column.name === normalizedIdColumn) || null;
  if (!idSpec) {
    throw new Error(`Could not find id column "${normalizedIdColumn}" in table.`);
  }
  if (idSpec.typeKind !== "integer") {
    throw new Error(`Id column "${normalizedIdColumn}" must use an integer type.`);
  }
  if (idSpec.nullable) {
    throw new Error(`Id column "${normalizedIdColumn}" must be not-null.`);
  }
  if (!idSpec.autoIncrement && !idSpec.hasDefault) {
    throw new Error(
      `Id column "${normalizedIdColumn}" must be auto_increment or have a database default.`
    );
  }

  return normalizedIdColumn;
}

function requirePrimaryKeyContainsId(primaryKeyColumns, idColumn) {
  if (!Array.isArray(primaryKeyColumns) || !primaryKeyColumns.includes(idColumn)) {
    throw new Error(`Primary key must include id column "${idColumn}".`);
  }
  if (primaryKeyColumns.length !== 1 || primaryKeyColumns[0] !== idColumn) {
    throw new Error(
      `Composite primary keys are not supported for CRUD generation. Primary key must be only "${idColumn}".`
    );
  }
}

async function introspectCrudTableSnapshot(knex, { tableName = "", idColumn = "id" } = {}) {
  requireKnexRaw(knex);
  const resolvedTableName = requireTableName(tableName);

  const schemaRows = normalizeRows(await knex.raw("SELECT DATABASE() AS schemaName"));
  const schemaName = normalizeDbSchemaName(schemaRows);

  const columnRows = normalizeRows(
    await knex.raw(
      `
        SELECT
          c.column_name AS columnName,
          c.data_type AS dataType,
          c.column_type AS columnType,
          c.is_nullable AS isNullable,
          c.column_default AS columnDefault,
          c.extra AS extra,
          c.character_maximum_length AS characterMaximumLength,
          c.numeric_precision AS numericPrecision,
          c.numeric_scale AS numericScale,
          c.datetime_precision AS datetimePrecision,
          c.ordinal_position AS ordinalPosition
        FROM information_schema.columns c
        WHERE c.table_schema = ?
          AND c.table_name = ?
        ORDER BY c.ordinal_position ASC
      `,
      [schemaName, resolvedTableName]
    )
  );
  if (columnRows.length < 1) {
    throw new Error(`Could not introspect table "${resolvedTableName}" in schema "${schemaName}".`);
  }

  const primaryRows = normalizeRows(
    await knex.raw(
      `
        SELECT
          k.column_name AS columnName,
          k.ordinal_position AS ordinalPosition
        FROM information_schema.table_constraints t
        JOIN information_schema.key_column_usage k
          ON k.constraint_name = t.constraint_name
         AND k.table_schema = t.table_schema
         AND k.table_name = t.table_name
        WHERE t.table_schema = ?
          AND t.table_name = ?
          AND t.constraint_type = 'PRIMARY KEY'
        ORDER BY k.ordinal_position ASC
      `,
      [schemaName, resolvedTableName]
    )
  );

  const indexRows = normalizeRows(
    await knex.raw(
      `
        SELECT
          s.index_name AS indexName,
          s.non_unique AS nonUnique,
          s.column_name AS columnName,
          s.seq_in_index AS seqInIndex
        FROM information_schema.statistics s
        WHERE s.table_schema = ?
          AND s.table_name = ?
          AND s.index_name <> 'PRIMARY'
        ORDER BY s.index_name ASC, s.seq_in_index ASC
      `,
      [schemaName, resolvedTableName]
    )
  );

  const columns = Object.freeze(columnRows.map((row) => normalizeColumn(row)));
  const resolvedIdColumn = requireIdColumn(columns, idColumn);
  const primaryKeyColumns = normalizePrimaryKeyColumns(primaryRows);
  requirePrimaryKeyContainsId(primaryKeyColumns, resolvedIdColumn);

  const snapshot = Object.freeze({
    dialect: "mysql2",
    schemaName,
    tableName: resolvedTableName,
    idColumn: resolvedIdColumn,
    primaryKeyColumns,
    hasWorkspaceOwnerColumn: columns.some((column) => column.name === "workspace_owner_id"),
    hasUserOwnerColumn: columns.some((column) => column.name === "user_owner_id"),
    columns,
    indexes: normalizeIndexes(indexRows)
  });

  return snapshot;
}

export { introspectCrudTableSnapshot };
