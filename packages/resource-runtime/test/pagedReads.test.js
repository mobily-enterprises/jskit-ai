import test from "node:test";
import { createPackageTestKnex } from "../src/test/index.js";
import { pagedReadsCases } from "./support/pagedReadsCases.js";

// SQLite in memory, or a PostgreSQL schema of its own on a DB_CLIENT=pg run (see createPackageTestKnex).
for (const [name, run] of pagedReadsCases((t) => createPackageTestKnex(t, { environment: process.env }))) {
  test(name, run);
}
