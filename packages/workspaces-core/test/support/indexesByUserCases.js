import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import knexLib from "knex";
import { requireTestDatabase } from "@jskit-ai/database-runtime/server/testDatabases";
import { startTestFeatures } from "@jskit-ai/resource-runtime/test";
import { UsersExtensionsProvider } from "@jskit-ai/users-core/server/UsersExtensionsProvider";
import { UsersIdentityProvider } from "@jskit-ai/users-core/server/UsersIdentityProvider";
import usersInitial from "../../../users-core/migrations/users_core_generic_initial.cjs";
import usersUsername from "../../../users-core/migrations/users_core_profile_username.cjs";
import usersUpdatedAt from "../../../users-core/migrations/users_core_profile_updated_at.cjs";
import indexesByUser from "../../migrations/workspaces_core_indexes_by_user.cjs";
import workspacesInitial from "../../migrations/workspaces_core_initial.cjs";
import workspaceSettingsMigration from "../../migrations/workspaces_core_workspace_settings_single_name_source.cjs";
import workspaceColorMigration from "../../migrations/workspaces_core_workspaces_drop_color.cjs";
import { WorkspaceRecordsFeature } from "../../src/test/WorkspaceRecordsFeature.js";

// A person's workspaces are read through an index on every dialect: the statements workspaces.listForUserId (their
// memberships by user_id) and workspaces.findPersonalByOwnerUserId (their workspaces by owner_user_id) send, explained
// by the database's own planner. On SQLite and PostgreSQL the indexes are workspaces_core_indexes_by_user's; on
// MariaDB/MySQL they are the ones InnoDB made for the foreign keys, and the migration changes nothing.

const EARLIER_MIGRATIONS = [usersInitial, usersUsername, usersUpdatedAt, workspacesInitial, workspaceSettingsMigration, workspaceColorMigration];
const PEOPLE = 60;
// The index each read uses, by dialect: the migration's own, or InnoDB's for the foreign key.
const READS = Object.freeze({
  memberships: { table: "workspace_memberships", column: "user_id", sqlite: "ix_workspace_memberships_user", postgres: "ix_workspace_memberships_user", mysql: "workspace_memberships_user_id_foreign" },
  owned: { table: "workspaces", column: "owner_user_id", sqlite: "ix_workspaces_owner", postgres: "ix_workspaces_owner", mysql: "workspaces_owner_user_id_foreign" }
});
// The migration directories of users-core and workspaces-core, in the order an application migrates them, each in
// file name order, as createKnexMigrationConfig has Knex run them.
const MIGRATION_DIRECTORIES = ["../../../users-core/migrations", "../../migrations"]
  .map((directory) => fileURLToPath(new URL(directory, import.meta.url)));
const DIRECTORY_MIGRATIONS = Object.freeze({ directory: MIGRATION_DIRECTORIES, extension: "cjs", sortDirsSeparately: true });
const INDEXES_BY_USER = "workspaces_core_indexes_by_user.cjs";
const PERSON_INDEXES = "workspaces_core_person_indexes.cjs";
const require = createRequire(import.meta.url);

// Each index of `table` with its columns in order.
async function indexColumns(knex, dialect, table) {
  const columns = new Map();
  const add = (name, column) => columns.set(name, [...(columns.get(name) ?? []), column]);
  if (dialect === "sqlite") {
    for (const { name } of await knex.raw("pragma index_list(??)", [table])) {
      for (const { name: column } of await knex.raw("pragma index_info(??)", [name])) add(name, column);
    }
  } else if (dialect === "postgres") {
    const { rows } = await knex.raw(
      `select index.relname as name, attribute.attname as column from pg_index entry
         join pg_class index on index.oid = entry.indexrelid join pg_class source on source.oid = entry.indrelid
         join pg_namespace space on space.oid = source.relnamespace
         cross join lateral unnest(entry.indkey) with ordinality as key(number, position)
         join pg_attribute attribute on attribute.attrelid = source.oid and attribute.attnum = key.number
        where source.relname = ? and space.nspname = current_schema() order by index.relname, key.position`,
      [table]
    );
    for (const { name, column } of rows) add(name, column);
  } else {
    const [rows] = await knex.raw("show index from ??", [table]);
    for (const row of rows.sort((left, right) => left.Seq_in_index - right.Seq_in_index)) add(row.Key_name, row.Column_name);
  }
  return columns;
}

// The indexes of `table` on `column` alone.
async function indexesOn(knex, dialect, table, column) {
  const indexes = [...(await indexColumns(knex, dialect, table))];
  return indexes.filter(([, columns]) => columns.length === 1 && columns[0] === column).map(([name]) => name);
}

// The migrations of a database made before workspaces_core_indexes_by_user existed and then upgraded to the release
// that added it: every other migration of both directories in Knex's order, then that one. The migrations are named
// by their files, as Knex names a directory's, so a later run on the directories finds them run.
function upgradedDatabaseMigrations() {
  const files = MIGRATION_DIRECTORIES.flatMap((directory) =>
    readdirSync(directory).filter((file) => file.endsWith(".cjs")).sort().map((file) => ({ directory, file })));
  return {
    getMigrations: async () => [
      ...files.filter(({ file }) => file !== INDEXES_BY_USER && file !== PERSON_INDEXES),
      files.find(({ file }) => file === INDEXES_BY_USER)
    ],
    getMigrationName: ({ file }) => file,
    getMigration: async ({ directory, file }) => require(path.join(directory, file))
  };
}

// The indexes the planner reads for one captured statement. PostgreSQL's planner is told to avoid whole-table scans,
// which it prefers for tables this small, so its plan shows whether an index can serve the statement.
async function indexesUsed(knex, dialect, { sql, bindings }) {
  if (dialect === "sqlite") {
    const plan = await knex.raw(`explain query plan ${sql}`, bindings);
    return plan.map(({ detail }) => /USING (?:COVERING )?INDEX (\S+)/u.exec(detail)?.[1]).filter(Boolean);
  }
  if (dialect === "postgres") {
    return knex.transaction(async (trx) => {
      await trx.raw("set local enable_seqscan = off");
      const { rows } = await trx.raw(`explain (format json) ${sql.replace(/\$\d+/gu, "?")}`, bindings);
      const names = [];
      const visit = (node) => {
        if (node["Index Name"]) names.push(node["Index Name"]);
        for (const child of node.Plans ?? []) visit(child);
      };
      visit(rows[0]["QUERY PLAN"][0].Plan);
      return names;
    });
  }
  const [plan] = await knex.raw(`explain ${sql}`, bindings);
  return plan.map(({ key }) => key).filter(Boolean);
}

// The statement `read` sends that filters `table` by `column`.
async function statementOf(knex, table, column, read) {
  const sent = [];
  const listener = (query) => sent.push(query);
  knex.on("query", listener);
  try {
    await read();
  } finally {
    knex.removeListener("query", listener);
  }
  const filter = new RegExp(`\\b${table}\\b[\\s\\S]*\\bwhere\\b[\\s\\S]*\\b${column}\\b`, "u");
  const statement = sent.find(({ sql }) => filter.test(sql));
  assert.ok(statement, `a statement reading ${table} by ${column}, among: ${sent.map(({ sql }) => sql).join(" | ")}`);
  return statement;
}

// PEOPLE people, each owning a personal workspace and a member of the next person's too.
async function seed(knex) {
  const tag = (number) => `byuser-${number}`;
  await knex.batchInsert("users", Array.from({ length: PEOPLE }, (_, number) => ({
    auth_provider: "local", auth_provider_user_sid: tag(number), email: `${tag(number)}@example.test`, username: tag(number), display_name: tag(number)
  })), 100);
  const users = await knex("users").select("id", "username").orderBy("id");
  await knex.batchInsert("workspaces", users.map(({ id, username }) => ({ slug: username, name: username, owner_user_id: id, is_personal: true })), 100);
  const workspaces = await knex("workspaces").select("id", "owner_user_id").orderBy("id");
  await knex.batchInsert("workspace_memberships", workspaces.flatMap(({ id }, number) => [
    { workspace_id: id, user_id: workspaces[number].owner_user_id, role_sid: "owner", status: "active" },
    { workspace_id: id, user_id: workspaces[(number + 1) % PEOPLE].owner_user_id, role_sid: "member", status: "active" }
  ]), 100);
  return users[PEOPLE / 2].id;
}

/**
 * Registers the test on the database `open(t)` answers: an empty Knex connection of the test's own, dropped after it.
 * @param {(t: import("node:test").TestContext) => Promise<import("knex").Knex>} open
 * @param {{ dialect: "sqlite" | "postgres" | "mysql", database?: boolean, skip?: string | false }} options
 */
function indexesByUserCases(open, { dialect, database = true, skip = false }) {
  test(`a person's memberships and owned workspaces are read through an index (${dialect})`, { skip }, async (t) => {
    if (database) requireTestDatabase(process.env);
    const knex = await open(t);
    for (const migration of EARLIER_MIGRATIONS) await migration.up(knex);
    await indexesByUser.up(knex);
    const person = await seed(knex);
    if (dialect === "postgres") await knex.raw("analyze");
    const { capabilities, stop } = await startTestFeatures({
      knex,
      features: [WorkspaceRecordsFeature, UsersIdentityProvider, UsersExtensionsProvider],
      requires: { workspaces: "workspaces" }
    });
    t.after(stop);
    const reads = {
      memberships: async () => assert.equal((await capabilities.workspaces.listForUserId(person)).length, 2),
      owned: async () => assert.equal((await capabilities.workspaces.findPersonalByOwnerUserId(person)).ownerUserId, String(person))
    };

    for (const [read, { table, column, [dialect]: index }] of Object.entries(READS)) {
      assert.deepEqual((await indexColumns(knex, dialect, table)).get(index), [column], `${index} indexes ${table}.${column}`);
      const statement = await statementOf(knex, table, column, reads[read]);
      assert.ok((await indexesUsed(knex, dialect, statement)).includes(index), `${statement.sql} reads ${index}`);
    }

    // Applied again, it changes nothing; taken back, the migration's own indexes go and InnoDB's stay.
    await indexesByUser.up(knex);
    await indexesByUser.down(knex);
    for (const { table, [dialect]: index } of Object.values(READS)) {
      assert.equal((await indexColumns(knex, dialect, table)).has(index), dialect === "mysql", `${index} after down`);
    }
  });
}

/**
 * Registers the tests of the migrations as Knex runs them, on the empty database `open(t)` answers: a new database
 * migrated from nothing, and one that ran workspaces_core_indexes_by_user after workspaces_core_initial. Each ends with
 * `ix_workspace_memberships_user` and `ix_workspaces_owner` (InnoDB's foreign key indexes on MariaDB/MySQL), each the
 * one index on its column.
 * @param {(t: import("node:test").TestContext) => Promise<import("knex").Knex>} open
 * @param {{ dialect: "sqlite" | "postgres" | "mysql", database?: boolean, skip?: string | false }} options
 */
function migrationOrderCases(open, { dialect, database = true, skip = false }) {
  async function indexedOnce(knex) {
    for (const { table, column, [dialect]: index } of Object.values(READS)) {
      assert.deepEqual(await indexesOn(knex, dialect, table, column), [index], `${table}.${column} has one index, ${index}`);
    }
  }

  test(`a new database migrated in Knex's order has a person's indexes (${dialect})`, { skip }, async (t) => {
    if (database) requireTestDatabase(process.env);
    const knex = await open(t);
    await knex.migrate.latest(DIRECTORY_MIGRATIONS);
    await indexedOnce(knex);
    // Rolled back in the reverse order, workspaces_core_person_indexes takes the indexes back before the tables go and
    // workspaces_core_indexes_by_user, last, finds nothing to drop.
    await knex.migrate.rollback(DIRECTORY_MIGRATIONS, true);
    assert.equal(await knex.schema.hasTable("workspace_memberships"), false);
  });

  test(`a database that ran ${INDEXES_BY_USER} after the tables keeps its indexes, once (${dialect})`, { skip }, async (t) => {
    if (database) requireTestDatabase(process.env);
    const knex = await open(t);
    await knex.migrate.latest({ migrationSource: upgradedDatabaseMigrations() });
    await indexedOnce(knex);
    const [, ran] = await knex.migrate.latest(DIRECTORY_MIGRATIONS);
    assert.deepEqual(ran, [PERSON_INDEXES]);
    await indexedOnce(knex);
  });
}

/** An in-memory SQLite database. */
async function openSqlite(t) {
  const knex = knexLib({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  t.after(() => knex.destroy());
  return knex;
}

function serverOf(defaultPort) {
  return { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || defaultPort, user: process.env.DB_USER, password: process.env.DB_PASSWORD };
}

/** A MariaDB/MySQL database named after TEST_DB_NAME with `suffix`, made for the test and dropped after it. */
function openMysql(suffix) {
  return async (t) => {
    const name = `${requireTestDatabase(process.env)}_${suffix}`;
    const server = { ...serverOf(3306), supportBigNumbers: true, bigNumberStrings: true, dateStrings: ["DATE"], timezone: "Z" };
    const admin = knexLib({ client: "mysql2", connection: server, pool: { min: 0, max: 1 } });
    const knex = knexLib({ client: "mysql2", connection: { ...server, database: name }, pool: { min: 0, max: 4 } });
    t.after(async () => {
      try {
        await knex.destroy();
        await admin.raw("DROP DATABASE IF EXISTS ??", [name]);
      } finally {
        await admin.destroy();
      }
    });
    await admin.raw("DROP DATABASE IF EXISTS ??", [name]);
    await admin.raw("CREATE DATABASE ??", [name]);
    return knex;
  };
}

/** A PostgreSQL schema in TEST_DB_NAME named after it with `suffix`, made for the test and dropped after it. */
function openPostgres(suffix) {
  return async (t) => {
    const database = requireTestDatabase(process.env);
    const schema = `${database}_${suffix}_${process.pid}`;
    const connection = { ...serverOf(5432), database };
    const admin = knexLib({ client: "pg", connection, pool: { min: 0, max: 1 } });
    const knex = knexLib({ client: "pg", connection, searchPath: [schema], pool: { min: 0, max: 4 } });
    t.after(async () => {
      try {
        await knex.destroy();
        await admin.raw("DROP SCHEMA IF EXISTS ?? CASCADE", [schema]);
      } finally {
        await admin.destroy();
      }
    });
    await admin.raw("DROP SCHEMA IF EXISTS ?? CASCADE", [schema]);
    await admin.raw("CREATE SCHEMA ??", [schema]);
    return knex;
  };
}

// A PostgreSQL test on a run for another database, such as CI's MariaDB run, is left to the PostgreSQL run.
const POSTGRES_ELSEWHERE = process.env.DB_CLIENT && process.env.DB_CLIENT !== "pg"
  ? `a PostgreSQL test, on a ${process.env.DB_CLIENT} run`
  : false;

export { POSTGRES_ELSEWHERE, indexesByUserCases, migrationOrderCases, openMysql, openPostgres, openSqlite };
