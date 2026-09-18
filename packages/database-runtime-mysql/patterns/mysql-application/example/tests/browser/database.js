import knex from "knex";

// Application-owned test setup. Schema migration tests use a separate fresh database.
async function prepareBrowserTestDatabase({ knexConfig, environment = process.env, seed }) {
  if (environment.NODE_ENV === "production") throw new Error("Browser tests cannot prepare a production runtime.");
  if (typeof seed !== "function") throw new TypeError("An explicit browser fixture seed is required.");
  if (knexConfig?.client !== "mysql2" || !knexConfig.connection || typeof knexConfig.connection !== "object") {
    throw new Error("Browser preparation requires a resolved MySQL Knex configuration.");
  }
  const database = String(environment.TEST_DB_NAME || "").trim();
  if (!/^[a-zA-Z0-9_]{1,64}$/.test(database)) throw new Error("TEST_DB_NAME must name the exact disposable database.");
  const protectedNames = [knexConfig.connection.database, environment.DB_NAME];
  if (environment.DATABASE_URL) {
    try { protectedNames.push(decodeURIComponent(new URL(environment.DATABASE_URL).pathname.slice(1))); }
    catch { throw new Error("DATABASE_URL must be a valid database URL."); }
  }
  if (!knexConfig.connection.database || protectedNames.some(name => String(name || "").trim().toLowerCase() === database.toLowerCase())) {
    throw new Error("TEST_DB_NAME must differ from every configured application database.");
  }
  const adminConnection = { ...knexConfig.connection };
  delete adminConnection.database;
  const admin = knex({ ...knexConfig, connection: adminConnection, pool: { min: 0, max: 1 } });
  try { await admin.raw("CREATE DATABASE IF NOT EXISTS ??", [database]); }
  finally { await admin.destroy(); }
  const db = knex({ ...knexConfig, connection: { ...knexConfig.connection, database } });
  try {
    const [, migrations] = await db.migrate.latest();
    const connection = await db.client.acquireConnection();
    try {
      const [[actual]] = await db.raw("SELECT DATABASE() AS databaseName").connection(connection);
      if (actual.databaseName !== database) throw new Error("Browser reset requires the exact TEST_DB_NAME connection.");
      const [tables] = await db.raw(
        "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'", [database]
      ).connection(connection);
      const ledger = knexConfig.migrations?.tableName || "knex_migrations";
      await db.raw("SET FOREIGN_KEY_CHECKS = 0").connection(connection);
      try {
        for (const { name } of tables) {
          if (name === ledger || name === `${ledger}_lock`) continue;
          await db.raw("TRUNCATE TABLE ??", [name]).connection(connection);
        }
      } finally { await db.raw("SET FOREIGN_KEY_CHECKS = 1").connection(connection); }
    } finally { await db.client.releaseConnection(connection); }
    await db.transaction(seed);
    return { database, migrations };
  } finally { await db.destroy(); }
}

export { prepareBrowserTestDatabase };
