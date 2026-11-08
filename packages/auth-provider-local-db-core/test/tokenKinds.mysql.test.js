import { openLocalAuthDatabase } from "./support/mysqlLocalAuth.js";
import { tokenKindCases } from "./support/tokenKindCases.js";

tokenKindCases(openLocalAuthDatabase, { database: true });
