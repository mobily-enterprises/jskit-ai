import { openSqliteLocalAuth } from "./support/localAuthRuntime.js";
import { secondFactorCases } from "./support/secondFactorCases.js";

secondFactorCases((context) => openSqliteLocalAuth(context));
