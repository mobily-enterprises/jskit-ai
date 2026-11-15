import { openMysql } from "./support/indexesByUserCases.js";
import { transferOwnershipCases } from "./support/transferOwnershipCases.js";

// workspaces.transferOwnership on MariaDB/MySQL, where two transfers at once wait for each other's row locks.
transferOwnershipCases(openMysql("ws_transfer"), { dialect: "mysql" });
