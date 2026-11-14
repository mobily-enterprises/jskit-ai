import { POSTGRES_ELSEWHERE, indexesByUserCases, migrationOrderCases, openPostgres } from "./support/indexesByUserCases.js";

// workspaces_core_indexes_by_user and workspaces_core_person_indexes on PostgreSQL.
indexesByUserCases(openPostgres("ws_by_user"), { dialect: "postgres", skip: POSTGRES_ELSEWHERE });
migrationOrderCases(openPostgres("ws_order"), { dialect: "postgres", skip: POSTGRES_ELSEWHERE });
