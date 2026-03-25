import * as mysqlDialect from "../../shared/index.js";

const MYSQL_DATABASE_DRIVER_API = Object.freeze({
  ...mysqlDialect
});

class DatabaseRuntimeMysqlServiceProvider {
  static id = "runtime.database.driver.mysql";

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("DatabaseRuntimeMysqlServiceProvider requires application singleton().");
    }

    app.singleton("runtime.database.driver.mysql", () => MYSQL_DATABASE_DRIVER_API);
  }

  boot() {}
}

export { DatabaseRuntimeMysqlServiceProvider };
