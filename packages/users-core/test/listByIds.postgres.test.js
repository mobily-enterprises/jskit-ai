import { listByIdsCases } from "./support/listByIdsCases.js";
import { POSTGRES_ELSEWHERE, postgresUsersDatabase } from "./support/usersDatabases.js";

// users.profiles.listByIds on PostgreSQL: run with TEST_DB_NAME (and the usual DB_HOST, DB_PORT, DB_USER and
// DB_PASSWORD) naming a PostgreSQL database, and DB_CLIENT unset or pg.
listByIdsCases(postgresUsersDatabase("users_ids"), { skip: POSTGRES_ELSEWHERE });
