import test from "node:test";
import { createPackageTestKnex } from "../src/test/index.js";
import { lockPolicyCases } from "./support/lockPolicyCases.js";

// SQLite in memory, or on a DB_CLIENT=pg or mysql2 run a schema or database of its own (see createPackageTestKnex).
for (const [name, run] of lockPolicyCases((t) => createPackageTestKnex(t, { environment: process.env }))) {
  test(name, run);
}
