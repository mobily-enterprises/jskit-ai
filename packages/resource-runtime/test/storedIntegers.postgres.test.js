import { storedIntegerCases } from "./support/storedIntegerCases.js";

// Non-id BIGINT columns read through a handle on PostgreSQL: run with TEST_DB_NAME (and the usual DB_HOST, DB_PORT,
// DB_USER and DB_PASSWORD) naming a PostgreSQL database, and DB_CLIENT unset or pg.
storedIntegerCases("postgres");
