import knex from "knex";

// Application-owned test setup. Schema migration tests use a separate fresh database.
async function prepareBrowserTestDatabase({ knexConfig, environment = process.env, seed }) {
  const started = performance.now();
  if (environment.NODE_ENV === "production") throw new Error("Browser tests cannot prepare a production runtime.");
  if (typeof seed !== "function") throw new TypeError("An explicit browser fixture seed is required.");
  if (knexConfig?.client !== "mysql2" || !knexConfig.connection || typeof knexConfig.connection !== "object") {
    throw new Error("Browser preparation requires a resolved MySQL Knex configuration.");
  }
  const database = String(environment.BROWSER_TEST_DB_NAME || "").trim();
  if (!/^[a-zA-Z0-9_]{1,64}$/.test(database)) throw new Error("BROWSER_TEST_DB_NAME must name the exact browser database.");
  const protectedNames = [knexConfig.connection.database, environment.DB_NAME, environment.TEST_DB_NAME];
  if (environment.DATABASE_URL) {
    try { protectedNames.push(decodeURIComponent(new URL(environment.DATABASE_URL).pathname.slice(1))); }
    catch { throw new Error("DATABASE_URL must be a valid database URL."); }
  }
  if (!knexConfig.connection.database || protectedNames.some(name => String(name || "").trim().toLowerCase() === database.toLowerCase())) {
    throw new Error("BROWSER_TEST_DB_NAME must differ from the application and disposable TEST_DB_NAME databases.");
  }
  const adminConnection = { ...knexConfig.connection };
  delete adminConnection.database;
  const admin = knex({ ...knexConfig, connection: adminConnection, pool: { min: 0, max: 1 } });
  let schemaExisted;
  try {
    const [[row]] = await admin.raw("SELECT COUNT(*) AS count FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?", [database]);
    schemaExisted = Number(row.count) === 1;
    await admin.raw("CREATE DATABASE IF NOT EXISTS ??", [database]);
  }
  finally { await admin.destroy(); }
  console.info(`Browser database ${database}: ${schemaExisted ? "existing schema" : "new schema"}.`);
  const db = knex({ ...knexConfig, connection: { ...knexConfig.connection, database } });
  try {
    const migrationStarted = performance.now();
    const [, migrations] = await db.migrate.latest();
    const migrationMs = Math.round(performance.now() - migrationStarted);
    console.info(`Browser migrations: ${migrations.length} applied in ${migrationMs}ms.`);
    const resetStarted = performance.now();
    let resetTables = 0;
    const connection = await db.client.acquireConnection();
    try {
      const [[actual]] = await db.raw("SELECT DATABASE() AS databaseName").connection(connection);
      if (actual.databaseName !== database) throw new Error("Browser reset requires the exact BROWSER_TEST_DB_NAME connection.");
      const [tables] = await db.raw(
        "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'", [database]
      ).connection(connection);
      const ledger = knexConfig.migrations?.tableName || "knex_migrations";
      await db.raw("SET FOREIGN_KEY_CHECKS = 0").connection(connection);
      try {
        for (const { name } of tables) {
          if (name === ledger || name === `${ledger}_lock`) continue;
          await db.raw("TRUNCATE TABLE ??", [name]).connection(connection);
          resetTables += 1;
        }
      } finally { await db.raw("SET FOREIGN_KEY_CHECKS = 1").connection(connection); }
    } finally { await db.client.releaseConnection(connection); }
    const resetMs = Math.round(performance.now() - resetStarted);
    console.info(`Browser fixture reset: ${resetTables} tables in ${resetMs}ms.`);
    const seedStarted = performance.now();
    await db.transaction(seed);
    const seedMs = Math.round(performance.now() - seedStarted);
    const totalMs = Math.round(performance.now() - started);
    console.info(`Browser fixture seed: ${seedMs}ms; database preparation total: ${totalMs}ms.`);
    return { database, migrations, schemaExisted, timings: { migrationMs, resetMs, seedMs, totalMs } };
  } finally { await db.destroy(); }
}

export { prepareBrowserTestDatabase };
