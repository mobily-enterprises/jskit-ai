import { defineCrudJsonApiFeature } from "@jskit-ai/crud-core/server/defineCrudJsonApiFeature";
import { userCrud } from "../shared/userCrud.js";

const UsersFeature = defineCrudJsonApiFeature({
  resource: userCrud,
  id: "app.users",
  capability: "app.users",
  surface: "home",
  ownershipFilter: "public",
  relativePath: "/users"
});

export { UsersFeature };
