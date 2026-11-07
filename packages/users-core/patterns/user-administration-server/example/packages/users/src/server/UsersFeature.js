import { defineCrudFeature } from "@jskit-ai/crud-core/server/defineCrudFeature";
import { userCrud } from "../shared/userCrud.js";

// users-core owns the users table; this feature serves the administration
// CRUD contract through its owner's repository.
const UsersFeature = defineCrudFeature({
  crud: userCrud,
  ownerRepository: "users.profiles",
  id: "app.users",
  capability: "app.users",
  surface: "home",
  relativePath: "/users"
});

export { UsersFeature };
