import { joinSourceCases } from "./support/joinSourceCases.js";
import { POSTGRES_ELSEWHERE, postgresUsersDatabase } from "./support/usersDatabases.js";

// users.profiles.joinSource and users.settings.joinSource on PostgreSQL: run with TEST_DB_NAME (and the usual DB_HOST,
// DB_PORT, DB_USER and DB_PASSWORD) naming a PostgreSQL database, and DB_CLIENT unset or pg.
joinSourceCases(postgresUsersDatabase("users_join"), { skip: POSTGRES_ELSEWHERE });
