import knexLib from "knex";
import { requireTestDatabase } from "@jskit-ai/database-runtime/server/testDatabases";

// The connection settings the runtime gives mysql2 (BIGINT as text, DATE as text, UTC).
const RUNTIME_MYSQL = Object.freeze({ supportBigNumbers: true, bigNumberStrings: true, dateStrings: ["DATE"], timezone: "Z" });

/**
 * A MariaDB/MySQL database of the test's own beside TEST_DB_NAME, dropped after the test. Every connection runs with
 * MariaDB's innodb_snapshot_isolation off, the MariaDB 11.4 default (11.6 turns it on), so a test reads InnoDB's
 * REPEATABLE READ as every supported server does by default; a server without the setting (MySQL) needs nothing.
 * @param {import("node:test").TestContext} context
 * @param {string} suffix The database's name after TEST_DB_NAME's.
 */
async function ownMysqlDatabase(context, suffix) {
  const name = `${requireTestDatabase(process.env)}_${suffix}`;
  const server = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER, password: process.env.DB_PASSWORD };
  const admin = knexLib({ client: "mysql2", connection: server, pool: { min: 0, max: 1 } });
  const [variables] = await admin.raw("SHOW VARIABLES LIKE 'innodb_snapshot_isolation'");
  await admin.raw("DROP DATABASE IF EXISTS ??", [name]);
  await admin.raw("CREATE DATABASE ??", [name]);
  const setting = variables.length === 0 ? null : "SET SESSION innodb_snapshot_isolation = OFF";
  const knex = knexLib({
    client: "mysql2",
    connection: { ...server, database: name, ...RUNTIME_MYSQL },
    pool: { min: 0, max: 6, ...(setting ? { afterCreate: (connection, done) => connection.query(setting, (error) => done(error, connection)) } : {}) }
  });
  context.after(async () => {
    await knex.destroy();
    await admin.raw("DROP DATABASE IF EXISTS ??", [name]);
    await admin.destroy();
  });
  return knex;
}

export { ownMysqlDatabase };
