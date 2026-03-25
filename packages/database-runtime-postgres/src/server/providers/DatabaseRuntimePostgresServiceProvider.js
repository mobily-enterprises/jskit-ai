import * as postgresDialect from "../../shared/index.js";

const POSTGRES_DATABASE_DRIVER_API = Object.freeze({
  ...postgresDialect
});

class DatabaseRuntimePostgresServiceProvider {
  static id = "runtime.database.driver.postgres";

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("DatabaseRuntimePostgresServiceProvider requires application singleton().");
    }

    app.singleton("runtime.database.driver.postgres", () => POSTGRES_DATABASE_DRIVER_API);
  }

  boot() {}
}

export { DatabaseRuntimePostgresServiceProvider };
