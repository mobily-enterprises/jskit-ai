import { POSTGRES_ELSEWHERE, openPostgresLocalAuth } from "./support/postgresLocalAuth.js";
import { signInFactsCases } from "./support/signInFactsCases.js";

signInFactsCases(openPostgresLocalAuth, { database: true, skip: POSTGRES_ELSEWHERE });
