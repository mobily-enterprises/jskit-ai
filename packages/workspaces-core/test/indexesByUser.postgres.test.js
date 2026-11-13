import { POSTGRES_ELSEWHERE, indexesByUserCases, openPostgres } from "./support/indexesByUserCases.js";

// workspaces_core_indexes_by_user on PostgreSQL.
indexesByUserCases(openPostgres("ws_by_user"), { dialect: "postgres", skip: POSTGRES_ELSEWHERE });
