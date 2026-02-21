import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const MYSQL_IDENTIFIER_LIMIT = 64;
const BILLING_MIGRATION_FILES = [
  "migrations/20260221090000_create_billing_phase1_tables.cjs",
  "migrations/20260221110000_add_billing_phase2_1_tables.cjs"
];

function readMigrationSource(filePath) {
  return readFileSync(path.resolve(process.cwd(), filePath), "utf8");
}

function collectSchemaIdentifierNames(source) {
  const names = new Set();

  for (const match of source.matchAll(/["'`]((?:uq|idx|fk|chk)_[^"'`\s)]+)["'`]/g)) {
    names.add(match[1]);
  }

  for (const match of source.matchAll(/ADD\s+CONSTRAINT\s+([A-Za-z0-9_]+)/g)) {
    names.add(match[1]);
  }

  return [...names];
}

test("billing migrations keep schema identifier names within MySQL limits", () => {
  for (const migrationFile of BILLING_MIGRATION_FILES) {
    const source = readMigrationSource(migrationFile);
    const oversized = collectSchemaIdentifierNames(source).filter((name) => name.length > MYSQL_IDENTIFIER_LIMIT);
    assert.deepEqual(
      oversized,
      [],
      `${migrationFile} contains identifier names longer than ${MYSQL_IDENTIFIER_LIMIT}: ${oversized.join(", ")}`
    );
  }
});

test("billing migrations pin explicit names for historically overlong constraints", () => {
  const phase1Source = readMigrationSource(BILLING_MIGRATION_FILES[0]);
  const phase21Source = readMigrationSource(BILLING_MIGRATION_FILES[1]);

  assert.match(phase1Source, /fk_bsub_customer_entity_provider/);
  assert.match(phase1Source, /fk_bsub_items_plan_price_provider/);
  assert.match(phase1Source, /fk_bsub_remediations_canonical_subscription/);
  assert.match(phase1Source, /chk_bsub_remediations_distinct_provider_subs/);
  assert.match(phase21Source, /fk_bpay_methods_customer_entity_provider/);
});
