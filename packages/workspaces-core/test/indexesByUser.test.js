import { indexesByUserCases, migrationOrderCases, openSqlite } from "./support/indexesByUserCases.js";

// workspaces_core_indexes_by_user and workspaces_core_person_indexes on SQLite.
indexesByUserCases(openSqlite, { dialect: "sqlite", database: false });
migrationOrderCases(openSqlite, { dialect: "sqlite", database: false });
