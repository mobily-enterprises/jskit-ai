import { defineCrudJsonApiFeature } from "@jskit-ai/crud-core/server/defineCrudJsonApiFeature";
import { bookResource } from "../shared/bookResource.js";

const BooksFeature = defineCrudJsonApiFeature({
  resource: bookResource,
  id: "app.books",
  capability: "app.books",
  surface: "app",
  ownershipFilter: "user",
  relativePath: "/books"
});

export { BooksFeature };
