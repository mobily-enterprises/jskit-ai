import { POSTGRES_ELSEWHERE, openPostgres } from "./support/indexesByUserCases.js";
import { transferOwnershipCases } from "./support/transferOwnershipCases.js";

// workspaces.transferOwnership on PostgreSQL, where two transfers at once wait for each other's row locks.
transferOwnershipCases(openPostgres("ws_transfer"), { dialect: "postgres", skip: POSTGRES_ELSEWHERE });
