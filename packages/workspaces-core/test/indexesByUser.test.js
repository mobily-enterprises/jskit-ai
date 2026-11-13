import { indexesByUserCases, openSqlite } from "./support/indexesByUserCases.js";

// workspaces_core_indexes_by_user on SQLite.
indexesByUserCases(openSqlite, { dialect: "sqlite", database: false });
