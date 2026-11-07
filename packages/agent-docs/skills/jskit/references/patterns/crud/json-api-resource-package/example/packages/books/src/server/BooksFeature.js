import { defineCrudFeature } from "@jskit-ai/crud-core/server/defineCrudFeature";
import { bookCrud } from "../shared/bookResource.js";

// Owns the books table and serves its CRUD contract.
const BooksFeature = defineCrudFeature({
  crud: bookCrud,
  id: "app.books",
  capability: "app.books",
  surface: "app",
  relativePath: "/books"
});

export { BooksFeature };
