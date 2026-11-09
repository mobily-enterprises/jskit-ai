import test from "node:test";
import { createPackageTestKnex } from "../src/test/index.js";
import { reportsAcrossOwnersCases } from "./support/reportsAcrossOwnersCases.js";

// SQLite in memory, or a PostgreSQL schema of its own on a DB_CLIENT=pg run (see createPackageTestKnex).
for (const [name, run] of reportsAcrossOwnersCases((t) => createPackageTestKnex(t, { environment: process.env }))) {
  test(name, run);
}
