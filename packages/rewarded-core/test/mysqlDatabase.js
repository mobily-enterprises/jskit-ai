import assert from "node:assert/strict";
import knexLib from "knex";

/**
 * A MySQL database of the test file's own beside REWARDED_TEST_DATABASE_URL's, named after it with the file's
 * suffix, so the package's database files can run in parallel. dropDatabase() removes it after the test.
 * @param {string} databaseUrl
 * @param {string} suffix
 * @param {Record<string, unknown>} [connectionOptions]
 */
async function openOwnDatabase(databaseUrl, suffix, connectionOptions = {}) {
  const url = new URL(databaseUrl);
  assert.equal(url.protocol, "mysql:", "Rewarded shipped migrations require MySQL.");
  assert.match(url.pathname, /^\/jskit_rewarded_test_[a-z0-9_]+$/u, "Use an owned disposable rewarded test database.");
  const server = {
    host: url.hostname,
    port: Number(url.port) || 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ...(url.searchParams.has("socketPath") ? { socketPath: url.searchParams.get("socketPath") } : {}),
    ...connectionOptions
  };
  const database = `${url.pathname.slice(1)}_${suffix}`;
  const admin = knexLib({ client: "mysql2", connection: { ...server, database: url.pathname.slice(1) }, pool: { min: 1, max: 1 } });
  await admin.raw("DROP DATABASE IF EXISTS ??", [database]);
  await admin.raw("CREATE DATABASE ??", [database]);
  const knex = knexLib({ client: "mysql2", connection: { ...server, database }, pool: { min: 1, max: 1 } });
  async function dropDatabase() {
    try {
      await admin.raw("DROP DATABASE IF EXISTS ??", [database]);
    } finally {
      await admin.destroy();
    }
  }
  return { knex, dropDatabase };
}

export { openOwnDatabase };
