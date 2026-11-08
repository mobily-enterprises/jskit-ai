import { listForeignKeys } from "@jskit-ai/database-runtime/server/foreignKeyMigrations";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createResourceHost } from "./resourceHost.js";
import { createResourceRuntime } from "./resourceRuntime.js";

/** @typedef {{ tableName: string, columns: string[], referencedTableName: string, referencedColumns: string[] }} ForeignKeyColumns */

const sameNames = (left, right) => left.length === right.length && left.every((name, index) => name === right[index]);
const sameKey = (left, right) => left.tableName === right.tableName && left.referencedTableName === right.referencedTableName &&
  sameNames(left.columns, right.columns) && sameNames(left.referencedColumns, right.referencedColumns);

/**
 * Each resource's declared foreignKeys in database columns, its fields mapped as json-rest-api stores them.
 * @param {import("knex").Knex} knex
 * @param {ReadonlyArray<Record<string, any>>} resources
 */
async function declaredForeignKeys(knex, resources) {
  const declaring = resources.filter((resource) => resource.foreignKeys);
  if (declaring.length < 1) {
    return [];
  }
  const api = await createResourceHost({ knex, logger: silentLogger });
  await createResourceRuntime({ api }).own("jskit.foreign-key-check", declaring);
  return declaring.flatMap((resource) => {
    const adapter = api.knex.helpers.getStorageAdapter(resource.name);
    const column = (field) => (field === "id" ? adapter.getIdColumn() : adapter.translateColumn(field));
    return resource.foreignKeys.map((declared) => Object.freeze({
      resource: resource.name,
      declared,
      tableName: resource.tableName,
      columns: declared.columns.map(column),
      referencedTableName: declared.referencedTableName,
      referencedColumns: declared.referencedColumns ?? ["id"]
    }));
  });
}

/**
 * Compares the table resources' declared foreignKeys with the keys the connected database holds. json-rest-api relies
 * on a declared key to skip work, so a declared key the database lacks changes results: it is `missing`, and the
 * check fails on it. A database key on one of `tables` that nothing declares is `undeclared`: only work json-rest-api
 * could have skipped. It reads the database, so it runs where one already exists, as `jskit test --databases` does,
 * never at boot.
 * @param {object} options
 * @param {import("knex").Knex} options.knex
 * @param {ReadonlyArray<Record<string, any>>} options.resources Table resources; those declaring foreignKeys are checked.
 * @param {ReadonlyArray<string>} [options.tables] The tables whose undeclared keys are reported.
 */
async function checkForeignKeys({ knex, resources, tables = [] }) {
  const [declared, databaseKeys] = await Promise.all([declaredForeignKeys(knex, resources), listForeignKeys(knex)]);
  const reported = new Set(tables);
  return Object.freeze({
    missing: declared.filter((key) => !databaseKeys.some((real) => sameKey(key, real))),
    undeclared: databaseKeys.filter((real) => reported.has(real.tableName) && !declared.some((key) => sameKey(key, real)))
  });
}

export { checkForeignKeys };
