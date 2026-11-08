import { listByIdsCases } from "./support/listByIdsCases.js";
import { usersDatabase } from "./support/usersDatabases.js";

// users.profiles.listByIds on MariaDB/MySQL.
listByIdsCases(usersDatabase("users_ids"));
