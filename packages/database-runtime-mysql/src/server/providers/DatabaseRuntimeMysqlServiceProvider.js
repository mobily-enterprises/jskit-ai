import * as mysqlDialect from "../../shared/index.js";

const DATABASE_DRIVER_MYSQL_TOKEN = "runtime.database.driver.mysql";

const MYSQL_DATABASE_DRIVER_API = Object.freeze({
  ...mysqlDialect
});

class DatabaseRuntimeMysqlServiceProvider {
  static id = DATABASE_DRIVER_MYSQL_TOKEN;

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("DatabaseRuntimeMysqlServiceProvider requires application singleton().");
    }

    app.singleton(DATABASE_DRIVER_MYSQL_TOKEN, () => MYSQL_DATABASE_DRIVER_API);
  }

  boot() {}
}

export { DatabaseRuntimeMysqlServiceProvider };
