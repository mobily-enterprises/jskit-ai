import { openLocalAuthDatabase } from "./support/mysqlLocalAuth.js";
import { secondFactorCases } from "./support/secondFactorCases.js";

secondFactorCases(openLocalAuthDatabase, { database: true });
