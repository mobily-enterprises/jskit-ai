import { openSqliteLocalAuth } from "./support/localAuthRuntime.js";
import { tokenKindCases } from "./support/tokenKindCases.js";

tokenKindCases((context) => openSqliteLocalAuth(context));
