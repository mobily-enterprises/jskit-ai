import { detectDialectFromClient } from "../shared/dialect.js";

/**
 * A single-column foreign key that a constraints migration adds once its parent table exists.
 * @typedef {object} ForeignKey
 * @property {string} tableName
 * @property {string} columnName
 * @property {string} parentTable
 * @property {string} [parentColumn] Defaults to "id".
 * @property {string} [name] Defaults to Knex's `<table>_<column>_foreign`.
 * @property {string} [onDelete]
 * @property {string} [onUpdate]
 */

/**
 * The name of the foreign key that links the column to the parent column, whatever that name is,
 * or null when no key does. SQLite keys have no name, so a SQLite key's is "".
 * @param {import("./types.js").RuntimeKnex} knex
 * @param {ForeignKey} key
 * @returns {Promise<string | null>}
 */
async function findForeignKeyName(knex, { tableName, columnName, parentTable, parentColumn = "id" }) {
  const dialect = detectDialectFromClient(knex);
  if (dialect === "mysql") {
    const row = await knex("information_schema.KEY_COLUMN_USAGE")
      .whereRaw("TABLE_SCHEMA = DATABASE()")
      .where({
        TABLE_NAME: tableName,
        COLUMN_NAME: columnName,
        REFERENCED_TABLE_NAME: parentTable,
        REFERENCED_COLUMN_NAME: parentColumn
      })
      .first("CONSTRAINT_NAME");
    return row ? row.CONSTRAINT_NAME : null;
  }
  if (dialect === "postgres") {
    const { rows } = await knex.raw(
      `SELECT c.conname FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
         JOIN pg_attribute p ON p.attrelid = c.confrelid AND p.attnum = c.confkey[1]
        WHERE c.contype = 'f' AND cardinality(c.conkey) = 1
          AND c.conrelid = to_regclass(?) AND c.confrelid = to_regclass(?)
          AND a.attname = ? AND p.attname = ?`,
      [tableName, parentTable, columnName, parentColumn]
    );
    return rows.length > 0 ? rows[0].conname : null;
  }
  if (dialect.includes("sqlite")) {
    const keys = await knex.raw("PRAGMA foreign_key_list(??)", [tableName]);
    return keys.some((key) => key.table === parentTable && key.from === columnName && key.to === parentColumn)
      ? ""
      : null;
  }
  throw new Error(`Foreign key migrations do not support the ${dialect || "unknown"} dialect.`);
}

/**
 * Whether a foreign key already links the column to the parent column, whatever its name.
 * @param {import("./types.js").RuntimeKnex} knex
 * @param {ForeignKey} key
 */
async function hasForeignKey(knex, key) {
  return (await findForeignKeyName(knex, key)) !== null;
}

/**
 * Adds the foreign key unless it already exists, so a constraints migration runs on a fresh
 * database and on one an earlier migration already gave the key. Refuses, naming the table, column
 * and count, when rows have no parent; it never deletes data.
 * @param {import("./types.js").RuntimeKnex} knex
 * @param {ForeignKey} key
 * @returns {Promise<boolean>} Whether it added the key.
 */
async function addMissingForeignKey(knex, key) {
  const { tableName, columnName, parentTable, parentColumn = "id", name, onDelete, onUpdate } = key;
  if (await hasForeignKey(knex, key)) {
    return false;
  }
  if (!(await knex.schema.hasTable(parentTable))) {
    throw new Error(`Cannot add the ${tableName}.${columnName} foreign key: the ${parentTable} table does not exist.`);
  }
  const [{ orphans }] = await knex(tableName)
    .whereNotNull(columnName)
    .whereNotExists(
      knex(parentTable).select(knex.raw("1")).whereRaw("??.?? = ??.??", [parentTable, parentColumn, tableName, columnName])
    )
    .count({ orphans: "*" });
  if (Number(orphans) > 0) {
    throw new Error(
      `Cannot add the ${tableName}.${columnName} foreign key to ${parentTable}.${parentColumn}: ` +
      `${orphans} ${tableName} row(s) have a ${columnName} with no ${parentTable} row. ` +
      "Repair or remove those rows, then migrate again; the migration deletes nothing."
    );
  }
  await knex.schema.alterTable(tableName, (table) => {
    const reference = table.foreign(columnName, name).references(parentColumn).inTable(parentTable);
    if (onDelete) reference.onDelete(onDelete);
    if (onUpdate) reference.onUpdate(onUpdate);
  });
  return true;
}

/**
 * Drops the foreign key when it exists, for a constraints migration's down().
 * @param {import("./types.js").RuntimeKnex} knex
 * @param {ForeignKey} key
 * @returns {Promise<boolean>} Whether it dropped the key.
 */
async function dropForeignKeyIfPresent(knex, key) {
  const name = await findForeignKeyName(knex, key);
  if (name === null) {
    return false;
  }
  // Knex's SQLite table rebuild finds the key by its column (its name is ""); the others drop it by
  // the name the database holds, which may differ from key.name.
  await knex.schema.alterTable(key.tableName, (table) => {
    table.dropForeign(key.columnName, name || undefined);
  });
  return true;
}

// Every foreign key of the connected database's tables, one row per column: the key's name, its table and column,
// the referenced table and column, and the column's place in the key. Keys to another schema are left out.
const FOREIGN_KEY_COLUMNS = Object.freeze({
  mysql: `SELECT CONSTRAINT_NAME AS name, TABLE_NAME AS tableName, COLUMN_NAME AS columnName,
      REFERENCED_TABLE_NAME AS referencedTableName, REFERENCED_COLUMN_NAME AS referencedColumnName
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_SCHEMA = DATABASE()
    ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`,
  postgres: `SELECT c.conname AS name, t.relname AS "tableName", a.attname AS "columnName",
      r.relname AS "referencedTableName", p.attname AS "referencedColumnName"
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_class r ON r.oid = c.confrelid
    CROSS JOIN LATERAL unnest(c.conkey, c.confkey) WITH ORDINALITY AS k(attnum, refnum, position)
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
    JOIN pg_attribute p ON p.attrelid = c.confrelid AND p.attnum = k.refnum
    WHERE c.contype = 'f' AND t.relnamespace = to_regnamespace(current_schema()) AND r.relnamespace = t.relnamespace
    ORDER BY t.relname, c.conname, k.position`,
  // SQLite keys have no name: each is told apart by its table and id.
  sqlite: `SELECT m.name || '#' || k.id AS name, m.name AS tableName, k."from" AS columnName,
      k."table" AS referencedTableName, k."to" AS referencedColumnName
    FROM sqlite_master m JOIN pragma_foreign_key_list(m.name) k
    WHERE m.type = 'table'
    ORDER BY m.name, k.id, k.seq`
});

// The rows of a raw statement, as each driver answers them.
const RAW_ROWS = Object.freeze({
  mysql: ([rows]) => rows,
  postgres: ({ rows }) => rows,
  sqlite: (rows) => rows
});

/**
 * The foreign keys the connected database holds, each with its table, its columns in order, and the table and
 * columns it references. A SQLite key's name is "", since SQLite keeps none.
 * @param {import("./types.js").RuntimeKnex} knex
 * @returns {Promise<Array<{ name: string, tableName: string, columns: string[], referencedTableName: string, referencedColumns: string[] }>>}
 */
async function listForeignKeys(knex) {
  const detected = detectDialectFromClient(knex);
  const dialect = detected.includes("sqlite") ? "sqlite" : detected;
  if (!Object.hasOwn(FOREIGN_KEY_COLUMNS, dialect)) {
    throw new Error(`Listing foreign keys does not support the ${detected || "unknown"} dialect.`);
  }
  const keys = new Map();
  for (const row of RAW_ROWS[dialect](await knex.raw(FOREIGN_KEY_COLUMNS[dialect]))) {
    const id = `${row.tableName}\u0000${row.name}`;
    if (!keys.has(id)) {
      keys.set(id, {
        name: dialect === "sqlite" ? "" : row.name,
        tableName: row.tableName,
        columns: [],
        referencedTableName: row.referencedTableName,
        referencedColumns: []
      });
    }
    keys.get(id).columns.push(row.columnName);
    keys.get(id).referencedColumns.push(row.referencedColumnName);
  }
  return [...keys.values()];
}

export { addMissingForeignKey, dropForeignKeyIfPresent, hasForeignKey, listForeignKeys };
