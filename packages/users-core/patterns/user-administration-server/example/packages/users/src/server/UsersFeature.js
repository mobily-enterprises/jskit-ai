import { defineCrudJsonApiFeature } from "@jskit-ai/crud-core/server/defineCrudJsonApiFeature";
import { resource } from "../shared/userResource.js";

const UsersFeature = defineCrudJsonApiFeature({
  resource,
  id: "app.users",
  capability: "app.users",
  surface: "home",
  ownershipFilter: "public",
  relativePath: "/users"
});

export { UsersFeature };
