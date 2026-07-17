import assert from "node:assert/strict";
import test from "node:test";
import descriptor from "../package.descriptor.mjs";

test("database-runtime db migrate scripts sync JSKIT-managed migrations before Knex reads them", () => {
  const scripts = descriptor.mutations.packageJson.scripts;

  assert.equal(scripts["db:migrations:sync"], "jskit migrations changed");
  assert.equal(
    scripts["db:migrate"],
    "npm run db:migrations:sync && knex --knexfile ./knexfile.js migrate:latest"
  );
  assert.equal(
    scripts["db:migrate:status"],
    "npm run db:migrations:sync && knex --knexfile ./knexfile.js migrate:list"
  );
  assert.equal(
    scripts["db:migrate:rollback"],
    "knex --knexfile ./knexfile.js migrate:rollback"
  );
  assert.deepEqual(descriptor.ci.steps, [
    {
      id: "database-migrations",
      phase: "before-verify",
      label: "Apply database migrations",
      command: "npm run db:migrate"
    }
  ]);
});
