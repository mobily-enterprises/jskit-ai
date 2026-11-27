// The databases a test process may open. A process a test run gave its databases names them in
// JSKIT_TEST_DATABASE_GUARD, which the processes it starts inherit: a `jskit test --databases` file its copy and the
// lettered copies its package data tests claim (testDatabaseFile.js), a browser run's Playwright worker its own
// server's (browserTestConfig() of @jskit-ai/jskit-catalog/browser-tests, which writes the same variable). The
// application's knexfile settings (createKnexMigrationConfig()) and its runtime's database (createDatabase()) then
// refuse any other name before anything connects, so a test never reaches a development or production database
// whatever its environment's DB_NAME or DATABASE_URL holds. The variable holds JSON `{ databases, given, fix }`: the
// names, what gave them ("this test file was given by ..."), and how a test reaches one.
const TEST_DATABASE_GUARD = "JSKIT_TEST_DATABASE_GUARD";

/** The names, shortened past four: `a, b and 25 more`. */
function shown(databases) {
  if (databases.length === 0) return "none";
  return databases.length > 4 ? `${databases.slice(0, 2).join(", ")} and ${databases.length - 2} more` : databases.join(", ");
}

/**
 * Refuses `database`, the name `environment` gives a connection, unless this process's test run gave it; does nothing
 * in a process no test run gave databases.
 * @param {Record<string, string | undefined>} environment The environment the connection's settings came from.
 * @param {string} database
 */
function refuseNonTestDatabase(environment, database) {
  const text = String(environment?.[TEST_DATABASE_GUARD] || process.env[TEST_DATABASE_GUARD] || "").trim();
  if (!text) return;
  const { databases = [], given = "this test process was given", fix = "" } = JSON.parse(text);
  if (databases.includes(database)) return;
  const variable = String(environment?.DB_NAME || "").trim() ? "DB_NAME" : "DATABASE_URL";
  throw new Error(`${variable} names ${database}, which is not one of the test databases ${given} (${shown(databases)}): ` +
    `a test never reaches a development or production database. ${fix}`.trim());
}

export { TEST_DATABASE_GUARD, refuseNonTestDatabase };
