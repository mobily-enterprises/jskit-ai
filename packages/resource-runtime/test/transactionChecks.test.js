import test from "node:test";
import { createPackageTestKnex } from "../src/test/index.js";
import { transactionChecksCases } from "./support/transactionChecksCases.js";

// SQLite in memory, or on a DB_CLIENT=pg or mysql2 run a schema or database of its own (see createPackageTestKnex).
for (const [name, run] of transactionChecksCases((t) => createPackageTestKnex(t, { environment: process.env }))) {
  test(name, run);
}
