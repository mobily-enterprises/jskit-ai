import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Every package migration that creates a table creates it, on MySQL and MariaDB, in the collation of the tables
// already there rather than the database's default: a released one through its companion `<name>-collation.cjs`,
// which Knex sorts just before it, a new one by calling migrateInExistingCollation itself
// (@jskit-ai/database-runtime/server/tableCollationMigrations).

const PACKAGES = fileURLToPath(new URL("../../../packages/", import.meta.url));

// Released table migrations a companion cannot serve, and why.
const WITHOUT_COMPANION = Object.freeze({
  "payments-core/migrations/payments_core_initial.cjs":
    "creates its tables without checking whether they exist, so a companion cannot create them first; its one key joins two of its own tables",
  "connectors-core/migrations/connectors_core_initial.cjs":
    "creates its tables without checking whether they exist, so a companion cannot create them first; its one key joins two of its own tables",
  "agent-runtime/migrations/agent_initial.cjs": "runs on PostgreSQL only (jsonb columns, partial indexes)"
});

function packageMigrations() {
  const files = [];
  for (const packageName of readdirSync(PACKAGES)) {
    const directory = path.join(PACKAGES, packageName, "migrations");
    let names;
    try {
      names = readdirSync(directory);
    } catch {
      continue;
    }
    // Knex sorts a directory's files with the default sort.
    const sorted = names.filter((name) => name.endsWith(".cjs")).sort();
    for (const name of sorted) {
      files.push({ id: `${packageName}/migrations/${name}`, directory, name, sorted, source: readFileSync(path.join(directory, name), "utf8") });
    }
  }
  return files;
}

test("each package migration that creates a table runs in the collation of the existing tables", () => {
  const migrations = packageMigrations();
  const creating = migrations.filter(({ name, source }) => !name.endsWith("-collation.cjs") && /\.createTable\(/u.test(source));
  assert.ok(creating.length > 10, `found ${creating.length} table migrations`);
  for (const { id, name, sorted, source } of creating) {
    if (Object.hasOwn(WITHOUT_COMPANION, id) || source.includes("migrateInExistingCollation")) continue;
    const companion = name.replace(/\.cjs$/u, "-collation.cjs");
    assert.ok(sorted.includes(companion), `${id} creates a table: add ${companion}, which runs it through migrateInExistingCollation`);
  }
  for (const id of Object.keys(WITHOUT_COMPANION)) {
    assert.ok(creating.some((migration) => migration.id === id), `${id} is listed without a companion but creates no table`);
  }
});

test("each companion runs the released migration Knex sorts right after it, and names it as Knex records it", () => {
  for (const { id, name, sorted, source } of packageMigrations().filter((migration) => migration.name.endsWith("-collation.cjs"))) {
    const released = name.replace(/-collation\.cjs$/u, ".cjs");
    assert.equal(sorted[sorted.indexOf(name) + 1], released, `${id} sorts just before ${released}`);
    assert.ok(source.includes(`require("./${released}")`), `${id} runs ${released}`);
    assert.ok(source.includes(`migration: "${released}"`), `${id} names ${released}`);
    assert.ok(source.includes("migrateInExistingCollation"), `${id} runs it through migrateInExistingCollation`);
  }
});
