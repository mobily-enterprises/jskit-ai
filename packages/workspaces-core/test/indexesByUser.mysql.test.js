import { indexesByUserCases, migrationOrderCases, openMysql } from "./support/indexesByUserCases.js";

// workspaces_core_indexes_by_user and workspaces_core_person_indexes on MariaDB/MySQL, whose foreign keys' own indexes
// serve these reads.
indexesByUserCases(openMysql("ws_by_user"), { dialect: "mysql" });
migrationOrderCases(openMysql("ws_order"), { dialect: "mysql" });
