import { openSqlite } from "./support/indexesByUserCases.js";
import { transferOwnershipCases } from "./support/transferOwnershipCases.js";

// workspaces.transferOwnership on SQLite.
transferOwnershipCases(openSqlite, { dialect: "sqlite", database: false });
