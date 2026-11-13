import { indexesByUserCases, openMysql } from "./support/indexesByUserCases.js";

// workspaces_core_indexes_by_user on MariaDB/MySQL, whose foreign keys' own indexes serve these reads.
indexesByUserCases(openMysql("ws_by_user"), { dialect: "mysql" });
