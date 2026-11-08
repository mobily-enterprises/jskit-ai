import { POSTGRES_ELSEWHERE, openPostgresLocalAuth } from "./support/postgresLocalAuth.js";
import { tokenKindCases } from "./support/tokenKindCases.js";

tokenKindCases(openPostgresLocalAuth, { database: true, skip: POSTGRES_ELSEWHERE });
