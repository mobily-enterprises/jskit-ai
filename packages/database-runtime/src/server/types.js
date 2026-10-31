// The types of the database capabilities, for features that require them.

/** @typedef {ReturnType<typeof import("./database.js").createDatabase>} RuntimeDatabase */

/**
 * The `runtime.database.driver` capability: the shared exports of the
 * installed dialect package (`@jskit-ai/database-runtime-mysql` or
 * `@jskit-ai/database-runtime-postgres`). Each driver package implements this
 * contract; `runtime.database` reads its dialect from it.
 * @typedef {object} RuntimeDatabaseDriver
 * @property {string} DIALECT_ID The dialect id: "mysql2" or "pg".
 * @property {() => string} getDialectId
 * @property {(knex: import("knex").Knex, options?: { tableName?: string, idColumn?: string }) => Promise<object>} [introspectCrudTableSnapshot]
 *   Reads a table's columns for CRUD generation; the MySQL driver has it.
 */

export {};
