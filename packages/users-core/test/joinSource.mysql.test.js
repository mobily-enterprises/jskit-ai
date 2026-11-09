import { joinSourceCases } from "./support/joinSourceCases.js";
import { usersDatabase } from "./support/usersDatabases.js";

// users.profiles.joinSource and users.settings.joinSource on MariaDB/MySQL.
joinSourceCases(usersDatabase("users_join"));
