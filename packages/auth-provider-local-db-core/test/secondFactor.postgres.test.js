import { POSTGRES_ELSEWHERE, openPostgresLocalAuth } from "./support/postgresLocalAuth.js";
import { secondFactorCases } from "./support/secondFactorCases.js";

secondFactorCases(openPostgresLocalAuth, { database: true, skip: POSTGRES_ELSEWHERE });
