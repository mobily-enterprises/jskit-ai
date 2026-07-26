import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import descriptor from "../package.descriptor.mjs";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

test("database-runtime runs deferred constraints after all ordinary migrations", async () => {
  const knexfile = await readFile(path.join(PACKAGE_ROOT, "templates/knexfile.js"), "utf8");
  const deferredDirectoryMutation = descriptor.mutations.files.find(
    (mutation) => mutation.id === "database-runtime-constraint-migrations-dir"
  );

  assert.match(
    knexfile,
    /directory:\s*\[migrationsDirectory,\s*deferredConstraintsDirectory\]/
  );
  assert.match(knexfile, /sortDirsSeparately:\s*true/);
  assert.match(knexfile, /path\.join\(migrationsDirectory,\s*"constraints"\)/);
  assert.equal(deferredDirectoryMutation?.to, "migrations/constraints/.gitkeep");
});
