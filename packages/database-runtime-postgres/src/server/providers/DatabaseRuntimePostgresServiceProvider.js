import * as postgresDialect from "../../shared/index.js";

const DATABASE_DRIVER_POSTGRES_TOKEN = "runtime.database.driver.postgres";

const POSTGRES_DATABASE_DRIVER_API = Object.freeze({
  ...postgresDialect
});

class DatabaseRuntimePostgresServiceProvider {
  static id = DATABASE_DRIVER_POSTGRES_TOKEN;

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("DatabaseRuntimePostgresServiceProvider requires application singleton().");
    }

    app.singleton(DATABASE_DRIVER_POSTGRES_TOKEN, () => POSTGRES_DATABASE_DRIVER_API);
  }

  boot() {}
}

export { DatabaseRuntimePostgresServiceProvider };
