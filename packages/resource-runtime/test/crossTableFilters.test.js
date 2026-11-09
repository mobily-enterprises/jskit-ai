import test from "node:test";
import { createPackageTestKnex } from "../src/test/index.js";
import { crossTableFiltersCases } from "./support/crossTableFiltersCases.js";

// SQLite in memory, or a PostgreSQL schema of its own on a DB_CLIENT=pg run (see createPackageTestKnex).
for (const [name, run] of crossTableFiltersCases((t) => createPackageTestKnex(t, { environment: process.env }))) {
  test(name, run);
}
