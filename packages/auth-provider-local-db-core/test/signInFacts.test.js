import { openSqliteLocalAuth } from "./support/localAuthRuntime.js";
import { signInFactsCases } from "./support/signInFactsCases.js";

signInFactsCases((context) => openSqliteLocalAuth(context));
