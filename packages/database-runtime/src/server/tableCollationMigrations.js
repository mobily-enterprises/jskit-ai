import { detectDialectFromClient } from "../shared/dialect.js";
import { addMissingForeignKey, hasForeignKey } from "./foreignKeyMigrations.js";

// MySQL and MariaDB create a table without a character set or collation of its own in the database's default. A
// database restored onto a server with another default keeps its tables' collation, so a package migration that
// creates a table there made it in another collation than the tables it joins, and MariaDB refused a key between
// them (errno 150), leaving the new table behind, empty and unrecorded. These helpers create a migration's tables in
// the collation of the tables already there, and repair what the database's default left.

// A collation name as information_schema gives it; its character set is the part before the first "_" ("binary"
// has none), and Knex writes both into its SQL as they are.
const COLLATION_NAME = /^[a-z0-9]+(?:_[a-z0-9]+)*$/u;

// The character sets whose every character the key holds, so converting a table's text to it loses none.
const HOLDS_EVERY_CHARACTER_OF = Object.freeze({
  utf8mb4: Object.freeze(["utf8mb4", "utf8mb3", "utf8", "latin1", "ascii"])
});

/**
 * A collation and its character set.
 * @typedef {object} TableCollation
 * @property {string} collation
 * @property {string} charset
 */

/**
 * The collation of a table, and the character sets of its text columns.
 * @typedef {object} TableState
 * @property {string} collation
 * @property {string[]} charsets
 */

/**
 * A collation and the character set its name starts with.
 * @param {string} collation
 * @returns {TableCollation}
 */
function collationNamed(collation) {
  if (!COLLATION_NAME.test(collation)) {
    throw new Error(`Unexpected collation name ${JSON.stringify(collation)} in information_schema.`);
  }
  return Object.freeze({
    collation,
    charset: collation.split("_")[0]
  });
}

/**
 * The collation of each of the tables that exists in the connected database, and its text columns' character sets.
 * @param {import("./types.js").RuntimeKnex} knex
 * @param {readonly string[]} tableNames
 * @returns {Promise<Map<string, TableState>>}
 */
async function tableStates(knex, tableNames) {
  const tables = await knex("information_schema.TABLES")
    .whereRaw("TABLE_SCHEMA = DATABASE()")
    .where({ TABLE_TYPE: "BASE TABLE" })
    .whereIn("TABLE_NAME", tableNames)
    .select({ tableName: "TABLE_NAME", collation: "TABLE_COLLATION" });
  const columns = await knex("information_schema.COLUMNS")
    .whereRaw("TABLE_SCHEMA = DATABASE()")
    .whereNotNull("CHARACTER_SET_NAME")
    .whereIn("TABLE_NAME", tableNames)
    .distinct({ tableName: "TABLE_NAME", charset: "CHARACTER_SET_NAME" });
  return new Map(tables.map(({ tableName, collation }) => [tableName, Object.freeze({
    collation,
    charsets: columns.filter((column) => column.tableName === tableName).map((column) => column.charset)
  })]));
}

/**
 * Whether Knex has recorded the migration as run.
 * @param {import("./types.js").RuntimeKnex} knex
 * @param {string} migration The migration's file name, as Knex records it.
 */
async function isRecorded(knex, migration) {
  const ledger = knex.client.config.migrations?.tableName || "knex_migrations";
  if (!(await knex.schema.hasTable(ledger))) {
    return false;
  }
  return Boolean(await knex(ledger).where({ name: migration }).first("name"));
}

/**
 * Whether the table holds no row.
 * @param {import("./types.js").RuntimeKnex} knex
 * @param {string} tableName
 */
async function isEmpty(knex, tableName) {
  return !(await knex(tableName).first(knex.raw("1 AS present")));
}

/**
 * A Knex that is `knex` in every way, except that each table its schema builder creates has the collation.
 * @param {import("./types.js").RuntimeKnex} knex
 * @param {TableCollation} collation
 * @returns {import("./types.js").RuntimeKnex}
 */
function creatingTablesIn(knex, { collation, charset }) {
  return new Proxy(knex, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (property !== "schema") {
        return value;
      }
      // Each read of knex.schema is a new builder, so changing this one changes no other.
      const createTable = value.createTable;
      value.createTable = function createTableInCollation(tableName, build) {
        return createTable.call(this, tableName, function buildInCollation(table) {
          table.charset(charset);
          table.collate(collation);
          return build.call(this, table);
        });
      };
      return value;
    }
  });
}

/**
 * Converts a table to the collation when no stored character can be lost: its text columns are all in a character
 * set the target holds, or it has no row. Otherwise it refuses and changes nothing.
 * @param {import("./types.js").RuntimeKnex} knex
 * @param {string} tableName
 * @param {TableState} state
 * @param {TableCollation} target
 */
async function convertTable(knex, tableName, state, { collation, charset }) {
  const holds = HOLDS_EVERY_CHARACTER_OF[charset] || [charset];
  const lossy = state.charsets.filter((columnCharset) => !holds.includes(columnCharset));
  if (lossy.length > 0 && !(await isEmpty(knex, tableName))) {
    throw new Error(
      `Cannot convert ${tableName} from ${state.collation} to ${collation}: it holds rows in ${lossy.join(", ")}, ` +
      `which ${charset} may not hold. Convert it by hand after a backup, then migrate again; the migration changed nothing.`
    );
  }
  await knex.raw(`ALTER TABLE ?? CONVERT TO CHARACTER SET ${charset} COLLATE ${collation}`, [tableName]);
}

/**
 * A table of a recorded migration: converted to the reference collation when it has another, then given each of its
 * keys it lacks.
 * @param {import("./types.js").RuntimeKnex} knex
 * @param {string} tableName
 * @param {TableState} state
 * @param {TableCollation} reference
 * @param {readonly import("./foreignKeyMigrations.js").ForeignKey[]} keys
 */
async function repairRecordedTable(knex, tableName, state, reference, keys) {
  if (state.collation !== reference.collation) {
    await convertTable(knex, tableName, state, reference);
  }
  for (const key of keys) {
    await addMissingForeignKey(knex, key);
  }
}

/**
 * A table of a migration Knex has not recorded that lacks one of its keys is what a refused key left: dropped when it
 * holds no row, so the migration creates it again, and refused with rows. A table with its keys is left as it is.
 * @param {import("./types.js").RuntimeKnex} knex
 * @param {string} migration
 * @param {string} tableName
 * @param {readonly import("./foreignKeyMigrations.js").ForeignKey[]} keys
 */
async function dropTableLeftWithoutKey(knex, migration, tableName, keys) {
  const missing = [];
  for (const key of keys) {
    if (!(await hasForeignKey(knex, key))) missing.push(key);
  }
  if (missing.length === 0) {
    return;
  }
  if (!(await isEmpty(knex, tableName))) {
    throw new Error(
      `${tableName} holds rows but has no foreign key to ${missing.map((key) => key.parentTable).join(", ")}, and ` +
      `${migration} has not run. Back up and repair ${tableName} by hand, then migrate again; the migration changed nothing.`
    );
  }
  await knex.schema.dropTable(tableName);
}

/**
 * Runs a migration that creates tables, on MySQL and MariaDB, with each table it creates in the character set and
 * collation of the first of `referenceTables` that exists, instead of the database's default. A released migration is
 * run this way by a companion file named after it with "-collation" (`<name>-collation.cjs`): Knex sorts that file
 * just before the released one, runs it on every database that has not run it yet, and the released migration then
 * finds its tables in place and skips creating them. A new migration can call it with its own name and `up`.
 *
 * Before that, it repairs what the database's default left, each only in the state it measures, and changes nothing
 * on a database whose tables are all in place, in the reference collation, with their keys:
 * - a table of the migration that Knex has not recorded, that holds no row and lacks one of its `foreignKeys`, is
 *   what a refused key left: it is dropped, and created again. A table with rows in that state is refused.
 * - a table of a migration Knex has recorded, in another collation, is converted to the reference collation when no
 *   character can be lost (`convertTable`), and then gains any of its `foreignKeys` it lacks (`addMissingForeignKey`,
 *   which refuses rows without a parent).
 *
 * On other databases, or before any of `referenceTables` exists, it does nothing and the migration runs as released.
 * @param {import("./types.js").RuntimeKnex} knex The migration's Knex or transaction.
 * @param {object} options
 * @param {string} options.migration The released migration's file name, as Knex records it.
 * @param {(knex: import("./types.js").RuntimeKnex) => Promise<unknown>} options.up The released migration's `up`.
 * @param {readonly string[]} options.tables The tables the released migration creates.
 * @param {readonly string[]} options.referenceTables The tables whose collation new tables take, the first that exists.
 * @param {readonly import("./foreignKeyMigrations.js").ForeignKey[]} [options.foreignKeys] The keys the released
 *   migration creates with its tables to tables created before it, which a different collation made MariaDB refuse.
 */
async function migrateInExistingCollation(knex, { migration, up, tables, referenceTables, foreignKeys = [] }) {
  if (detectDialectFromClient(knex) !== "mysql") {
    return;
  }
  const references = await tableStates(knex, referenceTables);
  const referenceTable = referenceTables.find((tableName) => references.has(tableName));
  if (!referenceTable) {
    return;
  }
  const reference = collationNamed(references.get(referenceTable).collation);
  const recorded = await isRecorded(knex, migration);
  const states = await tableStates(knex, tables);

  for (const tableName of tables.filter((name) => states.has(name))) {
    const keys = foreignKeys.filter((key) => key.tableName === tableName);
    if (recorded) {
      await repairRecordedTable(knex, tableName, states.get(tableName), reference, keys);
    } else {
      await dropTableLeftWithoutKey(knex, migration, tableName, keys);
    }
  }

  if (!recorded) {
    await up(creatingTablesIn(knex, reference));
  }
}

export { migrateInExistingCollation };
